import { supabase } from "../supabase/supabaseClient.js";

const form = document.getElementById("forgotPasswordForm");

form.addEventListener("submit", async (e) => {
    e.preventDefault();

    const email = document.getElementById("email").value.trim();

    const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/pages/auth/resetPassword.html`
    });

    if (error) {
        console.error(error);
        alert("Error: " + error.message);
        return;
    }

    alert("Check your email for reset link!");
});