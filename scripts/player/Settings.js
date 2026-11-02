import { supabase } from "../supabase/supabaseClient.js";
import { saveLog } from "../../scripts/sysAdmin/sysLogs.js";

window.showAlert = function (message, type = "info") {
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
};

function normalizePhone(value) {
    let digits = String(value || "").replace(/\D/g, "");

    if (digits.startsWith("63") && digits.length === 12) {
        digits = "0" + digits.slice(2);
    }

    return digits.slice(0, 11);
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
    const genderInput = document.getElementById("gender");

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

    const fullName =
        profile?.full_name ||
        user.user_metadata?.full_name ||
        user.user_metadata?.name ||
        "";

    const email = user.email || "";

    const username =
        profile?.username ||
        user.user_metadata?.username ||
        (email ? email.split("@")[0] : "");

    const phone =
        profile?.contact_number ||
        user.user_metadata?.contact_number ||
        user.phone ||
        "";

    const gender =
        profile?.gender ||
        user.user_metadata?.gender ||
        "";

    if (fullNameInput) fullNameInput.value = fullName;
    if (usernameInput) usernameInput.value = username;
    if (emailInput) emailInput.value = email;
    if (phoneInput) phoneInput.value = normalizePhone(phone);
    if (genderInput) genderInput.value = gender;

    const googleAvatar =
        user.user_metadata?.avatar_url ||
        user.user_metadata?.picture;

    const finalAvatar =
        profile?.avatar_url ||
        googleAvatar ||
        "/components/logobg.jpeg";

    if (profilePreview) {
        profilePreview.src = finalAvatar;
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
            const filePath = `players/${user.id}.${fileExt}`;

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

            const avatarUrl = publicUrlData.publicUrl;

            const { error: updateError } = await supabase
                .from("profiles")
                .update({
                    avatar_url: avatarUrl
                })
                .eq("id", user.id);

            if (updateError) {
                showAlert(
                    "Saving avatar failed: " + updateError.message,
                    "error"
                );
                return;
            }

            profilePreview.src = avatarUrl;

            await saveLog(
                "SETTINGS",
                "Player profile picture updated.",
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
                normalizePhone(phoneInput?.value.trim() || "");

            const updatedEmail =
                emailInput?.value.trim() || "";

            const updatedGender =
                genderInput?.value || "";

            const phoneRegex = /^\d{11}$/;

            if (updatedPhone && !phoneRegex.test(updatedPhone)) {
                showAlert(
                    "Phone number must be exactly 11 digits, numbers only.",
                    "error"
                );
                return;
            }

            const emailChanged =
                updatedEmail && updatedEmail !== email;

            const { error: authUpdateError } =
                await supabase.auth.updateUser({
                    data: {
                        full_name: updatedFullName
                    },
                    ...(emailChanged && { email: updatedEmail })
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
                        contact_number: updatedPhone,
                        gender: updatedGender || null
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
                emailChanged
                    ? "Player profile updated; email change pending confirmation."
                    : "Player profile information updated.",
                updatedUsername || profile?.username || user.email,
                "info"
            );

            if (emailChanged) {
                showAlert(
                    "Profile updated. Please check your new email inbox to confirm the email change.",
                    "warning"
                );
            } else {
                showAlert(
                    "Profile updated successfully!",
                    "success"
                );
            }
        });
    }

    if (phoneInput) {
        phoneInput.addEventListener("input", () => {
            phoneInput.value = normalizePhone(phoneInput.value);
        });
    }

    if (securityForm) {
        securityForm.addEventListener("submit", async (e) => {
            e.preventDefault();

            const newPass =
                document.getElementById("newPassword")?.value || "";

            const confirmPass =
                document.getElementById("confirmPassword")?.value || "";

            if (!newPass || !confirmPass) {
                showAlert(
                    "Please fill in all password fields.",
                    "error"
                );
                return;
            }

            if (newPass !== confirmPass) {
                showAlert(
                    "Passwords do not match!",
                    "error"
                );
                return;
            }

            const passwordRegex =
                /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&.#_-])[A-Za-z\d@$!%*?&.#_-]{8,}$/;

            if (!passwordRegex.test(newPass)) {
                showAlert(
                    "Password must contain uppercase, lowercase, number, special character, and at least 8 characters.",
                    "error"
                );
                return;
            }

            const { error: passError } =
                await supabase.auth.updateUser({
                    password: newPass
                });

            if (passError) {
                showAlert(
                    "Error: " + passError.message,
                    "error"
                );
                return;
            }

            await saveLog(
                "AUTH",
                "Player password changed successfully.",
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

    const toggle = document.getElementById("residentToggle");
    const section = document.getElementById("proofUploadSection");
    const fileInput = document.getElementById("proofFile");
    const dropzone = document.getElementById("proofDropzone");
    const previewWrap = document.getElementById("proofPreviewWrap");
    const previewImg = document.getElementById("proofPreviewImg");
    const filenameEl = document.getElementById("proofFilename");
    const removeBtn = document.getElementById("removeProofBtn");
    const submitBtn = document.getElementById("residentSubmitBtn");
    const badge = document.getElementById("residentBadge");

    if (toggle) {
        const { data: existing } = await supabase
            .from("homeowner_verifications")
            .select("status")
            .eq("player_id", user.id)
            .maybeSingle();

        if (existing) {
            if (existing.status === "pending") {
                badge.textContent = "⏳ Pending Review";
                badge.style.display = "inline-flex";
                toggle.disabled = true;
            } else if (existing.status === "approved") {
                badge.textContent = "✓ Verified Homeowner";
                badge.style.display = "inline-flex";
                badge.className = "resident-status-badge verified";
                toggle.disabled = true;
                toggle.checked = true;
            } else if (existing.status === "rejected") {
                badge.textContent = "✗ Rejected — Resubmit";
                badge.style.display = "inline-flex";
            }
        }

        toggle.addEventListener("change", () => {
            section.classList.toggle(
                "visible",
                toggle.checked
            );

            if (!toggle.checked) {
                clearProof();
            }
        });

        fileInput.addEventListener("change", () => {
            if (fileInput.files.length) {
                handleFile(fileInput.files[0]);
            }
        });

        function handleFile(file) {
            if (file.size > 5 * 1024 * 1024) {
                showAlert(
                    "File is too large. Max 5MB.",
                    "error"
                );
                return;
            }

            filenameEl.textContent = file.name;
            submitBtn.disabled = false;
            dropzone.style.display = "none";
            previewWrap.classList.add("visible");

            if (file.type.startsWith("image/")) {
                const reader = new FileReader();

                reader.onload = (e) => {
                    previewImg.src = e.target.result;
                    previewImg.style.display = "";
                };

                reader.readAsDataURL(file);
            } else {
                previewImg.src = "";
                previewImg.style.display = "none";
            }
        }

        function clearProof() {
            fileInput.value = "";
            previewWrap.classList.remove("visible");
            previewImg.src = "";
            previewImg.style.display = "";
            dropzone.style.display = "";
            filenameEl.textContent = "";
            submitBtn.disabled = true;
        }

        removeBtn.addEventListener("click", clearProof);

        document
            .getElementById("residentForm")
            ?.addEventListener("submit", async (e) => {
                e.preventDefault();

                if (!fileInput.files.length) {
                    showAlert(
                        "Please select a proof document.",
                        "error"
                    );
                    return;
                }

                const file = fileInput.files[0];

                submitBtn.textContent = "Uploading...";
                submitBtn.disabled = true;

                const fileExt = file.name.split(".").pop();

                const filePath =
                    `homeowner_proofs/${user.id}_${Date.now()}.${fileExt}`;

                const { error: uploadError } =
                    await supabase.storage
                        .from("proofs")
                        .upload(filePath, file, {
                            upsert: true
                        });

                if (uploadError) {
                    showAlert(
                        "Upload failed: " +
                        uploadError.message,
                        "error"
                    );

                    submitBtn.textContent =
                        "Submit for Verification";

                    submitBtn.disabled = false;
                    return;
                }

                const { data: urlData } =
                    supabase.storage
                        .from("proofs")
                        .getPublicUrl(filePath);

                const { error: dbError } =
                    await supabase
                        .from("homeowner_verifications")
                        .upsert({
                            player_id: user.id,
                            status: "pending",
                            proof_url: urlData.publicUrl,
                            submitted_at: new Date().toISOString()
                        }, {
                            onConflict: "player_id"
                        });

                if (dbError) {
                    showAlert(
                        "Submission failed: " +
                        dbError.message,
                        "error"
                    );

                    submitBtn.textContent =
                        "Submit for Verification";

                    submitBtn.disabled = false;
                    return;
                }

                await saveLog(
                    "SETTINGS",
                    "Player submitted homeowner verification for admin review.",
                    profile?.username || user.email,
                    "info"
                );

                badge.textContent = "⏳ Pending Review";
                badge.style.display = "inline-flex";

                submitBtn.textContent = "Submitted!";
                toggle.disabled = true;

                section.classList.remove("visible");

                showAlert(
                    "Verification submitted successfully. Pending admin review.",
                    "success"
                );
            });
    }
});