import { supabase } from "../supabase/supabaseClient.js";
import { saveLog } from "../sysAdmin/sysLogs.js";

function showToast(message, type = "error", duration = 4000) {
    document.querySelectorAll(".sp-toast").forEach(t => t.remove());

    const icons = {
        success: "bx-check-circle",
        error: "bx-x-circle",
        warning: "bx-error",
        info: "bx-info-circle"
    };

    const toast = document.createElement("div");
    toast.className = `sp-toast sp-toast--${type}`;

    const icon = document.createElement("i");
    icon.className = `bx ${icons[type] || icons.error} sp-toast__icon`;

    const msgSpan = document.createElement("span");
    msgSpan.className = "sp-toast__msg";
    msgSpan.textContent = message;

    const closeBtn = document.createElement("button");
    closeBtn.className = "sp-toast__close";
    closeBtn.innerHTML = "<i class='bx bx-x'></i>";
    closeBtn.addEventListener("click", () => toast.remove());

    toast.append(icon, msgSpan, closeBtn);
    document.body.appendChild(toast);

    requestAnimationFrame(() => toast.classList.add("sp-toast--show"));

    setTimeout(() => {
        toast.classList.remove("sp-toast--show");
        setTimeout(() => toast.remove(), 350);
    }, duration);
}

document.addEventListener("DOMContentLoaded", () => {
    const registerForm = document.getElementById("registerForm");
    if (!registerForm) return;

    const contactNumberInput = document.getElementById("contactNumber");
    const agreeTermsCheckbox = document.getElementById("agreeTerms");
    const registerBtn = document.getElementById("registerBtn");
    const googleLoginBtn = document.getElementById("googleLoginBtn");
    const termsWrapper = document.getElementById("termsWrapperLogin");

    function updateRegisterButtonState() {
        const isAgreed = !!agreeTermsCheckbox?.checked;

        if (registerBtn) {
            registerBtn.disabled = !isAgreed;
        }

        if (googleLoginBtn) {
            googleLoginBtn.setAttribute("aria-disabled", String(!isAgreed));
        }
    }

    updateRegisterButtonState();
    agreeTermsCheckbox?.addEventListener("change", updateRegisterButtonState);

    contactNumberInput?.addEventListener("input", e => {
        e.target.value = e.target.value.replace(/\D/g, "").slice(0, 10);
    });

    const setupPasswordToggle = (toggleId, inputId) => {
        document.getElementById(toggleId)?.addEventListener("click", function () {
            const input = document.getElementById(inputId);
            if (!input) return;
            input.type = input.type === "password" ? "text" : "password";
            this.classList.toggle("bx-low-vision");
            this.classList.toggle("bx-show");
        });
    };

    setupPasswordToggle("togglePassword", "password");
    setupPasswordToggle("toggleConfirmPassword", "confirmPassword");

    googleLoginBtn?.addEventListener("click", async () => {
        if (!agreeTermsCheckbox?.checked) {
            termsWrapper?.classList.add("shake");
            setTimeout(() => termsWrapper?.classList.remove("shake"), 450);
            showToast("Please agree to the Terms and Conditions and Privacy Policy first.", "warning");
            return;
        }

        await saveLog("AUTH", "Google OAuth registration initiated.", "Google_User", "info");

        const { data, error } = await supabase.auth.signInWithOAuth({
            provider: "google",
            options: {
                redirectTo: `${window.location.origin}/pages/auth/authCallback.html`
            }
        });

        if (error) {
            showToast("Google sign-up error: " + error.message, "error");
            return;
        }

        if (data?.url) {
            window.location.href = data.url;
        }
    });

    registerForm.addEventListener("submit", async e => {
        e.preventDefault();

        if (!agreeTermsCheckbox?.checked) {
            termsWrapper?.classList.add("shake");
            setTimeout(() => termsWrapper?.classList.remove("shake"), 450);
            showToast("Please agree to the Terms and Conditions and Privacy Policy.", "warning");
            return;
        }

        const fullName = document.getElementById("fullName")?.value.trim() || "";
        const gender = document.getElementById("gender")?.value || "";
        const username = document.getElementById("username")?.value.trim() || "";
        const localNumber = document.getElementById("contactNumber")?.value.trim() || "";
        const email = document.getElementById("email")?.value.trim() || "";
        const password = document.getElementById("password")?.value || "";
        const confirmPassword = document.getElementById("confirmPassword")?.value || "";

        if (!fullName || !gender || !username || !localNumber || !email || !password || !confirmPassword) {
            showToast("Please fill in all fields.", "error");
            return;
        }

        const usernameRegex = /^[a-zA-Z0-9_.]{3,20}$/;
        if (!usernameRegex.test(username)) {
            showToast("Username must be 3-20 characters (letters, numbers, underscore, or period only).", "error");
            return;
        }

        const phLocalRegex = /^9\d{9}$/;
        if (!phLocalRegex.test(localNumber)) {
            showToast("Enter a valid PH mobile number (10 digits, starting with 9).", "error");
            return;
        }

        if (password !== confirmPassword) {
            showToast("Passwords do not match.", "error");
            return;
        }

        const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&.#_\-])[A-Za-z\d@$!\%*?&.#_\-]{8,72}$/;
        if (!passwordRegex.test(password)) {
            showToast("Password must be 8-72 characters with uppercase, lowercase, number & special character.", "error", 5000);
            return;
        }

        const contactNumber = `+63${localNumber}`;

        if (registerBtn) {
            registerBtn.disabled = true;
            registerBtn.textContent = "REGISTERING...";
        }

        try {
            const { data: existingUsername, error: usernameCheckError } = await supabase
                .from("profiles")
                .select("id")
                .ilike("username", username)
                .maybeSingle();

            if (usernameCheckError) {
                showToast("Could not verify username availability. Please try again.", "error");
                return;
            }

            if (existingUsername) {
                showToast("This username is already taken.", "error");
                return;
            }

            const { data, error } = await supabase.auth.signUp({
                email,
                password,
                options: {
                    data: {
                        full_name: fullName,
                        gender,
                        username,
                        contact_number: contactNumber
                    }
                }
            });

            if (error) {
                console.error("Registration error:", error);
                await saveLog("SYSTEM", `Registration failed for user: ${username}`, username, "warning");
                showToast(`Registration failed: ${error.message}`, "error", 5000);
                return;
            }

            if (data?.user?.identities?.length === 0) {
                showToast("An account with this email already exists. Try logging in instead.", "warning", 5000);
                return;
            }

            await saveLog("SYSTEM", `New player registration: ${username}`, username, "success");
            showToast("Registration successful! Redirecting to email verification...", "success", 3000);

            setTimeout(() => {
                window.location.href = `../../pages/auth/otpVerification.html?email=${encodeURIComponent(email)}`;
            }, 2000);

        } catch (err) {
            console.error("Unexpected registration error:", err);
            showToast("Something went wrong. Please check your connection and try again.", "error", 5000);
        } finally {
            if (registerBtn && registerBtn.textContent === "REGISTERING...") {
                registerBtn.textContent = "Register";
                updateRegisterButtonState();
            }
        }
    });
});