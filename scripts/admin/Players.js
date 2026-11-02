import { supabase } from "../supabase/supabaseClient.js";

const WINRATE_IS_FRACTION = false;

const ROWS_PER_PAGE = 5;
const AUTO_SUSPEND_WARNING_LIMIT = 3;
const AUTO_SUSPEND_DAYS = 7;

// ── HELPERS ──────────────────────────────────────────────────────────────────
function showAlert(message, type = "info") {
    document.getElementById("globalAlert")?.remove();

    const colors = {
        success: "#16a34a",
        error: "#ef4444",
        warning: "#f59e0b",
        info: "#2563eb"
    };

    const el = document.createElement("div");
    el.id = "globalAlert";
    el.setAttribute("role", "alert");
    el.textContent = message;
    el.style.cssText = `
        position:fixed;
        top:20px;
        right:20px;
        background:${colors[type] || colors.info};
        color:#fff;
        padding:12px 16px;
        border-radius:10px;
        z-index:99999;
        font-size:14px;
        font-weight:600;
    `;

    document.body.appendChild(el);
    setTimeout(() => el.remove(), 3000);
}

const esc = (s) =>
    String(s ?? "").replace(/[&<>"']/g, (c) => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
    }[c]));

function safeUrl(u) {
    try {
        const p = new URL(u);
        return p.protocol === "https:" || p.protocol === "http:" ? p.href : null;
    } catch {
        return null;
    }
}

function toPercent(value) {
    const n = Number(value) || 0;
    const pct = WINRATE_IS_FRACTION ? n * 100 : n;
    return Math.min(100, Math.max(0, pct));
}

function formatDate(d, opts = { month: "short", day: "numeric", year: "numeric" }) {
    return new Date(d).toLocaleDateString("en-PH", opts);
}

// ── MAIN ─────────────────────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", async () => {

    let players = [];
    let filteredPlayers = [];
    let currentPage = 1;
    let currentTargetId = null;
    let currentActionType = null;
    let warningPlayerId = null;
    let isProcessing = false; 

    const tableBody          = document.getElementById("playerTable");
    const searchInput        = document.getElementById("searchInput");
    const filterSelect       = document.getElementById("filterSelect");
    const sortSelect         = document.getElementById("sortSelect");
    const paginationWrapper  = document.getElementById("paginationWrapper");
    const actionModal        = document.getElementById("actionModal");
    const modalTitle         = document.getElementById("modalTitle");
    const modalDesc          = document.getElementById("modalDescription");
    const durationWrapper    = document.getElementById("durationWrapper");
    const durationSelect     = document.getElementById("suspendDuration");
    const reasonWrapper      = document.getElementById("suspendReasonWrapper");
    const reasonSelect       = document.getElementById("suspendReasonSelect");
    const warningSelect      = document.getElementById("warningReasonSelect");
    const warningReasonInput = document.getElementById("warningReason");
    const reasonInput        = document.getElementById("suspendReason");
    const confirmBtn         = document.getElementById("confirmModalBtn");
    const closeBtn           = document.getElementById("closeModal");
    const warningModal       = document.getElementById("warningModal");

    async function runLocked(fn) {
        if (isProcessing) return;
        isProcessing = true;
        if (confirmBtn) confirmBtn.disabled = true;
        const rejectBtn = document.getElementById("rejectHomeownerBtn");
        if (rejectBtn) rejectBtn.disabled = true;
        try {
            await fn();
        } finally {
            isProcessing = false;
            if (confirmBtn) confirmBtn.disabled = false;
            const rb = document.getElementById("rejectHomeownerBtn");
            if (rb) rb.disabled = false;
        }
    }

    // ── REASON SELECT LISTENERS ──────────────────────────────────────────────
    reasonSelect?.addEventListener("change", (e) => {
        const val = e.target.value;
        if (val === "Other") {
            reasonInput.style.display = "block";
            reasonInput.value = "";
            durationWrapper.style.display = "block";
        } else if (val !== "") {
            reasonInput.style.display = "none";
            reasonInput.value = val;
            durationWrapper.style.display = "block";
        } else {
            reasonInput.style.display = "none";
            reasonInput.value = "";
            durationWrapper.style.display = "none";
        }
    });

    warningSelect?.addEventListener("change", (e) => {
        if (e.target.value === "Other") {
            warningReasonInput.style.display = "block";
            warningReasonInput.value = "";
        } else {
            warningReasonInput.style.display = "none";
            warningReasonInput.value = e.target.value;
        }
    });

    // ── 1. FETCH ─────────────────────────────────────────────────────────────
    async function liftExpiredSuspensions() {
        const { error } = await supabase
            .from("profiles")
            .update({ status: "active", suspended_until: null, suspension_reason: null })
            .eq("role", "player")
            .eq("status", "suspended")
            .not("suspended_until", "is", null)
            .lte("suspended_until", new Date().toISOString());

        if (error) console.error("Auto-lift failed:", error);
    }

    async function fetchPlayers() {
        tableBody.innerHTML = `<tr><td colspan="5" style="text-align:center;height:310px;color:var(--text-color);">Loading players…</td></tr>`;

        await liftExpiredSuspensions();

        const [profilesRes, warningsRes, verificationsRes] = await Promise.all([
            supabase
                .from("profiles")
                .select("id, full_name, player_level, winrate, games_played, status, username, email, contact_number, suspended_until, suspension_reason, locked_until")
                .eq("role", "player")
                .order("full_name", { ascending: true }),
            supabase.from("player_warnings").select("player_id"),
            supabase
                .from("homeowner_verifications")
                .select("id, player_id, status, submitted_at, proof_url")
                .order("submitted_at", { ascending: true })
        ]);

        if (profilesRes.error) {
            console.error("Profiles error:", profilesRes.error);
            tableBody.innerHTML = `<tr><td colspan="5" style="text-align:center;height:310px;color:var(--danger);">Failed to load players.</td></tr>`;
            return;
        }
        if (warningsRes.error) console.error("Warnings error:", warningsRes.error);
        if (verificationsRes.error) console.error("Verifications error:", verificationsRes.error);

        const warningMap = {};
        (warningsRes.data || []).forEach((w) => {
            warningMap[w.player_id] = (warningMap[w.player_id] || 0) + 1;
        });

        // Ordered ascending, kaya ang pinakabago ang mananalo
        const verificationMap = {};
        (verificationsRes.data || []).forEach((v) => {
            verificationMap[v.player_id] = v;
        });

        const now = Date.now();

        players = profilesRes.data.map((p) => {
            // Fallback sa UI kung na-block ng RLS ang auto-lift
            const expired = p.suspended_until && new Date(p.suspended_until).getTime() <= now;
            const suspended = p.status === "suspended" && !expired;

            // Locked dahil sa maling password (galing sa login lockout)
            const locked = !!p.locked_until && new Date(p.locked_until).getTime() > now;

            return {
                id:             p.id,
                name:           p.full_name || p.username || "Unknown",
                email:          p.email || "—",
                contact:        p.contact_number || "—",
                level:          p.player_level || "Not Qualified",
                winRate:        toPercent(p.winrate),
                games_played:   p.games_played || 0,
                status:         suspended ? "suspended" : "active",
                isSuspended:    suspended,
                isLocked:       locked,
                suspendedUntil: suspended ? p.suspended_until : null,
                suspendReason:  suspended ? p.suspension_reason : null,
                warnings:       warningMap[p.id] || 0,
                homeowner:      verificationMap[p.id] || null
            };
        });

        applyFilterAndSort();
    }

    // ── 2. FILTER + SORT ─────────────────────────────────────────────────────
    function applyFilterAndSort() {
        const search = searchInput.value.toLowerCase().trim();
        const filter = filterSelect.value;
        const sort   = sortSelect.value;

        filteredPlayers = players.filter((p) => {
            const matchSearch =
                p.name.toLowerCase().includes(search) ||
                p.email.toLowerCase().includes(search) ||
                (p.contact || "").includes(search) ||
                (p.level || "").toLowerCase().includes(search);

            const level = (p.level || "").toLowerCase();
            const matchFilter =
                filter === "all"           ? true :
                filter === "homeowners"    ? p.homeowner?.status === "approved" :
                filter === "advanced"      ? level === "advanced" :
                filter === "intermediate"  ? level === "intermediate" :
                filter === "beginner"      ? level === "beginner" :
                filter === "not-qualified" ? level === "not qualified" :
                true;

            return matchSearch && matchFilter;
        });

        if (sort === "winrate-desc") {
            filteredPlayers.sort((a, b) => b.winRate - a.winRate);
        } else if (sort === "winrate-asc") {
            filteredPlayers.sort((a, b) => a.winRate - b.winRate);
        } else {
            filteredPlayers.sort((a, b) => a.name.localeCompare(b.name));
        }

        currentPage = 1;
        renderTable();
    }

    // ── 3. RENDER ────────────────────────────────────────────────────────────
    function buildRow(player) {
        const isSuspended = player.isSuspended;
        const isLocked    = player.isLocked;

        const warningBadge = player.warnings > 0
            ? `<span class="warn-badge">${player.warnings} Warning${player.warnings > 1 ? "s" : ""}</span>`
            : "";

        let suspendBadge = "";
        if (isSuspended) {
            const untilLabel = player.suspendedUntil
                ? `Until ${formatDate(player.suspendedUntil)}`
                : "Indefinite";
            const reasonTitle = player.suspendReason ? ` title="${esc(player.suspendReason)}"` : "";
            suspendBadge = `<span class="suspend-badge"${reasonTitle}>${esc(untilLabel)}</span>`;
        }

        const lockedBadge = isLocked
            ? `<span class="suspend-badge" title="Locked due to failed login attempts">Locked</span>`
            : "";

        let homeownerBadge = "";
        switch (player.homeowner?.status) {
            case "approved":
                homeownerBadge = `<span class="homeowner-badge verified"><i class='bx bxs-home'></i> Homeowner</span>`;
                break;
            case "pending":
                homeownerBadge = `<span class="homeowner-badge pending"><i class='bx bx-time'></i> Pending</span>`;
                break;
            case "rejected":
                homeownerBadge = `<span class="homeowner-badge rejected"><i class='bx bx-x-circle'></i> Rejected</span>`;
                break;
        }

        const levelKey = (player.level || "").toLowerCase().replace(/\s+/g, "-");
        const winRate = player.winRate;

        const homeownerBtn = player.homeowner?.status === "pending"
            ? `<button class="action-btn homeowner-approve" title="Review Homeowner Verification"><i class='bx bx-home'></i></button>`
            : "";

        const unlockBtn = isLocked
            ? `<button class="action-btn unlock" title="Unlock Account"><i class='bx bx-lock-open'></i></button>`
            : "";

        const warnBtn = `
            <button class="action-btn warn" title="${isSuspended ? "Player is suspended" : "Issue Warning"}"
                    ${isSuspended ? "disabled" : ""}>
                <i class='bx bx-error-circle'></i>
            </button>`;

        return `
            <tr class="${isSuspended ? "is-suspended" : ""}" data-id="${esc(player.id)}">
                <td>
                    <span class="p-name">${esc(player.name)}</span>
                    ${warningBadge}
                    ${suspendBadge}
                    ${lockedBadge}
                    ${homeownerBadge}
                </td>

                <td>
                    <span class="p-contact">${esc(player.contact)}</span>
                    <div class="p-email">${esc(player.email)}</div>
                </td>

                <td><span class="badge ${esc(levelKey)}">${esc(player.level)}</span></td>

                <td>
                    <div class="win-rate-wrapper">
                        <span class="rate-text">
                            ${winRate.toFixed(1)}%
                            <small style="color: var(--text-color); font-weight: normal;">(${Number(player.games_played)} matches)</small>
                        </span>
                        <div class="rate-bar">
                            <div class="fill" style="width:${winRate}%;"></div>
                        </div>
                    </div>
                </td>

                <td style="text-align:center;">
                    ${homeownerBtn}
                    ${unlockBtn}
                    ${warnBtn}
                    <button class="action-btn suspend"
                            title="${isSuspended ? "Lift Suspension" : "Suspend Player"}">
                        <i class='bx ${isSuspended ? "bx-play-circle" : "bx-user-x"}'></i>
                    </button>
                </td>
            </tr>`;
    }

    function renderTable() {
        if (!tableBody) return;

        if (filteredPlayers.length === 0) {
            tableBody.innerHTML = `<tr><td colspan="5" style="text-align:center;height:310px;color:var(--text-color);">No players found.</td></tr>`;
            updatePagination();
            updateInfoText(0, 0);
            return;
        }

        const start     = (currentPage - 1) * ROWS_PER_PAGE;
        const end       = start + ROWS_PER_PAGE;
        const pageItems = filteredPlayers.slice(start, end);

        const placeholderRow = `
            <tr class="empty-row">
                <td colspan="5" style="height:65px;border-bottom:1px solid #f1f5f9;">&nbsp;</td>
            </tr>`;

        // Isang assignment lang sa innerHTML para iwas reflow
        tableBody.innerHTML =
            pageItems.map(buildRow).join("") +
            placeholderRow.repeat(ROWS_PER_PAGE - pageItems.length);

        updatePagination();
        updateInfoText(start, end);
    }

    // ── 4. PAGINATION ────────────────────────────────────────────────────────
    function updatePagination() {
        if (!paginationWrapper) return;
        paginationWrapper.innerHTML = "";

        const pageCount = Math.ceil(filteredPlayers.length / ROWS_PER_PAGE);
        if (pageCount <= 1) return;

        const prevBtn = document.createElement("button");
        prevBtn.innerHTML = "<i class='bx bx-chevron-left'></i> Prev";
        prevBtn.disabled = currentPage === 1;
        prevBtn.addEventListener("click", () => {
            if (currentPage > 1) {
                currentPage--;
                renderTable();
                window.scrollTo({ top: 0, behavior: "smooth" });
            }
        });
        paginationWrapper.appendChild(prevBtn);

        const pageLabel = document.createElement("span");
        pageLabel.className = "page-indicator";
        pageLabel.innerText = `Page ${currentPage} of ${pageCount}`;
        paginationWrapper.appendChild(pageLabel);

        const nextBtn = document.createElement("button");
        nextBtn.innerHTML = "Next <i class='bx bx-chevron-right'></i>";
        nextBtn.disabled = currentPage === pageCount;
        nextBtn.addEventListener("click", () => {
            if (currentPage < pageCount) {
                currentPage++;
                renderTable();
                window.scrollTo({ top: 0, behavior: "smooth" });
            }
        });
        paginationWrapper.appendChild(nextBtn);
    }

    function updateInfoText(start, end) {
        document.getElementById("totalEntries").innerText = filteredPlayers.length;
        document.getElementById("showingStart").innerText = filteredPlayers.length === 0 ? 0 : start + 1;
        document.getElementById("showingEnd").innerText   = Math.min(end, filteredPlayers.length);
    }

    // ── 5. MODALS ────────────────────────────────────────────────────────────
    function openModal(type, player) {
        currentTargetId   = player.id;
        currentActionType = type;
        actionModal.classList.add("active");
        durationWrapper.style.display = "none";

        if (reasonWrapper) reasonWrapper.style.display = "none";
        if (reasonSelect) reasonSelect.value = "";
        if (reasonInput) {
            reasonInput.value = "";
            reasonInput.style.display = "none";
        }

        confirmBtn.className = "modal-btn btn-confirm";
        document.getElementById("rejectHomeownerBtn")?.remove();

        if (type === "suspend") {
            const isRestoring = player.isSuspended;

            modalTitle.innerText   = isRestoring ? "Restore Account" : "Suspend Account";
            modalTitle.style.color = isRestoring ? "var(--primary-color)" : "var(--warn)";
            modalDesc.innerText    = isRestoring
                ? `Lift the suspension for ${player.name}?`
                : `Choose the suspension reason and duration for ${player.name}.`;

            if (reasonWrapper) reasonWrapper.style.display = isRestoring ? "none" : "block";
            confirmBtn.innerText = isRestoring ? "Lift Suspension" : "Confirm Suspension";

        } else if (type === "unlock") {
            modalTitle.innerText   = "Unlock Account";
            modalTitle.style.color = "var(--primary-color)";
            modalDesc.innerText    = `Unlock ${player.name}'s account? They will be able to log in again.`;
            confirmBtn.innerText   = "Unlock";

        } else if (type === "homeowner") {
            const v = player.homeowner;
            const proof = safeUrl(v?.proof_url);

            modalTitle.innerText   = "Homeowner Verification";
            modalTitle.style.color = "var(--primary-color)";
            modalDesc.innerHTML    = `
                <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px;">
                    <div style="width:40px;height:40px;border-radius:50%;background:var(--primary-color);color:#fff;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:16px;flex-shrink:0;">
                        ${esc(player.name.charAt(0).toUpperCase())}
                    </div>
                    <div>
                        <strong style="font-size:15px;">${esc(player.name)}</strong><br>
                        <span style="font-size:12px;color:var(--text-color);">${esc(player.email)}</span>
                    </div>
                </div>
                <div style="background:#f8fafc;border-radius:8px;padding:12px;font-size:13px;line-height:2;">
                    <b>Submitted:</b> ${v?.submitted_at
                        ? esc(formatDate(v.submitted_at, { year: "numeric", month: "long", day: "numeric" }))
                        : "—"}
                </div>
                ${proof
                    ? `<div style="margin-top:12px;">
                        <a href="${esc(proof)}" target="_blank" rel="noopener noreferrer">
                            <img id="proofImg" src="${esc(proof)}" alt="Proof"
                                 style="width:100%;max-height:200px;object-fit:contain;border-radius:8px;border:1px solid #e2e8f0;cursor:pointer;">
                        </a>
                        <div id="proofFallback" style="display:none;">
                            <a href="${esc(proof)}" target="_blank" rel="noopener noreferrer"
                               style="color:var(--primary-color);font-weight:600;">View Proof Document ↗</a>
                        </div>
                       </div>`
                    : `<p style="margin-top:10px;color:#94a3b8;font-size:13px;"><em>No proof document uploaded.</em></p>`}
            `;

            // Fallback kung hindi image ang proof (hal. PDF)
            modalDesc.querySelector("#proofImg")?.addEventListener("error", (ev) => {
                ev.target.style.display = "none";
                const fb = modalDesc.querySelector("#proofFallback");
                if (fb) fb.style.display = "block";
            });

            const rejectBtn     = document.createElement("button");
            rejectBtn.id        = "rejectHomeownerBtn";
            rejectBtn.className = "modal-btn btn-reject";
            rejectBtn.innerText = "Reject";
            confirmBtn.parentNode.insertBefore(rejectBtn, confirmBtn);
            rejectBtn.addEventListener("click", () => runLocked(() => handleHomeownerDecision("rejected")));

            confirmBtn.innerText = "Approve";
            confirmBtn.classList.add("homeowner-mode");
        }
    }

    function closeModal() {
        actionModal.classList.remove("active");
        currentTargetId   = null;
        currentActionType = null;
        document.getElementById("rejectHomeownerBtn")?.remove();
    }

    function openWarningModal(player) {
        if (!player || !player.id) {
            showAlert("Error: Player ID is missing.", "error");
            return;
        }
        warningPlayerId = player.id;

        if (warningSelect) warningSelect.value = "";
        if (warningReasonInput) {
            warningReasonInput.value = "";
            warningReasonInput.style.display = "none";
        }

        warningModal.classList.add("active");
    }

    function closeWarningModal() {
        warningPlayerId = null;
        warningModal.classList.remove("active");
    }

    // ── 6. HOMEOWNER DECISION ────────────────────────────────────────────────
    async function handleHomeownerDecision(decision) {
        const player = players.find((p) => p.id === currentTargetId);
        const verificationId = player?.homeowner?.id;
        if (!verificationId) return;

        // Row id ang gamit, hindi player_id, para hindi ma-overwrite ang lumang records
        const { error } = await supabase
            .from("homeowner_verifications")
            .update({ status: decision, reviewed_at: new Date().toISOString() })
            .eq("id", verificationId);

        if (error) {
            showAlert("Error: " + error.message, "error");
            return;
        }

        showAlert(
            decision === "approved" ? "Homeowner approved." : "Homeowner rejected.",
            decision === "approved" ? "success" : "warning"
        );
        closeModal();
        await fetchPlayers();
    }

    // ── 7. CONFIRM MODAL ─────────────────────────────────────────────────────
    confirmBtn.addEventListener("click", () => runLocked(async () => {
        if (currentActionType === "homeowner") {
            await handleHomeownerDecision("approved");
            return;
        }

        if (currentActionType === "unlock") {
            const { error } = await supabase.rpc("unlock_user_account", {
                p_user_id: currentTargetId
            });

            if (error) {
                console.error("Unlock failed:", error);
                showAlert("Failed to unlock account.", "error");
                return;
            }

            showAlert("Account unlocked successfully.", "success");
            closeModal();
            await fetchPlayers();
            return;
        }

        const player = players.find((p) => p.id === currentTargetId);
        if (!player) return;

        if (currentActionType === "suspend") {
            const isRestoring = player.isSuspended;
            let updatePayload;

            if (isRestoring) {
                updatePayload = { status: "active", suspended_until: null, suspension_reason: null };
            } else {
                const reason = reasonInput?.value.trim() || "";
                if (!reason) {
                    showAlert("Please enter a reason for the suspension.", "warning");
                    return;
                }

                const days = parseInt(durationSelect?.value || "7", 10);
                const until = new Date();
                until.setDate(until.getDate() + days);

                updatePayload = {
                    status: "suspended",
                    suspended_until: until.toISOString(),
                    suspension_reason: reason
                };
            }

            const { error } = await supabase
                .from("profiles")
                .update(updatePayload)
                .eq("id", currentTargetId);

            if (error) {
                showAlert("Error: " + error.message, "error");
                return;
            }

            showAlert(isRestoring ? "Suspension lifted." : "Player suspended.", "success");
            closeModal();
            await fetchPlayers();
        }
    }));

    closeBtn.addEventListener("click", closeModal);

    // ── 8. TABLE CLICK DELEGATION ────────────────────────────────────────────
    tableBody.addEventListener("click", (e) => {
        const btn = e.target.closest(".action-btn");
        if (!btn || btn.disabled) return;

        const row = btn.closest("tr");
        if (!row?.dataset.id) return;

        const player = players.find((p) => p.id === row.dataset.id);
        if (!player) return;

        if (btn.classList.contains("warn"))              openWarningModal(player);
        if (btn.classList.contains("suspend"))           openModal("suspend", player);
        if (btn.classList.contains("unlock"))            openModal("unlock", player);
        if (btn.classList.contains("homeowner-approve")) openModal("homeowner", player);
    });

    // ── 9. WARNINGS ──────────────────────────────────────────────────────────
    async function submitWarning() {
        if (isProcessing) return;

        if (!warningPlayerId) {
            showAlert("Error: No player selected for the warning.", "error");
            return;
        }

        const reason = warningReasonInput.value.trim();
        if (!reason) {
            showAlert("Please enter a warning reason.", "warning");
            return;
        }

        isProcessing = true;
        try {
            // getSession ay local lang; ang RLS pa rin ang tunay na authority
            const { data: { session } } = await supabase.auth.getSession();
            const user = session?.user;
            if (!user) {
                showAlert("Session expired. Please log in again.", "error");
                return;
            }

            const { error: insertError } = await supabase
                .from("player_warnings")
                .insert({ player_id: warningPlayerId, issued_by: user.id, reason });

            if (insertError) {
                showAlert(insertError.message, "error");
                return;
            }

            const { count, error: countError } = await supabase
                .from("player_warnings")
                .select("id", { count: "exact", head: true })
                .eq("player_id", warningPlayerId);

            if (!countError && count >= AUTO_SUSPEND_WARNING_LIMIT) {
                const until = new Date();
                until.setDate(until.getDate() + AUTO_SUSPEND_DAYS);

                const { error: suspendError } = await supabase
                    .from("profiles")
                    .update({
                        status: "suspended",
                        suspended_until: until.toISOString(),
                        suspension_reason: `Automatically suspended after receiving ${AUTO_SUSPEND_WARNING_LIMIT} warnings.`
                    })
                    .eq("id", warningPlayerId);

                if (suspendError) {
                    showAlert("Warning issued, but auto-suspend failed: " + suspendError.message, "error");
                } else {
                    // Nire-reset ang warnings pagkatapos ng auto-suspend
                    const { error: clearError } = await supabase
                        .from("player_warnings")
                        .delete()
                        .eq("player_id", warningPlayerId);

                    if (clearError) console.error("Failed to clear warnings:", clearError);

                    showAlert(
                        `Warning #${AUTO_SUSPEND_WARNING_LIMIT} reached. Player auto-suspended for ${AUTO_SUSPEND_DAYS} days.`,
                        "warning"
                    );
                }
            } else {
                showAlert("Warning issued successfully.", "success");
            }

            closeWarningModal();
            await fetchPlayers();
        } finally {
            isProcessing = false;
        }
    }

    // ── 10. SEARCH + FILTER + SORT LISTENERS ─────────────────────────────────
    let searchTimer;
    searchInput.addEventListener("input", () => {
        clearTimeout(searchTimer);
        searchTimer = setTimeout(applyFilterAndSort, 250);
    });
    filterSelect.addEventListener("change", applyFilterAndSort);
    sortSelect.addEventListener("change", applyFilterAndSort);

    window.closeWarningModal = closeWarningModal;
    window.submitWarning = submitWarning;

    await fetchPlayers();
});