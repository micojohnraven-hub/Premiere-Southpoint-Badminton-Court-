{
    const body = document.querySelector("body"),
          sidebar = body.querySelector(".sidebar"),
          toggle = body.querySelector(".toggle");

    // 1. STABILIZE: Check localStorage immediately on page load
    // This prevents the sidebar from moving/resetting when switching pages
    if (localStorage.getItem("coachSidebarState") === "closed") {
        sidebar.classList.add("close");
    } else {
        sidebar.classList.remove("close");
    }

    // 2. TOGGLE LOGIC: Save the state when clicked
    if (toggle) {
        toggle.addEventListener("click", () => {
            sidebar.classList.toggle("close");
            
            // Save the current state so it stays the same on the next page
            const state = sidebar.classList.contains("close") ? "closed" : "open";
            localStorage.setItem("coachSidebarState", state);
        });
    }

    // 3. LOGO REDIRECT: Click logo to go back to Coach Dashboard
    const logoArea = body.querySelector(".image-text");
    if (logoArea) {
        logoArea.style.cursor = "pointer";
        logoArea.addEventListener("click", () => {
            window.location.href = "Dashboard.html";
        });
    }

    // 4. ACTIVE LINK HIGHLIGHTING
    // Automatically highlights the bar you clicked based on the file name
    const links = document.querySelectorAll(".nav-link a");
    const currentFile = window.location.pathname.split("/").pop();

    links.forEach(link => {
        if (link.getAttribute("href") === currentFile) {
            link.classList.add("active");
        } else {
            link.classList.remove("active");
        }
    });

    const logoutBtn = document.getElementById("logoutBtn");
    if (logoutBtn) {
        logoutBtn.addEventListener("click", async (e) => {
            e.preventDefault();
    
            try {
                const { supabase } = await import("/supabase/supabaseClient.js");
                await supabase.auth.signOut({ scope: 'global' }); // force clear
            } catch (err) {
                console.warn("Logout error:", err);
            }
    
            localStorage.clear();
            sessionStorage.clear();
            window.location.href = "/pages/auth/login.html";
        });
    }
}