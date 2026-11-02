import { supabase } from "../supabase/supabaseClient.js";

function showToast(message, type = "error", duration = 4000) {
    document.querySelectorAll(".sp-toast").forEach(t => t.remove());

    const icons = {
        success: "bx-check-circle",
        error:   "bx-x-circle",
        warning: "bx-error",
        info:    "bx-info-circle"
    };

    const toast = document.createElement("div");
    toast.className = `sp-toast sp-toast--${type}`;
    toast.innerHTML = `
        <i class='bx ${icons[type]} sp-toast__icon'></i>
        <span class="sp-toast__msg">${message}</span>
        <button class="sp-toast__close" onclick="this.parentElement.remove()">
            <i class='bx bx-x'></i>
        </button>
    `;

    document.body.appendChild(toast);
    requestAnimationFrame(() => toast.classList.add("sp-toast--show"));

    setTimeout(() => {
        toast.classList.remove("sp-toast--show");
        setTimeout(() => toast.remove(), 350);
    }, duration);
}

// ─────────────────────────────────────────────
//  MAIN
// ─────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", () => {
    const otpForm  = document.getElementById("otpForm");
    const otpInput = document.getElementById("otpInput"); // hidden input
    const resendBtn = document.getElementById("resendOtp");
    const boxes    = document.querySelectorAll(".otp-box");

    const params = new URLSearchParams(window.location.search);
    const email  = params.get("email");

    if (!email) {
        showToast("No email found. Please register again.", "error");
        setTimeout(() => window.location.href = "register.html", 2000);
        return;
    }

    // ── Sync all boxes → hidden #otpInput ──
    function syncOtpValue() {
        otpInput.value = [...boxes].map(b => b.value).join("");
    }

    function clearBoxes() {
        boxes.forEach(b => b.value = "");
        otpInput.value = "";
        boxes[0].focus();
    }

    // ── Box behavior ──
    boxes.forEach((box, i) => {
        box.addEventListener("input", () => {
            box.value = box.value.replace(/\D/g, "").slice(0, 1);
            syncOtpValue();
            if (box.value && i < boxes.length - 1) boxes[i + 1].focus();
        });

        box.addEventListener("keydown", (e) => {
            if (e.key === "Backspace" && !box.value && i > 0) {
                boxes[i - 1].focus();
            }
        });

        box.addEventListener("paste", (e) => {
            e.preventDefault();
            const text = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, 6);
            [...text].forEach((char, j) => { if (boxes[j]) boxes[j].value = char; });
            syncOtpValue();
            const next = Math.min(text.length, boxes.length - 1);
            boxes[next].focus();
        });
    });

    // ── Submit — original verifyOtp logic, untouched ──
    otpForm.addEventListener("submit", async (e) => {
        e.preventDefault();

        const token = otpInput.value.trim();

        if (token.length !== 6) {
            showToast("Please enter the complete 6-digit OTP.", "warning");
            return;
        }

        const { data, error } = await supabase.auth.verifyOtp({
            email,
            token,
            type: "signup"
        });

        if (error) {
            showToast("Invalid or expired OTP. Please try again.", "error");
            clearBoxes();
            return;
        }

        const pending = JSON.parse(sessionStorage.getItem("pendingUser"));

        if (pending) {
            await supabase.auth.updateUser({
                password: pending.password,
                data: {
                    full_name:      pending.fullName,
                    username:       pending.username,
                    contact_number: pending.contactNumber,
                    role:           "player"
                }
            });

            sessionStorage.removeItem("pendingUser");
        }

        showToast("Email verified successfully! Redirecting to login...", "success", 3000);
        await supabase.auth.signOut();
        setTimeout(() => window.location.href = "login.html", 2000);
    });

    // ── Resend OTP — original logic, untouched ──
    resendBtn.addEventListener("click", async (e) => {
        e.preventDefault();

        const { error } = await supabase.auth.resend({
            type:  "signup",
            email
        });

        if (error) {
            showToast("Failed to resend OTP: " + error.message, "error");
            return;
        }

        showToast("OTP resent! Please check your email.", "info");
    });
});