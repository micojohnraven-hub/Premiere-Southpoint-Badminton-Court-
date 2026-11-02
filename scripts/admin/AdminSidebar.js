/**
 * AdminSidebar.js - Business Admin Sidebar Controller
 */
document.addEventListener("DOMContentLoaded", () => {
    const sidebar = document.querySelector(".sidebar");
    const toggle = document.querySelector(".toggle");
    const logoArea = document.querySelector(".image-text");
    const logoutBtn = document.getElementById("logoutBtn");

    // Remove the preload class after initial paint so smooth transitions work for manual clicks
    requestAnimationFrame(() => {
        setTimeout(() => {
            document.body.classList.remove("preload");
        }, 50);
    });

    if (!sidebar) return;

    // 1. SYNC STATE FROM LOCALSTORAGE (Fallback sync)
    const savedState = localStorage.getItem("adminSidebarState");
    if (savedState === "open") {
        sidebar.classList.remove("close");
    } else if (savedState === "closed") {
        sidebar.classList.add("close");
    }

    // 2. TOGGLE EVENT
    if (toggle) {
        toggle.addEventListener("click", () => {
            sidebar.classList.toggle("close");
            const state = sidebar.classList.contains("close") ? "closed" : "open";
            localStorage.setItem("adminSidebarState", state);
        });
    }

    // 3. LOGO CLICK -> REDIRECT TO ADMIN DASHBOARD
    if (logoArea) {
        logoArea.style.cursor = "pointer";
        logoArea.addEventListener("click", () => {
            window.location.href = "Dashboard.html";
        });
    }

    // 4. DYNAMIC ACTIVE TAB HIGHLIGHTING
    const links = document.querySelectorAll(".sidebar .nav-link a, .sidebar .menu a");
    const currentFile = window.location.pathname.split("/").pop().toLowerCase();

    links.forEach((link) => {
        const href = (link.getAttribute("href") || "").split("/").pop().toLowerCase();
        
        if (href === currentFile || (currentFile === "" && href === "dashboard.html")) {
            link.classList.add("active");
        } else {
            link.classList.remove("active");
        }
    });

    // 5. SECURE LOGOUT HANDLER
    if (logoutBtn) {
        logoutBtn.addEventListener("click", async (e) => {
            e.preventDefault();

            try {
                const { supabase } = await import("/supabase/supabaseClient.js");
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
});