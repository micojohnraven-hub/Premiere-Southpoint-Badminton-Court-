import { supabase } from "../supabase/supabaseClient.js";

// ── TOAST ─────────────────────────────────────────────────────────
window.showToast = function (message, type = "default") {
    const toast = document.getElementById("toastNotification");
    const toastMessage = document.getElementById("toastMessage");
    if (!toast || !toastMessage) return;
    toast.classList.remove("success", "error");
    if (type === "success") toast.classList.add("success");
    if (type === "error") toast.classList.add("error");
    toastMessage.textContent = message;
    toast.classList.add("show");
    setTimeout(() => toast.classList.remove("show"), 2500);
};

// ── CONSTANTS ─────────────────────────────────────────────────────
const LEVEL_THEME = {
    Advanced: { tag: "ADVANCED" },
    Intermediate: { tag: "INTERMEDIATE" },
    Beginner: { tag: "BEGINNER" },
    "Not Qualified": { tag: "NOT QUALIFIED" },
    "Not Assessed": { tag: "NOT ASSESSED" },
};

// ── STATE ─────────────────────────────────────────────────────────
let activeTournament = null;
let participants = [];
let tournamentInterval;
let startTime;
let lastLocalSaveAt = 0;
const SELF_ECHO_WINDOW_MS = 2000;

// ── INIT ──────────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", async () => {
    await loadActiveTournament();
    setupRealtimeSync();
    setupPolling();
});

// ── LOAD ACTIVE TOURNAMENT (read-only, no create) ─────────────────
async function loadActiveTournament() {
    const { data, error } = await supabase
        .from("tournaments")
        .select("*")
        .in("status", ["registration_open", "registration_closed", "ongoing"])
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

    if (error) {
        console.error(error);
        return;
    }

    activeTournament = data;

    const noTournamentSection = document.getElementById("noTournamentSection");

    if (activeTournament) {
        if (noTournamentSection) noTournamentSection.style.display = "none";
        await loadParticipantsData();
        renderTournamentInfo();
        await loadTournamentBracket();
    } else {
        if (noTournamentSection) noTournamentSection.style.display = "block";
        renderNoTournament();
        renderRecentChampions();
    }
}

async function loadParticipantsData() {
    if (!activeTournament) return;
    const { data, error } = await supabase
        .from("tournament_registrations")
        .select("*, profiles(full_name, player_level, winrate)")
        .eq("tournament_id", activeTournament.id)
        .eq("verified", true)
        .eq("payment_status", "verified");

    if (error) {
        console.error("Failed to load participants:", error);
        return;
    }
    participants = data || [];
}

// ── TOURNAMENT INFO BANNER ────────────────────────────────────────
function renderTournamentInfo() {
    const adSection = document.getElementById("adSection");
    const regBadge = document.getElementById("regBadge");
    const titleEl = document.getElementById("displayAdTitle");
    const descEl = document.getElementById("displayAdDesc");

    if (!activeTournament) return;

    const statusLabel =
        {
            registration_open: "🟢 Registration Open",
            registration_closed: "🔴 Registration Closed",
            ongoing: "🏸 Ongoing",
            finished: "✅ Finished",
        }[activeTournament.status] || activeTournament.status;

    const seedingLabel =
        activeTournament.seeding_method === "winrate"
            ? "By Winrate"
            : activeTournament.seeding_method === "random"
            ? "Random Shuffle"
            : "By Level";

    if (titleEl) titleEl.textContent = activeTournament.title;

    if (descEl) {
        descEl.innerHTML = `
            <i class='bx bx-calendar'></i> ${new Date(activeTournament.date).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
            &nbsp;·&nbsp;
            <i class='bx bx-trophy'></i> ${activeTournament.format === "single" ? "Single Elimination" : "Double Elimination"}
            &nbsp;·&nbsp;
            <i class='bx bx-sort-alt-2'></i> ${seedingLabel}
            &nbsp;·&nbsp;
            <i class='bx bx-peso'></i> ₱${parseFloat(activeTournament.fee).toFixed(2)} fee`;
    }

    if (regBadge) regBadge.textContent = statusLabel;
    if (adSection) adSection.style.display = "block";
}

function renderNoTournament() {
    const adSection = document.getElementById("adSection");
    if (adSection) adSection.style.display = "none";

    const bracketSection = document.getElementById("bracketSection");
    if (bracketSection) bracketSection.style.display = "none";
}

async function renderRecentChampions() {
    const container = document.getElementById("recentChampsList");
    if (!container) return;

    const { data, error } = await supabase
        .from("tournaments")
        .select("id, title, date, winner_name, format, duration")
        .eq("status", "finished")
        .order("date", { ascending: false })
        .limit(5);

    if (error) {
        console.error("Failed to load recent champions:", error);
        container.innerHTML = `<p class="champs-empty">Unable to load history.</p>`;
        return;
    }

    if (!data || data.length === 0) {
        container.innerHTML = `<p class="champs-empty">No past tournaments yet.</p>`;
        return;
    }

    container.innerHTML = data
        .map(
            (item) => `
        <div class="champ-row">
            <div class="champ-icon"><i class='bx bxs-trophy'></i></div>
            <div class="champ-info">
                <span class="champ-name">${item.winner_name || "TBA"}</span>
                <span class="champ-meta">${item.title} · ${new Date(item.date).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</span>
            </div>
            <span class="champ-format">${item.format === "single" ? "Single Elim" : "Double Elim"}</span>
        </div>`
        )
        .join("");
}

// ── TIMER (display only) ───────────────────────────────────────────
function startTimer(existingStartTime = null) {
    startTime = existingStartTime || Date.now();

    if (tournamentInterval) clearInterval(tournamentInterval);
    tournamentInterval = setInterval(() => {
        const diff = Date.now() - startTime;
        const h = Math.floor(diff / 3600000).toString().padStart(2, "0");
        const m = Math.floor((diff % 3600000) / 60000).toString().padStart(2, "0");
        const s = Math.floor((diff % 60000) / 1000).toString().padStart(2, "0");
        const slot = document.getElementById("timerDisplay");
        if (slot) slot.innerHTML = `<i class='bx bx-timer'></i> ${h}:${m}:${s}`;
    }, 1000);
}

function stopTimer() {
    clearInterval(tournamentInterval);
    const slot = document.getElementById("timerDisplay");
    if (slot) slot.innerHTML = `<i class='bx bx-timer'></i> 00:00:00`;
}

function lockBracketInputs(display) {
    display.querySelectorAll(".score-input").forEach((inp) => {
        inp.disabled = true;
        inp.readOnly = true;
        inp.tabIndex = -1;
    });
}

async function loadTournamentBracket() {
    const display = document.getElementById("bracketInlineDisplay");
    const bracketSection = document.getElementById("bracketSection");
    if (!display) return;

    if (!activeTournament?.bracket_html) {
        if (bracketSection) bracketSection.style.display = "none";
        return;
    }

    if (bracketSection) bracketSection.style.display = "block";
    display.innerHTML = activeTournament.bracket_html;
    
    lockBracketInputs(display);

    if (activeTournament?.winner_name) {
        const champNameEl = display.querySelector(".champion-name");
        if (champNameEl) champNameEl.textContent = activeTournament.winner_name;
        const champCard = display.querySelector(".champion-card");
        if (champCard) champCard.classList.add("active");
    }

    if (activeTournament?.start_time) startTimer(parseInt(activeTournament.start_time));
}

function setupRealtimeSync() {
    supabase
        .channel("employee-tournament-live")
        .on("postgres_changes", { event: "*", schema: "public", table: "tournaments" }, async () => {
            if (Date.now() - lastLocalSaveAt < SELF_ECHO_WINDOW_MS) return;
            await loadActiveTournament();
        })
        .on(
            "postgres_changes",
            { event: "*", schema: "public", table: "tournament_registrations" },
            async () => {
                if (activeTournament) await loadParticipantsData();
            }
        )
        .subscribe();
}

function setupPolling() {
    setInterval(async () => {
        if (activeTournament) {
            const { data } = await supabase
                .from("tournaments")
                .select("*")
                .eq("id", activeTournament.id)
                .single();

            if (data) {
                const statusChanged = data.status !== activeTournament.status;
                const bracketChanged = data.bracket_html !== activeTournament.bracket_html;
                activeTournament = data;
                if (statusChanged) renderTournamentInfo();
                if (bracketChanged) await loadTournamentBracket();
            }
        }
    }, 5000);
}