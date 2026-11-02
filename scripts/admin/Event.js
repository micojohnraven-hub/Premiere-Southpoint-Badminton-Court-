import { supabase } from "../supabase/supabaseClient.js";
import { recordMatchResult } from "./winrate.js";

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
const LEVEL_ORDER = { Advanced: 3, Intermediate: 2, Beginner: 1 };

const LEVEL_THEME = {
    Advanced: { tag: "ADVANCED" },
    Intermediate: { tag: "INTERMEDIATE" },
    Beginner: { tag: "BEGINNER" },
    "Not Qualified": { tag: "NOT QUALIFIED" },
    "Not Assessed": { tag: "NOT ASSESSED" },
};

const ASSESSED_LEVELS = ["Advanced", "Intermediate", "Beginner"];

// ── STATE ─────────────────────────────────────────────────────────
let activeTournament = null;
let participants = [];
let tournamentInterval;
let startTime;

const finalizingMatches = new Set();

let saveDebounceTimer = null;
let lastLocalSaveAt = 0;
const SAVE_DEBOUNCE_MS = 400;
const SELF_ECHO_WINDOW_MS = 2000;

// ── INIT ──────────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", async () => {
    await loadActiveTournament();
    renderHistory();
    setupEventListeners();
    setupRealtimeSync();
    setupPolling();
});

// ── PHYSICAL COURTS LOADER ────────────────────────────────────────
async function loadPhysicalCourts() {
    const { data: courts, error } = await supabase
        .from("courts")
        .select("id, name") 
        .eq("is_active", true) // Optional: only show active courts
        .order("name", { ascending: true });

    if (error) {
        console.error("Error fetching courts:", error);
        return;
    }

    const grid = document.getElementById("courtCheckboxGrid");
    const container = document.getElementById("courtSelectionContainer");
    if (!grid || !container) return;

    container.style.display = "block";
    grid.innerHTML = courts.map(c => `
        <label class="category-item" style="background:#f8fafc; padding:8px; border-radius:6px; border:1px solid #e2e8f0;">
            <input type="checkbox" name="selectedTournamentCourts" value="${c.name}">
            <span style="font-weight:600;">${c.name}</span>
        </label>
    `).join("");
}

// ── EVENT LISTENERS ───────────────────────────────────────────────
function setupEventListeners() {
    window.onclick = (e) => {
        if (e.target === document.getElementById("createModal")) closeModal();
        if (e.target === document.getElementById("confirmModal")) closeConfirm();
        if (e.target === document.getElementById("payProofModal")) closePayProofModal();
    };
}

// ── TAB CONTROL ───────────────────────────────────────────────────
window.openTab = function(evt, tabName) {
    document.querySelectorAll(".tab-content").forEach((c) => c.classList.remove("active"));
    document.querySelectorAll(".tab-link").forEach((l) => l.classList.remove("active"));
    document.getElementById(tabName).classList.add("active");
    evt.currentTarget.classList.add("active");

    if (tabName === "ParticipantsTab") {
        if (activeTournament) {
            loadParticipants();
        } else {
            const container = document.getElementById("participantsList");
            if (container) {
                container.innerHTML = `<div class="empty-state"><i class='bx bx-info-circle'></i><p>No active tournament. Create one first.</p></div>`;
            }
        }
    } else if (tabName === "BracketTab" && activeTournament) {
        loadTournamentBracket();
    }
}

// ── LOAD ACTIVE TOURNAMENT (Ensure UI sync) ────────────────────────
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

    if (activeTournament) {
        renderTournamentInfo();
        if (document.getElementById("BracketTab").classList.contains("active")) {
            await loadTournamentBracket();
        }
    }

    updateAdminUI(!!activeTournament);
}

function renderTournamentInfo() {
    const slot = document.getElementById("tournamentInfoSlot");
    if (!slot || !activeTournament) return;

    const statusLabel = {
        registration_open: "🟢 Registration Open",
        registration_closed: "🔴 Registration Closed",
        ongoing: "🏸 Ongoing",
        finished: "✅ Finished",
    }[activeTournament.status] || activeTournament.status;

    const seedingLabel = activeTournament.seeding_method === "winrate" ? "By Winrate" : 
                         activeTournament.seeding_method === "random" ? "Random Shuffle" : "By Level";

    const categoryList = activeTournament.categories ? activeTournament.categories.join(", ") : "None Selected";

    slot.innerHTML = `
        <div class="tournament-info-banner">
            <!-- Left Side: Text Details -->
            <div class="tinfo-main">
                <span class="tinfo-title">${activeTournament.title}</span>
                <span class="tinfo-meta">
                    <i class='bx bx-map'></i> ${activeTournament.venue || "No Venue Set"}
                    &nbsp;·&nbsp;
                    <i class='bx bx-calendar'></i> ${new Date(activeTournament.date).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                    &nbsp;·&nbsp;
                    <i class='bx bx-list-check'></i> ${categoryList}
                </span>
                <span class="tinfo-meta" style="margin-top:5px; display:block; opacity:0.8;">
                    <i class='bx bx-trophy'></i> ${activeTournament.format === "single" ? "Single Elimination" : "Double Elimination"}
                    &nbsp;·&nbsp;
                    <i class='bx bx-sort-alt-2'></i> ${seedingLabel}
                    &nbsp;·&nbsp;
                    <i class='bx bx-peso'></i> ₱${parseFloat(activeTournament.fee).toFixed(2)} fee
                </span>
            </div>

            <!-- Right Side: Timer and Status -->
            <div style="display: flex; align-items: center; gap: 10px; flex-shrink: 0;">
                <div id="timerSlot"></div> 
                <span class="tinfo-status">${statusLabel}</span>
            </div>
        </div>`;
}

// ── LOAD PARTICIPANTS ─────────────────────────────────────────────
async function loadParticipants() {
    const container = document.getElementById("participantsList");
    if (!container) return;

    if (!activeTournament) {
        container.innerHTML = `<div class="empty-state"><i class='bx bx-info-circle'></i><p>No active tournament. Create one first.</p></div>`;
        return;
    }

    container.innerHTML = `<div class="loading-state"><i class='bx bx-loader-alt bx-spin'></i> Loading participants...</div>`;

    const { data, error } = await supabase
        .from("tournament_registrations")
        .select("*, profiles(full_name, player_level, avatar_url)")
        .eq("tournament_id", activeTournament.id)
        .order("created_at", { ascending: true });

    if (error) {
        console.error("Supabase error:", error);
        container.innerHTML = `<div class="empty-state"><i class='bx bx-error'></i><p>Failed to load participants.</p><small>${error.message}</small></div>`;
        return;
    }

    participants = data || [];

    if (!data || data.length === 0) {
        container.innerHTML = `<div class="empty-state"><i class='bx bx-user-x'></i><p>No registrations yet.</p></div>`;
        return;
    }

    const getName = (r) => r.profiles?.full_name || r.full_name || "Unknown";
    const getLevel = (r) => r.profiles?.player_level || r.level || "Not Assessed";

    const total = data.length;
    const verified = data.filter((r) => r.verified).length;
    const pending = data.filter((r) => r.payment_status === "pending").length;
    const rejected = data.filter((r) => r.payment_status === "rejected").length;

    container.innerHTML = `
        <div class="participants-stats">
            <div class="pstat"><span class="pstat-num">${total}</span><span class="pstat-label">Total</span></div>
            <div class="pstat pstat-green"><span class="pstat-num">${verified}</span><span class="pstat-label">Verified</span></div>
            <div class="pstat pstat-yellow"><span class="pstat-num">${pending}</span><span class="pstat-label">Pending</span></div>
            <div class="pstat pstat-red"><span class="pstat-num">${rejected}</span><span class="pstat-label">Rejected</span></div>
        </div>
        <div class="participants-table-wrapper">
            <table class="participants-table">
                <thead>
                    <tr>
                        <th>#</th>
                        <th>Player / Partner</th>
                        <th>Category</th>
                        <th>Experience & Club</th>
                        <th>Level</th>
                        <th>Ref & Contact</th>
                        <th>Payment</th>
                        <th>Actions</th>
                    </tr>
                </thead>
                <tbody>
                    ${data
                        .map((r, i) => {
                            const name = getName(r);
                            const level = getLevel(r);
                            const initial = name[0].toUpperCase();
                            const statusClass =
                                r.payment_status === "verified"
                                    ? "status-verified"
                                    : r.payment_status === "rejected"
                                    ? "status-rejected"
                                    : "status-pending";
                            const statusIcon =
                                r.payment_status === "verified"
                                    ? "bx-check-circle"
                                    : r.payment_status === "rejected"
                                    ? "bx-x-circle"
                                    : "bx-time";
                            return `
                        <tr class="${r.verified ? "" : "row-unverified"}">
                            <td>${i + 1}</td>
                            <td>
                                <div class="p-cell">
                                    <div class="p-avatar">${initial}</div>
                                    <div>
                                        <span style="font-weight:600; color:#111827;">${name}</span>
                                        ${r.partner_name ? `<div style="font-size:11px; color:#64748b;"><i class='bx bx-user-plus'></i> Partner: <b>${r.partner_name}</b></div>` : ''}
                                    </div>
                                </div>
                            </td>
                            <td>
                                <span style="font-weight:600; font-size:11px; color:#2563eb; background:#eff6ff; padding:3px 8px; border-radius:4px; border:1px solid #dbeafe;">
                                    ${r.category || 'General'}
                                </span>
                            </td>
                            <td>
                                <div style="font-size:12px; font-weight:600; color:#334155;">${r.club_team || 'Independent'}</div>
                                <small style="font-size:11px; color:#64748b;">${r.years_experience || '—'}</small>
                            </td>
                            <td><span class="lvl-badge-table lvl-${level.toLowerCase().replace(" ", "-")}">${level}</span></td>
                            <td>
                                <div class="ref-num">${r.reference_number || "—"}</div>
                                <div style="font-size:11px; color:#64748b;">${r.contact_number || "—"}</div>
                            </td>
                            <td><span class="pay-status ${statusClass}"><i class='bx ${statusIcon}'></i> ${r.payment_status}</span></td>
                            <td>
                                <div class="action-btns">
                                    ${
                                        r.screenshot_url
                                            ? `<button class="btn-view-proof" onclick="viewPayProof('${encodeURIComponent(r.screenshot_url)}')"><i class='bx bx-image'></i> Proof</button>`
                                            : '<span class="no-proof">No proof</span>'
                                    }
                                    ${
                                        r.payment_status === "pending"
                                            ? `
                                        <button class="btn-verify" onclick="openVerifyPaymentModal('${r.id}', '${name}', '${r.reference_number || ""}')">
                                            <i class='bx bx-check'></i>
                                        </button>                                        
                                        <button class="btn-reject" onclick="verifyPayment('${r.id}', false)">
                                            <i class='bx bx-x'></i>
                                        </button>
                                        `
                                            : ""
                                    }
                                </div>
                            </td>
                        </tr>`;
                        })
                        .join("")}
                </tbody>
            </table>
        </div>`;
    
    window.calculateCourtNeeds();
}

// ── VERIFY PAYMENT ────────────────────────────────────────────────
window.verifyPayment = async function (regId, approve) {
    const { error } = await supabase
        .from("tournament_registrations")
        .update({
            payment_status: approve ? "verified" : "rejected",
            verified: approve,
        })
        .eq("id", regId);

    if (error) {
        showToast("Failed to update: " + error.message, "error");
    } else {
        showToast(approve ? "✅ Payment verified!" : "❌ Payment rejected.", approve ? "success" : "error");
        loadParticipants();
    }
};

// ── VIEW PAYMENT PROOF ────────────────────────────────────────────
window.viewPayProof = function (url) {
    const decodedUrl = decodeURIComponent(url);
    const modal = document.getElementById("payProofModal");
    const img = document.getElementById("payProofImg");
    if (!modal || !img) return;
    img.src = decodedUrl;
    modal.style.display = "flex";
};

window.closePayProofModal = function() {
    const modal = document.getElementById("payProofModal");
    if (modal) modal.style.display = "none";
}

// ── TOURNAMENT MODAL CONTROL ─────────────────────────────────────
function openModal() {
    // 1. Existing logic: Check if a tournament is already active
    if (activeTournament && activeTournament.status !== 'finished') {
        window.showToast("Finish or delete the current tournament first.", "error");
        return;
    }

    // --- CALENDAR FIX ---
    const dateInput = document.getElementById("tournamentDate");
    if (dateInput) {
        const today = new Date();
        const year = today.getFullYear();
        const month = String(today.getMonth() + 1).padStart(2, '0');
        const day = String(today.getDate()).padStart(2, '0');
        const minDate = `${year}-${month}-${day}`;
        dateInput.setAttribute("min", minDate);
        dateInput.value = "";
    }

    // Reset other fields
    const title = document.getElementById("tournamentTitle");
    const venue = document.getElementById("tournamentVenue");
    if(title) title.value = "";
    if(venue) venue.value = "";
    
    document.querySelectorAll('input[name="tournamentCategory"]').forEach(cb => cb.checked = false);
    
    // Show the modal
    document.getElementById("createModal").style.display = "flex";
}

// THIS WAS MISSING:
function closeModal() {
    const modal = document.getElementById("createModal");
    if (modal) modal.style.display = "none";
}

let pendingVerifyId = null;

window.openVerifyPaymentModal = function(regId, playerName, refNum) {
    pendingVerifyId = regId;
    const modal = document.getElementById("verifyPaymentModal");
    document.getElementById("vPlayerName").textContent = playerName;
    document.getElementById("vRefNum").textContent = refNum || "No Reference Provided";
    
    modal.style.display = "flex";

    // Set the click action for the confirmation button
    document.getElementById("confirmVerifyBtn").onclick = async () => {
        await verifyPayment(pendingVerifyId, true);
        closeVerifyPaymentModal();
    };
};

window.closeVerifyPaymentModal = function() {
    document.getElementById("verifyPaymentModal").style.display = "none";
    pendingVerifyId = null;
};

// ── CREATE TOURNAMENT ACTION ─────────────────────────────────────
window.createTournament = async function() {
    const title = document.getElementById("tournamentTitle")?.value.trim();
    const venue = document.getElementById("tournamentVenue")?.value.trim();
    const date = document.getElementById("tournamentDate")?.value;
    const format = document.getElementById("tournamentType")?.value;
    const seedingMethod = document.getElementById("seedingMethod")?.value || "level";
    const fee = parseFloat(document.getElementById("tournamentFee")?.value) || 0;

    const categoryEls = document.querySelectorAll('input[name="tournamentCategory"]:checked');
    const categories = Array.from(categoryEls).map(el => el.value);

    if (!title || !date || !format || !venue || categories.length === 0) {
        window.showToast("Please fill in all required fields and select at least one category.", "error");
        return;
    }

    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;

    const { data, error } = await supabase
        .from("tournaments")
        .insert({
            title, venue, categories, date, format,
            seeding_method: seedingMethod,
            fee, status: "registration_open",
            created_by: session.user.id,
        })
        .select().single();

    if (error) {
        window.showToast("Failed: " + error.message, "error");
    } else {
        activeTournament = data;
        window.showToast("🏆 Tournament created!", "success");
        window.closeModal();
        await loadActiveTournament();
    }
};

// Add this helper function
function nextPowerOf2(n) {
    if (n <= 0) return 1;
    let p = 1;
    while (p < n) p <<= 1;
    return p;
}

// ── GENERATE SEPARATE BRACKETS PER CATEGORY & LEVEL ──────────────
window.generateBracket = async function () {
    if (!activeTournament) {
        showToast("Create a tournament first.", "error");
        return;
    }

    const selectedCourtEls = document.querySelectorAll('input[name="selectedTournamentCourts"]:checked');
    const selectedCourts = Array.from(selectedCourtEls).map(el => el.value);

    // 1. Fetch Verified Participants
    const { data, error } = await supabase
        .from("tournament_registrations")
        .select("*, profiles(full_name, player_level, winrate)")
        .eq("tournament_id", activeTournament.id)
        .eq("verified", true)
        .eq("payment_status", "verified");

    if (error || !data || data.length < 2) {
        showToast("Need at least 2 verified participants to generate brackets.", "error");
        return;
    }

    // Helper to normalize level names
    const getNormalizedLevel = (r) => {
        const raw = (r.profiles?.player_level || r.level || "Beginner").trim();
        const lower = raw.toLowerCase();
        if (lower.includes("adv")) return "Advanced";
        if (lower.includes("inter")) return "Intermediate";
        if (lower.includes("beg")) return "Beginner";
        return raw.charAt(0).toUpperCase() + raw.slice(1);
    };

    // 2. Determine Categories
    const categories = activeTournament.categories && activeTournament.categories.length > 0
        ? activeTournament.categories
        : [...new Set(data.map(p => p.category || "Open Singles"))];

    const LEVEL_ORDER = ["Advanced", "Intermediate", "Beginner"];

    // 3. Group by BOTH Category AND Level
    const validDivisionGroups = {};
    const unformedDivisions = [];

    for (const cat of categories) {
        const catPlayers = data.filter(r => (r.category || "").trim().toLowerCase() === cat.trim().toLowerCase());
        
        // Find all levels present in this category
        const presentLevels = [...new Set(catPlayers.map(p => getNormalizedLevel(p)))];
        
        // Sort levels: Advanced -> Intermediate -> Beginner
        presentLevels.sort((a, b) => {
            const idxA = LEVEL_ORDER.indexOf(a);
            const idxB = LEVEL_ORDER.indexOf(b);
            return (idxA === -1 ? 99 : idxA) - (idxB === -1 ? 99 : idxB);
        });

        for (const lvl of presentLevels) {
            const levelPlayers = catPlayers.filter(p => getNormalizedLevel(p) === lvl);
            const divisionKey = `${cat} (${lvl})`;

            if (levelPlayers.length >= 2) {
                validDivisionGroups[divisionKey] = {
                    category: cat,
                    level: lvl,
                    players: levelPlayers
                };
            } else {
                unformedDivisions.push(`${cat} [${lvl}] (${levelPlayers.length} entry)`);
            }
        }
    }

    if (Object.keys(validDivisionGroups).length === 0) {
        showToast("Need at least 2 verified participants within the same level to create a bracket.", "error");
        return;
    }

    if (unformedDivisions.length > 0) {
        showToast(`Note: ${unformedDivisions.join(", ")} requires at least 2 entries.`, "default");
    }

    // Lock Selected Courts if any
    if (selectedCourts.length > 0) {
        await supabase
            .from("courts")
            .update({ is_active: false, closed_reason: "Tournament in Progress" })
            .in("name", selectedCourts);
        localStorage.setItem(`active_courts_${activeTournament.id}`, JSON.stringify(selectedCourts));
    }

    // 4. Build Category & Level Filter Navigation
    const container = document.getElementById("bracketDisplay");
    container.innerHTML = "";

    const navDiv = document.createElement("div");
    navDiv.className = "category-filter-nav";
    navDiv.innerHTML = `<button class="cat-filter-btn active" onclick="filterCategoryBracket('all', this)"><i class='bx bx-grid-alt'></i> All Divisions</button>`;

    Object.keys(validDivisionGroups).forEach(divKey => {
        const group = validDivisionGroups[divKey];
        const count = group.players.length;
        navDiv.innerHTML += `
            <button class="cat-filter-btn" data-category="${divKey}" onclick="filterCategoryBracket(this.getAttribute('data-category'), this)">
                <i class='bx bx-trophy'></i> ${divKey} (${count})
            </button>
        `;
    });
    container.appendChild(navDiv);

    // 5. Generate Brackets for Each Category + Level Division
    const seedingMethod = activeTournament.seeding_method || "level";
    const courtTracker = { index: 0 };

    Object.keys(validDivisionGroups).forEach((divKey) => {
        const group = validDivisionGroups[divKey];
        const rawList = group.players;
        const cat = group.category;
        const lvl = group.level;
        const isDoubles = cat.toLowerCase().includes("doubles");

        // Format Singles vs Doubles contestants
        let contestants = rawList.map(r => {
            const primaryName = r.profiles?.full_name || r.full_name || "Unknown";
            const teamName = isDoubles 
                ? `${primaryName} / ${r.partner_name || "TBD"}`
                : primaryName;

            return {
                name: teamName,
                level: lvl,
                winrate: r.profiles?.winrate || 0,
                isDoubles: isDoubles
            };
        });

        // Seeding inside this specific level
        if (seedingMethod === "winrate") {
            contestants.sort((a, b) => (b.winrate || 0) - (a.winrate || 0));
        } else if (seedingMethod === "random") {
            contestants.sort(() => Math.random() - 0.5);
        }

        // Bracket Sizing with BYE padding
        const bracketSize = nextPowerOf2(contestants.length);
        while (contestants.length < bracketSize) {
            contestants.push({ name: "BYE", isBye: true, level: null });
        }

        // Create Container Card for this Category + Level
        const catWrapper = document.createElement("div");
        catWrapper.className = "category-bracket-wrapper";
        catWrapper.setAttribute("data-category", divKey);

        const lvlClass = lvl.toLowerCase().replace(/\s+/g, "-");

        catWrapper.innerHTML = `
            <div class="category-bracket-header">
                <div class="category-bracket-title">
                    <i class='bx ${isDoubles ? "bx-group" : "bx-user"}'></i> 
                    <span>${cat}</span>
                    <span class="lvl-badge-table lvl-${lvlClass}" style="margin-left: 8px;">${lvl.toUpperCase()} DIVISION</span>
                    <span style="font-size:12px; font-weight:600; color:#64748b; background:#f1f5f9; padding:2px 8px; border-radius:50px; margin-left: 8px;">
                        ${rawList.length} ${isDoubles ? "Pairs" : "Players"}
                    </span>
                </div>
            </div>
            <div class="cat-bracket-content"></div>
        `;

        const bracketContentSlot = catWrapper.querySelector(".cat-bracket-content");

        if (activeTournament.format === "single") {
            renderSingleElimination(bracketContentSlot, bracketSize, contestants, false, selectedCourts, courtTracker);
        } else {
            renderDoubleElimination(bracketContentSlot, bracketSize, contestants, selectedCourts, courtTracker);
        }

        container.appendChild(catWrapper);
    });

    // 6. Update Tournament State & Start Time
    startTime = Date.now();
    await supabase.from("tournaments").update({
        status: "ongoing",
        start_time: startTime
    }).eq("id", activeTournament.id);

    startTimer(startTime);
    activeTournament.status = "ongoing";
    renderTournamentInfo();
    updateAdminUI(true);
    await saveTournament();

    showToast("🏆 Skill-based division brackets generated!", "success");
};

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

// ── Ad Creator ───────────────────────────────────────────────
document.getElementById("adImage")?.addEventListener("change", e => {
    const file = e.target.files[0];
    if (!file) return;

    const preview = document.getElementById("adImagePreview");
    const thumb = document.getElementById("adImageThumb");

    thumb.src = URL.createObjectURL(file);
    preview.style.display = "block";
});

window.publishAnnouncement = async function() {
    const title = document.getElementById("adTitle")?.value.trim();
    const message = document.getElementById("adDesc")?.value.trim();
    const fileInput = document.getElementById("adImage");
    const file = fileInput?.files[0];
    const btn = document.querySelector(".btn-save");

    if (!title || !message) {
        showToast("Please fill in both the headline and message.", "error");
        return;
    }

    const { data: { session } } = await supabase.auth.getSession();

    if (!session) {
        showToast("Your session has expired. Please log in again.", "error");
        return;
    }

    btn.disabled = true;
    btn.innerHTML = "<i class='bx bx-loader-alt bx-spin'></i> Publishing...";

    let imageUrl = null;

    if (file) {
        const ext = file.name.split(".").pop();
        const fileName = `tournament_${Date.now()}.${ext}`;

        const { error: uploadError } = await supabase.storage
            .from("announcement-banners")
            .upload(fileName, file, { upsert: true });

        if (uploadError) {
            showToast("Image upload failed: " + uploadError.message, "error");
            btn.disabled = false;
            btn.innerHTML = "<i class='bx bx-paper-plane'></i> Publish";
            return;
        }

        const { data: urlData } = supabase.storage
            .from("announcement-banners")
            .getPublicUrl(fileName);

        imageUrl = urlData.publicUrl;
    }

    const { error } = await supabase
        .from("announcements")
        .insert({
            title,
            message,
            image_url: imageUrl,
            category: "Tournament",
            audience: "players",
            is_active: true
        });

    if (error) {
        showToast("Failed to publish: " + error.message, "error");
    } else {
        document.getElementById("adTitle").value = "";
        document.getElementById("adDesc").value = "";
        fileInput.value = "";
        document.getElementById("adImagePreview").style.display = "none";
        document.getElementById("adImageThumb").src = "";

        showToast("Tournament announcement published!", "success");
    }

    btn.disabled = false;
    btn.innerHTML = "<i class='bx bx-paper-plane'></i> Publish";
};

// ── MODAL & CONFIRM ───────────────────────────────────────────────
window.openConfirm = function(title, msg, btnText, btnColor, actionFn) {
    const modal = document.getElementById("confirmModal");
    document.getElementById("confirmTitle").innerHTML = title;
    document.getElementById("confirmMessage").innerHTML = msg;
    const btn = document.getElementById("confirmBtn");
    btn.innerText = btnText;
    btn.style.background = btnColor;
    btn.onclick = () => {
        actionFn();
        closeConfirm();
    };
    modal.style.display = "flex";
}

window.closeConfirm = function() {
    document.getElementById("confirmModal").style.display = "none";
}

// ── TIMER ─────────────────────────────────────────────────────────
function startTimer(existingStartTime = null) {
    startTime = existingStartTime || Date.now();
    localStorage.setItem("tournament_start_time", startTime);

    if (activeTournament?.id) {
        supabase.from("tournaments").update({ start_time: startTime }).eq("id", activeTournament.id);
    }

    if (tournamentInterval) clearInterval(tournamentInterval);
    tournamentInterval = setInterval(() => {
        const diff = Date.now() - startTime;
        const h = Math.floor(diff / 3600000).toString().padStart(2, "0");
        const m = Math.floor((diff % 3600000) / 60000).toString().padStart(2, "0");
        const s = Math.floor((diff % 60000) / 1000).toString().padStart(2, "0");
        const slot = document.getElementById("timerSlot");
        if (slot)
            slot.innerHTML = `
            <div class="tournament-timer">
                <i class='bx bx-stopwatch'></i>
                <span id="currentTimeDisplay">${h}:${m}:${s}</span>
            </div>`;
    }, 1000);
}

function stopTimer() {
    clearInterval(tournamentInterval);
    localStorage.removeItem("tournament_start_time");
    const slot = document.getElementById("timerSlot");
    if (slot) slot.innerHTML = "";
}

// ── SCORING (Best of 3) ───────────────────────────────────────────
function getSetResult(s1, s2) {
    if (s1 === 0 && s2 === 0) return { finished: false };
    if (s1 >= 30 || s2 >= 30) return { finished: true, winnerIdx: s1 > s2 ? 0 : 1 };
    if ((s1 >= 21 || s2 >= 21) && Math.abs(s1 - s2) >= 2)
        return { finished: true, winnerIdx: s1 > s2 ? 0 : 1 };
    if (s1 >= 20 && s2 >= 20 && Math.abs(s1 - s2) < 2) return { finished: false, isDeuce: true };
    return { finished: false };
}

function handleScoreInput(input) {
    const card = input.closest(".match-card");
    const inputs = card.querySelectorAll(".score-input");
    const rows = card.querySelectorAll(".player-row");
    const alert = document.getElementById("conflictAlert");

    let p1Wins = 0, p2Wins = 0, anyDeuce = false;

    for (let s = 0; s < 3; s++) {
        let v1 = Math.max(0, Math.min(30, parseInt(inputs[s].value) || 0));
        let v2 = Math.max(0, Math.min(30, parseInt(inputs[s + 3].value) || 0));
        if (inputs[s].value !== "") inputs[s].value = v1;
        if (inputs[s + 3].value !== "") inputs[s + 3].value = v2;

        const res = getSetResult(v1, v2);
        if (res.isDeuce) anyDeuce = true;
        if (res.finished) {
            res.winnerIdx === 0 ? p1Wins++ : p2Wins++;
            if (s < 2 && p1Wins < 2 && p2Wins < 2) {
                inputs[s + 1].disabled = inputs[s + 4].disabled = false;
            }
        } else {
            for (let next = s + 1; next < 3; next++) {
                inputs[next].disabled = inputs[next + 3].disabled = true;
                inputs[next].value = inputs[next + 3].value = "";
            }
            break;
        }
    }

    if (alert) alert.style.display = anyDeuce ? "flex" : "none";
    card.classList.toggle("error", anyDeuce);

    if (p1Wins === 2 || p2Wins === 2) {
        const winnerIdx = p1Wins === 2 ? 0 : 1;
        rows.forEach((r) => r.classList.remove("winner"));
        rows[winnerIdx].classList.add("winner");
        finalizeMatch(card, winnerIdx);
    } else {
        if (!card.classList.contains("match-finished")) {
            rows.forEach((r) => r.classList.remove("winner"));
        }
    }

    if (saveDebounceTimer) clearTimeout(saveDebounceTimer);
    saveDebounceTimer = setTimeout(() => saveTournament(), SAVE_DEBOUNCE_MS);
}

async function finalizeMatch(card, winnerIdx) {

    const roundEl = card.closest(".round");
    const allMatchesInRound = Array.from(roundEl.querySelectorAll(".match-card"));
    const matchRealIndex = allMatchesInRound.indexOf(card);
    
    const cardId = `${roundEl.querySelector('.round-title')?.textContent || 'R'}_${matchRealIndex}`;

    if (finalizingMatches.has(cardId)) return;
    if (card.classList.contains("match-finished")) return;

    finalizingMatches.add(cardId);
    card.classList.add("match-finished");
    
    
    card.querySelectorAll(".score-input").forEach((i) => (i.disabled = true));

    const rows = card.querySelectorAll(".player-row");
    const winnerName = rows[winnerIdx].querySelector(".player-name").textContent.trim();
    const loserName = rows[winnerIdx === 0 ? 1 : 0].querySelector(".player-name").textContent.trim();

    if (winnerName.includes(" / ")) {
        const [w1, w2] = winnerName.split(" / ").map(s => s.trim());
        const [l1, l2] = loserName.split(" / ").map(s => s.trim());
        if (w1 && l1) await recordMatchResult(w1, l1, activeTournament.id);
        if (w2 && l2) await recordMatchResult(w2, l2, activeTournament.id);
    } else {
        await recordMatchResult(winnerName, loserName, activeTournament.id);
    }

    const type = activeTournament?.format || "single";
    advancePlayers(card, winnerName, loserName, type);

    setTimeout(() => finalizingMatches.delete(cardId), 1000);
}

// ── ADVANCEMENT LOGIC (SCOPED BY DIVISION) ────────────────────────
function advancePlayers(card, winner, loser, type) {
    const section = card.closest(".bracket-section");
    if (!section) return;

    // IMPORTANT: Confine routing to THIS specific category & level bracket
    const catWrapper = card.closest(".category-bracket-wrapper") || document;

    const isWB = section.classList.contains("winners-bracket-section");
    const isLB = section.classList.contains("losers-bracket-section");
    const isGrandFinal = card.classList.contains("grand-final-match") || card.id === "grandFinalMatch";
    const isResetMatch = card.classList.contains("reset-match") || card.id === "resetMatch";

    const rounds = Array.from(section.querySelectorAll(".round"));
    const currentRound = card.closest(".round");
    const roundIdx = rounds.indexOf(currentRound);
    
    const matchesInRound = Array.from(currentRound.querySelectorAll(".match-card"));
    const matchIdxInRound = matchesInRound.indexOf(card);

    // ── 1. FINISH / GRAND FINAL LOGIC ──
    if (type === "double") {
        if (isResetMatch) {
            window.declareChampion(winner, card);
            return;
        }
        if (isGrandFinal) {
            const winnerRow = card.querySelectorAll(".player-row")[0];
            const isWBWinnerWon = winnerRow.classList.contains("winner");
            
            if (isWBWinnerWon) {
                // Winners Bracket finalist won the first game -> Division Over
                window.declareChampion(winner, card);
            } else {
                // Losers Bracket finalist won -> Trigger Bracket Reset inside this division
                handleBracketReset(winner, loser, catWrapper);
            }
            return;
        }
    } else if (type === "single" && roundIdx === rounds.length - 1) {
        window.declareChampion(winner, card);
        return;
    }

    // ── 2. ADVANCE WINNER WITHIN SAME SECTION ──
    if (roundIdx !== -1 && roundIdx < rounds.length - 1) {
        const nextRound = rounds[roundIdx + 1];
        const targetMatches = Array.from(nextRound.querySelectorAll(".match-card"));

        if (isLB) {
            // LB routing
            if (roundIdx % 2 === 0) { 
                updateSlot(targetMatches[matchIdxInRound]?.querySelectorAll(".player-row")[0], winner, false);
            } else { 
                updateSlot(targetMatches[Math.floor(matchIdxInRound / 2)]?.querySelectorAll(".player-row")[matchIdxInRound % 2], winner, false);
            }
        } else {
            // WB routing
            const targetMatch = targetMatches[Math.floor(matchIdxInRound / 2)];
            updateSlot(targetMatch?.querySelectorAll(".player-row")[matchIdxInRound % 2], winner, false);
        }
    }

    // ── 3. DROP LOSER (Winners -> Losers of THIS Division) ──
    if (type === "double" && isWB) {
        const lbSection = catWrapper.querySelector(".losers-bracket-section");
        const lbRounds = lbSection ? Array.from(lbSection.querySelectorAll(".round")) : [];
        const gf = catWrapper.querySelector(".grand-final-match");

        if (lbRounds.length === 0) {
            // 2-team division: Round 1 loser drops straight into Grand Final (bottom slot)
            if (gf) updateSlot(gf.querySelectorAll(".player-row")[1], loser, true);
        } else if (roundIdx === rounds.length - 1) {
            // WB Finalist drops to the very last LB Round (LB Final)
            const targetMatch = lbRounds[lbRounds.length - 1]?.querySelectorAll(".match-card")[0];
            if (targetMatch) {
                updateSlot(targetMatch.querySelectorAll(".player-row")[1], loser, true);
            }
        } else {
            // Mapping for early rounds
            const targetRoundIdx = roundIdx * 2;
            const targetMatchIdx = Math.floor(matchIdxInRound / 2);
            const targetSlotIdx = matchIdxInRound % 2;

            const targetMatch = lbRounds[targetRoundIdx]?.querySelectorAll(".match-card")[targetMatchIdx];
            if (targetMatch) {
                updateSlot(targetMatch.querySelectorAll(".player-row")[targetSlotIdx], loser, true);
            }
        }
    }

    // ── 4. ROUTE TO GRAND FINAL (Winners/Losers Finalists of THIS Division) ──
    if (type === "double") {
        const gf = catWrapper.querySelector(".grand-final-match");
        if (gf && roundIdx === rounds.length - 1) {
            if (isWB) updateSlot(gf.querySelectorAll(".player-row")[0], winner, false);
            if (isLB) updateSlot(gf.querySelectorAll(".player-row")[1], winner, false);
        }
    }
}

// ── UPDATE SLOT ───────────────────────────────────────────────────
function updateSlot(row, name, isFromLosers = false) {
    if (!row || !name) return;
    const nameEl = row.querySelector(".player-name");
    const iconEl = row.querySelector(".player-icon");
    const detailsEl = row.querySelector(".player-details");

    // Clean name for lookup (remove any status tags)
    const cleanName = name.replace(/\s\(L\)$/i, "")
                          .replace(" (Winners)", "")
                          .replace(" (Loser)", "")
                          .replace(" (Losers)", "")
                          .trim();

    // Use case-insensitive find to prevent players from "disappearing" due to typing errors
    const playerObj = participants.find((p) => {
        const pName = (p.profiles?.full_name || p.full_name || "").trim();
        return pName.toLowerCase() === cleanName.toLowerCase();
    });
    
    const level = playerObj?.profiles?.player_level || playerObj?.level || null;
    
    // Set UI Display
    nameEl.textContent = isFromLosers ? `${cleanName} (L)` : cleanName;
    nameEl.style.color = "#111827";
    nameEl.classList.remove("tbd");

    iconEl.textContent = cleanName[0]?.toUpperCase() || "?";
    iconEl.classList.remove("tbd");
    iconEl.style.background = "rgb(5, 185, 5)";
    iconEl.style.color = "#ffffff";

    // Clean old meta tags before adding new ones
    const oldMeta = detailsEl.querySelector(".player-meta-row");
    if (oldMeta) oldMeta.remove();
    
    if (level && LEVEL_THEME[level]) {
        const metaRow = document.createElement("div");
        metaRow.className = "player-meta-row";
        metaRow.style.cssText = "display:flex; align-items:center; margin-top:2px;";
        metaRow.innerHTML = `
            <span class="lvl-badge" style="color:#111827;font-weight:600;font-size:0.6rem;border:1px solid #9ca3af;border-radius:3px;padding:0 3px;margin-right:5px;">${LEVEL_THEME[level].tag}</span>
            <span class="player-meta" style="font-size:0.65rem;color:#707070;">${isFromLosers ? "From Losers" : "Advanced"}</span>`;
        detailsEl.appendChild(metaRow);
    }

    // Auto-unlock inputs if match is ready
    const card = row.closest(".match-card");
    const rows = card.querySelectorAll(".player-row");
    const name1 = rows[0].querySelector(".player-name").textContent;
    const name2 = rows[1].querySelector(".player-name").textContent;
    
    const isTBD = (n) => !n || n.includes("TBD") || n === "—";
    if (!isTBD(name1) && !isTBD(name2)) {
        const inputs = card.querySelectorAll(".score-input");
        if (inputs[0]) inputs[0].disabled = false;
        if (inputs[3]) inputs[3].disabled = false;
    }
    
    saveTournament();
}

function handleBracketReset(lbWinner, wbLoser, catWrapper = null) {
    const scope = catWrapper || document;
    if (scope.querySelector(".reset-match")) return;
    
    const gfSection = scope.querySelector(".grand-final-section");
    if (!gfSection) return;
    const container = gfSection.querySelector(".gf-match-container");
    if (!container) return;
    
    // Create the reset match
    const resetWrapper = createMatch(wbLoser, lbWinner, 99);
    const resetCard = resetWrapper.querySelector(".match-card");
    resetCard.classList.add("reset-match");
    resetCard.style.border = "2px solid #ef4444";
    resetCard.querySelector(".match-label").innerHTML = "<i class='bx bx-refresh'></i> Final Reset (Deciding Match)";
    
    // Update labels to show one life is gone
    updateSlot(resetCard.querySelectorAll(".player-row")[0], wbLoser, true); 
    updateSlot(resetCard.querySelectorAll(".player-row")[1], lbWinner, false);

    container.appendChild(resetWrapper);
    resetCard.scrollIntoView({ behavior: "smooth" });
    saveTournament();
    window.showToast("Bracket Reset! Final match required.", "default");
}

// ── DECLARE CHAMPION & AUTO-ARCHIVE ───────────────────────────────
window.declareChampion = function (name, card = null) {
    const cleanName = name.replace(/\s\(L\)$/, "").replace(" (Winners)", "").replace(" (Loser)", "").replace(" (Losers)", "").trim();
    
    let champCard = null;
    let nameEl = null;
    let divisionTitle = "Division";

    if (card) {
        const catWrapper = card.closest(".category-bracket-wrapper") || card.closest(".bracket-section");
        champCard = catWrapper?.querySelector(".champion-card");
        nameEl = catWrapper?.querySelector(".champion-name");
        divisionTitle = catWrapper?.getAttribute("data-category") || "Division";
    }

    if (!champCard) champCard = document.querySelector(".champion-card");
    if (!nameEl) nameEl = document.querySelector(".champion-name");

    if (nameEl) {
        nameEl.textContent = cleanName;
        champCard?.classList.add("active");
        champCard?.scrollIntoView({ behavior: "smooth", block: "center" });
    }

    window.showToast(`🏆 ${divisionTitle} Champion: ${cleanName}!`, "success");
    saveTournament();

    checkTournamentCompletion();
};

async function checkTournamentCompletion() {
    if (!activeTournament || activeTournament.status === "finished") return;

    const wrappers = document.querySelectorAll(".category-bracket-wrapper");
    
    if (wrappers.length > 0) {
        // Multi-category: check if every category has a champion
        const winnersList = [];
        let allCompleted = true;

        wrappers.forEach(wrapper => {
            const catName = wrapper.getAttribute("data-category") || "Division";
            const champName = wrapper.querySelector(".champion-name")?.textContent?.trim();

            if (!champName || champName === "TBD" || champName === "—") {
                allCompleted = false;
            } else {
                winnersList.push(`${catName}: ${champName}`);
            }
        });

        // When all categories are finished, archive the tournament
        if (allCompleted && winnersList.length > 0) {
            const overallWinners = winnersList.join(" | ");
            window.showToast("🏆 All divisions complete! Archiving tournament...", "success");
            
            setTimeout(async () => {
                await archiveCurrentTournament(overallWinners);
            }, 2000);
        }
    } else {
        // Single bracket
        const champName = document.querySelector(".champion-name")?.textContent?.trim();
        if (champName && champName !== "TBD" && champName !== "—") {
            window.showToast(`🏆 Tournament complete! Archiving...`, "success");
            setTimeout(async () => {
                await archiveCurrentTournament(champName);
            }, 2000);
        }
    }
}

// ── BRACKET RENDERING ─────────────────────────────────────────────
function createMatch(p1, p2, idx, courtName = null) {
    const wrapper = document.createElement("div");
    wrapper.className = "match-wrapper";

    const getPData = (p) => {
        if (!p || (typeof p === "string" && (p.includes("TBD") || p === "BYE"))) {
            return { name: p || "TBD", meta: "", level: null, isTbd: true, isBye: p === "BYE" };
        }
        if (typeof p === "object") {
            if (p.isBye) return { name: "BYE", meta: "", level: null, isTbd: true, isBye: true };
            return { name: p.name, meta: "", level: p.level, isTbd: false };
        }
        const clean = p.replace(/\s\(L\)$/, "").replace(" (Winners)", "").replace(" (Loser)", "").replace(" (Losers)", "");
        const found = participants.find((pl) => (pl.full_name || pl.profiles?.full_name) === clean);
        const level = found?.profiles?.player_level || null;
        return { name: p, meta: p.includes("(L)") ? "From Losers" : "Advanced", level, isTbd: false };
    };

    const d1 = getPData(p1), d2 = getPData(p2);
    const isByeMatch = d1.isBye || d2.isBye;
    const courtBadge = courtName ? `<div class="court-assignment-badge"><i class='bx bx-map'></i> ${courtName}</div>` : "";

    wrapper.innerHTML = `
        <div class="match-card ${isByeMatch ? "match-bye" : ""}">
            ${courtBadge}
            <div class="match-label">Match ${idx + 1} (Bo3)</div>
            ${[d1, d2]
                .map((d) => `
                <div class="player-row ${d.isBye ? "player-bye" : ""}">
                    <div class="player-info">
                        <div class="player-icon ${d.isTbd ? "tbd" : ""}" style="background:${d.isTbd ? "#e5e7eb" : "rgb(5,185,5)"};color:#fff;">${d.isBye ? "—" : d.name[0]}</div>
                        <div class="player-details">
                            <span class="player-name ${d.isTbd ? "tbd" : ""}" style="${d.isTbd ? "" : "color:#111827;"}">${d.name}</span>
                            <div class="player-meta-row" style="display:flex;align-items:center;">
                                ${d.level && LEVEL_THEME[d.level] ? `<span class="lvl-badge" style="color:#111827;font-weight:600;font-size:0.6rem;border:1px solid #9ca3af;border-radius:3px;padding:0 3px;margin-right:5px;">${LEVEL_THEME[d.level].tag}</span>` : ""}
                                <span class="player-meta" style="font-size:0.65rem;color:#707070;">${d.meta}</span>
                            </div>
                        </div>
                    </div>
                    <div class="score-controls">
                        <input type="number" class="score-input" placeholder="S1" min="0" max="30" ${d1.isTbd || d2.isTbd ? "disabled" : ""}>
                        <input type="number" class="score-input" placeholder="S2" min="0" max="30" disabled>
                        <input type="number" class="score-input" placeholder="S3" min="0" max="30" disabled>
                    </div>
                </div>`).join("")}
        </div>`;

    if (isByeMatch) {
        const card = wrapper.querySelector(".match-card");
        if (d1.isBye && d2.isBye) {
            card.classList.add("match-finished", "match-bye");
            card.querySelectorAll(".score-input").forEach((i) => (i.disabled = true));
            return wrapper;
        }
        const byeIdx = d1.isBye ? 0 : 1;
        const winnerIdx = byeIdx === 0 ? 1 : 0;
        card.classList.add("match-finished", "match-bye");
        const rows = card.querySelectorAll(".player-row");
        rows[winnerIdx].classList.add("winner");
        card.querySelectorAll(".score-input").forEach((i) => (i.disabled = true));

        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                const winnerName = rows[winnerIdx].querySelector(".player-name").textContent;
                advancePlayers(card, winnerName, "BYE", activeTournament?.format || "single");
                saveTournament();
            });
        });
    } else {
        wrapper.querySelectorAll(".score-input").forEach((inp) => {
            inp.oninput = () => handleScoreInput(inp);
        });
    }
    return wrapper;
}

function renderSingleElimination(container, count, players, isSub = false, selectedCourts = [], courtTracker = { index: 0 }) {
    const roundsCount = Math.log2(count);
    const wrapper = document.createElement("div");
    
    wrapper.className = isSub ? "bracket-container" : "bracket-container bracket-section winners-bracket-section";

    for (let r = 0; r < roundsCount; r++) {
        const matchCount = count / Math.pow(2, r + 1);
        const roundDiv = document.createElement("div");
        roundDiv.className = "round";
        
        const rt = document.createElement("div");
        rt.className = "round-title";
        rt.textContent = r === roundsCount - 1 ? "Championship" : `Round ${r + 1}`;
        roundDiv.appendChild(rt);

        const matchesCol = document.createElement("div");
        matchesCol.className = "round-matches";
        
        for (let m = 0; m < matchCount; m++) {
            let assignedCourt = null;
            if (r === 0 && selectedCourts && selectedCourts.length > 0) {
                assignedCourt = selectedCourts[courtTracker.index % selectedCourts.length];
                courtTracker.index++;
            }
            matchesCol.appendChild(createMatch(r === 0 ? players[m * 2] : "TBD", r === 0 ? players[m * 2 + 1] : "TBD", m, assignedCourt));
        }
        roundDiv.appendChild(matchesCol);
        wrapper.appendChild(roundDiv);
    }

    if (!isSub) {
        const champ = document.createElement("div");
        champ.className = "champion-card";
        champ.innerHTML = `<i class='bx bxs-trophy'></i><div class="champion-name">TBD</div>`;
        wrapper.appendChild(champ);
    }
    container.appendChild(wrapper);
}

function renderDoubleElimination(container, count, players, selectedCourts = [], courtTracker = { index: 0 }) {
    container.innerHTML = ""; 

    // 1. Winners Bracket
    const wbSec = document.createElement("div");
    wbSec.className = "bracket-section winners-bracket-section";
    wbSec.innerHTML = `<h3 class="format-title" style="font-size:15px; font-weight:700; color:#1e293b; margin-bottom:12px;"><i class='bx bx-trending-up' style="color:var(--primary-color);"></i> Winners Bracket</h3>`;
    renderSingleElimination(wbSec, count, players, true, selectedCourts, courtTracker);
    container.appendChild(wbSec);

    // 2. Losers Bracket
    const wbRounds = Math.log2(count);
    const lbRoundsCount = (wbRounds - 1) * 2; 

    const lbSec = document.createElement("div");
    lbSec.className = "bracket-section losers-bracket-section";
    lbSec.style.marginTop = "24px";
    lbSec.innerHTML = `<h3 class="format-title" style="font-size:15px; font-weight:700; color:#1e293b; margin-bottom:12px;"><i class='bx bx-refresh' style="color:#d97706;"></i> Losers Bracket</h3>`;
    
    const lbWrapper = document.createElement("div");
    lbWrapper.className = "bracket-container";

    if (lbRoundsCount <= 0) {
        // If 2 contestants (e.g. 2 pairs), the Round 1 loser meets the WB winner directly in Grand Final
        lbWrapper.innerHTML = `
            <div style="padding:12px 18px; background:#f8fafc; border:1px dashed #cbd5e1; border-radius:8px; font-size:13px; color:#64748b;">
                <i class='bx bx-info-circle'></i> 2-Entry Division: The Round 1 loser advances directly to the Grand Final.
            </div>`;
    } else {
        for (let r = 0; r < lbRoundsCount; r++) { 
            const rd = document.createElement("div");
            rd.className = "round";
            let label = r === lbRoundsCount - 1 ? "LB Final" : `LB Round ${Math.floor(r/2) + 1}${r % 2 === 0 ? 'A' : 'B'}`;
            rd.innerHTML = `<div class="round-title">${label}</div>`;
            
            const mc = document.createElement("div");
            mc.className = "round-matches";
            const matchCount = Math.pow(2, wbRounds - 2 - Math.floor((r + 1) / 2));

            for (let i = 0; i < matchCount; i++) {
                mc.appendChild(createMatch("TBD (L)", "TBD (L)", i));
            }
            rd.appendChild(mc);
            lbWrapper.appendChild(rd);
        }
    }

    lbSec.appendChild(lbWrapper);
    container.appendChild(lbSec);

    // 3. Grand Final
    const gfSec = document.createElement("div");
    gfSec.className = "bracket-section grand-final-section";
    gfSec.style.marginTop = "24px";
    gfSec.innerHTML = `
        <h3 class="format-title" style="font-size:15px; font-weight:700; color:#1e293b; margin-bottom:12px;"><i class='bx bxs-crown' style="color:#eab308;"></i> Grand Final</h3>
        <div class="bracket-container">
            <div class="round">
                <div class="round-title">Championship</div>
                <div class="round-matches gf-match-container"></div>
            </div>
            <div class="champion-card"><i class='bx bxs-trophy'></i><div class="champion-name">TBD</div></div>
        </div>`;
    
    const gfMatch = createMatch("TBD (Winners)", "TBD (Loser)", 0);
    const gfCard = gfMatch.querySelector(".match-card");
    gfCard.classList.add("grand-final-match");
    gfSec.querySelector(".gf-match-container").appendChild(gfMatch);
    container.appendChild(gfSec);
}

// ── PERSISTENCE ───────────────────────────────────────────────────
async function saveTournament() {
    const display = document.getElementById("bracketDisplay");
    if (!display || !display.innerHTML.trim()) return;

    lastLocalSaveAt = Date.now();
    if (activeTournament?.winner_name) {
        const champNameEl = display.querySelector(".champion-name");
        if (champNameEl) champNameEl.textContent = activeTournament.winner_name;
        const champCard = display.querySelector(".champion-card");
        if (champCard) champCard.classList.add("active");
    }

    display.querySelectorAll(".score-input").forEach((input) => { input.setAttribute("value", input.value); });
    const inputs = Array.from(display.querySelectorAll(".score-input")).map((i) => ({ v: i.value, d: i.disabled }));

    localStorage.setItem("southpoint_data", JSON.stringify({ html: display.innerHTML, inputs: inputs, type: activeTournament?.format || "single" }));

    if (activeTournament?.id) {
        const { error } = await supabase.from("tournaments").update({ bracket_html: display.innerHTML }).eq("id", activeTournament.id);
        if (!error) lastLocalSaveAt = Date.now();
    }
}

async function loadTournamentBracket() {
    const display = document.getElementById("bracketDisplay");
    if (!display) return;
    let htmlToLoad = activeTournament?.bracket_html;
    let inputsToLoad = null;

    if (!htmlToLoad) {
        const saved = localStorage.getItem("southpoint_data");
        if (saved) {
            try { const data = JSON.parse(saved); htmlToLoad = data.html; inputsToLoad = data.inputs; } catch (e) {}
        }
    }

    if (!htmlToLoad) return;
    display.innerHTML = htmlToLoad;
    const inputs = display.querySelectorAll(".score-input");
    if (inputsToLoad) {
        inputsToLoad.forEach((state, i) => { if (inputs[i]) { inputs[i].value = state.v; inputs[i].disabled = state.d; } });
    }
    inputs.forEach((inp) => { inp.oninput = () => handleScoreInput(inp); });

    if (activeTournament?.winner_name) {
        const cn = display.querySelector(".champion-name"); if (cn) cn.textContent = activeTournament.winner_name;
        const cc = display.querySelector(".champion-card"); if (cc) cc.classList.add("active");
    }

    updateAdminUI(true);
    const savedTime = activeTournament?.start_time || localStorage.getItem("tournament_start_time");
    if (savedTime) startTimer(parseInt(savedTime));

    checkTournamentCompletion();
}

    // ── ARCHIVE & HISTORY ─────────────────────────────────────────────
    window.openFinishConfirm = function() {
    const champName = document.querySelector(".champion-name")?.textContent;
    if (!champName || champName === "TBD") {
        showToast("A champion must be decided before finishing!", "error");
        return;
    }
    openConfirm(
        `<i class='bx bx-check-shield' style='color:var(--primary-color)'></i> Finish Tournament`,
        "Finalize this tournament and archive the results? This will also release the selected courts.",
        "Finish & Archive",
        "var(--primary-color)",
        () => archiveCurrentTournament(champName)
    );
};

window.viewTournamentReport = async function(tournamentId) {
    const { data: t, error } = await supabase
        .from("tournaments")
        .select("*")
        .eq("id", tournamentId)
        .single();

    if (error || !t) return;

    const { data: regs } = await supabase
        .from("tournament_registrations")
        .select("id")
        .eq("tournament_id", tournamentId)
        .eq("verified", true);

    const reportContent = document.getElementById("reportContent");
    if (!reportContent) return;

    reportContent.innerHTML = `
        <div style="text-align: center; margin-bottom: 20px;">
            <h1 style="color: var(--primary-color); margin:0;">${t.title}</h1>
            <p style="color: #667085;">Official Tournament Summary</p>
        </div>
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px; margin-bottom: 20px;">
            <div style="background: #f9fafb; padding: 15px; border-radius: 8px;">
                <span style="font-size: 11px; color: #667085; text-transform: uppercase;">CHAMPION</span>
                <div style="font-size: 18px; font-weight: 800; color: #101828;"><i class='bx bxs-trophy' style="color:#eab308"></i> ${t.winner_name || 'N/A'}</div>
            </div>
            <div style="background: #f9fafb; padding: 15px; border-radius: 8px;">
                <span style="font-size: 11px; color: #667085; text-transform: uppercase;">DURATION</span>
                <div style="font-size: 18px; font-weight: 800; color: #101828;"><i class='bx bx-stopwatch'></i> ${t.duration || '00:00:00'}</div>
            </div>
        </div>
        <div style="border-top: 1px solid #eaecf0; padding-top: 15px;">
            <h4 style="margin-bottom: 10px;">Quick Stats</h4>
            <div style="font-size: 14px; color: #475467;">
                <p><b>Participants:</b> ${regs?.length || 0} Verified Players</p>
                <p><b>Format:</b> ${t.format === 'single' ? 'Single Elimination' : 'Double Elimination'}</p>
                <p><b>Venue:</b> ${t.venue}</p>
            </div>
        </div>
    `;

    document.getElementById("reportModal").style.display = "flex";
};

window.closeReportModal = function() {
    document.getElementById("reportModal").style.display = "none";
    location.reload(); 
};

window.closeReportModal = function() {
    document.getElementById("reportModal").style.display = "none";
    location.reload(); // Reload to clear the board
}

async function autoArchiveTournament(winner) {
    await archiveCurrentTournament(winner);
}

async function renderHistory() {
    const body = document.getElementById("historyBody");
    const emptyMsg = document.getElementById("historyEmpty");
    if (!body) return;

    const { data } = await supabase
        .from("tournaments")
        .select("*")
        .eq("status", "finished")
        .order("date", { ascending: false });

    const history = data || [];
    if (emptyMsg) emptyMsg.style.display = history.length === 0 ? "block" : "none";
    
    body.innerHTML = history.map(item => `
        <tr>
            <td>${new Date(item.date).toLocaleDateString("en-US", { timeZone: "UTC" })}</td>
            <td>
                <div class="history-winner-cell">
                    <i class='bx bxs-trophy'></i>
                    <span>${item.winner_name || "TBA"}</span>
                </div>
            </td>
            <td><span class="format-tag">${item.format}</span></td>
            <td>${item.duration || "—"}</td>
            <td>
                <div style="display:flex; gap:8px;">
                    <!-- New View Bracket Button -->
                    <button class="btn-view-proof" onclick="viewArchivedBracket('${item.id}')" title="View Bracket">
                        <i class='bx bx-sitemap'></i> Bracket
                    </button>
                    <button class="btn-view-proof" onclick="viewTournamentReport('${item.id}')" title="View Report">
                        <i class='bx bx-file'></i>
                    </button>
                    <button class="btn-history-del" onclick="deleteHistoryItem('${item.id}')">
                        <i class='bx bx-trash'></i>
                    </button>
                </div>
            </td>
        </tr>`
    ).join("");
}

window.deleteHistoryItem = async function(id) {
    await supabase.from("tournaments").delete().eq("id", id);
    renderHistory();
}

window.openRemoveConfirm = function() {
    openConfirm(`<i class='bx bx-trash' style='color:var(--danger)'></i> Delete Tournament`, "Are you sure? This deletes everything.", "Delete Everything", "var(--danger)", async () => {
        if (activeTournament) {
            await supabase.from("tournament_registrations").delete().eq("tournament_id", activeTournament.id);
            await supabase.from("tournaments").delete().eq("id", activeTournament.id);
        }
        localStorage.removeItem("southpoint_data");
        localStorage.removeItem("tournament_start_time");
        stopTimer();
        location.reload();
    });
}

// ── REALTIME SYNC (ADMIN) ─────────────────────────────────────────
function setupRealtimeSync() {
    supabase.channel("admin-tournament-live")
        // 1. Listen for Tournament Created / Updated / Deleted
        .on("postgres_changes", { event: "*", schema: "public", table: "tournaments" }, async (payload) => {
            if (Date.now() - lastLocalSaveAt < SELF_ECHO_WINDOW_MS) return;
            
            if (payload.eventType === "INSERT") {
                showToast(`🏆 Tournament "${payload.new.title}" is now active!`, "success");
            }
            await loadActiveTournament();
        })
        // 2. Listen for Live Player Registrations & Payments
        .on("postgres_changes", { event: "*", schema: "public", table: "tournament_registrations" }, async (payload) => {
            const targetId = payload.new?.tournament_id || payload.old?.tournament_id;
            
            // Only update if it belongs to current active tournament
            if (activeTournament && targetId === activeTournament.id) {
                if (payload.eventType === "INSERT") {
                    const playerName = payload.new.full_name || "A new player";
                    showToast(`🔔 New Registration: ${playerName} (${payload.new.category || "General"})`, "default");
                } else if (payload.eventType === "DELETE") {
                    showToast("A player withdrew their registration.", "default");
                }

                // Immediately refresh participant list and stats in real time
                await loadParticipants();
            }
        })
        .subscribe();
}

function setupPolling() {
    setInterval(async () => {
        if (activeTournament) {
            const { data } = await supabase.from("tournaments").select("*").eq("id", activeTournament.id).single();
            if (data && data.status !== activeTournament.status) { activeTournament = data; renderTournamentInfo(); }
        }
    }, 5000);
}

// ── STEP 2: PLANNING & DECISION SUPPORT ───────────────────────────
window.closeRegistration = async function() {
    if (!activeTournament) return;
    openConfirm("<i class='bx bx-lock'></i> Close Registration?", "Freeze participants list?", "Close Now", "#6b7280", async () => {
        await supabase.from("tournaments").update({ status: "registration_closed" }).eq("id", activeTournament.id);
        await loadActiveTournament();
    });
};

window.calculateCourtNeeds = async function() {
    const hoursInput = document.getElementById("planHours");
    const resultDiv = document.getElementById("analysisResult");
    if (!hoursInput || !resultDiv || !activeTournament) return;
    const hours = parseFloat(hoursInput.value) || 8;
    const totalMinutesAvailable = hours * 60;
    const verifiedCount = participants.filter(p => p.verified).length;
    if (verifiedCount < 2) { resultDiv.innerHTML = `<p style="font-size:13px; color:#ef4444; margin:0;">Need 2 verified players.</p>`; return; }
    const estimatedMatches = activeTournament.format === "double" ? (2 * verifiedCount) - 1 : verifiedCount - 1;
    const courtsNeeded = Math.ceil((estimatedMatches * 40) / totalMinutesAvailable);
    resultDiv.innerHTML = `
        <div style="display:flex; gap:15px; align-items:center; width:100%;">
            <div style="flex:1">
                <h4 style="color:#166534; margin:0 0 4px 0; font-size:14px;">Recommendation</h4>
                <p style="font-size:12px; color:#475569; margin:0;">For <b>${verifiedCount}</b> players:</p>
            </div>
            <div style="text-align:center; background:white; padding:8px 15px; border-radius:8px; border:1px solid #e2e8f0; shadow: 0 1px 2px rgba(0,0,0,0.05)">
                <span style="display:block; font-size:20px; font-weight:800; color:var(--primary-color);">${courtsNeeded}</span>
                <span style="font-size:9px; text-transform:uppercase; font-weight:700; color:#64748b;">Courts Needed</span>
            </div>
        </div>`;
};

// ── UPDATE ADMIN UI ───────────────────────────────────────────────
function updateAdminUI(isActive) {
    const btnRemove = document.getElementById("btnRemove");
    const btnCloseReg = document.getElementById("btnCloseReg");
    const btnCreate = document.querySelector(".btn-create");
    const planningSection = document.getElementById("planningSection");

    const status = activeTournament?.status;

    if (isActive && activeTournament) {
        if(btnCreate) btnCreate.disabled = true; 
        if(btnRemove) btnRemove.style.display = "inline-flex";

        if (planningSection) {
            planningSection.style.display = "block";
            loadPhysicalCourts();
            window.calculateCourtNeeds();
        }
        
        if (status === "registration_open") {
            if(btnCloseReg) btnCloseReg.style.display = "inline-flex";
        } else {
            if(btnCloseReg) btnCloseReg.style.display = "none";
        }
    } else {
        if(btnCreate) btnCreate.disabled = false;
        if(btnRemove) btnRemove.style.display = "none";
        if(btnCloseReg) btnCloseReg.style.display = "none";
        if(planningSection) planningSection.style.display = "none";
    }
}

window.viewArchivedBracket = async function(tournamentId) {
    const { data: t, error } = await supabase
        .from("tournaments")
        .select("title, bracket_html")
        .eq("id", tournamentId)
        .single();

    if (error || !t || !t.bracket_html) {
        showToast("Bracket data not found for this tournament.", "error");
        return;
    }

    const modal = document.getElementById("archivedBracketModal");
    const titleEl = document.getElementById("archivedBracketTitle");
    const displayEl = document.getElementById("archivedBracketDisplay");

    titleEl.textContent = `Bracket History: ${t.title}`;
    displayEl.innerHTML = t.bracket_html;

    // IMPORTANT: Make the bracket read-only
    const inputs = displayEl.querySelectorAll("input");
    inputs.forEach(inp => {
        inp.disabled = true;
        // Ensure values are visible
        if (inp.getAttribute('value')) {
            inp.value = inp.getAttribute('value');
        }
    });

    modal.style.display = "flex";
};

window.closeArchivedBracket = function() {
    document.getElementById("archivedBracketModal").style.display = "none";
};

async function archiveCurrentTournament(winner) {
    const now = Date.now();
    const start = parseInt(activeTournament.start_time || localStorage.getItem("tournament_start_time"));
    let duration = "00:00:00";
    
    if (start) {
        const diff = now - start;
        const h = Math.floor(diff / 3600000).toString().padStart(2, "0");
        const m = Math.floor((diff % 3600000) / 60000).toString().padStart(2, "0");
        const s = Math.floor((diff % 60000) / 1000).toString().padStart(2, "0");
        duration = `${h}:${m}:${s}`;
    }

    const completionDate = new Date().toISOString().split('T')[0]; 

    // 1. Get the locked courts from storage (crucial for persistence)
    const savedCourts = localStorage.getItem(`active_courts_${activeTournament.id}`);
    const courtNames = savedCourts ? JSON.parse(savedCourts) : [];
    
    try {
        // 2. Release the courts
        if (courtNames.length > 0) {
            await supabase
                .from("courts")
                .update({ is_active: true, closed_reason: null })
                .in("name", courtNames);
        }

        if (activeTournament) {
            // 3. Update tournament record
            await supabase
                .from("tournaments")
                .update({ 
                    status: "finished", 
                    winner_name: winner, 
                    duration: duration,
                    date: completionDate,
                    bracket_html: document.getElementById("bracketDisplay").innerHTML
                })
                .eq("id", activeTournament.id);

            showToast("🏆 Tournament Archived & Courts Released!", "success");
            
            // 4. Cleanup
            localStorage.removeItem(`active_courts_${activeTournament.id}`);
            localStorage.removeItem("southpoint_data");
            localStorage.removeItem("tournament_start_time");
            stopTimer();

            // 5. Refresh UI
            await viewTournamentReport(activeTournament.id);
            renderHistory();
            updateAdminUI(false);
        }
    } catch (err) {
        console.error("Archive Error:", err);
        showToast("Error during archiving.", "error");
    }
}


// ── WINDOW EXPORTS ────────────────────────────────────────────────
window.openTab = openTab;
window.openModal = openModal;
window.closeModal = closeModal;
window.openConfirm = openConfirm;
window.closeConfirm = closeConfirm;
window.generateBracket = generateBracket;
window.createTournament = createTournament;
window.verifyPayment = verifyPayment;
window.viewPayProof = viewPayProof;
window.closePayProofModal = closePayProofModal;
window.deleteHistoryItem = deleteHistoryItem;
window.closeRegistration = closeRegistration;
window.calculateCourtNeeds = calculateCourtNeeds;
window.openFinishConfirm = openFinishConfirm;
window.openVerifyPaymentModal = openVerifyPaymentModal;
window.closeVerifyPaymentModal = closeVerifyPaymentModal;
window.viewArchivedBracket = viewArchivedBracket;
window.closeArchivedBracket = closeArchivedBracket;
window.updateSlot = updateSlot;
window.saveTournament = saveTournament;
window.advancePlayers = advancePlayers;
window.archiveCurrentTournament = archiveCurrentTournament;
window.checkTournamentCompletion = checkTournamentCompletion;