async function setupRealtimeNotificationBell() {
    const { data: authData, error: authError } = await supabase.auth.getUser();
    const user = authData?.user;
    if (authError || !user) return;

    if (notificationChannel) supabase.removeChannel(notificationChannel);

    notificationChannel = supabase
        .channel(`player-notifications-${user.id}`)
        .on(
            "postgres_changes",
            {
                event: "INSERT",
                schema: "public",
                table: "notifications",
                filter: `user_id=eq.${user.id}`
            },
            async (payload) => {
                const notif = payload.new;

                if (notif?.message) {
                    showToast(`${notif.title}: ${notif.message}`);
                }

                await refreshPlayerNotifBadge(user.id);
            }
        )
        .subscribe();
        
    await refreshPlayerNotifBadge(user.id);
}

async function refreshPlayerNotifBadge(userId) {
    const { data, error } = await supabase
        .from("notifications")
        .select("id")
        .eq("user_id", userId)
        .eq("is_read", false);

    const badge = document.getElementById("notifBadge");
    if (!badge) return;

    const count = data?.length || 0;
    badge.textContent   = count > 0 ? count : "";
    badge.style.display = count > 0 ? "flex" : "none";
}