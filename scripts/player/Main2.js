{
    const body = document.querySelector("body"),
          sidebar = body.querySelector(".sidebar"),
          toggle = body.querySelector(".toggle");

    // ── SIDEBAR TOGGLE ───────────────────────────────────────────
    if (sidebar && toggle) {
        const savedState = localStorage.getItem("sidebarState");

        if (savedState === "closed") {
            sidebar.classList.add("close");
        } else if (savedState === "open") {
            sidebar.classList.remove("close");
        } else {
            if (window.innerWidth <= 768) {
                sidebar.classList.add("close");
            } else {
                sidebar.classList.remove("close");
            }
        }

        toggle.addEventListener("click", () => {
            sidebar.classList.toggle("close");
            localStorage.setItem(
                "sidebarState",
                sidebar.classList.contains("close") ? "closed" : "open"
            );
        });
    }

    // ── ACTIVE PAGE HIGHLIGHTING ─────────────────────────────────
    const mainSidebarLinks = document.querySelectorAll(".sidebar .menu-bar .nav-link a");
    const currentPagePath = window.location.pathname.split("/").pop() || "index.html";

    mainSidebarLinks.forEach(link => {
        const linkHref = link.getAttribute("href");
        if (linkHref === currentPagePath) {
            link.classList.add("active");
            link.parentElement.classList.add("active");
        } else {
            link.classList.remove("active");
            link.parentElement.classList.remove("active");
        }
    });

    // ── LOGOUT ───────────────────────────────────────────────────
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

    // Show alert
    function showAlert(message, type = "success") {
        const existing = document.querySelector(".custom-alert");
        if (existing) existing.remove();

        const alert = document.createElement("div");
        alert.className = "custom-alert";
        alert.textContent = message;

        let bg = "#16a34a";

        if (type === "error") bg = "#dc2626";
        if (type === "warning") bg = "#f59e0b";
        if (type === "info") bg = "#2563eb";

        alert.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            background: ${bg};
            color: white;
            padding: 14px 22px;
            border-radius: 8px;
            font-size: 14px;
            font-weight: 600;
            z-index: 99999;
            box-shadow: 0 8px 20px rgba(0,0,0,.2);
            animation: slideDown .25s ease;
        `;

        document.body.appendChild(alert);

        setTimeout(() => {
            alert.remove();
        }, 3000);
    }
}