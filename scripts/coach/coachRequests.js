import { supabase } from "../supabase/supabaseClient.js";

const modal       = document.getElementById("playerModal");
const closeBtns   = document.querySelectorAll("#closeModal, #closeModalBtn");
const searchInput = document.getElementById("searchInput");
const requestList = document.getElementById("requestList");
const playerTable = document.getElementById("playerTable");

let requestChannel = null;
let currentUser    = null;
let isLoadingPackages = false;
let reloadPackagesQueued = false;

// ─── INIT ───

document.addEventListener("DOMContentLoaded", async () => {
    const { data: authData } = await supabase.auth.getUser();
    currentUser = authData?.user ?? null;
    if (!currentUser) return;

    setupModal();
    setupSearch();
    setupPackageEvents();
    await Promise.all([
        loadPendingRequests(),
        loadMyPlayers(),
        loadPackageSessions(),
    ]);
    setupRealtime();
});

// ─── DEBOUNCE HELPER ───

function debounce(fn, delay = 400) {
    let timer = null;
    return (...args) => {
        clearTimeout(timer);
        timer = setTimeout(() => fn(...args), delay);
    };
}

const debouncedRefreshRequests = debounce(async () => {
    await Promise.all([loadPendingRequests(), loadMyPlayers()]);
}, 400);

const debouncedRefreshPackages = debounce(async () => {
    await loadPackageSessions();
}, 500);

// ─── REALTIME ───

function setupRealtime() {
    if (requestChannel) supabase.removeChannel(requestChannel);

    requestChannel = supabase
        .channel(`coach-realtime-${currentUser.id}`)
        .on("postgres_changes", {
            event: "*", schema: "public", table: "coaching_requests",
            filter: `coach_id=eq.${currentUser.id}`,
        }, () => debouncedRefreshRequests())
        .on("postgres_changes", {
            event: "*", schema: "public", table: "coach_availability",
            filter: `coach_id=eq.${currentUser.id}`,
        }, () => debouncedRefreshRequests())
        .on("postgres_changes", {
            event: "*", schema: "public", table: "package_sessions",
        }, () => debouncedRefreshPackages())
        .subscribe();
}

function refreshCardHeader(card) {
    const rows = card.querySelectorAll('.session-row');
    let completed = 0, scheduled = 0, unscheduled = 0;

    rows.forEach(row => {
        const statusEl = row.querySelector('.session-status');
        if (statusEl?.classList.contains('completed'))       completed++;
        else if (statusEl?.classList.contains('scheduled'))  scheduled++;
        else                                                  unscheduled++;
    });

    const total = rows.length;

    const headerRight = card.querySelector('.c-header-right');
    if (headerRight) {
        headerRight.innerHTML = `
            <span class="chip chip-done">${completed} done</span>
            ${scheduled   ? `<span class="chip chip-sched">${scheduled} scheduled</span>` : ''}
            ${unscheduled ? `<span class="chip chip-none">${unscheduled} unscheduled</span>` : ''}
        `;
    }

    const progressPct = total ? Math.round((completed / total) * 100) : 0;
    const fill = card.querySelector('.progress-fill');
    if (fill) fill.style.width = `${progressPct}%`;

    const labels = card.querySelectorAll('.progress-labels span');
    if (labels[1]) labels[1].textContent = `${completed}/${total} completed`;
}

// ─── LOAD PENDING REQUESTS ───
async function loadPendingRequests() {
    if (!requestList || !currentUser) return;

    const { data, error } = await supabase
        .from("coaching_requests")
        .select(`
            *,
            coach_availability!availability_id (
                id,
                slot_date,
                start_time,
                end_time,
                status,
                courts (
                    name
                )
            )
        `)
        .eq("coach_id", currentUser.id)
        .eq("status", "pending")
        .order("created_at", { ascending: true });

    if (error) {
        requestList.innerHTML = `<p class="no-posts-text">Failed to load requests.</p>`;
        return;
    }

    const pendingRequests = data || [];

    if (!pendingRequests.length) {
        requestList.innerHTML = `<p class="no-posts-text">No pending requests.</p>`;
        return;
    }

    requestList.innerHTML = pendingRequests.map(req => {
        const needsPaymentCheck = Boolean(req.package_sessions) && req.payment_method === "E-wallet";

        const referenceLine = needsPaymentCheck && req.reference_number
            ? `<p>Reference No.: <strong>${escapeHtml(req.reference_number)}</strong></p>`
            : "";

        const paymentNote = needsPaymentCheck
            ? `<p style="font-size:12px;color:#6b7280;">Check your own e-wallet account for this payment before responding.</p>`
            : "";

        return `
            <div class="request-row" data-id="${req.id}">
                <div class="request-info">
                    <h3>${escapeHtml(req.player_name || "Unknown Player")}</h3>
                    <p><strong>${escapeHtml(req.request_type || "Session")}</strong></p>
                    <p>${req.session_date || "No date"}${req.session_time ? ` • ${req.session_time}` : ""}</p>
                    <p>Payment: ${escapeHtml(req.payment_method || "N/A")}</p>
                    <p>Amount: ₱${Number(req.amount || 0).toLocaleString()}</p>
                    ${referenceLine}
                    ${paymentNote}
                </div>
                <div class="request-actions">
                    ${req.payment_screenshot ? `<button class="view-proof-btn" data-screenshot="${escapeHtml(req.payment_screenshot)}">View Payment Proof</button>` : ""}
                    <button class="btn-accept" data-id="${req.id}" data-label="Accept" data-payment-check="${needsPaymentCheck}">Accept</button>
                    <button class="btn-decline" data-id="${req.id}" data-label="Decline" data-payment-check="${needsPaymentCheck}">Decline</button>
                </div>
            </div>
        `;
    }).join("");

    requestList.querySelectorAll(".btn-accept, .btn-decline").forEach(btn => {
        btn.addEventListener("click", () => {
            const id = btn.dataset.id;
            const isDecline = btn.classList.contains("btn-decline");
            const label = btn.dataset.label || "Accept";
            const needsPaymentCheck = btn.dataset.paymentCheck === "true";

            const acceptMessage = needsPaymentCheck
                ? "Only accept after you have confirmed that this payment arrived in your own e-wallet account. Do you want to accept this request?"
                : `Confirm to ${label.toLowerCase()} this coaching request?`;

            const declineMessage = needsPaymentCheck
                ? "Do you want to decline it?"
                : "Are you sure you want to decline this request?";

            showConfirm({
                title: isDecline ? "Decline Request" : `${label} Request`,
                message: isDecline ? declineMessage : acceptMessage,
                confirmText: isDecline ? "Decline" : label,
                danger: isDecline,
                onConfirm: () => {
                    const row = btn.closest(".request-row");

                    if (row) {
                        row.style.transition = "opacity 0.2s ease";
                        row.style.opacity = "0.4";
                        row.style.pointerEvents = "none";
                        setTimeout(() => row.remove(), 200);
                    }

                    updateRequestStatus(id, isDecline ? "declined" : "accepted");
                },
            });
        });
    });

    requestList.querySelectorAll(".view-proof-btn").forEach(btn => {
        btn.addEventListener("dblclick", e => e.preventDefault());
        btn.addEventListener("click", () => {
            document.getElementById("paymentProofImg").src = btn.dataset.screenshot;
            document.getElementById("paymentProofModal").style.display = "flex";
        });
    });
}

// ─── UPDATE REQUEST STATUS ───

async function updateRequestStatus(requestId, newStatus) {
    if (window.isProcessingRequest) return;
    window.isProcessingRequest = true;

    if (newStatus === "accepted") {
        const { data, error } = await supabase.rpc("accept_coaching_request", {
            p_request_id: requestId,
            p_coach_id:   currentUser.id,
        });

        if (error) { showAlert("Failed to accept request."); window.isProcessingRequest = false; return; }

        const errorMap = {
            slot_already_taken:   "This slot is already taken.",
            request_not_open:     "This request is no longer pending.",
            request_not_found:    "Request not found.",
            missing_availability: "This request has no linked slot.",
            slot_not_found:       "The selected slot was not found.",
        };
        if (errorMap[data]) { showAlert(errorMap[data]); window.isProcessingRequest = false; return; }
        if (data !== "success") { showAlert(`Unable to accept: ${data}`); window.isProcessingRequest = false; return; }

        const { data: reqDetails } = await supabase
            .from('coaching_requests')
            .select('id, package_sessions, player_id, coach_name')
            .eq('id', requestId)
            .single();

        if (reqDetails?.package_sessions) {
            const { data: existing } = await supabase
                .from('package_sessions')
                .select('id')
                .eq('request_id', requestId)
                .limit(1);

            if (!existing?.length) {
                const rows = Array.from({ length: reqDetails.package_sessions }, (_, i) => ({
                    request_id:     requestId,
                    session_number: i + 1,
                    status:         'unscheduled',
                }));
                await supabase.from('package_sessions').insert(rows);
            }

            supabase.from("notifications").insert([{
                user_id: reqDetails.player_id,
                title:   "Package Request Accepted",
                message: `Your ${reqDetails.package_sessions}-session package with ${reqDetails.coach_name} has been accepted! Your coach will set your session schedules soon.`,
                is_read: false,
            }]);
        }

    } else if (newStatus === "declined") {
        const { data: reqRow, error: reqErr } = await supabase
            .from("coaching_requests")
            .select("id, player_id, coach_name, session_date, session_time")
            .eq("id", requestId)
            .single();

        if (reqErr || !reqRow) { showAlert("Failed to read request."); window.isProcessingRequest = false; return; }

        const { error } = await supabase
            .from("coaching_requests")
            .update({ status: "declined", updated_at: new Date().toISOString() })
            .eq("id", requestId)
            .eq("status", "pending");

        if (error) { showAlert("Failed to decline request."); window.isProcessingRequest = false; return; }

        supabase.from("notifications").insert([{
            user_id: reqRow.player_id,
            title:   "Coach Request Declined",
            message: `Your coaching session with ${reqRow.coach_name} on ${reqRow.session_date ?? '-'} at ${reqRow.session_time ?? '-'} was declined.`,
            is_read: false,
        }]);
    }

    window.isProcessingRequest = false;
}

// ─── LOAD MY PLAYERS ───

async function loadMyPlayers() {
    if (!playerTable || !currentUser) return;

    const { data, error } = await supabase
        .from("coaching_requests")
        .select("player_id, player_name")
        .eq("coach_id", currentUser.id)
        .eq("status", "accepted")
        .order("created_at", { ascending: false });

    if (error) { console.error(error); return; }

    if (!data?.length) {
        playerTable.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:20px;">No players yet.</td></tr>`;
        return;
    }

    const seen   = new Set();
    const unique = data.filter(p => seen.has(p.player_id) ? false : seen.add(p.player_id));

    playerTable.innerHTML = unique.map(player => `
        <tr>
            <td class="p-name">${player.player_name || "Unknown Player"}</td>
            <td>-</td><td>-</td><td>-</td>
            <td><span class="badge">BEGINNER</span></td>
            <td>
                <div class="win-rate-wrapper">
                    <span class="rate-text">-</span>
                    <div class="rate-bar"><div class="fill" style="width:0%;"></div></div>
                </div>
            </td>
            <td style="text-align:center;">
                <button class="action-btn view"><i class='bx bx-show'></i></button>
            </td>
        </tr>
    `).join("");

    bindViewButtons();
}

// ─── PACKAGE SESSION EVENTS ───

function setupPackageEvents() {
    const container = document.getElementById("packageSessionsGrid");
    if (!container) return;

    container.addEventListener("click", e => {
        const scheduleBtn = e.target.closest(".set-schedule-btn");
        if (scheduleBtn && container.contains(scheduleBtn)) {
            e.stopPropagation();
            openSetScheduleModal(
                scheduleBtn.dataset.sessionId,
                scheduleBtn.dataset.sessionNumber,
                scheduleBtn.dataset.playerId,
                scheduleBtn.dataset.playerName
            );
            return;
        }

        const doneBtn = e.target.closest(".mark-done-btn");
        if (doneBtn && container.contains(doneBtn)) {
            e.stopPropagation();
            handleMarkDoneClick(doneBtn);
            return;
        }

        const header = e.target.closest(".collapse-toggle");
        if (header && container.contains(header)) {
            const body    = document.getElementById(header.dataset.target);
            const reqId   = header.dataset.target.replace("sessions-", "");
            const chevron = document.getElementById(`chevron-${reqId}`);
            if (!body) return;
            const isOpen = body.style.display !== "none";
            body.style.display = isOpen ? "none" : "block";
            chevron?.classList.toggle("open", !isOpen);
        }
    });
}

function handleMarkDoneClick(btn) {
    showConfirm({
        title:       "Mark as Done",
        message:     `Mark Session ${btn.dataset.sessionNumber} for ${btn.dataset.playerName} as completed?`,
        confirmText: "Mark Done",
        danger:      false,
        onConfirm:   () => {
            const row  = btn.closest(".session-row");
            const card = btn.closest(".custom-card");

            if (row) {
                const statusEl = row.querySelector(".session-status");
                if (statusEl) {
                    statusEl.textContent = "✓ Done";
                    statusEl.className   = "session-status completed";
                }
                row.querySelectorAll(".set-schedule-btn, .mark-done-btn")
                   .forEach(b => b.remove());
                row.parentElement?.appendChild(row);
            }

            if (card) refreshCardHeader(card);

            markSessionDone(
                btn.dataset.sessionId,
                btn.dataset.playerId,
                btn.dataset.playerName,
                btn.dataset.sessionNumber
            );
        },
    });
}

// ─── LOAD PACKAGE SESSIONS ───

async function loadPackageSessions() {
    if (isLoadingPackages) {
        reloadPackagesQueued = true;
        return;
    }
    isLoadingPackages = true;

    try {
        await renderPackageSessions();
    } catch (err) {
        console.error(err);
    } finally {
        isLoadingPackages = false;
        if (reloadPackagesQueued) {
            reloadPackagesQueued = false;
            loadPackageSessions();
        }
    }
}

async function renderPackageSessions() {
    const container = document.getElementById("packageSessionsGrid");
    if (!container || !currentUser) return;

    const { data: requests, error } = await supabase
        .from("coaching_requests")
        .select("id, player_id, player_name, package_sessions, amount")
        .eq("coach_id", currentUser.id)
        .eq("status", "accepted")
        .eq("request_type", "Package Session")
        .order("created_at", { ascending: false });

    if (error) { console.error(error); return; }

    if (!requests?.length) {
        container.innerHTML = `<p class="no-posts-text">No active package sessions.</p>`;
        return;
    }

    const requestIds = requests.map(r => r.id);
    const { data: sessions } = await supabase
        .from("package_sessions")
        .select("*")
        .in("request_id", requestIds)
        .order("session_number", { ascending: true });

    const sessionMap = {};
    (sessions || []).forEach(s => {
        if (!sessionMap[s.request_id]) sessionMap[s.request_id] = [];
        sessionMap[s.request_id].push(s);
    });

    requests.sort((a, b) => {
        const aSessions = sessionMap[a.id] || [];
        const bSessions = sessionMap[b.id] || [];

        const aTotal = Number(a.package_sessions || 0);
        const bTotal = Number(b.package_sessions || 0);

        const aCompleted =
            aTotal > 0 &&
            aSessions.length >= aTotal &&
            aSessions.filter(s => s.status === "completed").length === aTotal;

        const bCompleted =
            bTotal > 0 &&
            bSessions.length >= bTotal &&
            bSessions.filter(s => s.status === "completed").length === bTotal;

        if (aCompleted && !bCompleted) return 1;
        if (!aCompleted && bCompleted) return -1;

        return 0;
    });

    const openCards = new Set(
        [...document.querySelectorAll('.sessions-body')]
            .filter(el => el.style.display !== 'none')
            .map(el => el.id.replace('sessions-', ''))
    );

    container.innerHTML = `<div class="pkg-list">${requests.map(req => {
        const reqSessions = sessionMap[req.id] || [];
        const completed   = reqSessions.filter(s => s.status === 'completed').length;
        const scheduled   = reqSessions.filter(s => s.status === 'scheduled').length;
        const total       = req.package_sessions;
        const unscheduled = total - completed - scheduled;
        const progressPct = total ? Math.round((completed / total) * 100) : 0;
        const isOpen      = openCards.has(String(req.id));

        const statusPriority = (s) => {
            if (s.status === 'completed') return 2;
            return 0;
        };

        const sortedSessions = [...reqSessions].sort((a, b) => {
            const pa = statusPriority(a);
            const pb = statusPriority(b);

            if (pa !== pb) return pa - pb;

            return a.session_number - b.session_number;
        });

        const chips = `
            <span class="chip chip-done">${completed} done</span>
            ${scheduled   ? `<span class="chip chip-sched">${scheduled} scheduled</span>` : ''}
            ${unscheduled ? `<span class="chip chip-none">${unscheduled} unscheduled</span>` : ''}
        `;

        const sessionRows = sortedSessions.map(s => {
            const isScheduled = s.session_date && s.session_time;
            const isDone      = s.status === 'completed';
            const statusClass = isDone ? 'completed' : isScheduled ? 'scheduled' : 'unscheduled';
            const statusLabel = isDone ? '✓ Done' : isScheduled ? '📅 Scheduled' : 'Unscheduled';
            const schedText   = isScheduled
                ? `${formatDate(s.session_date)} · ${formatTime12h(s.session_time)}`
                : 'No schedule set';

            const actions = isDone ? '' : `
                <button class="set-schedule-btn"
                    data-session-id="${s.id}"
                    data-session-number="${s.session_number}"
                    data-player-id="${req.player_id}"
                    data-player-name="${req.player_name}">
                    ${isScheduled ? 'Edit' : 'Set Schedule'}
                </button>
                ${isScheduled ? `
                <button class="mark-done-btn"
                    data-session-id="${s.id}"
                    data-player-id="${req.player_id}"
                    data-player-name="${req.player_name}"
                    data-session-number="${s.session_number}">
                    ✓ Mark Done
                </button>` : ''}
            `;

            return `
                <div class="session-row">
                    <div class="session-info">
                        <span class="session-label">Session ${s.session_number}</span>
                        <span class="session-schedule">${schedText}</span>
                    </div>
                    <div class="session-actions">
                        <span class="session-status ${statusClass}">${statusLabel}</span>
                        ${actions}
                    </div>
                </div>
            `;
        }).join('');

        return `
            <div class="custom-card" data-req-id="${req.id}">
                <div class="c-header collapse-toggle" data-target="sessions-${req.id}">
                    <div class="c-header-left">
                        <span class="chevron ${isOpen ? 'open' : ''}" id="chevron-${req.id}">▶</span>
                        <strong>${req.player_name}</strong>
                        <span class="type-badge">${total}-Session Package</span>
                    </div>
                    <div class="c-header-right">${chips}</div>
                </div>
                <div class="sessions-body" id="sessions-${req.id}" style="display:${isOpen ? 'block' : 'none'};">
                    <div class="progress-wrapper">
                        <div class="progress-labels">
                            <span>Progress</span>
                            <span>${completed}/${total} completed</span>
                        </div>
                        <div class="progress-track">
                            <div class="progress-fill" style="width:${progressPct}%;"></div>
                        </div>
                        ${sessionRows}
                    </div>
                </div>
            </div>
        `;
    }).join('')}</div>`;
}

// ─── MARK SESSION DONE ───

async function markSessionDone(sessionId, playerId, playerName, sessionNumber) {
    const { error } = await supabase
        .from("package_sessions")
        .update({ status: 'completed', updated_at: new Date().toISOString() })
        .eq("id", sessionId);

    if (error) {
        showAlert("Failed to mark session as done.");
        loadPackageSessions();
        return;
    }

    supabase.from("notifications").insert([{
        user_id: playerId,
        title:   "Session Completed",
        message: `Session ${sessionNumber} has been marked as completed by your coach. Great work, ${playerName}!`,
        is_read: false,
    }]);
}

// ─── SET SCHEDULE MODAL ───

function openSetScheduleModal(sessionId, sessionNumber, playerId, playerName) {
    document.getElementById("_scheduleDialog")?.remove();

    const overlay = document.createElement("div");
    overlay.id        = "_scheduleDialog";
    overlay.className = "schedule-overlay";
    overlay.innerHTML = `
        <div class="schedule-modal">
            <h3>Set Schedule — Session ${sessionNumber}</h3>
            <div class="form-group">
                <label>Date</label>
                <input type="date" id="_schedDate" min="${new Date().toISOString().split('T')[0]}">
            </div>
            <div class="form-group">
                <label>Time</label>
                <input type="time" id="_schedTime">
            </div>
            <div class="modal-actions">
                <button id="_schedSave" class="btn-save">Save</button>
                <button id="_schedCancel" class="btn-cancel">Cancel</button>
            </div>
        </div>
    `;
    document.body.appendChild(overlay);

    overlay.querySelector("#_schedCancel").addEventListener("click", () => overlay.remove());
    overlay.addEventListener("click", e => { if (e.target === overlay) overlay.remove(); });

    overlay.querySelector("#_schedSave").addEventListener("click", async () => {
        const date = document.getElementById("_schedDate").value;
        const time = document.getElementById("_schedTime").value;

        if (!date || !time) {
            showAlert("Please fill both date and time.");
            return;
        }

        const btn  = document.querySelector(`.set-schedule-btn[data-session-id="${sessionId}"]`);
        const row  = btn?.closest('.session-row');
        const card = btn?.closest('.custom-card');

        if (row) {
            const scheduleEl = row.querySelector('.session-schedule');
            const statusEl   = row.querySelector('.session-status');
            const wasScheduled = statusEl?.classList.contains('scheduled');

            if (scheduleEl) {
                const formatted = new Date(date + "T00:00:00")
                    .toLocaleDateString("en-US", { month: "short", day: "numeric" });
                scheduleEl.textContent = `${formatted} · ${formatTime12h(time)}`;
            }
            if (statusEl) {
                statusEl.textContent = '📅 Scheduled';
                statusEl.className   = 'session-status scheduled';
            }

            const actionsEl = row.querySelector('.session-actions');
            btn.textContent = 'Edit';

            if (!wasScheduled && actionsEl && !actionsEl.querySelector('.mark-done-btn')) {
                const doneBtn = document.createElement('button');
                doneBtn.className = 'mark-done-btn';
                doneBtn.dataset.sessionId     = sessionId;
                doneBtn.dataset.playerId      = playerId;
                doneBtn.dataset.playerName    = playerName;
                doneBtn.dataset.sessionNumber = sessionNumber;
                doneBtn.textContent = '✓ Mark Done';
                actionsEl.appendChild(doneBtn);
            }
        }

        if (card) refreshCardHeader(card);
        overlay.remove();

        const { data: sessionData } = await supabase
            .from("package_sessions")
            .select(`
                request_id,
                session_number,
                coaching_requests(
                    player_id,
                    coach_name
                )
            `)
            .eq("id", sessionId)
            .single();

        const { error } = await supabase
            .from("package_sessions")
            .update({
                session_date: date,
                session_time: time,
                status: "scheduled",
                updated_at: new Date().toISOString()
            })
            .eq("id", sessionId);

        if (error) {
            showAlert("Failed to save schedule.");
            return;
        }

        const reqData = sessionData?.coaching_requests;
        if (reqData?.player_id) {
            const formattedDate = new Date(date + "T00:00:00")
                .toLocaleDateString("en-US", {
                    weekday: "long",
                    month: "long",
                    day: "numeric",
                    year: "numeric",
                });

            supabase.from("notifications").insert([{
                user_id: reqData.player_id,
                title: "Session Scheduled",
                message: `Your coach has scheduled Session ${sessionNumber} on ${formattedDate} at ${formatTime12h(time)}.`,
                is_read: false
            }]);
        }
    });
}

// ─── MODAL & SEARCH ───

function bindViewButtons() {
    document.querySelectorAll(".action-btn.view").forEach(btn => {
        btn.addEventListener("click", e => {
            const row   = e.target.closest("tr");
            const name  = row?.querySelector(".p-name")?.innerText || "Unknown Player";
            const level = row?.querySelector(".badge")?.innerText  || "BEGINNER";
            document.getElementById("modalPlayerName").innerText = name;
            document.getElementById("modalLevel").innerText      = level;
            modal.style.display = "flex";
        });
    });
}

function setupModal() {
    closeBtns.forEach(btn => btn.addEventListener("click", () => modal.style.display = "none"));
    window.addEventListener("click", e => { if (e.target === modal) modal.style.display = "none"; });
}

function setupSearch() {
    if (!searchInput) return;
    searchInput.addEventListener("input", () => {
        const kw = searchInput.value.toLowerCase();
        playerTable?.querySelectorAll("tr").forEach(row => {
            row.style.display = row.innerText.toLowerCase().includes(kw) ? "" : "none";
        });
    });
}

// ─── HELPERS ───

function formatDate(dateStr) {
    if (!dateStr) return "-";
    const d = new Date(dateStr);
    return isNaN(d) ? dateStr : d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function formatTime12h(timeStr) {
    if (!timeStr) return "";
    const [h, m] = timeStr.split(":");
    const hr     = Number(h);
    const ampm   = hr >= 12 ? "PM" : "AM";
    return `${(hr % 12 || 12).toString().padStart(2, "0")}:${m} ${ampm}`;
}

function escapeHtml(value) {
    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

function showConfirm({ title, message, confirmText, danger, onConfirm }) {
    document.getElementById("_confirmDialog")?.remove();
    const overlay = document.createElement("div");
    overlay.id        = "_confirmDialog";
    overlay.className = "modal-overlay";
    overlay.style.cssText = "display:flex;position:fixed;inset:0;z-index:9999;";
    overlay.innerHTML = `
        <div class="modal-card" style="max-width:380px;width:90%;">
            <h3>${title}</h3>
            <p style="margin:12px 0 20px;">${message}</p>
            <div class="modal-footer">
                <button id="_confirmYes" class="btn ${danger ? 'btn-danger' : 'btn-primary'}">${confirmText}</button>
                <button id="_confirmNo"  class="btn btn-secondary">Cancel</button>
            </div>
        </div>
    `;
    document.body.appendChild(overlay);
    const close = () => overlay.remove();
    overlay.querySelector("#_confirmYes").addEventListener("click", () => { close(); onConfirm(); });
    overlay.querySelector("#_confirmNo").addEventListener("click", close);
    overlay.addEventListener("click", e => { if (e.target === overlay) close(); });
}

function showAlert(msg) {
    showConfirm({ title: "Notice", message: msg, confirmText: "OK", danger: false, onConfirm: () => {} });
}