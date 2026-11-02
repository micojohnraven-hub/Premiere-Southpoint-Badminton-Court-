import { supabase } from "../supabase/supabaseClient.js";

const MAINTENANCE_PAGE = "/pages/shared/maintenance.html";

async function checkMaintenance() {
    const currentPath = window.location.pathname;

    if (
        currentPath.includes("login.html") ||
        currentPath.includes("maintenance.html")
    ) {
        return;
    }

    const { data: settings, error: settingsError } = await supabase
        .from("site_settings")
        .select("maintenance_mode")
        .eq("id", "homepage")
        .single();

    if (settingsError || !settings?.maintenance_mode) {
        return;
    }

    const {
        data: { session },
        error: sessionError
    } = await supabase.auth.getSession();

    if (sessionError || !session) {
        window.location.replace(MAINTENANCE_PAGE);
        return;
    }

    const { data: profile, error: profileError } = await supabase
        .from("profiles")
        .select("role")
        .eq("id", session.user.id)
        .single();

    if (
        profileError ||
        !profile ||
        profile.role !== "sys_admin"
    ) {
        await supabase.auth.signOut().catch(() => {});
        window.location.replace(MAINTENANCE_PAGE);
    }
}

checkMaintenance();