/**
 * EmployeeSidebar.js - Employee Portal Sidebar Controller
 */

// 1. SYNC STATE IMMEDIATELY ON SCRIPT EVALUATION
(function syncInitialSidebarState() {
    const savedState = localStorage.getItem("employeeSidebarState");
    const sidebar = document.querySelector(".sidebar");
    
    if (sidebar) {
        if (savedState === "open") {
            sidebar.classList.remove("close");
        } else if (savedState === "closed") {
            sidebar.classList.add("close");
        }
    }
})();

document.addEventListener("DOMContentLoaded", () => {
    const sidebar = document.querySelector(".sidebar");
    const toggle = document.querySelector(".toggle");
    const logoArea = document.querySelector(".image-text");
    const logoutBtn = document.getElementById("logoutBtn");

    // 2. REMOVE PRELOAD TO RESTORE INTERACTIVE TRANSITIONS
    requestAnimationFrame(() => {
        setTimeout(() => {
            document.body.classList.remove("preload");
        }, 50);
    });

    if (!sidebar) return;

    // Double check state sync after DOM is loaded
    const savedState = localStorage.getItem("employeeSidebarState");
    if (savedState === "open") {
        sidebar.classList.remove("close");
    } else if (savedState === "closed") {
        sidebar.classList.add("close");
    }

    // 3. TOGGLE SIDEBAR
    if (toggle) {
        toggle.addEventListener("click", () => {
            sidebar.classList.toggle("close");
            const state = sidebar.classList.contains("close") ? "closed" : "open";
            localStorage.setItem("employeeSidebarState", state);
        });
    }

    // 4. LOGO REDIRECT -> EMPLOYEE HOME (Reservations)
    if (logoArea) {
        logoArea.style.cursor = "pointer";
        logoArea.addEventListener("click", () => {
            window.location.href = "employeeRole.html";
        });
    }

    // 5. ACTIVE TAB HIGHLIGHTING
    const links = document.querySelectorAll(".sidebar .nav-link a, .sidebar .menu a");
    const currentFile = window.location.pathname.split("/").pop().toLowerCase();

    links.forEach((link) => {
        const href = (link.getAttribute("href") || "").split("/").pop().toLowerCase();

        // Check if matching current page, default to employeeRole.html if root
        if (href === currentFile || (currentFile === "" && href === "employeerole.html")) {
            link.classList.add("active");
        } else {
            link.classList.remove("active");
        }
    });

    // 6. LOGOUT HANDLER
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