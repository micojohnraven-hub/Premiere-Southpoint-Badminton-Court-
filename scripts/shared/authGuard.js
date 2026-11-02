import { supabase } from "../supabase/supabaseClient.js";
import { initIdleLogout } from "./idleLogout.js";

const LOGIN_PATH = "/pages/auth/login.html";

const MIN = 60 * 1000;
const IDLE_TIMEOUT_BY_ROLE = {
    player: 15 * MIN,
    coach: 15 * MIN,
    employee: 30 * MIN,
    business_admin: 30 * MIN,
    sys_admin: 10 * MIN
};
const DEFAULT_IDLE_TIMEOUT = 15 * MIN;

function startIdleLogout(role) {
    if (window.__idleStarted) return; 
    window.__idleStarted = true;
    initIdleLogout(supabase, {
        timeoutMs: IDLE_TIMEOUT_BY_ROLE[role] ?? DEFAULT_IDLE_TIMEOUT,
        redirectTo: LOGIN_PATH
    });
}

function showAlert(message, type = "info") {
    document.getElementById("globalToast")?.remove();

    const colors = {
        success: "#16a34a",
        error: "#ef4444",
        warning: "#f59e0b",
        info: "#2563eb"
    };

    const toast = document.createElement("div");
    toast.id = "globalToast";
    toast.textContent = message;

    toast.style.cssText = `
        position:fixed;
        top:20px;
        right:20px;
        background:${colors[type] || colors.info};
        color:#fff;
        padding:12px 18px;
        border-radius:10px;
        box-shadow:0 8px 25px rgba(0,0,0,.18);
        z-index:99999;
        font-size:14px;
        font-weight:600;
        max-width:320px;
    `;

    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 2500);
}

async function redirectWithToast(message, type = "info", path = LOGIN_PATH) {
    showAlert(message, type);

    setTimeout(async () => {
        await supabase.auth.signOut().catch(() => {});
        window.location.href = path;
    }, 1800);
}

export async function checkAccess(allowedRoles = []) {
    const { data: { user }, error: userError } = await supabase.auth.getUser();

    if (userError || !user) {
        window.location.href = LOGIN_PATH;
        return;
    }

    const { data: profile, error: profileError } = await supabase
        .from("profiles")
        .select("role, status")
        .eq("id", user.id)
        .single();

    if (profileError || !profile) {
        await redirectWithToast("Profile not found. Please log in again.", "error");
        return;
    }

    const status = profile.status || "active";

    if (status === "pending") {
        const isSettingsPage = window.location.pathname.includes("Settings.html");

        if (!isSettingsPage) {
            await redirectWithToast("Please complete your account setup first.", "warning");
            return;
        }

        startIdleLogout(profile.role);
        return profile;
    }

    if (status === "suspended") {
        await redirectWithToast("Your account is currently suspended.", "warning");
        return;
    }

    if (status === "banned") {
        await redirectWithToast("Your account has been banned.", "error");
        return;
    }

    if (status !== "active") {
        await redirectWithToast("Your account is inactive. Please contact admin", "error");
        return;
    }

    if (allowedRoles.length && !allowedRoles.includes(profile.role)) {
        showAlert("Access denied.", "error");

        setTimeout(() => {
            switch (profile.role) {
                case "player":
                    window.location.href = "/pages/player/player.html";
                    break;
                case "coach":
                    window.location.href = "/pages/coach/Dashboard.html";
                    break;
                case "employee":
                    window.location.href = "/pages/employee/employeeRole.html";
                    break;
                case "sys_admin":
                    window.location.href = "/pages/sysAdmin/systemAdmin.html";
                    break;
                case "business_admin":
                    window.location.href = "/pages/admin/Dashboard.html";
                    break;
                default:
                    supabase.auth.signOut().catch(() => {});
                    window.location.href = LOGIN_PATH;
            }
        }, 1000);

        return;
    }

    startIdleLogout(profile.role);
    return profile;
}