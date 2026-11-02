(function () {
    const body = document.querySelector("body");
    const sidebar = body.querySelector(".sidebar");
    const toggle = body.querySelector(".toggle");

    if (!sidebar) return;

    // 1. SYNC SIDEBAR STATE FROM LOCALSTORAGE
    const savedState = localStorage.getItem("playerSidebarState");
    if (savedState === "open") {
        sidebar.classList.remove("close");
    } else {
        sidebar.classList.add("close");
    }

    // 2. TOGGLE BUTTON EVENT
    if (toggle) {
        toggle.addEventListener("click", () => {
            sidebar.classList.toggle("close");
            const currentState = sidebar.classList.contains("close") ? "closed" : "open";
            localStorage.setItem("playerSidebarState", currentState);
        });
    }

    // 3. LOGO REDIRECT (Click logo -> Player Profile/Dashboard)
    const logoArea = sidebar.querySelector(".image-text");
    if (logoArea) {
        logoArea.style.cursor = "pointer";
        logoArea.addEventListener("click", () => {
            window.location.href = "player.html";
        });
    }

    // 4. ACTIVE LINK HIGHLIGHT (Case-insensitive match for HTML file names)
    const currentPath = window.location.pathname.split("/").pop().toLowerCase();
    const links = sidebar.querySelectorAll(".nav-link a");

    links.forEach((link) => {
        const href = (link.getAttribute("href") || "").split("/").pop().toLowerCase();
        
        // Exact match or fallback for root player page
        if (href === currentPath || (currentPath === "" && href === "player.html")) {
            link.parentElement.classList.add("active");
            link.classList.add("active");
        } else {
            link.parentElement.classList.remove("active");
            link.classList.remove("active");
        }
    });

    // 5. SECURE LOGOUT HANDLER
    const logoutBtn = document.getElementById("logoutBtn");
    if (logoutBtn) {
        logoutBtn.addEventListener("click", async (e) => {
            e.preventDefault();

            try {
                const { supabase } = await import("../../supabase/supabaseClient.js");
                if (supabase?.auth) {
                    await supabase.auth.signOut({ scope: "global" });
                }
            } catch (err) {
                console.warn("Logout error:", err);
            }

            localStorage.clear();
            sessionStorage.clear();
            window.location.href = "/pages/auth/login.html";
        });
    }
})();