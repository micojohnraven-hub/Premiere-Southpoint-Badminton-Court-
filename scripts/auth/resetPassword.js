import { supabase } from "../supabase/supabaseClient.js";
import { saveLog } from "../sysAdmin/sysLogs.js";

const form = document.getElementById("resetForm");

form.addEventListener("submit", async e => {
    e.preventDefault();

    const newPassword =
        document.getElementById("newPassword").value;

    const { error } = await supabase.auth.updateUser({
        password: newPassword
    });

    if (error) {
        await saveLog(
            "SYSTEM",
            "Password reset failed",
            "Unknown_User",
            "warning"
        );

        alert("Error: " + error.message);
        return;
    }

    const {
        data: { user }
    } = await supabase.auth.getUser();

    const userInvolved =
        user?.email || user?.user_metadata?.username || "Unknown_User";

    await saveLog(
        "SYSTEM",
        "Password reset successfully",
        userInvolved,
        "success"
    );

    alert("Password updated successfully!");
    window.location.href = "login.html";
});