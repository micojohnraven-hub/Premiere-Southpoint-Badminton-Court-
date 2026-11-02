import { supabase } from "../supabase/supabaseClient.js";

document.addEventListener("DOMContentLoaded", async () => {
    const get = id => document.getElementById(id);

    const { data: { session } } = await supabase.auth.getSession();

    if (!session) {
        window.location.href = "../auth/login.html";
        return;
    }

    const elements = {
        headline: get("headlineInput"),
        subtext: get("subtextInput"),
        desktopInput: get("desktopInput"),
        mobileInput: get("mobileInput"),
        desktopBox: get("desktopBox"),
        mobileBox: get("mobileBox"),
        updateHeroBtn: get("updateHeroBtn"),
        announcementsBody: get("announcementsBody"),
        newPostBtn: get("newPostBtn"),
        postModal: get("postModalOverlay"),
        modalTitle: get("modalTitle"),
        postTitle: get("postTitle"),
        postMessage: get("postMessage"),
        postCategory: get("postCategory"),
        postAudience: get("postAudience"),
        postFile: get("postFile"),
        postFileGroup: get("postFileGroup"),
        savePostBtn: get("savePostBtn"),
        closePostModal: get("closePostModal"),
        modalOverlay: get("modalOverlay"),
        modalMessage: get("modalMessage"),
        modalConfirm: get("modalConfirm"),
        modalCancel: get("modalCancel"),
        logoutBtn: get("logoutBtn")
    };

    const escapeHTML = value => {
        const div = document.createElement("div");
        div.textContent = value ?? "";
        return div.innerHTML;
    };

    const formatDate = date => {
        if (!date) return "N/A";

        return new Date(date).toLocaleDateString("en-US", {
            year: "numeric",
            month: "short",
            day: "numeric"
        });
    };

    const showAlert = (title, message, type = "success") => {
        const container = get("notification-container");
        if (!container) return;

        const icons = {
            success: "bx-check-circle",
            error: "bx-error-circle",
            info: "bx-info-circle"
        };

        const alert = document.createElement("div");
        alert.className = `toast ${type}`;

        alert.innerHTML = `
            <i class="bx ${icons[type] || icons.success}"></i>
            <div class="toast-content">
                <span class="toast-title">${escapeHTML(title)}</span>
                <span class="toast-msg">${escapeHTML(message)}</span>
            </div>
        `;

        container.appendChild(alert);

        setTimeout(() => {
            alert.style.opacity = "0";
            setTimeout(() => alert.remove(), 400);
        }, 4000);
    };

    const showConfirm = message => {
        return new Promise(resolve => {
            if (!elements.modalOverlay || !elements.modalMessage || !elements.modalConfirm || !elements.modalCancel) {
                resolve(window.confirm(message));
                return;
            }

            elements.modalMessage.textContent = message;
            elements.modalOverlay.classList.add("active");

            const cleanup = () => {
                elements.modalConfirm.removeEventListener("click", confirm);
                elements.modalCancel.removeEventListener("click", cancel);
            };

            const confirm = () => {
                cleanup();
                elements.modalOverlay.classList.remove("active");
                resolve(true);
            };

            const cancel = () => {
                cleanup();
                elements.modalOverlay.classList.remove("active");
                resolve(false);
            };

            elements.modalConfirm.addEventListener("click", confirm);
            elements.modalCancel.addEventListener("click", cancel);
        });
    };

    const loadBanner = async () => {
        const { data, error } = await supabase
            .from("site_settings")
            .select("*")
            .eq("id", "homepage")
            .maybeSingle();

        if (error) {
            showAlert("Error", error.message, "error");
            return;
        }

        if (!data) return;

        elements.headline.value = data.headline || "";
        elements.subtext.value = data.sub_headline || "";

        if (data.desktop_banner_url && elements.desktopBox) {
            const preview = elements.desktopBox.querySelector(".preview-area");

            if (preview) {
                preview.innerHTML = `
                    <img src="${escapeHTML(data.desktop_banner_url)}" alt="Desktop Banner">
                `;
            }
        }

        if (data.mobile_banner_url && elements.mobileBox) {
            const preview = elements.mobileBox.querySelector(".preview-area");

            if (preview) {
                preview.innerHTML = `
                    <img src="${escapeHTML(data.mobile_banner_url)}" alt="Mobile Banner">
                `;
            }
        }
    };

    const loadAnnouncements = async () => {
        const { data, error } = await supabase
            .from("announcements")
            .select("id,title,message,created_at,image_url,category,audience,is_active")
            .order("created_at", { ascending: false });

        if (error) {
            showAlert("Error", error.message, "error");
            return;
        }

        if (!data?.length) {
            elements.announcementsBody.innerHTML = `
                <tr>
                    <td colspan="5" style="text-align:center;color:grey;">
                        No announcements available.
                    </td>
                </tr>
            `;
            return;
        }

        elements.announcementsBody.innerHTML = data.map(announcement => {
            const audienceLabels = {
                all: "All",
                players: "Players",
                coaches: "Coaches",
                employees: "Employees"
            };

            const audience = audienceLabels[announcement.audience] || announcement.audience || "All";

            return `
                <tr data-id="${announcement.id}">
                    <td>${escapeHTML(announcement.title)}</td>
                    <td>
                        <span class="badge">
                            ${escapeHTML(announcement.category || "General")}
                        </span>
                    </td>
                    <td>
                        <span class="badge">
                            ${escapeHTML(audience)}
                        </span>
                    </td>
                    <td>${formatDate(announcement.created_at)}</td>
                    <td style="text-align:center;">
                        <button class="delete-btn" data-id="${announcement.id}" title="Delete Announcement">
                            <i class="bx bx-trash"></i>
                        </button>
                    </td>
                </tr>
            `;
        }).join("");
    };

    const saveBanner = async () => {
        const headline = elements.headline.value.trim();
        const subtext = elements.subtext.value.trim();

        if (!headline) {
            showAlert("Required", "Please enter a banner headline.", "error");
            return;
        }

        elements.updateHeroBtn.disabled = true;

        const { error } = await supabase
            .from("site_settings")
            .upsert({
                id: "homepage",
                headline,
                sub_headline: subtext
            });

        elements.updateHeroBtn.disabled = false;

        if (error) {
            showAlert("Error", error.message, "error");
            return;
        }

        showAlert("Success", "Banner content has been updated.");
        await loadBanner();
    };

    const uploadImage = async (file, type) => {
        if (!file) return;

        const extension = file.name.split(".").pop().toLowerCase();
        const fileName = `${type}_${Date.now()}.${extension}`;

        const { error: uploadError } = await supabase
            .storage
            .from("banners")
            .upload(fileName, file);

        if (uploadError) {
            showAlert("Upload Failed", uploadError.message, "error");
            return;
        }

        const { data } = supabase
            .storage
            .from("banners")
            .getPublicUrl(fileName);

        const column = `${type}_banner_url`;

        const { error: updateError } = await supabase
            .from("site_settings")
            .upsert({
                id: "homepage",
                [column]: data.publicUrl
            });

        if (updateError) {
            showAlert("Error", updateError.message, "error");
            return;
        }

        showAlert(
            "Success",
            `${type === "desktop" ? "Desktop" : "Mobile"} banner updated.`
        );

        await loadBanner();
    };

    const openAnnouncementModal = announcement => {
        const isViewing = !!announcement;

        elements.modalTitle.textContent = isViewing
            ? "View Announcement"
            : "Create Announcement";

        elements.postTitle.value = announcement?.title || "";
        elements.postMessage.value = announcement?.message || "";
        elements.postCategory.value = announcement?.category || "General";
        elements.postAudience.value = announcement?.audience || "all";
        elements.postFile.value = "";

        elements.postTitle.disabled = isViewing;
        elements.postMessage.disabled = isViewing;
        elements.postCategory.disabled = isViewing;
        elements.postAudience.disabled = isViewing;
        elements.postFile.disabled = isViewing;

        elements.postFileGroup.style.display = isViewing ? "none" : "block";
        elements.savePostBtn.style.display = isViewing ? "none" : "inline-flex";
        elements.closePostModal.textContent = isViewing ? "Close" : "Cancel";

        elements.postModal.classList.add("active");
    };

    const closeAnnouncementModal = () => {
        elements.postModal.classList.remove("active");
    };

    const saveAnnouncement = async () => {
        const title = elements.postTitle.value.trim();
        const message = elements.postMessage.value.trim();
        const category = elements.postCategory.value;
        const audience = elements.postAudience.value.trim().toLowerCase();
        const file = elements.postFile.files[0];

        const validAudiences = [
            "all",
            "players",
            "coaches",
            "employees"
        ];

        if (!title || !message) {
            showAlert(
                "Required",
                "Please complete the announcement title and message.",
                "error"
            );
            return;
        }

        if (!validAudiences.includes(audience)) {
            showAlert(
                "Invalid Audience",
                "Please select a valid announcement audience.",
                "error"
            );
            return;
        }

        elements.savePostBtn.disabled = true;

        const { data: announcement, error } = await supabase
            .from("announcements")
            .insert({
                title,
                message,
                category: category || null,
                audience,
                is_active: true
            })
            .select()
            .single();

        if (error) {
            elements.savePostBtn.disabled = false;
            showAlert("Error", error.message, "error");
            return;
        }

        if (file && announcement?.id) {
            const extension = file.name.split(".").pop().toLowerCase();
            const fileName = `announcement_${announcement.id}_${Date.now()}.${extension}`;

            const { error: uploadError } = await supabase
                .storage
                .from("banners")
                .upload(fileName, file);

            if (uploadError) {
                await supabase
                    .from("announcements")
                    .delete()
                    .eq("id", announcement.id);

                elements.savePostBtn.disabled = false;

                showAlert(
                    "Upload Failed",
                    uploadError.message,
                    "error"
                );

                return;
            }

            const { data: publicUrl } = supabase
                .storage
                .from("banners")
                .getPublicUrl(fileName);

            const { error: imageError } = await supabase
                .from("announcements")
                .update({
                    image_url: publicUrl.publicUrl
                })
                .eq("id", announcement.id);

            if (imageError) {
                showAlert(
                    "Warning",
                    "Announcement was created, but the image could not be linked.",
                    "error"
                );
            }
        }

        elements.savePostBtn.disabled = false;

        closeAnnouncementModal();

        showAlert(
            "Success",
            "Announcement has been published."
        );

        await loadAnnouncements();
    };

    const deleteAnnouncement = async id => {
        const confirmed = await showConfirm(
            "Are you sure you want to permanently delete this announcement?"
        );

        if (!confirmed) return;

        const { error } = await supabase
            .from("announcements")
            .delete()
            .eq("id", id);

        if (error) {
            showAlert("Error", error.message, "error");
            return;
        }

        showAlert(
            "Deleted",
            "Announcement has been removed."
        );

        await loadAnnouncements();
    };

    if (elements.newPostBtn) {
        elements.newPostBtn.addEventListener("click", () => {
            openAnnouncementModal(null);
        });
    }

    if (elements.closePostModal) {
        elements.closePostModal.addEventListener(
            "click",
            closeAnnouncementModal
        );
    }

    if (elements.savePostBtn) {
        elements.savePostBtn.addEventListener(
            "click",
            saveAnnouncement
        );
    }

    if (elements.updateHeroBtn) {
        elements.updateHeroBtn.addEventListener(
            "click",
            saveBanner
        );
    }

    if (elements.desktopBox && elements.desktopInput) {
        elements.desktopBox.addEventListener(
            "click",
            () => elements.desktopInput.click()
        );
    }

    if (elements.mobileBox && elements.mobileInput) {
        elements.mobileBox.addEventListener(
            "click",
            () => elements.mobileInput.click()
        );
    }

    if (elements.desktopInput) {
        elements.desktopInput.addEventListener(
            "change",
            event => uploadImage(event.target.files[0], "desktop")
        );
    }

    if (elements.mobileInput) {
        elements.mobileInput.addEventListener(
            "change",
            event => uploadImage(event.target.files[0], "mobile")
        );
    }

    if (elements.announcementsBody) {
        elements.announcementsBody.addEventListener(
            "click",
            async event => {
                const row = event.target.closest("tr");

                if (!row) return;

                const id = row.dataset.id;

                if (!id) return;

                const deleteButton = event.target.closest(".delete-btn");

                if (deleteButton) {
                    await deleteAnnouncement(id);
                    return;
                }

                const { data, error } = await supabase
                    .from("announcements")
                    .select("*")
                    .eq("id", id)
                    .single();

                if (error) {
                    showAlert("Error", error.message, "error");
                    return;
                }

                if (data) {
                    openAnnouncementModal(data);
                }
            }
        );
    }

if (elements.logoutBtn) {
    elements.logoutBtn.addEventListener("click", async event => {
        event.preventDefault();
        event.stopImmediatePropagation();

        const { error } = await supabase.auth.signOut();

        if (error) {
            showAlert("Error", `Logging out: ${error.message}`, "error");
            return;
        }

        window.location.href = "../auth/login.html";
    }, true);
}

    await Promise.all([
        loadBanner(),
        loadAnnouncements()
    ]);
});