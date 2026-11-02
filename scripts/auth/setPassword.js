import { supabase } from "../supabase/supabaseClient.js";

const form        = document.getElementById("setPasswordForm");
const messageBox  = document.getElementById("messageBox");
const setBtn      = document.getElementById("setBtn");

const ROLE_LABELS = {
    coach:          "Coach",
    employee:       "Employee",
    business_admin: "Business Admin",
};

// ── I-exchange ang token mula sa invite link (PKCE flow) ──────────
await handleInviteCode();

async function handleInviteCode() {
    const { data: { session: existingSession } } = await supabase.auth.getSession();
    if (existingSession) {
        updateRoleLabel(existingSession.user);
        return;
    }

    const params = new URLSearchParams(window.location.search);
    const code   = params.get("code");

    if (!code) {
        showMessage("Invalid or expired invite link. Please contact the admin.", "error");
        setBtn.disabled = true;
        return;
    }

    const { data, error: sessionError } = await supabase.auth.exchangeCodeForSession(code);

    window.history.replaceState({}, document.title, window.location.pathname);

    if (sessionError) {
        showMessage("Invalid or expired invite link. Please contact the admin.", "error");
        setBtn.disabled = true;
        return;
    }

    updateRoleLabel(data.session?.user);
}

function updateRoleLabel(user) {
    const roleEl = document.getElementById("inviteRole");
    if (!roleEl || !user) return;

    const role = user.user_metadata?.role;
    roleEl.textContent = ROLE_LABELS[role] || "a team member";
}

// ── Submit ────────────────────────────────────────────────────────
form.addEventListener("submit", async (e) => {
    e.preventDefault();

    const newPassword     = document.getElementById("newPassword").value;
    const confirmPassword = document.getElementById("confirmPassword").value;

    if (newPassword !== confirmPassword) {
        showMessage("Passwords do not match.", "error");
        return;
    }

    const pwValid = newPassword.length >= 8
        && /[a-z]/.test(newPassword)
        && /[A-Z]/.test(newPassword)
        && /[0-9]/.test(newPassword)
        && /[^a-zA-Z0-9]/.test(newPassword);

    if (!pwValid) {
        showMessage("Password must be at least 8 characters with uppercase, lowercase, number, and special character.", "error");
        return;
    }

    setBtn.disabled    = true;
    setBtn.textContent = "Activating...";

    const { error } = await supabase.auth.updateUser({ password: newPassword });

    if (error) {
        showMessage("Failed to set password: " + error.message, "error");
        setBtn.disabled    = false;
        setBtn.textContent = "ACTIVATE ACCOUNT";
        return;
    }

    const { data: { user } } = await supabase.auth.getUser();

    await supabase
        .from("profiles")
        .update({ status: "active" })
        .eq("id", user.id);

    showMessage("Account activated! Redirecting to login...", "success");

    setTimeout(() => {
        window.location.href = "login.html";
    }, 2000);
});

// ── Helper ────────────────────────────────────────────────────────
function showMessage(msg, type) {
    messageBox.textContent  = msg;
    messageBox.style.display = "block";
    messageBox.style.color   = type === "error" ? "#e11d48" : "#05b905";
    messageBox.style.background = type === "error" ? "#fef2f2" : "#f0fdf4";
    messageBox.style.border  = `1px solid ${type === "error" ? "#fecaca" : "#bbf7d0"}`;
    messageBox.style.padding = "10px 14px";
    messageBox.style.borderRadius = "8px";
    messageBox.style.marginTop = "12px";
    messageBox.style.fontSize = "0.85rem";
}