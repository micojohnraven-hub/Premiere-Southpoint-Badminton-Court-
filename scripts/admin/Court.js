import { supabase } from "../../scripts/supabase/supabaseClient.js";
import { saveLog } from "../../scripts/sysAdmin/sysLogs.js";

let activeAction = null;
let pendingDowntimeCourtId = null;
let currentFilter = "";

document.addEventListener("DOMContentLoaded", async () => {
    await renderCourts();
    initCalendar();
    listenToCourtChanges();
    listenToReservationChanges();

    document.getElementById("logoutBtn")?.addEventListener("click", async (e) => {
        e.preventDefault();
        await supabase.auth.signOut();
        window.location.href = "../../pages/auth/login.html";
    });

    document.querySelectorAll("input[name='closeReason']").forEach(radio => {
        radio.addEventListener("change", () => {
            const otherInput = document.getElementById("otherReasonInput");
            const selected = document.querySelector("input[name='closeReason']:checked");
            otherInput.style.display = selected?.value === "Others" ? "block" : "none";
            if (selected?.value === "Others") otherInput.focus();
        });
    });

    document.getElementById("courtSearch")?.addEventListener("input", async (e) => {
        currentFilter = e.target.value;
        await renderCourts(currentFilter);
    });

    setInterval(async () => {
        await renderCourts(currentFilter);
    }, 30000);
});

function showAlert(message, type = "info") {
    document.getElementById("globalToast")?.remove();

    const colors = {
        success: "#16a34a",
        error: "#ef4444",
        warning: "#f59e0b",
        info: "#3b82f6"
    };

    const toast = document.createElement("div");
    toast.id = "globalToast";
    toast.textContent = message;
    toast.style.cssText = `
        position:fixed;
        top:20px;
        right:20px;
        background:${colors[type] || colors.info};
        color:white;
        padding:12px 16px;
        border-radius:10px;
        box-shadow:0 10px 25px rgba(0,0,0,0.15);
        z-index:99999;
        font-size:14px;
        font-weight:600;
        max-width:320px;
    `;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 3500);
}

function listenToCourtChanges() {
    supabase
        .channel("admin-courts-realtime")
        .on(
            "postgres_changes",
            { event: "*", schema: "public", table: "courts" },
            async () => {
                await renderCourts(currentFilter);
            }
        )
        .subscribe();
}

function listenToReservationChanges() {
    supabase
        .channel("admin-reservations-realtime")
        .on(
            "postgres_changes",
            { event: "*", schema: "public", table: "reservations" },
            async () => {
                await renderCourts(currentFilter);
            }
        )
        .subscribe();
}

function openReasonModal(courtId) {
    pendingDowntimeCourtId = courtId;

    document.querySelectorAll("input[name='closeReason']").forEach(r => r.checked = false);

    const otherInput = document.getElementById("otherReasonInput");
    otherInput.value = "";
    otherInput.style.display = "none";

    const modal = document.getElementById("reasonModal");
    modal.style.display = "flex";
    setTimeout(() => modal.classList.add("show"), 10);
}

function closeReasonModal() {
    const modal = document.getElementById("reasonModal");
    modal.classList.remove("show");
    setTimeout(() => {
        modal.style.display = "none";
    }, 300);
    pendingDowntimeCourtId = null;
}

async function confirmDowntimeReason() {
    const selected = document.querySelector("input[name='closeReason']:checked");

    if (!selected) {
        showAlert("Please select a reason.", "warning");
        return;
    }

    let reason = selected.value;

    if (reason === "Others") {
        const custom = document.getElementById("otherReasonInput").value.trim();

        if (!custom) {
            showAlert("Please specify a reason.", "warning");
            return;
        }

        reason = custom;
    }

    const { error } = await supabase
        .from("courts")
        .update({
            is_active: false,
            closed_reason: reason
        })
        .eq("id", pendingDowntimeCourtId);

    if (error) {
        showAlert("Failed to set downtime: " + error.message, "error");
        return;
    }

    await saveLog(
        
        `Court ${pendingDowntimeCourtId} set as ${reason}.`,
        "Business Admin",
        "warning"
    );

    showAlert(`Court set as ${reason}.`, "warning");
    closeReasonModal();
    await renderCourts(currentFilter);
}

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

    if (startMinutes === null) return { text: "Time unavailable", type: "unknown" };

    const diff = startMinutes - currentMinutes;

    if (diff > 30) return { text: `Starts in ${diff} min`, type: "normal" };
    if (diff > 0) return { text: `Starting in ${diff} min`, type: "soon" };
    if (diff === 0) return { text: "Start now", type: "now" };

    return { text: `Late by ${Math.abs(diff)} min`, type: "late" };
}

function getClosureMeta(reason) {
    const known = {
        "Maintenance":   { label: "Under Maintenance", icon: "bx-wrench",         cls: "maintenance" },
        "Private Event": { label: "Private Event",     icon: "bx-calendar-star",  cls: "event" },
        "Tournament":    { label: "Tournament",        icon: "bx-trophy",         cls: "tournament" },
    };
    return known[reason] || { label: reason || "Unavailable", icon: "bx-block", cls: "other" };
}

async function renderCourts(filter = "") {
    const courtGrid = document.getElementById("courtGrid");
    if (!courtGrid) return;

    const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Manila" });
    const { data: courts, error: courtError } = await supabase
        .from("courts")
        .select("id, name, is_active, closed_reason")
        .order("id");

    if (courtError || !courts) {
        courtGrid.innerHTML = `<p style="color:#ef4444;padding:20px;">Failed to load courts.</p>`;
        return;
    }

    const { data: reservations, error: reservationError } = await supabase
        .from("reservations")
        .select(`
            id,
            court_id,
            start_time,
            end_time,
            status,
            payment_method,
            profiles(full_name, username)
        `)
        .eq("reservation_date", today)
        .in("status", ["playing", "confirmed"])
        .order("start_time", { ascending: true });

    if (reservationError) {
        showAlert("Failed to load reservations.", "error");
    }

    const playingMap = {};
    const upcomingAll = [];

    (reservations || []).forEach((r) => {
        if (r.status === "playing" && !playingMap[r.court_id]) {
            playingMap[r.court_id] = r;
        }

        if (r.status === "confirmed") {
            upcomingAll.push(r);
        }
    });

    upcomingAll.sort((a, b) => {
        return (parseTimeToMinutes(a.start_time) ?? 9999) - (parseTimeToMinutes(b.start_time) ?? 9999);
    });

    const filtered = courts.filter(court =>
        court.name.toLowerCase().includes(filter.toLowerCase())
    );

    courtGrid.innerHTML = "";

    filtered.forEach((court) => {
        const isMaintenance = !court.is_active;
        const playing = isMaintenance ? null : playingMap[court.id];

        let status;
        let icon;
        let btnText;
        let bodyText;
        let bodySubText;
        let badgeText;

        if (isMaintenance) {
            const meta = getClosureMeta(court.closed_reason);
            status = meta.cls;
            icon = meta.icon;
            btnText = "Restore Court";
            badgeText = meta.label;
            bodyText = meta.label;
            bodySubText = court.closed_reason || "Unavailable";
        } else if (playing) {
            status = "occupied";
            icon = "bx-user";
            btnText = "Change Status";
            badgeText = "occupied";
            bodyText = playing.profiles?.full_name || playing.profiles?.username || "Unknown";
            bodySubText = `${playing.start_time} – ${playing.end_time}`;
        } else {
            status = "vacant";
            icon = "bx-user-check";
            btnText = "Change Status";
            badgeText = "vacant";
            bodyText = "---";
            bodySubText = "Ready for play";
        }

        const reasonBadge = isMaintenance ? `
            <div style="
                display:inline-flex;
                align-items:center;
                gap:4px;
                font-size:10px;
                font-weight:600;
                color:#b91c1c;
                background:#fee2e2;
                border:1px solid #fca5a5;
                padding:3px 8px;
                border-radius: 99px;
                margin-top:4px;
            ">
                <i class='bx bx-info-circle'></i>
                ${court.closed_reason || "Maintenance"}
            </div>
        ` : "";

        const card = document.createElement("div");
        card.className = "court-card";
        if (isMaintenance) card.style.opacity = "0.75";

        card.innerHTML = `
            <div class="c-header">
                <span style="font-weight:700">${court.name}</span>
                <span class="badge badge-${status}">${badgeText}</span>
            </div>

            <div class="c-body ${status}">
                <i class='bx ${icon}'></i>
                <p style="font-weight:600">${bodyText}</p>
                <p style="font-size:11px;color:#999;">${bodySubText}</p>
                ${reasonBadge}
            </div>

            <div class="c-footer">
                <button
                    class="btn-status btn-${status}"
                    onclick="${isMaintenance
                        ? `openConfirm('restore', ${court.id})`
                        : `openConfirm('downtime', ${court.id})`
                    }">
                    ${btnText}
                </button>

                <button class="btn-opt" onclick="toggleOpts(event, ${court.id})">
                    <i class='bx bx-dots-vertical-rounded'></i>
                </button>

                <div class="court-options" id="opts-${court.id}">
                    <button onclick="openEditCourt(${court.id}, '${court.name}')">
                        <i class='bx bx-edit'></i>
                        Edit Court
                    </button>

                    <button onclick="openConfirm('del', ${court.id})" class="delete-option">
                        <i class='bx bx-trash'></i>
                        Delete Court
                    </button>
                </div>
            </div>
        `;

        courtGrid.appendChild(card);
    });

    const addCard = document.createElement("div");
    addCard.className = "court-card add-court-card";
    addCard.onclick = () => openAddCourtModal();
    addCard.innerHTML = `
        <i class='bx bx-plus-circle'></i>
        <p style="font-weight:600">Expansion Court</p>
        <p style="font-size:10px">Add new slot</p>
    `;

    courtGrid.appendChild(addCard);
    renderUpcoming(upcomingAll, courts);
}

function renderUpcoming(upcomingAll, courts) {
    let upcomingSection = document.getElementById("upcomingSection");

    if (!upcomingSection) {
        const courtArea = document.querySelector(".court-area");
        if (!courtArea) return;

        upcomingSection = document.createElement("div");
        upcomingSection.id = "upcomingSection";
        upcomingSection.style.cssText = `
            margin-top:24px;
            background:#fff;
            border:1px solid #e5e7eb;
            border-radius:12px;
            padding:16px 18px;
        `;

        courtArea.appendChild(upcomingSection);
    }

    const rows = upcomingAll.length
        ? upcomingAll.map((r) => {
            const name = r.profiles?.full_name || r.profiles?.username || "Unknown";
            const court = courts.find(c => c.id === r.court_id);
            const countdown = getCountdownLabel(r.start_time);

            const badgeColor =
                countdown.type === "late"
                    ? "#fee2e2;color:#b91c1c;border:1px solid #fca5a5"
                    : countdown.type === "soon"
                    ? "#fef3c7;color:#b45309;border:1px solid #fcd34d"
                    : countdown.type === "now"
                    ? "#dbeafe;color:#1d4ed8;border:1px solid #93c5fd"
                    : "#f3f4f6;color:#6b7280;border:1px solid #e5e7eb";

            return `
                <div style="display:grid;grid-template-columns:130px 1fr auto;gap:12px;align-items:center;padding:10px 12px;border-radius:8px;background:#fafafa;border:1px solid #f0f0f0;${countdown.type === "late" ? "border-left:3px solid #ef4444;" : ""}">
                    <div>
                        <div style="font-size:11px;color:#9ca3af;font-weight:500;">
                            ${court?.name || "Court"}
                        </div>
                        <div style="font-size:12px;color:#111827;font-weight:600;">
                            ${r.start_time} – ${r.end_time}
                        </div>
                    </div>

                    <div>
                        <div style="font-size:13px;font-weight:600;color:#111827;">
                            ${name}
                        </div>
                        <div style="font-size:11px;color:#9ca3af;">
                            ${r.payment_method || "—"}
                        </div>
                    </div>

                    <span style="font-size:11px;font-weight:600;padding:3px 10px;border-radius:999px;background:${badgeColor};white-space:nowrap;">
                        ${countdown.text}
                    </span>
                </div>
            `;
        }).join("")
        : `<p style="font-size:13px;color:#9ca3af;text-align:center;padding:12px 0;">
            No upcoming reservations today.
        </p>`;

    upcomingSection.innerHTML = `
        <div style="display:flex;align-items:center;justify-content:space-between;padding-bottom:10px;border-bottom:1px solid #f0f0f0;margin-bottom:12px;">
            <span style="font-size:13px;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:.04em;">
                Upcoming Confirmed
            </span>
            <span style="font-size:11px;color:#6b7280;background:#f3f4f6;padding:2px 10px;border-radius:999px;border:1px solid #e5e7eb;">
                ${upcomingAll.length} slots
            </span>
        </div>

        <div style="display:flex;flex-direction:column;gap:6px;">
            ${rows}
        </div>
    `;
}

function openConfirm(type, id = null) {
    if (type === "downtime") {
        openReasonModal(id);
        return;
    }

    activeAction = { type, id };

    const modal = document.getElementById("confirmModal");
    const title = document.getElementById("modalTitle");
    const text = document.getElementById("modalText");

    const messages = {
        restore: {
            t: "Restore Court",
            b: "Set this court back to active?"
        },
        add: {
            t: "New Court",
            b: "Add a new court to the system?"
        },
        del: {
            t: "Delete Court",
            b: "Remove this court permanently?"
        }
    };

    const m = messages[type] || { t: "Confirm", b: "Proceed?" };

    title.innerText = m.t;
    text.innerText = m.b;

    modal.style.display = "flex";
    setTimeout(() => modal.classList.add("show"), 10);
}

function closeConfirm() {
    const modal = document.getElementById("confirmModal");
    modal.classList.remove("show");
    setTimeout(() => {
        modal.style.display = "none";
    }, 300);
}

document.getElementById("modalConfirmBtn")?.addEventListener("click", async () => {
    if (!activeAction) return;

    const { type, id } = activeAction;
    if (type === "restore") {
        const { data: { user }, error: authError } =
            await supabase.auth.getUser();

        if (authError || !user) {
            showAlert("User not authenticated.", "error");
            return;
        }

        const { error } = await supabase
            .from("courts")
            .update({
                is_active: true,
                closed_reason: null
            })
            .eq("id", id);

        if (error) {
            showAlert("Failed to restore court: " + error.message, "error");
            return;
        }

        await saveLog(
            
            `Court ${id} restored and made available.`,
            "Business Admin",
            "success"
        );

        const { error: issueError } = await supabase
            .from("court_issues")
            .update({
                status: "resolved",
                resolved_by: user.id,
                resolved_at: new Date().toISOString()
            })
            .eq("court_id", id)
            .eq("status", "approved");

        if (issueError) {
            showAlert(
                "Court restored but issue failed to resolve: " +
                issueError.message,
                "error"
            );
            return;
        }

        showAlert("Court restored successfully.", "success");
    } else if (type === "del") {
        const { error } = await supabase
            .from("courts")
            .delete()
            .eq("id", id);

        if (error) {
            showAlert("Failed to delete court: " + error.message, "error");
            closeConfirm();
            return;
        }

        await saveLog(
            
            `Court ${id} deleted.`,
            "Business Admin",
            "success"
        );

        showAlert("Court deleted successfully.", "success");
    }

    closeConfirm();
    await renderCourts(currentFilter);
});

function toggleOpts(e, id) {
    e.stopPropagation();

    document.querySelectorAll(".court-options").forEach((el) => {
        el.style.display = "none";
    });

    const target = document.getElementById(`opts-${id}`);
    if (target) target.style.display = "block";
}

window.addEventListener("click", () => {
    document.querySelectorAll(".court-options").forEach((el) => {
        el.style.display = "none";
    });
});

function initCalendar() {
    const grid = document.getElementById("calGrid");
    const label = document.getElementById("calMonth");

    if (!grid || !label) return;

    grid.innerHTML = "";

    const now = new Date();
    label.innerText = now.toLocaleString("default", {
        month: "long",
        year: "numeric"
    });

    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();

    for (let i = 1; i <= daysInMonth; i++) {
        const day = document.createElement("div");
        day.innerText = i;
        day.className = i === now.getDate() ? "cal-today" : "cal-day";
        grid.appendChild(day);
    }
}

let editingCourtId = null;

function openEditCourt(id, name) {
    editingCourtId = id;
    document.getElementById("editCourtName").value = name;
    document.getElementById("editCourtModal").classList.add("show");
}

function closeEditCourtModal() {
    document.getElementById("editCourtModal").classList.remove("show");
    editingCourtId = null;
}

async function saveCourtEdit() {
    const name = document.getElementById("editCourtName").value.trim();

    if (!name) {
        showAlert("Enter a valid court name.", "warning");
        return;
    }

    const { error } = await supabase
        .from("courts")
        .update({
            name
        })
        .eq("id", editingCourtId);

    if (error) {
        showAlert("Failed to update court: " + error.message, "error");
        return;
    }

    await saveLog(
        
        `Court ${editingCourtId} renamed to "${name}".`,
        "Business Admin",
        "info"
    );

    showAlert("Court updated successfully.", "success");
    closeEditCourtModal();
    await renderCourts(currentFilter);
}

function openAddCourtModal() {
    document.getElementById("addCourtName").value = "";
    document.getElementById("addCourtModal").classList.add("show");
}

function closeAddCourtModal() {
    document.getElementById("addCourtModal").classList.remove("show");
}

async function saveNewCourt() {
    const name = document.getElementById("addCourtName").value.trim();

    if (!name) {
        showAlert("Enter a valid court name.", "warning");
        return;
    }

    const { error } = await supabase
        .from("courts")
        .insert({
            name,
            is_active: true
        });

    if (error) {
        showAlert("Failed to add court: " + error.message, "error");
        return;
    }

    await saveLog(
        
        `New court "${name}" added.`,
        "Business Admin",
        "success"
    );

    showAlert("Court added successfully.", "success");
    closeAddCourtModal();
    await renderCourts(currentFilter);
}

window.openConfirm = openConfirm;
window.closeConfirm = closeConfirm;
window.closeReasonModal = closeReasonModal;
window.confirmDowntimeReason = confirmDowntimeReason;
window.toggleOpts = toggleOpts;
window.openEditCourt = openEditCourt;
window.closeEditCourtModal = closeEditCourtModal;
window.saveCourtEdit = saveCourtEdit;
window.openAddCourtModal = openAddCourtModal;
window.closeAddCourtModal = closeAddCourtModal;
window.saveNewCourt = saveNewCourt;