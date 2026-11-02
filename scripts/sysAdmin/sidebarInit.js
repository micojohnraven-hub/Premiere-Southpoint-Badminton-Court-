(function () {
    let savedState = null;

    try {
        savedState = localStorage.getItem("sidebarState");
    } catch {
        savedState = null;
    }

    const isMobile = window.innerWidth <= 768;

    if (savedState === "closed" || (!savedState && isMobile)) {
        document.documentElement.classList.add("sidebar-is-closed");
    }
})();