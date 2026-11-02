import { supabase } from "../supabase/supabaseClient.js";

const announcementFields = `
    id,
    title,
    message,
    created_at,
    image_url,
    category,
    audience
`;

async function fetchAnnouncements(audience, includeReads = false) {
    const select = includeReads
        ? `
            ${announcementFields},
            announcement_reads!left(user_id)
        `
        : announcementFields;

    const { data, error } = await supabase
        .from("announcements")
        .select(select)
        .eq("is_active", true)
        .or(`audience.eq.all,audience.eq.${audience}`)
        .order("created_at", { ascending: false });

    if (error) {
        console.error(`${audience} announcement error:`, error);
        return [];
    }

    return data || [];
}

async function checkAndShowRoleAnnouncements(userId, audience) {
    if (!userId) return;

    const announcements = await fetchAnnouncements(audience, true);

    if (!announcements.length) return;

    const unread = announcements.filter(announcement =>
        !announcement.announcement_reads?.some(
            read => read.user_id === userId
        )
    );

    if (!unread.length) return;

    showAnnouncementPopup(unread, userId);
}

async function loadAnnouncementGrid({
    containerId,
    userId,
    audience,
    previewHandler
}) {
    const container = document.getElementById(containerId);

    if (!container || !userId) return;

    container.classList.add("announcement-scroll");

    const announcements = await fetchAnnouncements(audience);

    if (!announcements.length) {
        container.innerHTML = `
            <div class="announcement-empty">
                <i class='bx bx-bell-off'></i>
                <p>No announcements available.</p>
            </div>
        `;
        return;
    }

    container.innerHTML = announcements.map(announcement => `
        <div class="ann-history-item" data-id="${announcement.id}">
            <div class="ann-h-header">
                <span class="ann-h-title">
                    ${escapeHtml(announcement.title)}
                </span>

                <span class="ann-h-date">
                    ${formatDate(announcement.created_at)}
                </span>
            </div>

            <p class="ann-h-message">
                ${escapeHtml(announcement.message)}
            </p>
        </div>
    `).join("");

    container.querySelectorAll(".ann-history-item").forEach(item => {
        item.addEventListener("click", () => {
            const selected = announcements.find(
                announcement => announcement.id === item.dataset.id
            );

            if (!selected) return;

            showAnnouncementPopup(
                [selected],
                userId,
                previewHandler
            );
        });
    });
}

export async function checkAndShowAnnouncements(userId) {
    await checkAndShowRoleAnnouncements(userId, "players");
}

export async function checkAndShowCoachAnnouncements(userId) {
    await checkAndShowRoleAnnouncements(userId, "coaches");
}

export async function checkAndShowEmployeeAnnouncements(userId) {
    await checkAndShowRoleAnnouncements(userId, "employees");
}

export async function loadUserAnnouncements(userId) {
    await loadAnnouncementGrid({
        containerId: "announcementsGrid",
        userId,
        audience: "players",
        previewHandler: true
    });
}

export async function loadCoachAnnouncementsGrid(userId) {
    await loadAnnouncementGrid({
        containerId: "coachAnnouncementList",
        userId,
        audience: "coaches",
        previewHandler: true
    });
}

export async function loadEmployeeAnnouncements(userId) {
    await loadAnnouncementGrid({
        containerId: "announcementFeed",
        userId,
        audience: "employees",
        previewHandler: true
    });
}

export async function loadAnnouncementHistory() {
    const container = document.getElementById("announcementHistory");

    if (!container) return;

    container.classList.add("announcement-scroll");

    const announcements = await fetchAnnouncements("players");

    if (!announcements.length) {
        container.innerHTML = `
            <p class="announcement-empty">
                No announcements found.
            </p>
        `;
        return;
    }

    container.innerHTML = announcements.map(announcement => `
        <div class="ann-history-item" data-id="${announcement.id}">
            <div class="ann-h-header">
                <span class="ann-h-title">
                    ${escapeHtml(announcement.title)}
                </span>

                <span class="ann-h-date">
                    ${formatDate(announcement.created_at)}
                </span>
            </div>

            <p class="ann-h-message">
                ${escapeHtml(announcement.message)}
            </p>
        </div>
    `).join("");

    container.querySelectorAll(".ann-history-item").forEach(item => {
        item.addEventListener("click", () => {
            const selected = announcements.find(
                announcement => announcement.id === item.dataset.id
            );

            if (!selected) return;

            showAnnouncementPopup(
                [selected],
                null,
                true
            );
        });
    });
}

export function showAnnouncementPopup(
    announcements,
    userId,
    isPreview = false
) {
    let currentIndex = 0;

    const overlay = document.getElementById("announcementOverlay");
    const body = document.getElementById("annBody");
    const closeBtn = document.getElementById("annCloseBtn");
    const headerTitle = document.getElementById("annHeaderTitle");

    if (!overlay || !body || !closeBtn || !headerTitle) return;

    function showCurrentAnnouncement() {
        const announcement = announcements[currentIndex];

        headerTitle.textContent = announcement.title;

        body.innerHTML = `
            <div class="ann-item">
                ${
                    announcement.image_url
                        ? `
                            <img
                                src="${escapeHtml(announcement.image_url)}"
                                alt="Announcement image"
                                class="announcement-image">
                        `
                        : ""
                }

                <div class="announcement-category">
                    <span class="badge">
                        ${escapeHtml(announcement.category || "General")}
                    </span>
                </div>

                <p class="announcement-message">
                    ${escapeHtml(announcement.message)}
                </p>

                <span class="announcement-date">
                    ${formatDate(announcement.created_at)}
                </span>
            </div>
        `;

        overlay.style.display = "flex";

        closeBtn.textContent =
            currentIndex === announcements.length - 1
                ? "Okay"
                : "Next";
    }

    closeBtn.onclick = async () => {
        const announcement = announcements[currentIndex];

        if (!isPreview && userId) {
            await markAsRead(announcement.id, userId);
        }

        currentIndex++;

        if (currentIndex < announcements.length) {
            showCurrentAnnouncement();
        } else {
            overlay.style.display = "none";
        }
    };

    showCurrentAnnouncement();
}

async function markAsRead(announcementId, userId) {
    if (!announcementId || !userId) return;

    const { error } = await supabase
        .from("announcement_reads")
        .upsert(
            {
                announcement_id: announcementId,
                user_id: userId
            },
            {
                onConflict: "announcement_id,user_id"
            }
        );

    if (error) {
        console.error("Announcement read error:", error);
    }
}

function escapeHtml(value) {
    const div = document.createElement("div");
    div.textContent = value ?? "";
    return div.innerHTML;
}

function formatDate(dateStr) {
    if (!dateStr) return "N/A";

    return new Date(dateStr).toLocaleDateString("en-PH", {
        year: "numeric",
        month: "short",
        day: "numeric"
    });
}