import { supabase } from "../supabase/supabaseClient.js";
import { saveLog } from "../sysAdmin/sysLogs.js";

const LOGIN_PAGE = "../auth/login.html";
const MAINTENANCE_PAGE = "/pages/shared/maintenance.html";

function backToLogin(errorMessage) {
    if (errorMessage) {
        sessionStorage.setItem("loginError", errorMessage);
    }
    window.location.replace(LOGIN_PAGE);
}

function redirectNow(role) {
    switch (role) {
        case "player":
            window.location.href = "../player/player.html";
            break;
        case "coach":
            window.location.href = "../coach/coachDashboard.html";
            break;
        case "employee":
            window.location.href = "../employee/employeeRole.html";
            break;
        case "sys_admin":
            window.location.href = "../sysAdmin/systemAdmin.html";
            break;
        case "business_admin":
            window.location.href = "../admin/Dashboard.html";
            break;
        default:
            backToLogin("Unknown role. Contact administrator.");
    }
}

async function isMaintenanceMode() {
    const { data, error } = await supabase
        .from("site_settings")
        .select("maintenance_mode")
        .eq("id", "homepage")
        .single();

    if (error) {
        console.error("Maintenance check failed:", error);
        return false;
    }
    return data?.maintenance_mode === true;
}

// ─── PHONE VALIDATION ───
function normalizePhilippinePhone(raw) {
    const digits = raw.replace(/\D/g, "");
    if (!/^9\d{9}$/.test(digits)) return null;
    return "+63" + digits;
}

document.getElementById("modalPhone")?.addEventListener("input", e => {
    e.target.value = e.target.value.replace(/\D/g, "").slice(0, 10);
});

// ─── COMPLETE PROFILE MODAL ───
function showCompleteProfileModal(userId) {
    const modal = document.getElementById("completeProfileModal");
    modal.style.display = "flex";

    const form = document.getElementById("completeProfileForm");
    form.onsubmit = async e => {
        e.preventDefault();

        const rawPhone = document.getElementById("modalPhone").value.trim();
        const gender = document.getElementById("modalGender").value;

        const contact_number = normalizePhilippinePhone(rawPhone);
        if (!contact_number) {
            alert("Invalid phone number. Please enter a 10-digit number starting with 9 (e.g. 9171234567).");
            return;
        }
        if (!gender) {
            alert("Please select a gender.");
            return;
        }

        const { error } = await supabase
            .from("profiles")
            .update({
                contact_number: contact_number,
                gender: gender,
            })
            .eq("id", userId);

        if (error) {
            alert("Failed to save: " + error.message);
            return;
        }

        modal.style.display = "none";
        window.location.href = "../player/CourtList.html";
    };
}

// ─── MAIN CALLBACK LOGIC ───
(async () => {
    const { data: { session } } = await supabase.auth.getSession();

    if (!session) {
        backToLogin();
        return;
    }

    const user = session.user;

    let { data: profile } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", user.id)
        .maybeSingle();

    if (!profile) {
        const { data: newProfile, error: insertError } = await supabase
            .from("profiles")
            .insert([{
                id: user.id,
                email: user.email,
                full_name: user.user_metadata?.full_name || user.email,
                avatar_url: user.user_metadata?.avatar_url || "",
                role: "player"
            }])
            .select()
            .single();

        if (insertError) {
            await supabase.auth.signOut().catch(() => {});
            backToLogin("Failed to create profile: " + insertError.message);
            return;
        }
        profile = newProfile;
        await saveLog("AUTH", `New user account registered via Google: ${user.email}`, user.email, "success");
    }

    if (["suspended", "banned", "inactive"].includes(profile.status)) {
        await supabase.auth.signOut().catch(() => {});
        const blockMessages = {
            suspended: "Your account is currently suspended. Please contact the admin.",
            banned: "Your account has been permanently banned.",
            inactive: "Your account is inactive. Please contact support."
        };
        await saveLog("AUTH", `Blocked Google login: User status is ${profile.status}`, user.email, "critical");
        backToLogin(blockMessages[profile.status]);
        return;
    }

    const maintenance = await isMaintenanceMode();
    if (maintenance && profile.role !== "sys_admin") {
        await supabase.auth.signOut().catch(() => {});
        await saveLog("AUTH", `Google login blocked during maintenance: ${user.email}`, user.email, "warning");
        window.location.replace(MAINTENANCE_PAGE);
        return;
    }

    await supabase
        .from("profiles")
        .update({
            full_name: user.user_metadata?.full_name || profile.full_name,
            avatar_url: user.user_metadata?.avatar_url || profile.avatar_url
        })
        .eq("id", user.id);

    if (!profile.contact_number || !profile.gender) {
        document.getElementById("statusText").style.display = "none";
        await saveLog("AUTH", `Google OAuth Login: Profile incomplete for ${user.email}`, user.email, "info");
        showCompleteProfileModal(user.id);
        return;
    }

    await saveLog("AUTH", `Google OAuth Login Successful (${profile.role})`, user.email, "success");
    redirectNow(profile.role);
})();