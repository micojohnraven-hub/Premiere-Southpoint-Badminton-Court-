import { supabase } from "../supabase/supabaseClient.js";
import { saveLog } from "../sysAdmin/sysLogs.js";

const MAINTENANCE_PAGE = "/pages/shared/maintenance.html";

function redirectNow(role) {
    switch (role) {
        case "player":
            window.location.href = "../player/player.html";
            break;
        case "coach":
            window.location.href = "../coach/coachDashboard.html";
            break;
        case "employee":
            window.location.href = "../employee/employeeRole.html";
            break;
        case "sys_admin":
            window.location.href = "../sysAdmin/systemAdmin.html";
            break;
        case "business_admin":
            window.location.href = "../admin/Dashboard.html";
            break;
        default:
            showError("Unknown role. Contact administrator.");
    }
}

function showError(message, persist = false) {
    let errEl = document.getElementById("loginError");

    if (!errEl) {
        errEl = document.createElement("p");
        errEl.id = "loginError";
        errEl.style.cssText = `
            color: #ef4444;
            font-size: 0.82rem;
            text-align: center;
            margin: 8px 0 0;
            font-weight: 600;
        `;
        document.querySelector(".btn-login")?.before(errEl);
    }

    errEl.innerText = message;

    if (!persist) {
        setTimeout(() => {
            if (errEl) errEl.innerText = "";
        }, 4000);
    }
}

function setLoading(isLoading) {
    const btn = document.getElementById("loginBtn");
    if (!btn) return;
    btn.disabled = isLoading;
    btn.innerText = isLoading ? "Logging in..." : "LOGIN";
}

async function isMaintenanceMode() {
    const { data, error } = await supabase
        .from("site_settings")
        .select("maintenance_mode")
        .eq("id", "homepage")
        .single();

    if (error) {
        console.error("Maintenance check failed:", error);
        return false;
    }
    return data?.maintenance_mode === true;
}

function redirectToMaintenance() {
    window.location.replace(MAINTENANCE_PAGE);
}

async function checkMaintenanceAccess(role) {
    const maintenance = await isMaintenanceMode();
    if (maintenance && role !== "sys_admin") {
        redirectToMaintenance();
        return false;
    }
    return true;
}

// ─── SHOW ERROR FROM PREVIOUS OAUTH ATTEMPT ───
const storedError = sessionStorage.getItem("loginError");
if (storedError) {
    showError(storedError, true);
    sessionStorage.removeItem("loginError");
}

// ─── PASSWORD VISIBILITY TOGGLE ───
const togglePasswordBtn = document.getElementById("togglePassword");
const passwordInput = document.getElementById("password");

if (togglePasswordBtn && passwordInput) {
    togglePasswordBtn.addEventListener("click", () => {
        const isHidden = passwordInput.type === "password";
        passwordInput.type = isHidden ? "text" : "password";
        togglePasswordBtn.classList.toggle("bx-low-vision", !isHidden);
        togglePasswordBtn.classList.toggle("bx-show", isHidden);
    });
}

// ─── LOGIN FORM ───
const loginForm = document.getElementById("loginForm");
if (loginForm) {
    loginForm.addEventListener("submit", async e => {
        e.preventDefault();

        const username = document.getElementById("username")?.value.trim();
        const password = document.getElementById("password")?.value.trim();

        if (!username || !password) {
            showError("Please fill in all fields.");
            return;
        }

        setLoading(true);

        const { data: profileData, error: profileError } = await supabase
            .from("profiles")
            .select("id, email, role, status, locked_until")
            .eq("username", username)
            .maybeSingle();

        if (profileError || !profileData) {
            showError("Username not found.");
            await saveLog("AUTH", `Login failed: Username "${username}" not found`, "Unknown", "warning");
            setLoading(false);
            return;
        }

        if (profileData.locked_until) {
            if (new Date(profileData.locked_until) > new Date()) {
                showError("Your account is temporarily locked. Please try again later.");
                await saveLog("AUTH", `Access blocked: Account temporarily locked for ${username}`, username, "error");
                setLoading(false);
                return;
            }
            await supabase.rpc("reset_login_attempts", { p_user_id: profileData.id });
        }

        if (["suspended", "banned", "inactive"].includes(profileData.status)) {
            const blockMessages = {
                suspended: "Your account is currently suspended. Please contact the admin.",
                banned: "Your account has been permanently banned.",
                inactive: "Your account is inactive. Please contact support."
            };
            showError(blockMessages[profileData.status], true);
            await saveLog("AUTH", `Blocked access: ${profileData.status} user tried to log in`, username, "critical");
            setLoading(false);
            return;
        }

        const allowed = await checkMaintenanceAccess(profileData.role);
        if (!allowed) {
            await saveLog("AUTH", `Login blocked during maintenance: ${username} (${profileData.role})`, username, "warning");
            setLoading(false);
            return;
        }

        const { error: signInError } = await supabase.auth.signInWithPassword({
            email: profileData.email,
            password
        });

        if (signInError) {
            const { data: failedLogin } = await supabase.rpc("handle_failed_login", { p_user_id: profileData.id });
            if (failedLogin?.locked) {
                showError("Too many failed login attempts. Your account has been locked for 15 minutes.", true);
                await saveLog("AUTH", `Account locked due to too many failed attempts: ${username}`, username, "critical");
            } else {
                showError(`Incorrect password. ${failedLogin?.remaining_attempts ?? 0} attempt(s) remaining.`);
                await saveLog("AUTH", `Incorrect password attempt for ${username}`, username, "warning");
            }
            setLoading(false);
            return;
        }

        await supabase.rpc("reset_login_attempts", { p_user_id: profileData.id });

        if (profileData.status === "pending") {
            await saveLog("AUTH", "User logged in (Status: Pending Password Change)", username, "info");
            switch (profileData.role) {
                case "coach":
                    window.location.href = "../coach/Settings.html";
                    break;
                case "employee":
                    window.location.href = "../employee/Settings.html";
                    break;
                default:
                    redirectNow(profileData.role);
            }
            return;
        }

        await saveLog("AUTH", `User logged in successfully (${profileData.role})`, username, "success");
        redirectNow(profileData.role);
    });
}

// ─── GOOGLE LOGIN ───
const googleBtn = document.getElementById("googleLoginBtn");

if (googleBtn) {
    googleBtn.addEventListener("click", async e => {
        e.preventDefault();

        const maintenance = await isMaintenanceMode();
        if (maintenance) {
            redirectToMaintenance();
            return;
        }

        await saveLog("AUTH", "Google OAuth login initiated.", "Google_User", "info");

        const { data, error } = await supabase.auth.signInWithOAuth({
            provider: "google",
            options: {
                scopes: "https://www.googleapis.com/auth/calendar.events",
                queryParams: { access_type: "offline", prompt: "consent" },
                redirectTo: `${window.location.origin}/pages/auth/authCallback.html`
            }
        });

        if (error) {
            showError("Google login error: " + error.message);
            return;
        }

        if (data?.url) {
            window.location.href = data.url;
        }
    });
}