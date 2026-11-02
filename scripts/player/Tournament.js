import { supabase } from "../supabase/supabaseClient.js";

// ── STATE ─────────────────────────────────────────────────────────
let activeTournament  = null;
let currentPlayer     = null;
let myRegistration    = null;
let clockInterval     = null;
let realtimeChannel   = null;
let pollingInterval   = null;
let lastClockStart    = null;
let bracketRefreshing = false;

// ── INIT ──────────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", async () => {
    await bootstrapPlayer();
    await loadActiveTournament();
    await loadTournamentHistory();
    setupRealtimeSync();
    setupPolling();
    setupScreenshotPreview();
    setupModalBackdrop();
    await checkMissedPlacementPopup();
});

// ── GET CURRENT PLAYER ────────────────────────────────────────────
async function bootstrapPlayer() {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;

    const { data, error } = await supabase
        .from("profiles")
        .select("id, full_name, player_level, avatar_url, winrate, games_played")
        .eq("id", session.user.id)
        .single();

    if (!error) currentPlayer = data;
}

// ── LOAD ACTIVE TOURNAMENT ────────────────────────────────────────
async function loadActiveTournament() {
    const { data, error } = await supabase
        .from("tournaments")
        .select("*")
        .in("status", ["registration_open", "registration_closed", "ongoing", "finished"])
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

    if (error) { console.error(error); return; }

    activeTournament = data;

    if (activeTournament) {
        await checkMyRegistration();
        showTournamentCard();
        renderBracketSection();
    } else {
        showNoTournament();
        renderBracketSection();
    }
}

// ── MISSED PLACEMENT POPUP ───────────────────
async function checkMissedPlacementPopup() {
    if (!currentPlayer) return;

    const { data, error } = await supabase
        .from("tournaments")
        .select("id, title, winner_name, status, date")
        .eq("status", "finished")
        .order("date", { ascending: false })
        .limit(1)
        .maybeSingle();

    if (error || !data) return;

    // Automatically skip if the tournament ended more than 24 hours
    if (data.date) {
        const tournamentTime = new Date(data.date).getTime();
        const now = Date.now();
        const twentyFourHoursMs = 24 * 60 * 60 * 1000; // 24 hours in milliseconds

        if (now - tournamentTime > twentyFourHoursMs) {
            return;
        }
    }

    // Player verification if player already registered in tourna
    const { data: reg } = await supabase
        .from("tournament_registrations")
        .select("id")
        .eq("tournament_id", data.id)
        .eq("player_id", currentPlayer.id)
        .maybeSingle();

    if (!reg) return;

    const seenKey = `placement_seen_${data.id}_${currentPlayer.id}`;
    if (localStorage.getItem(seenKey)) return;

    await showMyPlacementPopup(data.id, data.title, data.winner_name);
}

async function showMyPlacementPopup(tournamentId, tournamentTitle, winnerName) {
    if (!currentPlayer) return;

    const seenKey = `placement_seen_${tournamentId}_${currentPlayer.id}`;
    if (localStorage.getItem(seenKey)) return;
    localStorage.setItem(seenKey, "1");

    const isChampion = winnerName === currentPlayer.full_name;

    const existing = document.getElementById("placementPopup");
    if (existing) existing.remove();

    if (!document.getElementById("placementPopupStyle")) {
        const style = document.createElement("style");
        style.id = "placementPopupStyle";
        style.textContent = `
            @keyframes placementFadeIn {
                from { opacity:0; }
                to   { opacity:1; }
            }
            @keyframes placementSlideUp {
                from { opacity:0; transform:translateY(24px) scale(.97); }
                to   { opacity:1; transform:translateY(0) scale(1); }
            }
        `;
        document.head.appendChild(style);
    }

    const popup = document.createElement("div");
    popup.id = "placementPopup";
    popup.style.cssText = `
        position:fixed;inset:0;background:rgba(0,0,0,0.65);
        display:flex;align-items:center;justify-content:center;
        z-index:99999;animation:placementFadeIn .35s ease;`;

    popup.innerHTML = `
        <div style="
            background:#fff;border-radius:24px;padding:40px 32px 32px;
            max-width:360px;width:90%;text-align:center;
            box-shadow:0 24px 80px rgba(0,0,0,0.35);position:relative;
            animation:placementSlideUp .4s cubic-bezier(.22,1,.36,1);">

            <div style="font-size:4rem;margin-bottom:8px;line-height:1;">
                ${isChampion ? "🏆" : "🏸"}
            </div>

            <h2 style="margin:0 0 6px;font-size:1.45rem;color:#111827;font-weight:700;">
                ${isChampion ? "You're the Champion!" : "Tournament Complete!"}
            </h2>

            <p style="color:#6b7280;font-size:0.88rem;margin:0 0 24px;">
                ${tournamentTitle}
            </p>

            ${isChampion ? `
            <div style="
                background:linear-gradient(135deg,#fef9c3,#fef3c7);
                border:1px solid #fde68a;border-radius:12px;
                padding:13px 16px;margin-bottom:16px;">
                <p style="margin:0;font-size:0.88rem;color:#92400e;font-weight:600;">
                    🎉 Congratulations, Champion!
                </p>
            </div>` : `
            <div style="
                background:#f0fdf4;border:1px solid #bbf7d0;
                border-radius:12px;padding:13px 16px;margin-bottom:16px;">
                <p style="margin:0;font-size:0.88rem;color:#166534;font-weight:600;">
                    Thanks for participating! 🏸
                </p>
            </div>`}

            <button
                onclick="document.getElementById('placementPopup').remove()"
                style="
                    width:100%;padding:13px;border:none;border-radius:12px;
                    background:#05b905;color:#fff;font-weight:700;
                    font-size:0.95rem;cursor:pointer;
                    transition:background .15s ease;"
                onmouseover="this.style.background='#04a004'"
                onmouseout="this.style.background='#05b905'">
                Got it!
            </button>
        </div>`;

    document.body.appendChild(popup);

    popup.addEventListener("click", (e) => {
        if (e.target === popup) popup.remove();
    });
}

// ── POLLING ───────────────────────────────────────────────────────
function setupPolling() {
    if (pollingInterval) clearInterval(pollingInterval);

    pollingInterval = setInterval(async () => {
        if (currentPlayer) {
            const { data } = await supabase
                .from("profiles")
                .select("id, full_name, player_level, avatar_url, winrate, games_played")
                .eq("id", currentPlayer.id)
                .single();
            if (data) currentPlayer = data;
        }

        const { data } = await supabase
            .from("tournaments")
            .select("*")
            .in("status", ["registration_open", "registration_closed", "ongoing", "finished"])
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle();

        const prevStatus = activeTournament?.status;
        const prevId     = activeTournament?.id;

        if (!data) {
            if (prevId) {
                activeTournament = null;
                myRegistration   = null;
                lastClockStart   = null;
                stopClock();
                showNoTournament();
                renderBracketSection();
                renderRegControls();
            }
            return;
        }

        activeTournament = data;

        if (data.status === "finished" && data.winner_name) {
        const seenKey = `placement_seen_${data.id}_${currentPlayer?.id}`;
        if (!localStorage.getItem(seenKey)) {
            await showMyPlacementPopup(data.id, data.title, data.winner_name);
        }
        renderBracketSection();
        renderRegControls();
        return;
    }

        await checkMyRegistration();
        showTournamentCard();

        const idChanged     = prevId !== activeTournament.id;
        const statusChanged = prevStatus !== activeTournament.status;

        if (idChanged || statusChanged) {
            if (idChanged) {
                lastClockStart = null;
                stopClock();
            }
            renderBracketSection();
        } else if (activeTournament.status === "ongoing") {
            refreshBracketHTML();
        }

        renderRegControls();
    }, 5000);
}

// ── REAL-TIME SYNC (PLAYER) ───────────────────────────────────────
function setupRealtimeSync() {
    if (realtimeChannel) {
        supabase.removeChannel(realtimeChannel);
        realtimeChannel = null;
    }

    const profileFilter = currentPlayer?.id
        ? `id=eq.${currentPlayer.id}`
        : null;

    realtimeChannel = supabase
        .channel("player-tournament-live")
        // 1. Live Tournament Status (Created, Updated, Deleted)
        .on(
            "postgres_changes",
            { event: "*", schema: "public", table: "tournaments" },
            async (payload) => {
                const { eventType, new: newRow, old: oldRow } = payload;
                const validStatuses = ["registration_open", "registration_closed", "ongoing"];

                if (eventType === "INSERT") {
                    if (validStatuses.includes(newRow.status)) {
                        activeTournament = newRow;
                        await checkMyRegistration();
                        showTournamentCard();
                        renderBracketSection();
                        showToast(`🏆 New Tournament: ${newRow.title}! Registration is now open.`, "success");
                    }

                } else if (eventType === "UPDATE") {
                    if (activeTournament && newRow.id === activeTournament.id) {
                        const prevStatus = activeTournament.status;
                        const prevWinner = activeTournament.winner_name;
                        const savedId    = activeTournament.id;
                        const savedTitle = activeTournament.title || newRow.title;

                        activeTournament = { ...activeTournament, ...newRow };

                        await checkMyRegistration();
                        showTournamentCard();

                        const statusChanged = prevStatus !== newRow.status;
                        const winnerArrived = !prevWinner && newRow.winner_name;

                        if (statusChanged || winnerArrived) {
                            lastClockStart = null;
                            stopClock();
                            renderBracketSection();

                            if (winnerArrived) {
                                showToast(`🏆 ${newRow.winner_name} is the Champion!`, "success");
                                await showMyPlacementPopup(savedId, savedTitle, newRow.winner_name);
                            } else {
                                const statusLabels = {
                                    registration_open:   "Registration is now open!",
                                    registration_closed: "Registration has been closed.",
                                    ongoing:             "The tournament has started! 🏸",
                                    finished:            "Tournament has ended."
                                };
                                showToast(statusLabels[newRow.status] || "Tournament updated.", "success");
                            }
                        } else if (newRow.status === "ongoing") {
                            refreshBracketHTML();
                        }

                        renderRegControls();
                    }

                } else if (eventType === "DELETE") {
                    if (activeTournament && oldRow.id === activeTournament.id) {
                        activeTournament = null;
                        myRegistration   = null;
                        lastClockStart   = null;
                        stopClock();
                        const adSection = document.getElementById("adSection");
                        if (adSection) adSection.style.display = "none";
                        showNoTournament();
                        renderBracketSection();
                        showToast("Tournament has been removed.", "error");
                    }
                }
            }
        )
        // 2. Live Registration Status (My Verification, Approval, Rejection)
        .on(
            "postgres_changes",
            { event: "*", schema: "public", table: "tournament_registrations" },
            async (payload) => {
                const { eventType, new: newRow } = payload;
                if (!currentPlayer || !activeTournament) return;

                const isMyReg =
                    (newRow?.player_id === currentPlayer.id && newRow?.tournament_id === activeTournament.id) ||
                    (payload.old?.player_id === currentPlayer.id && payload.old?.tournament_id === activeTournament.id);

                if (!isMyReg) return;

                await checkMyRegistration();
                renderRegControls();

                if (eventType === "UPDATE" && newRow.payment_status === "verified") {
                    showToast("Your registration fee has been verified! ✓", "success");
                } else if (eventType === "UPDATE" && newRow.payment_status === "rejected") {
                    showToast("Your payment was rejected. Please contact the admin.", "error");
                }
            }
        );

    if (profileFilter) {
        realtimeChannel.on(
            "postgres_changes",
            {
                event:  "UPDATE",
                schema: "public",
                table:  "profiles",
                filter: profileFilter
            },
            async (payload) => {
                currentPlayer = { ...currentPlayer, ...payload.new };
                renderRegControls();
            }
        );
    }

    realtimeChannel.subscribe();
}

// ── NO TOURNAMENT STATE ───────────────────────────────────────────
function showNoTournament() {
    const noSection = document.getElementById("noTournamentSection");
    const adSection = document.getElementById("adSection");
    if (noSection) noSection.style.display = "flex";
    if (adSection) adSection.style.display = "none";
}

// ── CHECK MY REGISTRATION ─────────────────────────────────────────
async function checkMyRegistration() {
    if (!currentPlayer || !activeTournament) return;

    const { data } = await supabase
        .from("tournament_registrations")
        .select("*")
        .eq("tournament_id", activeTournament.id)
        .eq("player_id", currentPlayer.id)
        .maybeSingle();

    myRegistration = data || null;
}

// ── SHOW TOURNAMENT CARD ──────────────────────────────────────────
function showTournamentCard() {
    if (!activeTournament) return;

    const noSection = document.getElementById("noTournamentSection");
    if (noSection) noSection.style.display = "none";

    const statusLabel = {
        registration_open:   "Registration Open",
        registration_closed: "Registration Closed",
        ongoing:             "🔴 Live Now",
        finished:            "✅ Finished"
    }[activeTournament.status] || activeTournament.status;

    const badge = document.getElementById("regBadge");
    if (badge) {
        badge.textContent = statusLabel;
        badge.style.background =
            activeTournament.status === "registration_open" ? "#05b905" :
            activeTournament.status === "ongoing"           ? "#2563eb" :
            activeTournament.status === "finished"          ? "#6b7280" : "#dc2626";
    }

    const title = document.getElementById("displayAdTitle");
    if (title) title.textContent = activeTournament.title;

    const seedingLabel =
        activeTournament.seeding_method === "winrate" ? "By Win Rate" :
        activeTournament.seeding_method === "random"  ? "Random Shuffle" :
        "By Level";

    const desc = document.getElementById("displayAdDesc");
    if (desc) desc.textContent =
        `${activeTournament.format === "single" ? "Single Elimination" : "Double Elimination"} · ` +
        `${seedingLabel} · ` +
        `₱${parseFloat(activeTournament.fee).toFixed(2)} entry fee`;

    const adSection = document.getElementById("adSection");
    if (adSection) adSection.style.display = "flex";

    renderRegControls();
}

// ── RENDER REGISTRATION CONTROLS ─────────────────────────────────
function renderRegControls() {
    hideAll(["notQualifiedUI", "wrongLevelUI", "eligibleUI", "registeredUI", "closedUI", "ongoingUI"]);

    const level       = currentPlayer?.player_level;
    const gamesPlayed = currentPlayer?.games_played ?? 0;
    const filter      = activeTournament?.level_filter || "all";
    const seeding     = activeTournament?.seeding_method;
    const status      = activeTournament?.status;

    if (status === "ongoing" || status === "finished") {
        const span = document.querySelector("#ongoingUI span");
        if (span) span.textContent = status === "finished"
            ? "Tournament has ended."
            : "Tournament is live! See the bracket below.";
        show("ongoingUI");
        return;
    }

    if (myRegistration) {
        showRegisteredUI(myRegistration.payment_status);
        return;
    }

    if (status !== "registration_open") {
        show("closedUI");
        return;
    }

    if (seeding === "random") {
        const msg = document.getElementById("eligibleMsg");
        if (msg) msg.textContent = `Open to all players — random seeding!`;
        show("eligibleUI");
        return;
    }

    if (seeding === "winrate") {
        if (gamesPlayed < 1) {
            const span = document.getElementById("notQualifiedUI")?.querySelector("span");
            if (span) span.textContent = "You need at least 1 recorded match to join a win rate tournament.";
            show("notQualifiedUI");
            return;
        }
        if (filter !== "all" && level !== filter) {
            const msg = document.getElementById("wrongLevelMsg");
            if (msg) msg.textContent =
                `This tournament is for ${filter} players only. Your current level is ${level}.`;
            show("wrongLevelUI");
            return;
        }
        const msg = document.getElementById("eligibleMsg");
        if (msg) msg.textContent = `You are eligible! Games played: ${gamesPlayed}`;
        show("eligibleUI");
        return;
    }

    if (!level || level === "Not Qualified") {
        const span = document.getElementById("notQualifiedUI")?.querySelector("span");
        if (span) span.textContent = "You need a player level to join this tournament.";
        show("notQualifiedUI");
        return;
    }

    if (filter !== "all" && level !== filter) {
        const msg = document.getElementById("wrongLevelMsg");
        if (msg) msg.textContent =
            `This tournament is for ${filter} players only. Your current level is ${level}.`;
        show("wrongLevelUI");
        return;
    }

    const msg = document.getElementById("eligibleMsg");
    if (msg) msg.textContent = `You are eligible to join! Your level: ${level}`;
    show("eligibleUI");
}

function showRegisteredUI(paymentStatus) {
    const box      = document.getElementById("registeredStatusBox");
    const withdraw = document.getElementById("withdrawBtn");

    const config = {
        pending:  { icon: "bx-time",          color: "#f59e0b", bg: "#fffbeb", border: "#fde68a", label: "Pending verification",    showWithdraw: true  },
        verified: { icon: "bxs-check-circle", color: "#05b905", bg: "#f0fdf4", border: "#bbf7d0", label: "Registration Verified ✓",          showWithdraw: false },
        rejected: { icon: "bxs-x-circle",     color: "#dc2626", bg: "#fef2f2", border: "#fecaca", label: "Payment Rejected — contact admin.", showWithdraw: false }
    }[paymentStatus] || {};

    if (box) {
        box.style.background = config.bg;
        box.style.border     = `1px solid ${config.border}`;
        box.innerHTML = `
            <i class='bx ${config.icon}' style="color:${config.color};font-size:1.2rem;"></i>
            <span id="registeredStatusText" style="color:${config.color};font-weight:600;">${config.label}</span>
        `;
    }

    if (withdraw) withdraw.style.display = config.showWithdraw ? "inline-block" : "none";

    show("registeredUI");
}

// ── BRACKET SECTION ───────────────────────────────────────────────
async function renderBracketSection() {
    const section   = document.getElementById("bracketSection");
    const container = document.getElementById("bracketDisplay");
    if (!section || !container) return;

    if (!activeTournament || activeTournament.status === "finished") {
        section.style.display = "none";
        stopClock();
        return;
    }

    if (activeTournament.status !== "ongoing") {
        section.style.display = "none";
        stopClock();
        return;
    }

    section.style.display = "block";
    await refreshBracketHTML();
}

// ── REFRESH BRACKET HTML ──────────────────────────────────────────
async function refreshBracketHTML() {
    if (bracketRefreshing) return;
    bracketRefreshing = true;

    try {
        const container = document.getElementById("bracketDisplay");
        if (!container || !activeTournament) return;

        const { data, error } = await supabase
            .from("tournaments")
            .select("bracket_html, start_time, winner_name, title")
            .eq("id", activeTournament.id)
            .single();

        if (error || !data?.bracket_html) {
            container.innerHTML = `
                <div class="empty-stream-placeholder">
                    <div class="placeholder-icon"><i class='bx bx-cloud-off'></i></div>
                    <h3>Bracket not available yet</h3>
                    <p>The admin hasn't published the bracket yet. Please check back shortly.</p>
                </div>`;
            return;
        }

        if (data.winner_name) {
            const tempDiv = document.createElement("div");
            tempDiv.innerHTML = data.bracket_html;
            tempDiv.querySelectorAll(".champion-card").forEach(el => el.style.display = "none");
            const cleanBracketHtml = tempDiv.innerHTML;

            container.innerHTML = `
                <div class="winner-announcement">
                    <div class="winner-trophy"><i class='bx bxs-trophy'></i></div>
                    <h2>Tournament Completed!</h2>
                    <p class="winner-label">🏆 Champion</p>
                    <h3 class="winner-name">${data.winner_name}</h3>
                </div>
                ${cleanBracketHtml}
            `;

            makeContainerReadOnly(container);
            const champNameEl = container.querySelector(".champion-name");
            if (champNameEl) champNameEl.textContent = data.winner_name;
            const champCard = container.querySelector(".champion-card");
            if (champCard) champCard.classList.add("active");

            const timer = document.getElementById("bracketTimer");
            if (timer) timer.style.display = "none";

            const alreadyNotified = activeTournament.winner_name === data.winner_name;
            if (!alreadyNotified) {
                showToast(`🏆 ${data.winner_name} is the Champion!`, "success");
                await showMyPlacementPopup(
                    activeTournament.id,
                    data.title || activeTournament.title,
                    data.winner_name
                );
            }

            activeTournament = { ...activeTournament, winner_name: data.winner_name, status: "finished" };
            const section = document.getElementById("bracketSection");
            if (section) section.style.display = "none";
            stopClock();
            return;
        }

        container.innerHTML = data.bracket_html;
        makeContainerReadOnly(container);

        const timer = document.getElementById("bracketTimer");
        if (timer) timer.style.display = "flex";

        if (data.start_time && parseInt(data.start_time) !== lastClockStart) {
            lastClockStart = parseInt(data.start_time);
            syncClock(lastClockStart);
        }

    } finally {
        setTimeout(() => { bracketRefreshing = false; }, 1000);
    }
}

// ── UPDATE CHAMPION CARD ──────────────────────────────────────────
function updateChampionCard(container, winnerName) {
    if (!winnerName) return;

    const nameEl = container.querySelector(".champion-name, .winner-display-name, #championName");
    if (nameEl) nameEl.textContent = winnerName;

    const championCard = container.querySelector(".champion-card, .champion-display, .trophy-section");
    if (championCard) {
        championCard.querySelectorAll("*").forEach(el => {
            if (el.children.length === 0 && el.textContent.trim() === "TBD") {
                el.textContent = winnerName;
            }
        });
    }
}

// ── HELPER: Make bracket container read-only ──────────────────────
function makeContainerReadOnly(container) {
    container.querySelectorAll("input").forEach(input => {
        input.readOnly            = true;
        input.style.pointerEvents = "none";
        input.style.color         = "#111827";
        input.style.opacity       = "1";
        input.style.background    = "#f9fafb";
    });
    container.querySelectorAll(
        ".btn-verify, .btn-reject, .btn-view-proof, .action-btns"
    ).forEach(el => el.remove());
}

// ── HELPERS ───────────────────────────────────────────────────────
function show(id)     { const el = document.getElementById(id); if (el) el.style.display = "block"; }
function hideAll(ids) { ids.forEach(id => { const el = document.getElementById(id); if (el) el.style.display = "none"; }); }

function handlePaymentMethodChange(method) {
    const ewalletSec = document.getElementById("ewalletSection");
    const cashSec = document.getElementById("cashSection");
    const ewalletLabel = document.getElementById("optEwalletLabel");
    const cashLabel = document.getElementById("optCashLabel");

    if (method === "Cash") {
        if (ewalletSec) ewalletSec.style.display = "none";
        if (cashSec) cashSec.style.display = "block";
        if (ewalletLabel) {
            ewalletLabel.style.border = "1.5px solid #e2e8f0";
            ewalletLabel.style.background = "#fff";
        }
        if (cashLabel) {
            cashLabel.style.border = "1.5px solid #05b905";
            cashLabel.style.background = "#f0fdf4";
        }
    } else {
        if (ewalletSec) ewalletSec.style.display = "block";
        if (cashSec) cashSec.style.display = "none";
        if (ewalletLabel) {
            ewalletLabel.style.border = "1.5px solid #05b905";
            ewalletLabel.style.background = "#f0fdf4";
        }
        if (cashLabel) {
            cashLabel.style.border = "1.5px solid #e2e8f0";
            cashLabel.style.background = "#fff";
        }
    }
}
window.handlePaymentMethodChange = handlePaymentMethodChange;

// ── LOAD DYNAMIC QR FROM DATABASE (Same as Court.js) ──────────────
async function loadTournamentQR() {
    const qrImg = document.getElementById("tournaQRImage");
    const qrFallback = document.getElementById("qrFallback");
    const qrInfo = document.getElementById("tournaQRAccountInfo");

    try {
        const { data, error } = await supabase
            .from("payment_qr_codes")
            .select("provider, account_name, qr_image_url")
            .eq("owner_role", "business_admin")
            .eq("is_active", true)
            .maybeSingle();

        if (error || !data || !data.qr_image_url) {
            if (qrImg) qrImg.style.display = "none";
            if (qrFallback) {
                qrFallback.style.display = "flex";
                qrFallback.querySelector("span").textContent = "QR not available";
            }
            if (qrInfo) qrInfo.textContent = "";
            return;
        }

        if (qrImg) {
            qrImg.src = data.qr_image_url;
            qrImg.style.display = "block";
        }
        if (qrFallback) qrFallback.style.display = "none";
        if (qrInfo) qrInfo.textContent = `${data.provider} • ${data.account_name}`;

    } catch (err) {
        console.error("Error loading QR code:", err);
        if (qrFallback) {
            qrFallback.style.display = "flex";
            qrFallback.querySelector("span").textContent = "QR not available";
        }
    }
}

// ── JOIN MODAL ────────────────────────────────────────────────────
    async function openJoinModal() {
    const feeLabel = document.getElementById("joinFeeLabel");
    if (feeLabel) feeLabel.textContent = `₱${parseFloat(activeTournament?.fee || 0).toFixed(2)}`;

    // Populate categories created by admin
    const catSelect = document.getElementById("regCategorySelect");
    if (catSelect) {
        catSelect.innerHTML = `<option value="">Select Category</option>`;
        const categories = activeTournament?.categories || [];
        categories.forEach(cat => {
            catSelect.innerHTML += `<option value="${cat}">${cat}</option>`;
        });
    }

    // Load Admin QR from Supabase table payment_qr_codes
    await loadTournamentQR();

    resetJoinForm();
    const modal = document.getElementById("joinModal");
    if (modal) modal.style.display = "flex";
}
window.openJoinModal = openJoinModal;

function handleCategorySelection(category) {
    const partnerField = document.getElementById("partnerFieldContainer");
    if (!partnerField) return;

    // Show partner input only if category contains 'Doubles'
    if (category && category.toLowerCase().includes("doubles")) {
        partnerField.style.display = "block";
    } else {
        partnerField.style.display = "none";
        const partnerInput = document.getElementById("regPartnerInput");
        if (partnerInput) partnerInput.value = "";
    }
}
window.handleCategorySelection = handleCategorySelection;

function closeJoinModal() {
    const modal = document.getElementById("joinModal");
    if (modal) modal.style.display = "none";
}
window.closeJoinModal = closeJoinModal;

function resetJoinForm() {
    const ref = document.getElementById("refInput");
    const ssInput = document.getElementById("ssInput");
    const ssPreview = document.getElementById("ssPreview");
    const prompt = document.getElementById("uploadPrompt");
    const status = document.getElementById("joinStatus");
    const submitBtn = document.getElementById("submitBtn");
    const partnerInput = document.getElementById("regPartnerInput");
    const contactInput = document.getElementById("regContactInput");
    const clubTeamInput = document.getElementById("regClubTeam");
    const catSelect = document.getElementById("regCategorySelect");
    const partnerField = document.getElementById("partnerFieldContainer");

    const ewalletRadio = document.querySelector('input[name="tournaPaymentMethod"][value="E-wallet"]');
    if (ewalletRadio) ewalletRadio.checked = true;
    handlePaymentMethodChange("E-wallet");

    if (ref) ref.value = "";
    if (partnerInput) partnerInput.value = "";
    if (contactInput) contactInput.value = "";
    if (clubTeamInput) clubTeamInput.value = "";
    if (catSelect) catSelect.value = "";
    if (partnerField) partnerField.style.display = "none";
    if (ssInput) ssInput.value = "";
    if (ssPreview) { ssPreview.src = ""; ssPreview.style.display = "none"; }
    if (prompt) prompt.style.display = "flex";
    if (status) status.style.display = "none";
    if (submitBtn) { submitBtn.disabled = false; submitBtn.innerHTML = "Confirm & Register"; }
}

function setupScreenshotPreview() {
    const ssInput = document.getElementById("ssInput");
    if (!ssInput) return;
    ssInput.addEventListener("change", (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (ev) => {
            const preview = document.getElementById("ssPreview");
            const prompt  = document.getElementById("uploadPrompt");
            if (preview) { preview.src = ev.target.result; preview.style.display = "block"; }
            if (prompt)  prompt.style.display = "none";
        };
        reader.readAsDataURL(file);
    });
}

function setupModalBackdrop() {
    document.getElementById("joinModal")?.addEventListener("click", (e) => {
        if (e.target === document.getElementById("joinModal")) closeJoinModal();
    });
}

window.submitJoin = async function () {
    const category = document.getElementById("regCategorySelect")?.value;
    const partnerName = document.getElementById("regPartnerInput")?.value.trim();
    const contactNumber = document.getElementById("regContactInput")?.value.trim();
    const yearsExperience = document.getElementById("regExperience")?.value;
    const clubTeam = document.getElementById("regClubTeam")?.value.trim() || "Independent";

    const paymentMethod = document.querySelector('input[name="tournaPaymentMethod"]:checked')?.value || "E-wallet";
    const refNumber = document.getElementById("refInput")?.value.trim();
    const file = document.getElementById("ssInput")?.files[0];
    const submitBtn = document.getElementById("submitBtn");

    if (!category) { setJoinStatus("Please select a tournament category.", "error"); return; }
    if (category.toLowerCase().includes("doubles") && !partnerName) {
        setJoinStatus("Please provide your doubles partner's full name.", "error");
        return;
    }
    if (!contactNumber) { setJoinStatus("Please enter your contact number.", "error"); return; }

    // If E-Wallet, enforce reference number and screenshot
    if (paymentMethod === "E-wallet") {
        if (!refNumber) { setJoinStatus("Please enter your online payment reference number.", "error"); return; }
        if (!file) { setJoinStatus("Please upload your payment screenshot.", "error"); return; }
    }

    if (!currentPlayer || !activeTournament) return;

    submitBtn.disabled = true;
    submitBtn.innerHTML = "<i class='bx bx-loader-alt bx-spin'></i> Submitting...";

    try {
        let screenshotUrl = null;

        // Upload screenshot ONLY if E-Wallet
        if (paymentMethod === "E-wallet" && file) {
            const ext = file.name.split(".").pop();
            const path = `payments/proof_${currentPlayer.id}_${Date.now()}.${ext}`;

            const { error: upErr } = await supabase.storage
                .from("payment-screenshots")
                .upload(path, file, { upsert: true });

            if (upErr) throw new Error("Screenshot upload failed: " + upErr.message);

            const { data: urlData } = supabase.storage
                .from("payment-screenshots")
                .getPublicUrl(path);

            screenshotUrl = urlData.publicUrl;
        }

        // Inserts directly into your existing table columns:
        const { error: insErr } = await supabase
            .from("tournament_registrations")
            .insert({
                tournament_id: activeTournament.id,
                player_id: currentPlayer.id,
                full_name: currentPlayer.full_name,
                level: currentPlayer.player_level,
                category: category,
                partner_name: partnerName || null,
                contact_number: contactNumber,
                years_experience: yearsExperience,
                club_team: clubTeam,
                reference_number: paymentMethod === "E-wallet" ? refNumber : "CASH (Over the Counter)",
                screenshot_url: screenshotUrl,
                payment_status: "pending",
                verified: false
            });

        if (insErr) {
            if (insErr.code === "23505") {
                setJoinStatus("You are already registered! Updating...", "success");
                await checkMyRegistration();
                renderRegControls();
                setTimeout(() => { closeJoinModal(); }, 1000);
                return;
            }
            throw new Error(insErr.message);
        }

        submitBtn.innerHTML = "<i class='bx bx-check'></i> Registered!";
        setJoinStatus(
            paymentMethod === "Cash"
                ? "Registered! Please settle your fee at the counter."
                : "Submitted! Waiting for admin verification.",
            "success"
        );

        await checkMyRegistration();

        setTimeout(() => {
            closeJoinModal();
            renderRegControls();
        }, 1200);

    } catch (err) {
        setJoinStatus(err.message, "error");
        submitBtn.disabled = false;
        submitBtn.innerHTML = "Confirm & Register";
    }
};

function setJoinStatus(msg, type) {
    const el = document.getElementById("joinStatus");
    if (!el) return;
    el.textContent = msg;
    el.className = `join-status ${type}`;
    el.style.display = "block";
}

// ── LOAD TOURNAMENT HISTORY ───────────────────────────────────────
async function loadTournamentHistory() {
    const body = document.getElementById("historyBody");
    const emptyMsg = document.getElementById("historyEmpty");
    if (!body) return;

    const { data, error } = await supabase
        .from("tournaments")
        .select("id, title, date, winner_name, format")
        .eq("status", "finished")
        .order("date", { ascending: false });

    if (error || !data || data.length === 0) {
        if (emptyMsg) emptyMsg.style.display = "block";
        body.innerHTML = "";
        return;
    }

    if (emptyMsg) emptyMsg.style.display = "none";

    body.innerHTML = data.map(t => `
        <tr>
            <td>
                <span class="history-date">${new Date(t.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>
            </td>
            <td>
                <span style="font-weight: 700; color: #1e293b;">${t.title}</span>
                <span class="history-format">${t.format === 'single' ? 'Single Elimination' : 'Double Elimination'}</span>
            </td>
            <td>
                <div class="winner-pill">
                    <i class='bx bxs-trophy'></i>
                    <span>${t.winner_name || "N/A"}</span>
                </div>
            </td>
            <td style="text-align: right;">
                <button class="btn-view-archive" onclick="viewArchivedBracket('${t.id}')">
                    <i class='bx bx-sitemap'></i> View Bracket
                </button>
            </td>
        </tr>
    `).join("");
}

// ── VIEW ARCHIVED BRACKET ──────────────────────────────────────────
window.viewArchivedBracket = async function(tournamentId) {
    const { data, error } = await supabase
        .from("tournaments")
        .select("title, bracket_html")
        .eq("id", tournamentId)
        .single();

    if (error || !data || !data.bracket_html) {
        showToast("Bracket data not found.", "error");
        return;
    }

    const modal = document.getElementById("archivedBracketModal");
    const titleEl = document.getElementById("archivedBracketTitle");
    const displayEl = document.getElementById("archivedBracketDisplay");

    titleEl.textContent = `Archive: ${data.title}`;
    displayEl.innerHTML = data.bracket_html;

    // Make it read-only
    displayEl.querySelectorAll("input").forEach(inp => {
        inp.readOnly = true;
        inp.disabled = true;
        if (inp.getAttribute('value')) inp.value = inp.getAttribute('value');
    });

    modal.style.display = "flex";
};

window.closeArchivedBracket = function() {
    document.getElementById("archivedBracketModal").style.display = "none";
};

// ── WITHDRAW REGISTRATION ─────────────────────────────────────────
window.withdrawRegistration = async function () {
    if (!myRegistration) return;

    if (myRegistration.payment_status === "verified") {
        showToast("Cannot withdraw — your payment is already verified. Contact the admin.", "error");
        return;
    }

    if (!confirm("Withdraw your registration? This cannot be undone.")) return;

    const withdrawBtn = document.getElementById("withdrawBtn");
    if (withdrawBtn) {
        withdrawBtn.disabled = true;
        withdrawBtn.textContent = "Withdrawing...";
    }

    try {
        // Delete using both registration id and player id
        const { data, error } = await supabase
            .from("tournament_registrations")
            .delete()
            .eq("id", myRegistration.id)
            .eq("player_id", currentPlayer.id)
            .select();

        if (error) throw error;

        // If data is empty, RLS blocked it
        if (!data || data.length === 0) {
            throw new Error("Withdrawal was blocked by database permissions. Make sure the RLS delete policy is added.");
        }

        // Successfully deleted
        myRegistration = null;
        showToast("Registration withdrawn successfully.", "default");

        // Immediately update UI
        renderRegControls();
        await checkMyRegistration();

    } catch (err) {
        console.error("Withdraw error:", err);
        showToast("Failed to withdraw: " + err.message, "error");
        if (withdrawBtn) {
            withdrawBtn.disabled = false;
            withdrawBtn.textContent = "Withdraw Registration";
        }
    }
};

// ── TIMER ─────────────────────────────────────────────────────────
function syncClock(startTime) {
    stopClock();
    const tick = () => {
        const diff = Date.now() - startTime;
        const h    = Math.floor(diff / 3600000).toString().padStart(2, "0");
        const m    = Math.floor((diff % 3600000) / 60000).toString().padStart(2, "0");
        const s    = Math.floor((diff % 60000) / 1000).toString().padStart(2, "0");
        const el   = document.getElementById("timerDisplay");
        if (el) el.textContent = `${h}:${m}:${s}`;
    };
    tick();
    clockInterval = setInterval(tick, 1000);
}

function stopClock() {
    if (clockInterval) {
        clearInterval(clockInterval);
        clockInterval = null;
    }
}

// ── TOAST ─────────────────────────────────────────────────────────
function showToast(message, type = "default") {
    const old = document.getElementById("tToast");
    if (old) old.remove();
    const t = document.createElement("div");
    t.id = "tToast";
    t.style.cssText = `
        position:fixed;bottom:24px;left:50%;transform:translateX(-50%);
        background:${type === "success" ? "#05b905" : type === "error" ? "#dc2626" : "#111827"};
        color:#fff;padding:12px 24px;border-radius:50px;
        box-shadow:0 10px 30px rgba(0,0,0,.25);z-index:99999;
        display:flex;align-items:center;gap:10px;font-size:.875rem;font-weight:500;`;
    t.innerHTML = `<i class='bx ${type === "success" ? "bx-check-circle" : "bx-x-circle"}'></i>${message}`;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 3000);
}

// ── CATEGORY BRACKET SWITCHER ─────────────────────────────────────
window.filterCategoryBracket = function (category, btn) {
    // Update active tab button style
    document.querySelectorAll(".cat-filter-btn").forEach(b => b.classList.remove("active"));
    if (btn) btn.classList.add("active");

    const wrappers = document.querySelectorAll(".category-bracket-wrapper");
    wrappers.forEach(wrapper => {
        if (category === "all" || wrapper.getAttribute("data-category") === category) {
            wrapper.style.display = "block";
        } else {
            wrapper.style.display = "none";
        }
    });
};