import { supabase } from "../supabase/supabaseClient.js";
import { saveLog } from "../sysAdmin/sysLogs.js";

// ─── CONSTANTS ───
const QR_BUCKET = "payment-qrs";
const MAX_FILE_SIZE = 2 * 1024 * 1024;
const ALLOWED_TYPES = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/webp": "webp"
};

// ─── STATE ───
let activeQR = null;
let selectedFile = null;
let previewObjectUrl = null;
let currentUser = null;
let isBusy = false;

// ─── ELEMENTS ───
const els = {
    image: document.getElementById("qrCurrentImage"),
    empty: document.getElementById("qrEmptyState"),
    provider: document.getElementById("qr-provider"),
    accountName: document.getElementById("qr-account-name"),
    fileInput: document.getElementById("qr-file"),
    chooseBtn: document.getElementById("qrChooseFileBtn"),
    fileName: document.getElementById("qrFileName"),
    saveBtn: document.getElementById("saveQrBtn"),
    deactivateBtn: document.getElementById("deactivateQrBtn")
};

// ─── INIT ───
async function init() {
    if (!els.saveBtn) return;

    const { data: { user } } = await supabase.auth.getUser();
    currentUser = user;

    els.chooseBtn.addEventListener("click", () => els.fileInput.click());
    els.fileInput.addEventListener("change", handleFileChange);
    els.saveBtn.addEventListener("click", handleSave);
    els.deactivateBtn.addEventListener("click", handleDeactivate);

    els.image.addEventListener("error", () => {
        els.image.hidden = true;
        els.empty.textContent = "The QR image could not be loaded";
        els.empty.hidden = false;
    });

    await loadActiveQR();
}

// ─── LOAD & RENDER ───
async function loadActiveQR() {
    const { data, error } = await supabase
        .from("payment_qr_codes")
        .select("id, provider, account_name, qr_image_url")
        .eq("owner_role", "business_admin")
        .eq("is_active", true)
        .maybeSingle();

    if (error) {
        console.error(error);
        showAlert("Failed to load the payment QR code.", "error");
        return;
    }

    activeQR = data;
    clearSelectedFile();
    renderPreview();
    renderForm();
}

function renderPreview() {
    const source = previewObjectUrl || activeQR?.qr_image_url || null;

    if (!source) {
        els.image.removeAttribute("src");
        els.image.hidden = true;
        els.empty.textContent = "No QR code uploaded";
        els.empty.hidden = false;
        return;
    }

    els.image.src = source;
    els.image.hidden = false;
    els.empty.hidden = true;
}

function renderForm() {
    if (!activeQR) {
        els.accountName.value = "";
        els.deactivateBtn.hidden = true;
        els.saveBtn.textContent = getSaveLabel();
        return;
    }

    const hasOption = Array.from(els.provider.options)
        .some(option => option.value === activeQR.provider);

    els.provider.value = hasOption ? activeQR.provider : "Other";
    els.accountName.value = activeQR.account_name;
    els.deactivateBtn.hidden = false;
    els.saveBtn.textContent = getSaveLabel();
}

function getSaveLabel() {
    return activeQR ? "Replace QR Code" : "Save QR Code";
}

// ─── FILE HANDLING ───
function handleFileChange() {
    const file = els.fileInput.files[0];

    if (!file) {
        clearSelectedFile();
        renderPreview();
        return;
    }

    if (!ALLOWED_TYPES[file.type]) {
        clearSelectedFile();
        renderPreview();
        showAlert("Please choose a PNG, JPG, or WEBP image.", "warning");
        return;
    }

    if (file.size > MAX_FILE_SIZE) {
        clearSelectedFile();
        renderPreview();
        showAlert("Image must be 2 MB or smaller.", "warning");
        return;
    }

    if (previewObjectUrl) URL.revokeObjectURL(previewObjectUrl);

    selectedFile = file;
    previewObjectUrl = URL.createObjectURL(file);
    els.fileName.textContent = file.name;
    renderPreview();
}

function clearSelectedFile() {
    selectedFile = null;
    els.fileInput.value = "";
    els.fileName.textContent = "No file chosen";

    if (previewObjectUrl) {
        URL.revokeObjectURL(previewObjectUrl);
        previewObjectUrl = null;
    }
}

// ─── SAVE ───
async function handleSave() {
    if (isBusy) return;

    if (!currentUser) {
        showAlert("Your session has expired.", "error");
        return;
    }

    const provider = els.provider.value;
    const accountName = els.accountName.value.trim();

    if (!accountName) {
        showAlert("Please enter the account name.", "warning");
        return;
    }

    if (!selectedFile && !activeQR) {
        showAlert("Please choose a QR image to upload.", "warning");
        return;
    }

    if (
        !selectedFile &&
        activeQR &&
        activeQR.provider === provider &&
        activeQR.account_name === accountName
    ) {
        showAlert("No changes were made.", "info");
        return;
    }

    const wasReplacement = Boolean(activeQR);

    if (wasReplacement) {
        const confirmed = await confirmAction(
            "Replace Payment QR",
            "New payments will immediately use the updated QR details. Do you want to continue?",
            "default"
        );

        if (!confirmed) return;
    }

    setBusy(true, "Saving...");

    try {
        let imageUrl = activeQR?.qr_image_url;

        if (selectedFile) {
            const extension = ALLOWED_TYPES[selectedFile.type];
            const path = `${currentUser.id}/${Date.now()}.${extension}`;

            const { error: uploadError } = await supabase.storage
                .from(QR_BUCKET)
                .upload(path, selectedFile, {
                    cacheControl: "3600",
                    upsert: false,
                    contentType: selectedFile.type
                });

            if (uploadError) {
                console.error(uploadError);
                showAlert("Upload failed: " + uploadError.message, "error");
                return;
            }

            imageUrl = supabase.storage
                .from(QR_BUCKET)
                .getPublicUrl(path).data.publicUrl;
        }

        const { error } = await supabase.rpc("set_business_qr", {
            p_provider: provider,
            p_account_name: accountName,
            p_qr_image_url: imageUrl
        });

        if (error) {
            console.error(error);
            showAlert(getErrorMessage(error, "Failed to save the QR code."), "error");
            return;
        }

        await logAction(
            `${wasReplacement ? "Replaced" : "Added"} the payment QR code (${provider}, ${accountName}).`,
            "warning"
        );

        await loadActiveQR();

        showAlert(
            wasReplacement
                ? "Payment QR code replaced successfully."
                : "Payment QR code saved successfully.",
            "success"
        );
    } finally {
        setBusy(false);
    }
}

// ─── DEACTIVATE ───
async function handleDeactivate() {
    if (isBusy || !activeQR) return;

    const confirmed = await confirmAction(
        "Deactivate Payment QR",
        "Players will not be able to pay by E-Wallet until a new QR code is uploaded. Do you want to continue?",
        "lock"
    );

    if (!confirmed) return;

    setBusy(true);

    try {
        const { error } = await supabase.rpc("deactivate_business_qr");

        if (error) {
            console.error(error);
            showAlert(getErrorMessage(error, "Failed to deactivate the QR code."), "error");
            return;
        }

        await logAction("Deactivated the payment QR code.", "warning");
        await loadActiveQR();

        showAlert("Payment QR code deactivated. E-Wallet payments are now unavailable.", "success");
    } finally {
        setBusy(false);
    }
}

// ─── HELPERS ───
function setBusy(busy, label = null) {
    isBusy = busy;
    els.saveBtn.disabled = busy;
    els.deactivateBtn.disabled = busy;

    if (busy && label) {
        els.saveBtn.textContent = label;
    }

    if (!busy) {
        els.saveBtn.textContent = getSaveLabel();
    }
}

function getErrorMessage(error, fallback) {
    if (error?.message?.includes("not_authorized")) {
        return "You are not allowed to change the payment QR code.";
    }

    return fallback;
}

async function logAction(message, level) {
    try {
        await saveLog("SETTINGS", message, currentUser?.email || "Business Admin", level);
    } catch (error) {
        console.error("Failed to save log:", error);
    }
}

function confirmAction(title, message, type = "default") {
    const modal = document.getElementById("confirmModal");
    const titleEl = document.getElementById("confirmTitle");
    const messageEl = document.getElementById("confirmMessage");
    const iconEl = document.getElementById("confirmIcon");
    const okBtn = document.getElementById("confirmOkBtn");
    const cancelBtn = document.getElementById("confirmCancelBtn");

    const icons = {
        lock: "bx-lock-alt",
        default: "bx-question-mark"
    };

    return new Promise(resolve => {
        titleEl.textContent = title;
        messageEl.textContent = message;
        iconEl.className = `bx ${icons[type] || icons.default}`;
        modal.classList.add("show");

        okBtn.onclick = () => {
            modal.classList.remove("show");
            resolve(true);
        };

        cancelBtn.onclick = () => {
            modal.classList.remove("show");
            resolve(false);
        };
    });
}

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

init();