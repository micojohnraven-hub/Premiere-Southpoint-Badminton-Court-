// ─── INIT ───
function initCarousel(containerSelector) {
    const container = document.querySelector(containerSelector);

    if (!container) return;

    const track = container.querySelector(".carousel-track");
    const slides = Array.from(track.children);
    const dotsWrap = container.querySelector(".carousel-dots");
    const prevBtn = container.querySelector(".carousel-prev");
    const nextBtn = container.querySelector(".carousel-next");

    let currentIndex = 0;

    slides.forEach((_, index) => {
        const dot = document.createElement("button");

        dot.className = "carousel-dot";
        dot.setAttribute("aria-label", `Go to slide ${index + 1}`);
        dot.addEventListener("click", () => goToSlide(index));

        dotsWrap.appendChild(dot);
    });

    const dots = Array.from(dotsWrap.children);

    // ─── RENDER ───
    function updateUI() {
        track.style.transform = `translateX(-${currentIndex * 100}%)`;

        dots.forEach((dot, index) => {
            dot.classList.toggle("active", index === currentIndex);
        });

        prevBtn.disabled = currentIndex === 0;
        nextBtn.disabled = currentIndex === slides.length - 1;
    }

    // ─── NAVIGATION ───
    function goToSlide(index) {
        currentIndex = Math.max(0, Math.min(index, slides.length - 1));
        updateUI();
    }

    prevBtn.addEventListener("click", () => goToSlide(currentIndex - 1));
    nextBtn.addEventListener("click", () => goToSlide(currentIndex + 1));

    updateUI();
}

export { initCarousel };