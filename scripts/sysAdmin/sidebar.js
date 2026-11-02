document.addEventListener("DOMContentLoaded", () => {
    const sidebar = document.querySelector(".sidebar"),
          toggle = document.querySelector(".toggle");

    if (sidebar && toggle) {
        const savedState = localStorage.getItem("sidebarState");

        // Sync final state accurately
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

    // Auto-detect & highlight active menu item
    const mainSidebarLinks = document.querySelectorAll(".sidebar .menu-bar .nav-link a");
    const currentPagePath = (window.location.pathname.split("/").pop() || "systemAdmin.html").toLowerCase();

    mainSidebarLinks.forEach(link => {
        const linkHref = (link.getAttribute("href") || "").toLowerCase();
        if (linkHref === currentPagePath) {
            link.classList.add("active");
            link.parentElement.classList.add("active");
        } else {
            link.classList.remove("active");
            link.parentElement.classList.remove("active");
        }
    });

    requestAnimationFrame(() => {
        document.documentElement.classList.remove("preload");
    });
});