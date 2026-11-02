// ─── IMPORTS ───
import { supabase } from "../supabase/supabaseClient.js";
import { saveLog } from "../../scripts/sysAdmin/sysLogs.js";

// ─── CONSTANTS ───
const KEYS = ["contact_phone", "contact_email", "contact_facebook"];
const phoneInput = document.getElementById("contact-phone");
const emailInput = document.getElementById("contact-email");
const facebookInput = document.getElementById("contact-facebook");
const saveBtn = document.getElementById("saveContactBtn");

const PHONE_REGEX = /^09\d{9}$/;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const FACEBOOK_REGEX = /^https?:\/\/\S+$/i;

let saved = { contact_phone: "", contact_email: "", contact_facebook: "" };

// ─── TOAST ───
function showToast(message, type = "info") {
    document.getElementById("contactToast")?.remove();

    const colors = {
        success: "#16a34a",
        error: "#ef4444",
        warning: "#f59e0b",
        info: "#3b82f6"
    };

    const toast = document.createElement("div");
    toast.id = "contactToast";
    toast.textContent = message;
    toast.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        z-index: 99999;
        max-width: 320px;
        padding: 12px 16px;
        color: #fff;
        background: ${colors[type] || colors.info};
        border-radius: 10px;
        box-shadow: 0 10px 25px rgba(0, 0, 0, .15);
        font-size: 14px;
        font-weight: 600;
    `;

    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 3500);
}

// ─── LOAD ───
async function loadContacts() {
    if (!phoneInput || !emailInput || !facebookInput) return;

    const { data, error } = await supabase
        .from("business_settings")
        .select("key, value")
        .in("key", KEYS);

    if (error) {
        console.error("Failed to load contact information:", error);
        return;
    }

    (data || []).forEach(row => {
        saved[row.key] = row.value || "";
    });

    phoneInput.value = saved.contact_phone;
    emailInput.value = saved.contact_email;
    facebookInput.value = saved.contact_facebook;
}

// ─── SAVE ───
async function saveContacts() {
    const next = {
        contact_phone: phoneInput.value.trim(),
        contact_email: emailInput.value.trim(),
        contact_facebook: facebookInput.value.trim()
    };

    if (next.contact_phone && !PHONE_REGEX.test(next.contact_phone)) {
        showToast("Phone number must be 11 digits and start with 09.", "warning");
        return;
    }

    if (next.contact_email && !EMAIL_REGEX.test(next.contact_email)) {
        showToast("Enter a valid email address.", "warning");
        return;
    }

    if (next.contact_facebook && !FACEBOOK_REGEX.test(next.contact_facebook)) {
        showToast("Facebook link must start with https://", "warning");
        return;
    }

    const changed = KEYS.filter(key => next[key] !== saved[key]);

    if (!changed.length) {
        showToast("No contact changes were made.", "info");
        return;
    }

    saveBtn.disabled = true;
    saveBtn.textContent = "Saving...";

    const now = new Date().toISOString();

    const { error } = await supabase
        .from("business_settings")
        .upsert(
            KEYS.map(key => ({
                key,
                value: next[key],
                updated_at: now
            })),
            { onConflict: "key" }
        );

    saveBtn.disabled = false;
    saveBtn.textContent = "Save Contact Info";

    if (error) {
        console.error(error);
        showToast("Failed to save contact information: " + error.message, "error");
        return;
    }

    saved = { ...next };

    await saveLog(
        "SETTINGS",
        "Updated business contact information.",
        "System Admin",
        "info"
    );

    showToast("Contact information updated successfully.", "success");
}

// ─── INIT ───
phoneInput?.addEventListener("input", () => {
    phoneInput.value = phoneInput.value.replace(/\D/g, "").slice(0, 11);
});

saveBtn?.addEventListener("click", saveContacts);
loadContacts();