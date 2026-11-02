async function loadNotifications(coachId) {
    const { data, error } = await supabase
        .from("notifications")
        .select("id, title, message, is_read, created_at")
        .eq("user_id", coachId)
        .order("created_at", { ascending: false })
        .limit(10);

    const list  = document.getElementById("notifList");
    const badge = document.getElementById("notifBadge");

    if (error || !data || data.length === 0) {
        list.innerHTML = `<li class="notif-empty">No new notifications.</li>`;
        badge.style.display = "none";
        return;
    }

    const unread = data.filter(n => !n.is_read).length;
    badge.textContent   = unread > 0 ? unread : "";
    badge.style.display = unread > 0 ? "flex" : "none";

    list.innerHTML = data.map(notif => `
        <li class="notif-item ${notif.is_read ? "" : "unread"}" data-id="${notif.id}">
            <div class="notif-icon new-req">
                <i class='bx bx-user-plus'></i>
            </div>
            <div class="notif-text">
                <p><strong>${notif.title}</strong></p>
                <p>${notif.message}</p>
                <span>${getTimeAgo(new Date(notif.created_at))}</span>
            </div>
        </li>`
    ).join("");
}

window.clearNotifs = async function () {
    const { data: authData } = await supabase.auth.getUser();
    const user = authData?.user;
    if (!user) return;

    await supabase
        .from("notifications")
        .update({ is_read: true })
        .eq("user_id", user.id)
        .eq("is_read", false);

    // Remove highlight lang, hindi tinatanggal ang items
    document.querySelectorAll(".notif-item.unread").forEach(item => {
        item.classList.remove("unread");
    });

    document.getElementById("notifBadge").style.display = "none";
    document.getElementById("notifPanel").classList.remove("open");
};