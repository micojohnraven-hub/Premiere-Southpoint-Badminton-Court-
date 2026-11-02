{
    const body = document.querySelector("body"),
          sidebar = body.querySelector(".sidebar"),
          toggle = body.querySelector(".toggle");

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
}