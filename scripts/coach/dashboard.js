import { supabase } from "../supabase/supabaseClient.js";
import { checkAndShowCoachAnnouncements, loadCoachAnnouncementsGrid } from "../../scripts/shared/Announcement.js";

// ─── STATE ───
let weekSessionMap = {};
let selectedCalDate = null;

// ─── MANILA TIME ───
function getManilaToday() {
    return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Manila" });
}

function addDaysToDateStr(dateStr, days) {
    const d = new Date(dateStr + "T00:00:00Z");
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().split("T")[0];
}

function getWeekStart() {
    const today = getManilaToday();
    const dayOfWeek = new Date(today + "T00:00:00Z").getUTCDay();
    return addDaysToDateStr(today, -dayOfWeek);
}

function getWeekEnd() {
    return addDaysToDateStr(getWeekStart(), 6);
}

// ─── BOOT ───
document.addEventListener("DOMContentLoaded", async () => {
    await loadCoachDashboard();
    startNotifPolling();
    document.addEventListener("click", closeNotifOnOutsideClick);
});

// ─── DASHBOARD LOAD ───
async function loadCoachDashboard() {
    const { data: { session } } = await supabase.auth.getSession();
    const user = session?.user;
    if (!user) return;

    const today = getManilaToday();
    const weekStart = getWeekStart();
    const weekEnd = getWeekEnd();

    const announcementsTask = Promise.all([
        checkAndShowCoachAnnouncements(user.id),
        loadCoachAnnouncementsGrid(user.id)
    ]).catch(err => console.error("Announcements error:", err));

    const notificationsTask = loadNotifications(user.id);

    const [
        { data: profile },
        { data: todayBookings, error: todayBookingsError },
        { data: todayPackageSessions, error: todayPackageError },
        { data: todayAssessments, error: todayAssessmentError },
        { data: upcomingBookings, error: upcomingBookingsError },
        { data: upcomingPackageSessions, error: upcomingPackageError },
        { data: upcomingAssessments, error: upcomingAssessmentError },
        { data: pendingRequests },
        { data: pendingAssessments },
        { data: recentAssessments },
        { data: weekBookings },
        { data: weekPackageSessions },
        { data: weekAssessments }
    ] = await Promise.all([
        supabase
            .from("profiles")
            .select("status")
            .eq("id", user.id)
            .single(),

        supabase
            .from("coaching_requests")
            .select(`
                id,
                player_name,
                request_type,
                session_date,
                session_time,
                notes,
                package_sessions,
                status
            `)
            .eq("coach_id", user.id)
            .eq("status", "accepted")
            .eq("session_date", today),

        supabase
            .from("package_sessions")
            .select(`
                id,
                session_number,
                session_date,
                session_time,
                status,
                coaching_requests!package_sessions_request_id_fkey(
                    coach_id,
                    player_name,
                    request_type,
                    notes
                )
            `)
            .eq("status", "scheduled")
            .eq("session_date", today)
            .eq("coaching_requests.coach_id", user.id),

        supabase
            .from("assessment_batches")
            .select(`
                id,
                schedule_date,
                schedule_time,
                max_slots,
                status
            `)
            .eq("coach_id", user.id)
            .eq("status", "open")
            .eq("schedule_date", today),

        supabase
            .from("coaching_requests")
            .select(`
                id,
                player_name,
                request_type,
                session_date,
                session_time,
                notes,
                package_sessions,
                status
            `)
            .eq("coach_id", user.id)
            .eq("status", "accepted")
            .gt("session_date", today)
            .order("session_date", { ascending: true })
            .limit(20),

        supabase
            .from("package_sessions")
            .select(`
                id,
                session_number,
                session_date,
                session_time,
                status,
                coaching_requests!package_sessions_request_id_fkey(
                    coach_id,
                    player_name,
                    request_type,
                    notes
                )
            `)
            .eq("status", "scheduled")
            .gt("session_date", today)
            .eq("coaching_requests.coach_id", user.id)
            .order("session_date", { ascending: true })
            .limit(20),

        supabase
            .from("assessment_batches")
            .select(`
                id,
                schedule_date,
                schedule_time,
                max_slots,
                status
            `)
            .eq("coach_id", user.id)
            .eq("status", "open")
            .gt("schedule_date", today)
            .order("schedule_date", { ascending: true })
            .limit(20),

        supabase
            .from("coaching_requests")
            .select("id")
            .eq("coach_id", user.id)
            .in("status", ["pending"]),

        supabase
            .from("player_assessments")
            .select(`
                id,
                player_id,
                final_level,
                assessed_at,
                profiles!player_assessments_player_id_fkey(full_name, player_level)
            `)
            .eq("coach_id", user.id)
            .is("final_level", null),

        supabase
            .from("player_assessments")
            .select(`
                id,
                player_id,
                final_level,
                assessed_at,
                profiles!player_assessments_player_id_fkey(full_name, player_level)
            `)
            .eq("coach_id", user.id)
            .not("final_level", "is", null)
            .order("assessed_at", { ascending: false })
            .limit(5),

        supabase
            .from("coaching_requests")
            .select("id, player_name, request_type, session_date, session_time, notes")
            .eq("coach_id", user.id)
            .in("status", ["accepted", "completed"])
            .gte("session_date", weekStart)
            .lte("session_date", weekEnd),

        supabase
            .from("package_sessions")
            .select(`
                id,
                session_number,
                session_date,
                session_time,
                status,
                coaching_requests!package_sessions_request_id_fkey(
                    coach_id,
                    player_name,
                    request_type,
                    notes
                )
            `)
            .in("status", ["scheduled", "completed"])
            .gte("session_date", weekStart)
            .lte("session_date", weekEnd)
            .eq("coaching_requests.coach_id", user.id),

        supabase
            .from("assessment_batches")
            .select("id, schedule_date, schedule_time, max_slots")
            .eq("coach_id", user.id)
            .in("status", ["open", "completed"])
            .gte("schedule_date", weekStart)
            .lte("schedule_date", weekEnd)
    ]);

    if (profile?.status === "pending") {
        showWelcomeModal();
    }

    if (todayBookingsError) console.error("Today bookings error:", todayBookingsError);
    if (todayPackageError) console.error("Today package error:", todayPackageError);
    if (todayAssessmentError) console.error("Today assessments error:", todayAssessmentError);
    if (upcomingBookingsError) console.error("Upcoming bookings error:", upcomingBookingsError);
    if (upcomingPackageError) console.error("Upcoming package error:", upcomingPackageError);
    if (upcomingAssessmentError) console.error("Upcoming assessments error:", upcomingAssessmentError);

    const todaySessions = [
        ...(todayBookings || []).map(item => ({
            id: item.id,
            type: "booking",
            player_name: item.player_name,
            request_type: item.request_type,
            session_date: item.session_date,
            session_time: item.session_time,
            notes: item.notes
        })),

        ...(todayPackageSessions || [])
            .filter(item => item.coaching_requests?.coach_id === user.id)
            .map(item => ({
                id: item.id,
                type: "package",
                player_name: item.coaching_requests?.player_name || "Package Player",
                request_type: `Package Session ${item.session_number}`,
                session_date: item.session_date,
                session_time: item.session_time,
                notes: item.coaching_requests?.notes || ""
            })),

        ...(todayAssessments || []).map(item => ({
            id: item.id,
            type: "assessment",
            player_name: "Assessment Batch",
            request_type: `Open Assessment • Max ${item.max_slots} slots`,
            session_date: item.schedule_date,
            session_time: item.schedule_time,
            notes: "Player assessment schedule"
        }))
    ];

    const upcomingSessions = [
        ...(upcomingBookings || []).map(item => ({
            id: item.id,
            type: "booking",
            player_name: item.player_name,
            request_type: item.request_type,
            session_date: item.session_date,
            session_time: item.session_time,
            notes: item.notes
        })),

        ...(upcomingPackageSessions || [])
            .filter(item => item.coaching_requests?.coach_id === user.id)
            .map(item => ({
                id: item.id,
                type: "package",
                player_name: item.coaching_requests?.player_name || "Package Player",
                request_type: `Package Session ${item.session_number}`,
                session_date: item.session_date,
                session_time: item.session_time,
                notes: item.coaching_requests?.notes || ""
            })),

        ...(upcomingAssessments || []).map(item => ({
            id: item.id,
            type: "assessment",
            player_name: "Assessment Batch",
            request_type: `Open Assessment • Max ${item.max_slots} slots`,
            session_date: item.schedule_date,
            session_time: item.schedule_time,
            notes: "Player assessment schedule"
        }))
    ];

    const sortedUpcoming = [...upcomingSessions].sort((a, b) => {
        const dateCompare = new Date(a.session_date) - new Date(b.session_date);
        if (dateCompare !== 0) return dateCompare;
        return (a.session_time || "").localeCompare(b.session_time || "");
    });

    const nextDate = sortedUpcoming[0]?.session_date;
    const sameDaySessions = sortedUpcoming.filter(s => s.session_date === nextDate);

    const nextUpcoming = sameDaySessions.length >= 2
        ? sameDaySessions
        : sortedUpcoming.slice(0, 2);

    const weekSessions = [
        ...(weekBookings || []).map(item => ({
            id: item.id,
            type: "booking",
            player_name: item.player_name,
            request_type: item.request_type,
            session_date: item.session_date,
            session_time: item.session_time,
            notes: item.notes
        })),
        ...(weekPackageSessions || [])
            .filter(item => item.coaching_requests?.coach_id === user.id)
            .map(item => ({
                id: item.id,
                type: "package",
                player_name: item.coaching_requests?.player_name || "Package Player",
                request_type: `Package Session ${item.session_number}`,
                session_date: item.session_date,
                session_time: item.session_time,
                notes: item.coaching_requests?.notes || ""
            })),
        ...(weekAssessments || []).map(item => ({
            id: item.id,
            type: "assessment",
            player_name: "Assessment Batch",
            request_type: `Open Assessment • Max ${item.max_slots} slots`,
            session_date: item.schedule_date,
            session_time: item.schedule_time,
            notes: "Player assessment schedule"
        }))
    ];

    updateDashboardCards({
        today: todaySessions.length,
        requests: pendingRequests?.length || 0,
        pendingAssessments: pendingAssessments?.length || 0,
        upcoming: upcomingSessions.length
    });

    renderWeeklyCalendar(weekSessions);
    renderSessionGrid(todaySessions, "sessionGrid", true);
    renderSessionGrid(nextUpcoming, "upcomingGrid", false);
    renderPendingAssessments(pendingAssessments || []);
    renderRecentAssessments(recentAssessments || []);

    await Promise.all([announcementsTask, notificationsTask]);
}

function updateDashboardCards(stats) {
    setText("statToday", stats.today);
    setText("statRequests", stats.requests);
    setText("statPendingAssessments", stats.pendingAssessments);
    setText("statUpcoming", stats.upcoming);
}

// ─── WEEKLY CALENDAR ───
function renderWeeklyCalendar(weekSessions) {
    const todayKey = getManilaToday();
    const weekStartKey = getWeekStart();

    const dashMonth = document.getElementById("dashMonth");
    if (dashMonth) {
        dashMonth.textContent = new Date(weekStartKey + "T00:00:00").toLocaleDateString("en-US", {
            month: "long",
            year: "numeric"
        });
    }

    weekSessionMap = {};
    weekSessions.forEach(s => {
        if (!weekSessionMap[s.session_date]) weekSessionMap[s.session_date] = [];
        weekSessionMap[s.session_date].push(s);
    });

    const weekGrid = document.getElementById("weekDates");
    if (!weekGrid) return;

    weekGrid.innerHTML = "";

    for (let i = 0; i < 7; i++) {
        const dateKey = addDaysToDateStr(weekStartKey, i);
        const dayNumber = Number(dateKey.slice(8, 10));
        const isToday = dateKey === todayKey;
        const sessions = weekSessionMap[dateKey] || [];
        const count = sessions.length;

        const dots = Array.from({ length: Math.min(count, 3) })
            .map(() => `<span class="cal-dot"></span>`)
            .join("");

        const col = document.createElement("div");
        col.className = `cal-day-col ${isToday ? "today" : ""} ${count > 0 ? "has-sessions" : ""} ${selectedCalDate === dateKey ? "selected" : ""}`;
        col.dataset.date = dateKey;
        col.innerHTML = `
            <div class="cal-day-wrapper">
                <span>${dayNumber}</span>
                <div class="cal-dots">${dots}</div>
                ${count > 3 ? `<span class="cal-extra">+${count - 3}</span>` : ""}
            </div>
        `;

        if (count > 0) {
            col.addEventListener("click", () => {
                selectedCalDate = selectedCalDate === dateKey ? null : dateKey;
                renderWeeklyCalendar(weekSessions);
            });
        }

        weekGrid.appendChild(col);
    }

    renderCalDayDetail();
}

function renderCalDayDetail() {
    const container = document.getElementById("calDayDetail");
    if (!container) return;

    if (!selectedCalDate || !weekSessionMap[selectedCalDate]?.length) {
        container.style.display = "none";
        container.innerHTML = "";
        return;
    }

    const sessions = weekSessionMap[selectedCalDate];
    const dateLabel = new Date(selectedCalDate + "T00:00:00").toLocaleDateString("en-US", {
        weekday: "long",
        month: "short",
        day: "numeric"
    });

    container.style.display = "block";
    container.innerHTML = `
        <div class="cal-detail-header">
            <span>${dateLabel}</span>
            <button class="cal-detail-close" id="calDetailClose"><i class='bx bx-x'></i></button>
        </div>
        <div class="cal-detail-list">
            ${sessions.map(s => `
                <div class="cal-detail-item">
                    <i class='bx ${getSessionIcon(s.type)}'></i>
                    <div class="cal-detail-info">
                        <strong>${s.player_name || "Unknown"}</strong>
                        <span>${s.request_type || "Training"} • ${formatTime(s.session_time)}</span>
                    </div>
                </div>
            `).join("")}
        </div>
    `;

    document.getElementById("calDetailClose")?.addEventListener("click", () => {
        selectedCalDate = null;
        container.style.display = "none";
        container.innerHTML = "";
        document.querySelectorAll(".cal-day-col.selected").forEach(el => el.classList.remove("selected"));
    });
}

// ─── SESSION GRIDS ───
function renderSessionGrid(sessions, gridId, isToday) {
    const grid = document.getElementById(gridId);
    if (!grid) return;

    if (!sessions.length) {
        grid.innerHTML = `
            <div class="empty-state">
                <i class='bx bx-calendar-x'></i>
                <p>${isToday ? "No training or assessment scheduled." : "No upcoming training or assessment."}</p>
            </div>
        `;
        return;
    }

    grid.innerHTML = sessions.map((session, index) => {
        const dateDisplay = isToday
            ? "Today"
            : new Date(session.session_date + "T00:00:00").toLocaleDateString("en-US", {
                month: "short",
                day: "numeric"
            });

        return `
            <div class="court-card">
                <div class="c-header">
                    <strong>${getSessionTitle(session, index)}</strong>
                    <span class="badge ${isToday ? "badge-vacant" : "badge-upcoming"}">
                        ${dateDisplay}
                    </span>
                </div>

                <div class="c-body">
                    <i class='bx ${getSessionIcon(session.type)}' style="font-size:50px;color:var(--primary-color);"></i>
                    <h4>${session.player_name || "Unknown"}</h4>
                    <p>${session.request_type || "Training"} • ${formatTime(session.session_time)}</p>
                    ${session.notes ? `<p class="session-notes">${session.notes}</p>` : ""}
                </div>

                ${isToday
                    ? itemButton(session)
                    : `<button class="btn btn-secondary" disabled>Upcoming</button>`
                }
            </div>
        `;
    }).join("");
}

function getSessionTitle(session, index) {
    if (session.type === "assessment") return "Assessment Schedule";
    if (session.type === "package") return "Package Training";
    return `Training ${index + 1}`;
}

function getSessionIcon(type) {
    if (type === "assessment") return "bx-clipboard";
    if (type === "package") return "bx-package";
    return "bx-user-circle";
}

function itemButton(session) {
    if (session.type === "assessment") {
        return `<button class="btn btn-primary" onclick="location.href='coachStats.html'">View Assessment</button>`;
    }

    if (session.type === "package") {
        return `<button class="btn btn-primary" onclick="markPackageComplete('${session.id}', this)">Complete</button>`;
    }

    return `<button class="btn btn-primary" onclick="markComplete('${session.id}', this)">Check-in</button>`;
}

// ─── ASSESSMENTS ───
function renderPendingAssessments(assessments) {
    const container = document.getElementById("pendingAssessGrid");
    if (!container) return;

    if (!assessments.length) {
        container.innerHTML = `
            <div class="empty-state">
                <i class='bx bx-clipboard'></i>
                <p>No pending assessments.</p>
            </div>
        `;
        return;
    }

    container.innerHTML = assessments.map(item => {
        const playerName = item.profiles?.full_name || "Unknown Player";
        const level = item.profiles?.player_level || "Not Set";

        return `
            <div class="assessment-card">
                <div>
                    <h4>${playerName}</h4>
                    <p>Current Level: ${level}</p>
                </div>
                <button class="btn btn-primary" onclick="goToAssessment('${item.player_id}')">
                    Assess
                </button>
            </div>
        `;
    }).join("");
}

function renderRecentAssessments(assessments) {
    const container = document.getElementById("recentAssessGrid");
    if (!container) return;

    if (!assessments.length) {
        container.innerHTML = `
            <div class="empty-state">
                <i class='bx bx-file'></i>
                <p>No completed assessments yet.</p>
            </div>
        `;
        return;
    }

    container.innerHTML = assessments.map(item => {
        const playerName = item.profiles?.full_name || "Unknown Player";
        const level = item.final_level || "Not Set";
        const date = item.assessed_at
            ? new Date(item.assessed_at).toLocaleDateString("en-US", {
                month: "short",
                day: "numeric",
                year: "numeric"
            })
            : "-";

        return `
            <div class="assessment-card">
                <div class="assessment-info">
                    <h4>${playerName}</h4>

                    <p>
                        Final Level:<br>
                        <strong>${level}</strong>
                    </p>

                    <button
                        class="btn btn-secondary assessment-btn"
                        onclick="viewAssessment('${item.player_id}')">
                        View
                    </button>

                    <small>${date}</small>
                </div>
            </div>
        `;
    }).join("");
}

// ─── SESSION ACTIONS ───
window.markComplete = async function (sessionId, btn) {
    btn.disabled = true;
    btn.textContent = "Saving...";

    const { error } = await supabase
        .from("coaching_requests")
        .update({ status: "completed" })
        .eq("id", sessionId);

    if (error) {
        console.error(error);
        btn.disabled = false;
        btn.textContent = "Check-in";
        alert("Failed to mark session.");
        return;
    }

    btn.textContent = "Done";
    btn.classList.replace("btn-primary", "btn-secondary");
    btn.disabled = true;

    await loadCoachDashboard();
};

window.markPackageComplete = async function (sessionId, btn) {
    btn.disabled = true;
    btn.textContent = "Saving...";

    const { error } = await supabase
        .from("package_sessions")
        .update({ status: "completed" })
        .eq("id", sessionId);

    if (error) {
        console.error(error);
        btn.disabled = false;
        btn.textContent = "Complete";
        alert("Failed to complete package session.");
        return;
    }

    btn.textContent = "Done";
    btn.classList.replace("btn-primary", "btn-secondary");
    btn.disabled = true;

    await loadCoachDashboard();
};

window.goToAssessment = function (playerId) {
    window.location.href = `coachStats.html?player=${playerId}`;
};

window.viewAssessment = function (playerId) {
    window.location.href = `coachStats.html?player=${playerId}&view=readonly`;
};

// ─── WELCOME MODAL ───
function showWelcomeModal() {
    const modal = document.getElementById("welcomeModal");
    if (modal) modal.style.display = "flex";
}

window.dismissWelcome = function () {
    const modal = document.getElementById("welcomeModal");
    if (modal) modal.style.display = "none";
};

window.goToSettings = function () {
    window.location.href = "Settings.html";
};

// ─── NOTIFICATIONS ───
async function loadNotifications(coachId) {
    const { data, error } = await supabase
        .from("notifications")
        .select("id, title, message, is_read, created_at")
        .eq("user_id", coachId)
        .order("created_at", { ascending: false });

    const list = document.getElementById("notifList");
    const badge = document.getElementById("notifBadge");

    if (!list || !badge) return;

    if (error || !data || data.length === 0) {
        list.innerHTML = `<li class="notif-empty">No new notifications.</li>`;
        badge.style.display = "none";
        return;
    }

    const unread = data.filter(n => !n.is_read).length;
    badge.textContent = unread > 0 ? unread : "";
    badge.style.display = unread > 0 ? "flex" : "none";

    list.innerHTML = data.map(notif => `
        <li class="notif-item ${notif.is_read ? "" : "unread"}" data-id="${notif.id}" style="cursor:pointer;">
            <div class="notif-icon new-req">
                <i class='bx bx-bell'></i>
            </div>
            <div class="notif-text">
                <p><strong>${notif.title}</strong></p>
                <p>${notif.message}</p>
                <span>${getTimeAgo(new Date(notif.created_at))}</span>
            </div>
        </li>
    `).join("");

    list.querySelectorAll(".notif-item[data-id]").forEach(item => {
        item.addEventListener("click", async () => {
            if (!item.classList.contains("unread")) return;

            const { error: markError } = await supabase
                .from("notifications")
                .update({ is_read: true })
                .eq("id", item.dataset.id);

            if (markError) return;

            item.classList.remove("unread");

            const remainingUnread = document.querySelectorAll(".notif-item.unread").length;
            badge.textContent = remainingUnread > 0 ? remainingUnread : "";
            badge.style.display = remainingUnread > 0 ? "flex" : "none";
        });
    });
}

function startNotifPolling() {
    setInterval(async () => {
        const { data: { session } } = await supabase.auth.getSession();
        if (session?.user) {
            await loadNotifications(session.user.id);
        }
    }, 20000);
}

window.toggleNotifPanel = function () {
    document.getElementById("notifPanel")?.classList.toggle("open");
};

window.clearNotifs = async function () {
    const { data: authData } = await supabase.auth.getUser();
    const user = authData?.user;
    if (!user) return;

    await supabase
        .from("notifications")
        .update({ is_read: true })
        .eq("user_id", user.id)
        .eq("is_read", false);

    document.querySelectorAll(".notif-item.unread").forEach(item => {
        item.classList.remove("unread");
    });

    const badge = document.getElementById("notifBadge");
    if (badge) badge.style.display = "none";
};

function closeNotifOnOutsideClick(e) {
    const wrapper = document.querySelector(".notif-wrapper");
    if (wrapper && !wrapper.contains(e.target)) {
        document.getElementById("notifPanel")?.classList.remove("open");
    }
}

// ─── HELPERS ───
function setText(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
}

function formatTime(timeStr) {
    if (!timeStr) return "-";
    if (timeStr.includes("-")) {
        const times = timeStr.split("-");
        return `${convertSingleTime(times[0].trim())} - ${convertSingleTime(times[1].trim())}`;
    }
    return convertSingleTime(timeStr);
}

function convertSingleTime(time) {
    const cleanTime = time.split(":").slice(0, 2).join(":");
    const [h, m] = cleanTime.split(":").map(Number);
    if (isNaN(h) || isNaN(m)) return time;
    const period = h >= 12 ? "PM" : "AM";
    const hour = h % 12 || 12;
    return `${hour}:${String(m).padStart(2, "0")} ${period}`;
}

function getTimeAgo(date) {
    const diff = Math.floor((Date.now() - date.getTime()) / 1000);

    if (diff < 60) return "Just now";
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;

    return `${Math.floor(diff / 86400)}d ago`;
}