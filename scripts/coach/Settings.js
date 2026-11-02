import { supabase } from "../supabase/supabaseClient.js";
import { saveLog } from "../../scripts/sysAdmin/sysLogs.js";

function showAlert(message, type = "info") {
    document.getElementById("globalAlert")?.remove();

    const colors = {
        success: "#16a34a",
        error: "#ef4444",
        warning: "#f59e0b",
        info: "#2563eb"
    };

    const alert = document.createElement("div");

    alert.id = "globalAlert";
    alert.textContent = message;

    alert.style.cssText = `
        position:fixed;
        top:20px;
        right:20px;
        background:${colors[type] || colors.info};
        color:#fff;
        padding:12px 16px;
        border-radius:10px;
        box-shadow:0 10px 25px rgba(0,0,0,.15);
        z-index:99999;
        font-size:14px;
        font-weight:600;
        max-width:320px;
    `;

    document.body.appendChild(alert);

    setTimeout(() => alert.remove(), 3500);
}

document.addEventListener("DOMContentLoaded", async () => {
    const uploadPic = document.getElementById("fileUpload");
    const profilePreview = document.getElementById("avatarPreview");
    const profileForm = document.getElementById("profileForm");
    const securityForm = document.getElementById("securityForm");

    const fullNameInput = document.getElementById("fullName");
    const usernameInput = document.getElementById("username");
    const emailInput = document.getElementById("email");
    const phoneInput = document.getElementById("phone");

    const {
        data: { user },
        error: authError
    } = await supabase.auth.getUser();

    if (authError || !user) {
        window.location.href = "../../pages/auth/login.html";
        return;
    }

    const { data: profile } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", user.id)
        .single();

    if (profile?.status === "pending") {
        const banner = document.getElementById("newAccountBanner");

        if (banner) {
            banner.style.display = "flex";
        }
    }

    const fullName =
        profile?.full_name ||
        user.user_metadata?.full_name ||
        "";

    const username =
        profile?.username ||
        user.user_metadata?.username ||
        user.email?.split("@")[0] ||
        "";

    const phone =
        profile?.contact_number ||
        user.user_metadata?.contact_number ||
        "";

    if (fullNameInput) {
        fullNameInput.value = fullName;
    }

    if (usernameInput) {
        usernameInput.value = username;
    }

    if (emailInput) {
        emailInput.value = user.email || "";
    }

    if (phoneInput) {
        phoneInput.value = phone;
    }

    const googleAvatar =
        user.user_metadata?.avatar_url ||
        user.user_metadata?.picture;

    const avatar =
        profile?.avatar_url ||
        googleAvatar ||
        "/components/logobg.jpeg";

    if (profilePreview) {
        profilePreview.src = avatar;
    }

    if (uploadPic && profilePreview) {
        uploadPic.addEventListener("change", async function () {
            const file = this.files[0];

            if (!file) return;

            if (!file.type.startsWith("image/")) {
                showAlert("Please upload an image only.", "error");
                return;
            }

            if (file.size > 2 * 1024 * 1024) {
                showAlert("Max file size is 2MB.", "error");
                return;
            }

            const fileExt = file.name.split(".").pop();
            const filePath = `coaches/${user.id}.${fileExt}`;

            const { error: uploadError } = await supabase.storage
                .from("avatars")
                .upload(filePath, file, {
                    upsert: true
                });

            if (uploadError) {
                showAlert(
                    "Upload failed: " + uploadError.message,
                    "error"
                );
                return;
            }

            const { data: publicUrlData } = supabase.storage
                .from("avatars")
                .getPublicUrl(filePath);

            const { error: updateError } = await supabase
                .from("profiles")
                .update({
                    avatar_url: publicUrlData.publicUrl
                })
                .eq("id", user.id);

            if (updateError) {
                showAlert(
                    "Saving avatar failed: " + updateError.message,
                    "error"
                );
                return;
            }

            profilePreview.src = publicUrlData.publicUrl;

            await saveLog(
                "SETTINGS",
                "Coach profile picture updated.",
                profile?.username || user.email,
                "info"
            );

            showAlert(
                "Profile picture updated successfully!",
                "success"
            );
        });
    }

    if (profileForm) {
        profileForm.addEventListener("submit", async (e) => {
            e.preventDefault();

            const updatedFullName =
                fullNameInput?.value.trim() || "";

            const updatedUsername =
                usernameInput?.value.trim() || "";

            const updatedPhone =
                phoneInput?.value.trim() || "";

            const { error: authUpdateError } =
                await supabase.auth.updateUser({
                    data: {
                        full_name: updatedFullName
                    }
                });

            if (authUpdateError) {
                showAlert(
                    "Error: " + authUpdateError.message,
                    "error"
                );
                return;
            }

            const { error: profileError } =
                await supabase
                    .from("profiles")
                    .update({
                        full_name: updatedFullName,
                        username: updatedUsername,
                        contact_number: updatedPhone
                    })
                    .eq("id", user.id);

            if (profileError) {
                showAlert(
                    "Error saving profile: " +
                    profileError.message,
                    "error"
                );
                return;
            }

            await saveLog(
                "SETTINGS",
                "Coach profile information updated.",
                updatedUsername || user.email,
                "info"
            );

            showAlert(
                "Profile updated successfully!",
                "success"
            );
        });
    }

    if (securityForm) {
        securityForm.addEventListener("submit", async (e) => {
            e.preventDefault();

            const newPassword =
                document.getElementById("newPassword")?.value || "";

            const confirmPassword =
                document.getElementById("confirmPassword")?.value || "";

            if (!newPassword || !confirmPassword) {
                showAlert(
                    "Please fill in all password fields.",
                    "error"
                );
                return;
            }

            if (newPassword !== confirmPassword) {
                showAlert(
                    "Passwords do not match!",
                    "error"
                );
                return;
            }

            const passwordRegex =
                /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&.#_-])[A-Za-z\d@$!%*?&.#_-]{8,}$/;

            if (!passwordRegex.test(newPassword)) {
                showAlert(
                    "Password must contain uppercase, lowercase, number, special character, and at least 8 characters.",
                    "error"
                );
                return;
            }

            const { error: passwordError } =
                await supabase.auth.updateUser({
                    password: newPassword
                });

            if (passwordError) {
                showAlert(
                    "Error: " + passwordError.message,
                    "error"
                );
                return;
            }

            if (profile?.status === "pending") {
                const { error: statusError } = await supabase
                    .from("profiles")
                    .update({
                        status: "active"
                    })
                    .eq("id", user.id);

                if (statusError) {
                    showAlert(
                        "Password changed, but account activation failed.",
                        "error"
                    );
                    return;
                }

                await supabase.auth.signInWithPassword({
                    email: user.email,
                    password: newPassword
                });

                const banner =
                    document.getElementById("newAccountBanner");

                if (banner) {
                    banner.style.display = "none";
                }

                await saveLog(
                    "AUTH",
                    "Coach completed account activation by changing password.",
                    profile?.username || user.email,
                    "warning"
                );

                showAlert(
                    "Password updated! Redirecting...",
                    "success"
                );

                setTimeout(() => {
                    window.location.href =
                        "/pages/coach/Dashboard.html";
                }, 1500);

                return;
            }

            await saveLog(
                "AUTH",
                "Coach password changed successfully.",
                profile?.username || user.email,
                "warning"
            );

            showAlert(
                "Password updated successfully!",
                "success"
            );

            securityForm.reset();
        });
    }

    document.querySelectorAll(".toggle-password").forEach((icon) => {
        icon.addEventListener("click", () => {
            const target = document.getElementById(icon.dataset.target);
            const isHidden = target.type === "password";

            target.type = isHidden ? "text" : "password";
            icon.classList.toggle("bx-hide", !isHidden);
            icon.classList.toggle("bx-show", isHidden);
        });
    });
});