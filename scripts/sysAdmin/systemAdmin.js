import { supabase } from "../supabase/supabaseClient.js";
import { checkAccess } from "../shared/authGuard.js";

// ─── CONFIG ───

const HEALTH_INTERVAL_MS = 60000;
const QUERY_TIMEOUT_MS = 8000;
const REFRESH_DEBOUNCE_MS = 400;
const BACKUP_COOLDOWN_MS = 30000;
const DAY_MS = 24 * 60 * 60 * 1000;
const MANILA_OFFSET_MS = 8 * 60 * 60 * 1000;
const ALLOWED_PRIORITIES = ["low", "medium", "high"];
const ALLOWED_LOG_STATUSES = ["success", "warning", "error", "info"];

const MODAL_ICONS = {
    default: { className: "", icon: "bx-question-mark" },
    success: { className: "", icon: "bx-check-circle" },
    warning: { className: "warning", icon: "bx-error" },
    danger: { className: "warning", icon: "bx-error" },
    error: { className: "error", icon: "bx-x-circle" }
};

// ─── STATE ───

const state = {
    health: { database: null, auth: null },
    realtime: "connecting",
    channel: null,
    healthTimer: null,
    healthRunning: false,
    timers: {},
    backupCooldownUntil: 0
};

let modalQueue = Promise.resolve();

// ─── BOOT ───

document.addEventListener("DOMContentLoaded", init);

async function init() {
    setupModal();
    setupNavigation();
    setupLogout();

    const allowed = await checkAccess(["sys_admin"]);
    if (allowed === false) return;

    setupMaintenance();
    setupBackupActions();
    setupLifecycle();
    setupRealtime();

    await Promise.allSettled([
        loadSystemHealth(),
        loadTechnicalIssues(),
        loadRecentLogs(),
        loadBackups(),
        loadMaintenanceMode()
    ]);

    startHealthPolling();
}

// ─── UTILITIES ───

function byId(id) {
    return document.getElementById(id);
}

function setText(id, text, className) {
    const element = byId(id);
    if (!element) return;

    element.textContent = text;

    if (className !== undefined) {
        element.className = className;
    }
}

function setBadge(id, text, level) {
    setText(id, text, `health-status ${level}`.trim());
}

function withTimeout(promise, ms = QUERY_TIMEOUT_MS) {
    let timer;

    const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("Request timed out")), ms);
    });

    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

async function runQuery(builder) {
    try {
        return await withTimeout(builder);
    } catch (error) {
        return { data: null, count: null, error };
    }
}

function scheduleRefresh(key, callback) {
    clearTimeout(state.timers[key]);
    state.timers[key] = setTimeout(callback, REFRESH_DEBOUNCE_MS);
}

function safeClass(value, allowed, fallback) {
    const normalized = String(value || "").toLowerCase();
    return allowed.includes(normalized) ? normalized : fallback;
}

function startOfTodayManila() {
    const shifted = Date.now() + MANILA_OFFSET_MS;
    return new Date(Math.floor(shifted / DAY_MS) * DAY_MS - MANILA_OFFSET_MS);
}

function formatDate(value) {
    const date = new Date(value);

    if (!value || Number.isNaN(date.getTime())) return "";

    return date.toLocaleDateString("en-PH", {
        month: "short",
        day: "numeric",
        year: "numeric",
        timeZone: "Asia/Manila"
    });
}

function formatDateTime(value) {
    const date = new Date(value);

    if (!value || Number.isNaN(date.getTime())) return "";

    return date.toLocaleString("en-PH", {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
        timeZone: "Asia/Manila"
    });
}

function escapeHtml(value) {
    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

// ─── SYSTEM HEALTH ───

async function loadSystemHealth() {
    if (state.healthRunning) return;

    state.healthRunning = true;

    const [databaseResult, authResult] = await Promise.all([
        runQuery(supabase.from("profiles").select("id").limit(1)),
        runQuery(supabase.auth.getUser())
    ]);

    state.health.database = !databaseResult.error;
    state.health.auth = !authResult.error && Boolean(authResult.data?.user);
    state.healthRunning = false;

    renderHealth();
}

function renderHealth() {
    renderBadge("databaseStatus", state.health.database, "Connected", "Connection Error");
    renderBadge("authStatus", state.health.auth, "Operational", "Unavailable");
    renderServiceStatus();
    renderOverallStatus();
}

function renderBadge(id, ok, okText, failText) {
    if (ok === null) {
        setBadge(id, "Checking...", "");
    } else if (ok) {
        setBadge(id, okText, "optimal");
    } else {
        setBadge(id, failText, "critical");
    }
}

function renderServiceStatus() {
    const labels = {
        connecting: ["Connecting...", ""],
        connected: ["Operational", "optimal"],
        error: ["Degraded", "critical"]
    };

    const [text, level] = labels[state.realtime] || labels.connecting;

    setBadge("serviceStatus", text, level);
}

function renderOverallStatus() {
    const { database, auth } = state.health;

    let label = "Online";
    let level = "optimal";
    let text = "All systems operational";

    if (database === false) {
        label = "Warning";
        level = "critical";
        text = "Database connection problem";
    } else if (auth === false) {
        label = "Warning";
        level = "critical";
        text = "Authentication problem";
    } else if (state.realtime === "error") {
        label = "Degraded";
        level = "critical";
        text = "Live updates unavailable";
    } else if (database === null || auth === null || state.realtime === "connecting") {
        label = "Checking...";
        level = "";
        text = "Running health checks";
    }

    setText("systemStatus", label, level);
    setText("systemStatusText", text);
}

function startHealthPolling() {
    stopHealthPolling();

    if (document.hidden) return;

    state.healthTimer = setInterval(loadSystemHealth, HEALTH_INTERVAL_MS);
}

function stopHealthPolling() {
    clearInterval(state.healthTimer);
    state.healthTimer = null;
}

// ─── TECHNICAL ISSUES ───

async function loadTechnicalIssues() {
    const issueList = byId("issueList");

    const [listResult, countResult] = await Promise.all([
        runQuery(
            supabase
                .from("court_issues")
                .select("id, issue_type, description, priority, created_at")
                .eq("status", "pending")
                .order("created_at", { ascending: false })
                .limit(5)
        ),
        runQuery(
            supabase
                .from("court_issues")
                .select("id", { count: "exact", head: true })
                .eq("status", "pending")
        )
    ]);

    if (listResult.error || countResult.error) {
        console.error("Technical issues error:", listResult.error || countResult.error);

        setText("technicalIssues", "—", "");
        setBadge("issueStatus", "Unavailable", "critical");
        issueList.innerHTML =
            '<p class="empty-message">Unable to load technical issues.</p>';
        return;
    }

    const total = countResult.count ?? 0;
    const rows = listResult.data || [];

    setText("technicalIssues", String(total), total > 0 ? "critical" : "optimal");

    if (total === 0) {
        setBadge("issueStatus", "No Pending Issues", "optimal");
        issueList.innerHTML =
            '<p class="empty-message">No pending technical issues.</p>';
        return;
    }

    setBadge("issueStatus", `${total} Pending`, "critical");

    issueList.innerHTML = rows.map(issue => {
        const priority = safeClass(issue.priority, ALLOWED_PRIORITIES, "low");

        return `
            <div class="issue-item">
                <div class="issue-icon">
                    <i class='bx bx-error-circle'></i>
                </div>

                <div class="issue-info">
                    <strong>${escapeHtml(issue.issue_type || "Court Issue")}</strong>
                    <span>${escapeHtml(issue.description || "No description")}</span>
                    <small>${formatDate(issue.created_at)}</small>
                </div>

                <span class="priority ${priority}">${priority}</span>
            </div>
        `;
    }).join("");
}

// ─── SYSTEM LOGS ───

async function loadRecentLogs() {
    const logFeed = byId("logFeed");

    const [listResult, countResult] = await Promise.all([
        runQuery(
            supabase
                .from("system_logs")
                .select("id, event, status, created_at")
                .order("created_at", { ascending: false })
                .limit(8)
        ),
        runQuery(
            supabase
                .from("system_logs")
                .select("id", { count: "exact", head: true })
                .gte("created_at", startOfTodayManila().toISOString())
        )
    ]);

    if (countResult.error) {
        console.error("System logs count error:", countResult.error);
        setText("todayLogs", "—");
    } else {
        setText("todayLogs", String(countResult.count ?? 0));
    }

    if (listResult.error) {
        console.error("System logs error:", listResult.error);
        logFeed.innerHTML =
            '<p class="empty-message">Unable to load system activity.</p>';
        return;
    }

    const rows = listResult.data || [];

    if (!rows.length) {
        logFeed.innerHTML =
            '<p class="empty-message">No recent system activity.</p>';
        return;
    }

    logFeed.innerHTML = rows.map(log => `
        <div class="log-item ${safeClass(log.status, ALLOWED_LOG_STATUSES, "success")}">
            <span class="time">${formatDateTime(log.created_at)}</span>
            <p>${escapeHtml(log.event || "System activity recorded.")}</p>
        </div>
    `).join("");
}

// ─── BACKUP REQUESTS ───

async function loadBackups() {
    const backupList = byId("backupList");

    const { data, error } = await runQuery(
        supabase
            .from("backups")
            .select("id, filename, created_at")
            .order("created_at", { ascending: false })
            .limit(1)
    );

    if (error) {
        console.error("Backup loading error:", error);
        backupList.innerHTML =
            '<p class="empty-message">Unable to load backup requests.</p>';
        return;
    }

    if (!data || !data.length) {
        backupList.innerHTML =
            '<p class="empty-message">No backup requests recorded.</p>';
        return;
    }

    renderLatestBackup(data[0]);
}

function renderLatestBackup(backup) {
    const backupList = byId("backupList");

    backupList.innerHTML = `
        <div class="backup-item">
            <div>
                <span>${escapeHtml(backup.filename)}</span>
                <small>Requested ${formatDateTime(backup.created_at)}</small>
            </div>
        </div>
    `;
}

async function createBackup() {
    const backupBtn = byId("createBackupBtn");

    if (!backupBtn || backupBtn.disabled) return;

    if (Date.now() < state.backupCooldownUntil) {
        await showAlert(
            "Please Wait",
            "A request was just logged. Try again in a few seconds.",
            "warning"
        );
        return;
    }

    backupBtn.disabled = true;
    backupBtn.innerHTML =
        "<i class='bx bx-loader-alt bx-spin'></i> Logging Request...";

    state.backupCooldownUntil = Date.now() + BACKUP_COOLDOWN_MS;

    const stamp = new Date(Date.now() + MANILA_OFFSET_MS)
    .toISOString()
    .slice(0, 19)
    .replace(/[-:T]/g, "");

    const { error } = await runQuery(
        supabase
            .from("backups")
            .insert([{ filename: `backup_request_${stamp}` }])
    );

    if (error) {
        console.error("Backup request error:", error);

        await showAlert(
            "Request Failed",
            "Unable to record the backup request.",
            "error"
        );
    } else {
        await loadBackups();

        await showAlert(
            "Request Logged",
            "The backup request was recorded. This prototype does not copy the database.",
            "success"
        );
    }

    backupBtn.disabled = false;
    backupBtn.innerHTML =
        "<i class='bx bx-plus'></i> Log Backup Request";
}

function setupBackupActions() {
    const backupBtn = byId("createBackupBtn");

    if (backupBtn) {
        backupBtn.addEventListener("click", createBackup);
    }
}

// ─── MAINTENANCE MODE ───

async function loadMaintenanceMode() {
    const toggle = byId("maintenanceToggle");

    if (!toggle) return;

    toggle.disabled = true;

    const { data, error } = await runQuery(
        supabase
            .from("site_settings")
            .select("maintenance_mode")
            .eq("id", "homepage")
            .maybeSingle()
    );

    if (error || !data) {
        console.error("Maintenance mode error:", error || "Settings row not found");

        toggle.checked = false;
        toggle.setAttribute("aria-label", "Maintenance mode status unavailable");
        toggle.title = "Maintenance mode status unavailable";
        return;
    }

    toggle.checked = Boolean(data.maintenance_mode);
    toggle.disabled = false;
    toggle.title = "";
    toggle.setAttribute("aria-label", "Toggle maintenance mode");
}

function setupMaintenance() {
    const toggle = byId("maintenanceToggle");

    if (!toggle) return;

    toggle.addEventListener("change", async event => {
        const enabled = event.target.checked;

        toggle.disabled = true;

        const confirmed = await showConfirm(
            enabled
                ? "Activate Maintenance Mode"
                : "Deactivate Maintenance Mode",
            enabled
                ? "This will block public access to the system.\nDo you want to continue?"
                : "Public access will be restored immediately.\nDo you want to continue?",
            enabled ? "Activate" : "Deactivate",
            enabled ? "warning" : "default"
        );

        if (!confirmed) {
            toggle.checked = !enabled;
            toggle.disabled = false;
            return;
        }

        const { data, error } = await runQuery(
            supabase
                .from("site_settings")
                .update({ maintenance_mode: enabled })
                .eq("id", "homepage")
                .select("maintenance_mode")
        );

        const saved = !error && Array.isArray(data) && data.length === 1;

        if (!saved) {
            console.error("Maintenance update error:", error || "No row was updated");

            toggle.checked = !enabled;
            toggle.disabled = false;

            await showAlert(
                "Update Failed",
                "Unable to update maintenance mode. Please try again.",
                "error"
            );
            return;
        }

        toggle.disabled = false;

        await showAlert(
            enabled
                ? "Maintenance Mode Activated"
                : "Maintenance Mode Deactivated",
            enabled
                ? "Public access has been restricted."
                : "Public access has been restored.",
            enabled ? "warning" : "success"
        );
    });
}

// ─── REALTIME ───

function setupRealtime() {
    state.channel = supabase
        .channel("system-admin-overwatch")
        .on(
            "postgres_changes",
            { event: "INSERT", schema: "public", table: "system_logs" },
            () => scheduleRefresh("logs", loadRecentLogs)
        )
        .on(
            "postgres_changes",
            { event: "*", schema: "public", table: "court_issues" },
            () => scheduleRefresh("issues", loadTechnicalIssues)
        )
        .on(
            "postgres_changes",
            { event: "INSERT", schema: "public", table: "backups" },
            payload => {
                if (payload.new) renderLatestBackup(payload.new);
            }
        )
        .on(
            "postgres_changes",
            {
                event: "UPDATE",
                schema: "public",
                table: "site_settings",
                filter: "id=eq.homepage"
            },
            payload => {
                const toggle = byId("maintenanceToggle");

                if (toggle && payload.new) {
                    toggle.checked = Boolean(payload.new.maintenance_mode);
                }
            }
        )
        .subscribe(status => handleRealtimeStatus(status));
}

function handleRealtimeStatus(status) {
    const previous = state.realtime;

    if (status === "SUBSCRIBED") {
        state.realtime = "connected";
    } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
        state.realtime = "error";
    }

    renderServiceStatus();
    renderOverallStatus();

    if (previous === "error" && state.realtime === "connected") {
        loadTechnicalIssues();
        loadRecentLogs();
        loadBackups();
        loadMaintenanceMode();
    }
}

function setupLifecycle() {
    document.addEventListener("visibilitychange", () => {
        if (document.hidden) {
            stopHealthPolling();
            return;
        }

        loadSystemHealth();
        startHealthPolling();
    });

    window.addEventListener("pagehide", () => {
        stopHealthPolling();

        if (state.channel) {
            supabase.removeChannel(state.channel);
            state.channel = null;
        }
    });
}

// ─── NAVIGATION ───

function setupNavigation() {
    const navigation = {
        viewLogsBtn: "sysLogs.html",
        logsBtn: "sysLogs.html",
        viewFixesBtn: "sysFixes.html",
        fixesBtn: "sysFixes.html",
        usersBtn: "sysUsers.html",
        contentBtn: "sysContent.html"
    };

    Object.entries(navigation).forEach(([id, page]) => {
        const button = byId(id);

        if (!button) return;

        button.addEventListener("click", () => {
            window.location.href = page;
        });
    });
}

function setupLogout() {
    const logoutBtn = byId("logoutBtn");

    if (!logoutBtn) return;

    logoutBtn.addEventListener("click", async event => {
        event.preventDefault();

        try {
            await withTimeout(supabase.auth.signOut({ scope: "local" }));
        } catch (error) {
            console.error("Logout error:", error);
        }

        window.location.href = "../auth/login.html";
    });
}

// ─── MODAL ───

function setupModal() {
    const message = byId("modalMessage");

    if (message) {
        message.style.whiteSpace = "pre-line";
    }
}

function enqueueModal(options) {
    const result = modalQueue.then(() => presentModal(options));
    modalQueue = result.catch(() => {});
    return result;
}

function presentModal({ title, message, confirmText, cancelText, type }) {
    return new Promise(resolve => {
        const modal = byId("systemModal");
        const icon = byId("modalIcon");
        const cancelBtn = byId("modalCancelBtn");
        const confirmBtn = byId("modalConfirmBtn");
        const previouslyFocused = document.activeElement;
        const iconConfig = MODAL_ICONS[type] || MODAL_ICONS.default;

        setText("modalTitle", title);
        setText("modalMessage", message);

        confirmBtn.textContent = confirmText;
        confirmBtn.classList.toggle("danger", type === "danger");

        cancelBtn.textContent = cancelText || "Cancel";
        cancelBtn.style.display = cancelText ? "" : "none";

        icon.className = `system-modal-icon ${iconConfig.className}`.trim();
        icon.innerHTML = `<i class='bx ${iconConfig.icon}'></i>`;

        const onKeydown = event => {
            if (event.key === "Escape") {
                event.preventDefault();
                finish(false);
                return;
            }

            if (event.key !== "Tab") return;

            const focusable = [cancelBtn, confirmBtn].filter(
                button => button.style.display !== "none"
            );
            const first = focusable[0];
            const last = focusable[focusable.length - 1];

            if (event.shiftKey && document.activeElement === first) {
                event.preventDefault();
                last.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault();
                first.focus();
            }
        };

        const finish = result => {
            modal.classList.remove("show");
            modal.setAttribute("aria-hidden", "true");

            confirmBtn.onclick = null;
            cancelBtn.onclick = null;
            modal.onclick = null;
            document.removeEventListener("keydown", onKeydown);

            if (previouslyFocused && typeof previouslyFocused.focus === "function") {
                previouslyFocused.focus();
            }

            resolve(result);
        };

        confirmBtn.onclick = () => finish(true);
        cancelBtn.onclick = () => finish(false);
        modal.onclick = event => {
            if (event.target === modal) finish(false);
        };

        document.addEventListener("keydown", onKeydown);

        modal.classList.add("show");
        modal.setAttribute("aria-hidden", "false");
        confirmBtn.focus();
    });
}

function showConfirm(title, message, confirmText = "Confirm", type = "default") {
    return enqueueModal({
        title,
        message,
        confirmText,
        cancelText: "Cancel",
        type
    });
}

function showAlert(title, message, type = "success") {
    return enqueueModal({
        title,
        message,
        confirmText: "Okay",
        cancelText: null,
        type
    });
}