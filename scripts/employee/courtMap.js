import { supabase } from "../supabase/supabaseClient.js";
import { saveLog } from "../sysAdmin/sysLogs.js";

// ─── STATE ───
let isRenderingCourtMap = false;
let renderQueued = false;
let isMaintenanceRunning = false;
let selectedReviewIssue = null;
let currentUserId = null;

// ─── CACHE ───
function getCacheKey() {
    return `courtmap_cache_${currentUserId}`;
}

function loadCachedView() {
    try {
        const raw = sessionStorage.getItem(getCacheKey());
        if (!raw) return;

        const cached = JSON.parse(raw);

        const mapping = {
            dynamicContent: cached.content,
            scrollSection: cached.scroll,
            alertFeed: cached.feed,
            issueReportsFeed: cached.issues
        };

        Object.entries(mapping).forEach(([id, html]) => {
            const el = document.getElementById(id);
            if (el && typeof html === "string" && html) el.innerHTML = html;
        });

        applyCourtSearch();
    } catch {
        sessionStorage.removeItem(getCacheKey());
    }
}

function saveCachedView() {
    try {
        const read = id => document.getElementById(id)?.innerHTML ?? "";

        sessionStorage.setItem(getCacheKey(), JSON.stringify({
            content: read("dynamicContent"),
            scroll: read("scrollSection"),
            feed: read("alertFeed"),
            issues: read("issueReportsFeed")
        }));
    } catch {
        sessionStorage.removeItem(getCacheKey());
    }
}

// ─── START ───
async function start() {
    document.getElementById("courtSearch")?.addEventListener("input", applyCourtSearch);
    const { data: { session } } = await supabase.auth.getSession();
    const user = session?.user;

    if (!user) {
        window.location.href = "../../pages/auth/login.html";
        return;
    }

    currentUserId = user.id;

    loadCachedView();

    document.querySelector(".bottom-content a")?.addEventListener("click", async (e) => {
        e.preventDefault();
        await supabase.auth.signOut();
        window.location.href = "../../pages/auth/login.html";
    });

    const { data: profile } = await supabase
        .from("profiles")
        .select("role")
        .eq("id", user.id)
        .single();

    if (!profile || profile.role === "player") {
        showAlert("Access denied. Employee only.", "error");
        window.location.href = "../../pages/auth/login.html";
        return;
    }

    listenToIssueReports();

    supabase
        .channel("courtmap-realtime")
        .on(
            "postgres_changes",
            { event: "*", schema: "public", table: "reservations" },
            async () => {
                await Promise.all([
                    renderCourtMap(),
                    renderIssueReports()
                ]);
            }
        )
        .subscribe();

    setInterval(async () => {
        if (isRenderingCourtMap) return;
        await runMaintenance();
        await renderCourtMap();
    }, 10000);

    await Promise.all([
        renderCourtMap(),
        renderIssueReports()
    ]);

    const changed = await runMaintenance();

    if (changed) {
        await renderCourtMap();
    }
    
}

// ─── TIME HELPERS ───
function parseTimeToMinutes(timeStr) {
    if (!timeStr) return null;

    const value = timeStr.trim().toUpperCase();
    const match = value.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/);

    if (!match) return null;

    let hours = parseInt(match[1], 10);
    const minutes = parseInt(match[2], 10);
    const period = match[3];

    if (period === "AM" && hours === 12) hours = 0;
    if (period === "PM" && hours !== 12) hours += 12;

    return hours * 60 + minutes;
}

function getCountdownLabel(startTime) {
    const now = new Date();
    const currentMinutes = now.getHours() * 60 + now.getMinutes();
    const startMinutes = parseTimeToMinutes(startTime);

    if (startMinutes === null) {
        return { text: "Time unavailable", type: "unknown" };
    }

    const diff = startMinutes - currentMinutes;

    if (diff > 30) return { text: `Starts in ${diff} min`, type: "normal" };
    if (diff > 0) return { text: `Starting in ${diff} min`, type: "soon" };
    if (diff === 0) return { text: "Start now", type: "now" };

    return {
        text: `Late by ${Math.abs(diff)} min`,
        type: "late"
    };
}

// ─── MAINTENANCE ───
async function autoMarkDoneExpired() {
    const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Manila" });
    const now = new Date();
    const currentMinutes = now.getHours() * 60 + now.getMinutes();

    const { data } = await supabase
        .from("reservations")
        .select("id,end_time")
        .eq("reservation_date", today)
        .eq("status", "playing");

    if (!data?.length) return 0;

    const expiredIds = data
        .filter(r => {
            const endMinutes = parseTimeToMinutes(r.end_time);
            return endMinutes !== null && currentMinutes >= endMinutes;
        })
        .map(r => r.id);

    if (!expiredIds.length) return 0;

    await Promise.all(expiredIds.map(id => supabase.rpc("mark_done", { p_id: id })));

    return expiredIds.length;
}

async function autoCancelLateConfirmed() {
    const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Manila" });
    const now = new Date();
    const currentMinutes = now.getHours() * 60 + now.getMinutes();

    const { data } = await supabase
        .from("reservations")
        .select("id,start_time")
        .eq("reservation_date", today)
        .eq("status", "confirmed");

    if (!data?.length) return 0;

    const lateIds = data
        .filter(r => {
            const startMinutes = parseTimeToMinutes(r.start_time);
            return startMinutes !== null && currentMinutes - startMinutes >= 30;
        })
        .map(r => r.id);

    if (!lateIds.length) return 0;

    await supabase
        .from("reservations")
        .update({ status: "no_show" })
        .in("id", lateIds);

    return lateIds.length;
}

async function runMaintenance() {
    if (isMaintenanceRunning) return false;
    isMaintenanceRunning = true;

    try {
        const [markedDone, markedNoShow] = await Promise.all([
            autoMarkDoneExpired(),
            autoCancelLateConfirmed()
        ]);

        await supabase.rpc("sync_reservation_states");

        return markedDone > 0 || markedNoShow > 0;
    } catch (err) {
        console.error("Maintenance failed:", err);
        return false;
    } finally {
        isMaintenanceRunning = false;
    }
}

// ─── ISSUE META ───
function getIssueMeta(type) {
    const issue = type?.toLowerCase();

    const map = {
        maintenance: {
            label: "Under Maintenance",
            icon: "bx-wrench",
            class: "maintenance-text"
        },
        accident: {
            label: "Reported Accident",
            icon: "bx-error",
            class: "accident-text"
        },
        incident: {
            label: "Reported Accident",
            icon: "bx-error",
            class: "accident-text"
        },
        other: {
            label: "Reported Issue",
            icon: "bx-info-circle",
            class: "other-text"
        }
    };

    return map[issue] || map.other;
}

// ─── COURT MAP ───
async function renderCourtMap() {
    if (isRenderingCourtMap) {
        renderQueued = true;
        return;
    }

    isRenderingCourtMap = true;

    try {
        await drawCourtMap();
    } finally {
        isRenderingCourtMap = false;

        if (renderQueued) {
            renderQueued = false;
            renderCourtMap();
        }
    }
}

async function drawCourtMap() {
    const content = document.getElementById("dynamicContent");
    if (!content) return;

    const today = new Date().toLocaleDateString("en-CA", {
        timeZone: "Asia/Manila"
    });

    const [
        { data: courts, error: courtError },
        { data: issues },
        { data: reservations },
        { data: pending },
        activityHTML
    ] = await Promise.all([
        supabase.from("courts").select("*").order("id"),
        supabase.from("court_issues")
            .select("court_id,issue_type,description,status,created_at")
            .eq("status", "approved")
            .order("created_at", { ascending: false }),
        supabase.from("reservations")
            .select(`
                id,
                court_id,
                start_time,
                end_time,
                total_amount,
                payment_method,
                reference_number,
                status,
                created_at,
                profiles(full_name,username)
            `)
            .eq("reservation_date", today)
            .in("status", ["confirmed", "playing", "queued"])
            .order("start_time", { ascending: true })
            .order("created_at", { ascending: true }),
        supabase.from("reservations")
            .select(`
                id,
                status,
                start_time,
                payment_method,
                created_at,
                courts(name),
                profiles(full_name,username)
            `)
            .eq("reservation_date", today)
            .in("status", ["pending", "pending_verification"])
            .order("created_at", { ascending: true }),
        renderActivityLog()
    ]);

    if (courtError || !courts) {
        content.innerHTML = `<p style="color:#ef4444;padding:20px;">Failed to load courts.</p>`;
        return;
    }

    const latestIssueMap = {};

    (issues || []).forEach(issue => {
        if (!latestIssueMap[issue.court_id]) {
            latestIssueMap[issue.court_id] = issue;
        }
    });

    const playingByCourt = {};
    const upcoming = [];

    (reservations || []).forEach(r => {
        if (r.status === "playing") {
            if (!playingByCourt[r.court_id]) {
                playingByCourt[r.court_id] = [];
            }

            playingByCourt[r.court_id].push(r);
        }

        if (r.status === "confirmed") {
            upcoming.push(r);
        }
    });

    upcoming.sort((a, b) => {
        return parseTimeToMinutes(a.start_time) - parseTimeToMinutes(b.start_time);
    });

    const gridHTML = courts.map(court => {

        const current = playingByCourt[court.id]?.[0];
        const isOccupied = !!current;
        const isClosed = !court.is_active;

        const issue = latestIssueMap[court.id];
        const meta = getIssueMeta(issue?.issue_type);

        const playerName =
            current?.profiles?.full_name ||
            current?.profiles?.username ||
            "Unknown";

        return `
            <div class="court-card ${isOccupied ? "occupied" : "available"}">

                <div class="court-top">
                    <span class="court-title">${court.name}</span>
                    <span class="court-dot"></span>
                </div>

                ${
                    isClosed
                    ? `
                        <div class="court-status ${meta.class}">
                            <i class='bx ${meta.icon}'></i>
                            ${meta.label}
                        </div>

                        <div class="court-time">
                            ${issue?.description || court.closed_reason || "Court unavailable"}
                        </div>

                        <button class="restore-btn" onclick="restoreCourt(${court.id})">
                            <i class='bx bx-refresh'></i>
                            Restore Court
                        </button>
                    `
                    : isOccupied
                    ? `
                        <div class="court-status occupied-text">
                            <i class='bx bx-time-five'></i>
                            Occupied
                        </div>

                        <div class="court-player">${playerName}</div>

                        <div class="court-time">
                            ${current.start_time} – ${current.end_time}
                        </div>

                        <button class="done-btn" onclick="markDone('${current.id}')">
                            Mark Done
                        </button>
                    `
                    : `
                        <div class="court-status available-text">
                            <i class='bx bx-check-circle'></i>
                            Available
                        </div>
                    `
                }

                <button class="report-issue-btn"
                    onclick="openIssueModal(${court.id}, '${court.name}')">
                    <i class='bx bx-error-alt'></i>
                    Report Issue
                </button>

            </div>
        `;
    }).join("");

    content.innerHTML = `
        <div class="court-grid">
            ${gridHTML}
        </div>
    `;

    const scrollSection = document.getElementById("scrollSection");

    if (scrollSection) {
        scrollSection.innerHTML = `
            <div class="upcoming-activity-grid">

                <div style="background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:14px 16px;">

                    <div style="display:flex;justify-content:space-between;border-bottom:1px solid #eee;padding-bottom:10px;margin-bottom:10px;">
                        <span style="font-size:13px;font-weight:600;color:#6b7280;text-transform:uppercase;">
                            Upcoming Confirmed
                        </span>

                        <span style="font-size:11px;color:#6b7280;background:#f3f4f6;padding:2px 8px;border-radius:999px;">
                            ${upcoming.length} slots
                        </span>
                    </div>

                    <div style="display:flex;flex-direction:column;gap:6px;">

                        ${
                            upcoming.length
                            ? upcoming.map(r => {

                                const name =
                                    r.profiles?.full_name ||
                                    r.profiles?.username ||
                                    "Unknown";

                                const court = courts.find(c => c.id === r.court_id);
                                const countdown = getCountdownLabel(r.start_time);

                                return `
                                    <div style="display:grid;grid-template-columns:120px 1fr;gap:10px;padding:10px;border:1px solid #eee;border-radius:8px;background:#fafafa;">

                                        <div>
                                            <div style="font-size:12px;color:#9ca3af;">
                                                ${court?.name || "Court"}
                                            </div>

                                            <div style="font-size:12px;font-weight:600;">
                                                ${r.start_time} – ${r.end_time}
                                            </div>
                                        </div>

                                        <div>

                                            <div style="font-size:13px;font-weight:600;">
                                                ${name}
                                            </div>

                                            <div style="font-size:11px;color:#9ca3af;">
                                                ${r.payment_method}
                                            </div>

                                            <div style="display:flex;justify-content:space-between;margin-top:5px;">

                                                <span class="al-badge done">
                                                    ${countdown.text}
                                                </span>

                                                <button onclick="startGame('${r.id}')"
                                                    style="font-size:11px;padding:3px 10px;border-radius:6px;border:1px solid #ddd;background:#eff6ff;color:#2563eb;cursor:pointer;">
                                                    ▶ Start
                                                </button>

                                            </div>

                                        </div>

                                    </div>
                                `;
                            }).join("")
                            : `<p class="al-empty">No upcoming slots today.</p>`
                        }

                    </div>

                </div>

                <div style="background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:14px 16px;">
                    ${activityHTML}
                </div>

            </div>
        `;
    }

    const feed = document.getElementById("alertFeed");

    if (feed) {

        if (pending?.length) {

            feed.innerHTML = pending.map(r => {

                const name =
                    r.profiles?.full_name ||
                    r.profiles?.username ||
                    "Player";

                const court = r.courts?.name || "Court";

                const label =
                    r.status === "pending"
                    ? "⏳ Cash Pending at Counter"
                    : "⏳ GCash Pending Verify";

                return `
                    <div class="alert-item">
                        <span>${label} · ${court} · ${name}</span>
                        <small>${r.start_time}</small>
                    </div>
                `;
            }).join("");

        } else {
            feed.innerHTML = `<p style="font-size:12px;color:#888;">No pending payments.</p>`;
        }
    }

    await updateDowntimeButtons(courts);
    saveCachedView();
    applyCourtSearch();
}

// ─── DOWNTIME BUTTONS ───
async function updateDowntimeButtons(courtsData = null) {

    const downtimeBtn = document.getElementById("downtimeBtn");
    const activateBtn = document.getElementById("activateBtn");

    if (!downtimeBtn || !activateBtn) return;

    let data = courtsData;

    if (!data) {
        const result = await supabase
            .from("courts")
            .select("is_active");

        data = result.data;
    }

    const hasActive = data?.some(c => c.is_active);

    if (hasActive) {
        downtimeBtn.style.display = "flex";
        activateBtn.style.display = "none";
    } else {
        downtimeBtn.style.display = "none";
        activateBtn.style.display = "flex";
    }
}

// ─── ACTIVITY LOG ───
async function renderActivityLog() {

    const today = new Date().toLocaleDateString("en-CA", {
        timeZone: "Asia/Manila"
    });

    const { data } = await supabase
        .from("reservations")
        .select(`
            id,
            start_time,
            end_time,
            status,
            payment_method,
            reference_number,
            court_id,
            profiles(full_name,username),
            courts(name)
        `)
        .eq("reservation_date", today)
        .in("status", ["completed", "no_show"])
        .order("start_time");

    const header = `
        <div style="display:flex;justify-content:space-between;border-bottom:1px solid #eee;padding-bottom:10px;margin-bottom:10px;">
            <span style="font-size:13px;font-weight:600;color:#6b7280;text-transform:uppercase;">
                Today's Activity Log
            </span>

            <span style="font-size:11px;background:#f3f4f6;padding:2px 8px;border-radius:999px;">
                ${data?.length || 0} sessions
            </span>
        </div>
    `;

    if (!data?.length) {
        return header + `<p class="al-empty">No activity yet today.</p>`;
    }

    return header + data.map(r => {

        const name =
            r.profiles?.full_name ||
            r.profiles?.username ||
            "Unknown";

        const court = r.courts?.name || "Court";

        const cfg =
            r.status === "completed"
            ? { label: "Completed", cls: "done" }
            : { label: "No Show", cls: "noshow" };

        return `
            <div class="al-row">

                <div>
                    <div class="al-court">${court}</div>
                    <div class="al-time">${r.start_time} – ${r.end_time}</div>
                </div>

                <div>
                    <div class="al-player">${name}</div>
                    <div class="al-pay">${r.payment_method}</div>
                </div>

                <span class="al-badge ${cfg.cls}">
                    ${cfg.label}
                </span>

            </div>
        `;
    }).join("");
}

// ─── ISSUE REPORTS ───
async function renderIssueReports() {

    const feed = document.getElementById("issueReportsFeed");
    if (!feed) return;

    const { data, error } = await supabase
        .from("court_issues")
        .select(`*,courts(name)`)
        .eq("status", "pending")
        .eq("reporter_role", "player")
        .order("created_at", { ascending: false });

    if (error) return;

    if (!data.length) {
        feed.innerHTML = `<p class="empty-issue">No pending issue reports.</p>`;
        saveCachedView();
        return;
    }

    feed.innerHTML = data.map(issue => {

        const meta = getIssueMeta(issue.issue_type);

        return `
            <div class="issue-card">

                <h4>${issue.courts?.name || "Unknown Court"}</h4>

                <p>
                    <strong>
                        <i class='bx ${meta.icon}'></i>
                        ${meta.label}
                    </strong>
                </p>

                <p>${issue.description}</p>

                <button class="review-btn"
                    onclick="reviewIssue(${issue.id})">
                    Review
                </button>

            </div>
        `;
    }).join("");

    saveCachedView();
}

function listenToIssueReports() {

    supabase
        .channel("court-issues-realtime")
        .on(
            "postgres_changes",
            { event: "*", schema: "public", table: "court_issues" },
            async () => {
                await Promise.all([
                    renderIssueReports(),
                    renderCourtMap()
                ]);
            }
        )
        .subscribe();
}

// ─── DIALOGS & ALERTS ───
function showConfirm({ title, message, confirmText = "Confirm", danger = false, onConfirm }) {

    document.getElementById("_confirmDialog")?.remove();

    const overlay = document.createElement("div");

    overlay.id = "_confirmDialog";

    overlay.style.cssText = `
        display:flex;
        position:fixed;
        inset:0;
        z-index:99999;
        background:rgba(15,23,42,.55);
        align-items:center;
        justify-content:center;
    `;

    overlay.innerHTML = `
        <div style="background:#fff;border-radius:16px;padding:25px;width:90%;max-width:380px;">

            <h3>${title}</h3>

            <p>${message}</p>

            <div style="display:flex;gap:10px;">

                <button id="_confirmYes"
                    style="flex:1;background:${danger ? "#ef4444" : "#16a34a"};color:white;border:none;padding:10px;border-radius:8px;">
                    ${confirmText}
                </button>

                <button id="_confirmNo"
                    style="flex:1;border:none;padding:10px;border-radius:8px;">
                    Cancel
                </button>

            </div>

        </div>
    `;

    document.body.appendChild(overlay);

    overlay.querySelector("#_confirmYes").onclick = () => {
        overlay.remove();
        onConfirm();
    };

    overlay.querySelector("#_confirmNo").onclick = () => overlay.remove();
}

function showAlert(message, type = "info") {

    document.getElementById("globalToast")?.remove();

    const colors = {
        success: "#16a34a",
        warning: "#f59e0b",
        error: "#ef4444",
        info: "#2563eb"
    };

    const toast = document.createElement("div");

    toast.id = "globalToast";
    toast.textContent = message;

    toast.style.cssText = `
        position:fixed;
        top:20px;
        right:20px;
        background:${colors[type]};
        color:white;
        padding:12px 16px;
        border-radius:10px;
        z-index:99999;
        font-weight:600;
    `;

    document.body.appendChild(toast);

    setTimeout(() => toast.remove(), 3500);
}

// ─── GAME ACTIONS ───
async function startGame(id) {

    showConfirm({
        title: "Start Game",
        message: "Start this game now?",
        confirmText: "Start",
        onConfirm: async () => {

            const { error } = await supabase.rpc("start_game", {
                p_id: id
            });

            if (error) {
                showAlert(error.message, "error");
                return;
            }

            showAlert("Game started!", "success");
            await renderCourtMap();
        }
    });
}

async function markDone(id) {
    showConfirm({
        title: "Mark Session Done",
        message: "Mark this session as done?",
        confirmText: "Mark Done",
        onConfirm: async () => {

            const { error } = await supabase.rpc("mark_done", {
                p_id: id
            });

            if (error) {
                showAlert(error.message, "error");
                return;
            }

            showAlert("Session marked as done.", "success");
            await renderCourtMap();
        }
    });
}

// ─── DOWNTIME CONFIRM MODAL ───
function openConfirm(type) {

    const modal = document.getElementById("confirmModal");
    const confirmBtn = modal?.querySelector(".m-btn-confirm");

    if (!modal || !confirmBtn) return;

    const copy = {
        emergency: {
            title: "Manual Downtime",
            text: "Set all courts to downtime? Players won't be able to reserve any court until you activate them again."
        },
        activate: {
            title: "Activate Courts",
            text: "Activate all courts? They will be open for reservations again."
        }
    };

    const titleEl = document.getElementById("modalTitle");
    const textEl = document.getElementById("modalText");

    if (titleEl) titleEl.textContent = copy[type].title;
    if (textEl) textEl.textContent = copy[type].text;

    modal.classList.add("show");

    const actions = {

        emergency: async () => {

            const { error } = await supabase
                .from("courts")
                .update({
                    is_active: false,
                    closed_reason: "Emergency Downtime"
                })
                .neq("id", 0);

            if (error) {
                showAlert("Failed to set downtime: " + error.message, "error");
                return;
            }

            showAlert("All courts are now under downtime.", "warning");

            await renderCourtMap();
            await updateDowntimeButtons();
        },

        activate: async () => {

            const { error } = await supabase
                .from("courts")
                .update({
                    is_active: true,
                    closed_reason: null
                })
                .neq("id", 0);

            if (error) {
                showAlert("Failed to activate courts: " + error.message, "error");
                return;
            }

            showAlert("All courts activated.", "success");

            await renderCourtMap();
            await updateDowntimeButtons();
        }
    };

    confirmBtn.disabled = false;

    confirmBtn.onclick = async () => {
        confirmBtn.disabled = true;

        try {
            await actions[type]();
        } finally {
            confirmBtn.disabled = false;
            closeConfirm();
        }
    };
}

function closeConfirm() {
    document.getElementById("confirmModal")?.classList.remove("show");
}

// ─── ISSUE MODAL ───
function openIssueModal(courtId, courtName) {

    document.getElementById("issueCourtId").value = courtId;
    document.getElementById("issueModalCourtLabel").innerText = courtName;
    document.getElementById("issueTypeSelect").value = "maintenance";
    document.getElementById("issueDescription").value = "";

    document.getElementById("issueModal")?.classList.add("show");
}

function closeIssueModal() {
    document.getElementById("issueModal")?.classList.remove("show");
}

async function submitIssue() {
    const courtId = document.getElementById("issueCourtId").value;
    const issueType = document.getElementById("issueTypeSelect").value;
    const description = document.getElementById("issueDescription").value.trim();

    if (!description) {
        showAlert("Please enter a description.", "warning");
        return;
    }

    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
        showAlert("User not authenticated.", "error");
        return;
    }

    const { data: profile, error: profileError } = await supabase
        .from("profiles")
        .select("username")
        .eq("id", user.id)
        .single();

    if (profileError || !profile) {
        showAlert("Failed to load user profile.", "error");
        return;
    }

    const { error: issueError } = await supabase
        .from("court_issues")
        .insert({
            court_id: courtId,
            issue_type: issueType,
            description: description,
            reported_by: user.id,
            reporter_role: "employee",
            status: "approved",
            reviewed_by: user.id,
            reviewed_at: new Date().toISOString()
        });

    if (issueError) {
        showAlert("Failed to submit issue: " + issueError.message, "error");
        return;
    }

    const reasonLabels = {
        maintenance: "Under Maintenance",
        incident: "Accident / Incident Reported",
        other: "Other Issue Reported"
    };

    const closedReason = `${reasonLabels[issueType] || "Issue Reported"}: ${description}`;

    const { error: courtError } = await supabase
        .from("courts")
        .update({
            is_active: false,
            closed_reason: closedReason
        })
        .eq("id", courtId);

    if (courtError) {
        showAlert(
            "Issue saved but failed to disable court: " + courtError.message,
            "error"
        );
        return;
    }

    const logLabels = {
        maintenance: "Maintenance issue reported",
        incident: "Accident / incident reported",
        other: "Other court issue reported"
    };

    await saveLog(
        "COURT",
        `${logLabels[issueType] || "Court issue reported"} for Court ${courtId}: ${description}`,
        profile.username,
        "warning"
    );

    const alertLabels = {
        maintenance: "⚠️ Court flagged for maintenance.",
        incident: "⚠️ Accident / incident reported. Court is unavailable.",
        other: "📋 Other issue reported. Court is unavailable."
    };

    showAlert(
        alertLabels[issueType] || "Issue reported. Court is unavailable.",
        "warning"
    );

    await renderCourtMap();
    await renderIssueReports();
    closeIssueModal();
}

// ─── RESTORE COURT ───
async function restoreCourt(courtId, courtName) {
    const { data: court, error } = await supabase
        .from("courts")
        .select("name,closed_reason")
        .eq("id", courtId)
        .single();

    if (error || !court) {
        showAlert("Failed to load court details.", "error");
        return;
    }

    document.getElementById("_restoreCourtModal")?.remove();

    const modal = document.createElement("div");

    modal.id = "_restoreCourtModal";

    modal.innerHTML = `
        <div class="restore-modal-overlay">
            <div class="restore-modal">

                <div class="restore-modal-icon">
                    <i class='bx bx-refresh'></i>
                </div>

                <h3>Restore Court</h3>

                <p class="restore-court-name">
                    ${court.name || courtName}
                </p>

                <div class="restore-reason">
                    <span>Current Reason</span>
                    <p>${court.closed_reason || "Court is currently unavailable."}</p>
                </div>

                <p class="restore-message">
                    Are you sure you want to restore this court?
                    It will become available for reservations again.
                </p>

                <div class="restore-actions">
                    <button id="cancelRestoreBtn" class="restore-cancel">
                        Cancel
                    </button>

                    <button id="confirmRestoreBtn" class="restore-confirm">
                        <i class='bx bx-refresh'></i>
                        Restore Court
                    </button>
                </div>

            </div>
        </div>
    `;

    document.body.appendChild(modal);

    document.getElementById("cancelRestoreBtn").onclick = () => {
        modal.remove();
    };

    document.getElementById("confirmRestoreBtn").onclick = async () => {
        const { data: { user } } = await supabase.auth.getUser();

        const { error: courtError } = await supabase
            .from("courts")
            .update({
                is_active: true,
                closed_reason: null
            })
            .eq("id", courtId);

        if (courtError) {
            showAlert("Failed to restore court.", "error");
            return;
        }

        const { error: issueError } = await supabase
            .from("court_issues")
            .update({
                status: "resolved",
                resolved_by: user?.id || null,
                resolved_at: new Date().toISOString()
            })
            .eq("court_id", courtId)
            .eq("status", "approved");

        if (issueError) {
            showAlert("Court restored, but issue status failed to update.", "warning");
        } else {
            showAlert("Court restored successfully.", "success");
        }

        modal.remove();

        await renderCourtMap();
        await renderIssueReports();
    };
}

// ─── REVIEW ISSUE ───
async function reviewIssue(issueId) {

    const { data, error } = await supabase
        .from("court_issues")
        .select(`*,courts(name)`)
        .eq("id", issueId)
        .single();

    if (error) {
        showAlert("Failed to load issue.", "error");
        return;
    }

    selectedReviewIssue = data;

    const meta = getIssueMeta(data.issue_type);

    const reportedAt = new Date(data.created_at).toLocaleString("en-PH", {
        dateStyle: "medium",
        timeStyle: "short"
    });

    document.getElementById("reviewIssueDetails").innerHTML = `
        <div class="review-info">

            <p>
                <strong>Court</strong><br>
                ${data.courts?.name || "Court"}
            </p>

            <p>
                <strong>Issue Type</strong><br>
                <i class='bx ${meta.icon}'></i>
                ${meta.label}
            </p>

            <p>
                <strong>Description</strong><br>
                ${data.description}
            </p>

            <p>
                <strong>Reported At</strong><br>
                ${reportedAt}
            </p>

        </div>
    `;

    document.getElementById("reviewIssueModal").classList.add("show");
}

function closeReviewIssueModal() {
    document.getElementById("reviewIssueModal")?.classList.remove("show");
}

async function approveIssue() {

    if (!selectedReviewIssue) return;

    const { data: { user } } = await supabase.auth.getUser();

    await supabase
        .from("court_issues")
        .update({
            status: "approved",
            reviewed_by: user.id,
            reviewed_at: new Date().toISOString()
        })
        .eq("id", selectedReviewIssue.id);

    await supabase
        .from("courts")
        .update({
            is_active: false,
            closed_reason: selectedReviewIssue.description
        })
        .eq("id", selectedReviewIssue.court_id);

    showAlert("Issue approved.", "success");

    closeReviewIssueModal();

    await renderCourtMap();
    await renderIssueReports();
}

async function rejectIssue() {

    if (!selectedReviewIssue) return;

    const { data: { user } } = await supabase.auth.getUser();

    await supabase
        .from("court_issues")
        .update({
            status: "rejected",
            reviewed_by: user.id,
            reviewed_at: new Date().toISOString()
        })
        .eq("id", selectedReviewIssue.id);

    showAlert("Issue rejected.", "warning");

    closeReviewIssueModal();

    await renderIssueReports();
}

// ─── COURT SEARCH ───
function applyCourtSearch() {
    const input = document.getElementById("courtSearch");
    const content = document.getElementById("dynamicContent");
    if (!input || !content) return;

    const term = input.value.trim().toLowerCase();
    const cards = content.querySelectorAll(".court-card");
    let visible = 0;

    cards.forEach(card => {
        const haystack = [...card.querySelectorAll(".court-title, .court-player, .court-status")]
            .map(el => el.textContent)
            .join(" ")
            .toLowerCase();

        const match = !term || haystack.includes(term);
        card.style.display = match ? "" : "none";
        if (match) visible++;
    });

    document.getElementById("courtSearchEmpty")?.remove();

    if (term && cards.length && visible === 0) {
        const msg = document.createElement("p");
        msg.id = "courtSearchEmpty";
        msg.style.cssText = "padding:20px;text-align:center;color:#888;font-size:14px;";
        msg.textContent = `No courts match "${input.value.trim()}".`;
        content.appendChild(msg);
    }
}

// ─── EXPORTS ───
window.startGame = startGame;
window.markDone = markDone;
window.openConfirm = openConfirm;
window.closeConfirm = closeConfirm;
window.openIssueModal = openIssueModal;
window.closeIssueModal = closeIssueModal;
window.submitIssue = submitIssue;
window.restoreCourt = restoreCourt;
window.reviewIssue = reviewIssue;
window.closeReviewIssueModal = closeReviewIssueModal;
window.approveIssue = approveIssue;
window.rejectIssue = rejectIssue;

// ─── BOOT ───
if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
} else {
    start();
}