import { supabase } from "../supabase/supabaseClient.js";

function showAlert(message, type = "info") {
    document.getElementById("globalToast")?.remove();

    const colors = {
        success: "#16a34a",
        error: "#ef4444",
        warning: "#f59e0b",
        info: "#2563eb"
    };

    const toast = document.createElement("div");
    toast.id = "globalToast";
    toast.textContent = message;
    toast.style.cssText = `
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
        box-shadow:0 10px 25px rgba(0,0,0,.15);
    `;

    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 3000);
}

document.addEventListener("DOMContentLoaded", () => {
    let coaches = [];
    let filteredCoaches = [];
    let currentPage = 1;
    const rowsPerPage = 5;
    let currentTargetId = null;
    let currentActionType = null;

    const tableBody = document.getElementById("coachTableBody");
    const searchInput = document.getElementById("coachSearchInput");
    const paginationWrapper = document.getElementById("paginationBtns");

    const coachModal = document.getElementById("coachModal");
    const coachForm = document.getElementById("coachForm");
    const openModalBtn = document.getElementById("openModalBtn");
    const closeModalBtn = document.getElementById("closeModal");

    const actionModal = document.getElementById("actionModal");
    const modalTitle = document.getElementById("modalTitle");
    const modalDescription = document.getElementById("modalDescription");
    
    const durationWrapper = document.getElementById("durationWrapper");
    const durationSelect = document.getElementById("suspendDuration");
    
    const reasonSelectWrapper = document.getElementById("suspendReasonSelectWrapper");
    const reasonSelect = document.getElementById("suspendReasonSelect");
    const reasonWrapper = document.getElementById("suspendReasonWrapper");
    const reasonInput = document.getElementById("suspendReason");
    
    const confirmBtn = document.getElementById("confirmModalBtn");
    const closeActionModal = document.getElementById("closeActionModal");

    if (!tableBody) return;

    async function fetchCoaches() {
        tableBody.innerHTML = `
            <tr>
                <td colspan="4" style="text-align:center;height:310px;color:var(--text-color);">
                    Loading coaches…
                </td>
            </tr>
        `;

        // Tinanggal muna natin ang `.select('... club')` para hindi mag-error ang database
        const { data, error } = await supabase
            .from("profiles")
            .select(`
                id,
                full_name,
                email,
                contact_number,
                status,
                suspended_until,
                suspension_reason,
                locked_until
            `)
            .eq("role", "coach")
            .order("full_name", { ascending: true });

        if (error) {
            console.error(error.message);
            tableBody.innerHTML = `
                <tr>
                    <td colspan="4" style="text-align:center;height:310px;color:var(--danger);">
                        Failed to load coaches.
                    </td>
                </tr>
            `;
            showAlert("Failed to load coaches.", "error");
            return;
        }

        const now = Date.now();

        coaches = (data || []).map(coach => ({
            ...coach,
            name: coach.full_name || "Unknown",
            contact: coach.contact_number || "—",
            email: coach.email || "—",
            isSuspended: coach.status === "suspended",
            isLocked: !!coach.locked_until && new Date(coach.locked_until).getTime() > now
        }));

        applySearchFilter();
    }

    function applySearchFilter() {
        const term = searchInput?.value.toLowerCase().trim() || "";

        filteredCoaches = coaches.filter(coach =>
            coach.name.toLowerCase().includes(term) ||
            coach.email.toLowerCase().includes(term) ||
            coach.contact.toLowerCase().includes(term)
        );

        const maxPages = Math.ceil(filteredCoaches.length / rowsPerPage);

        if (currentPage > maxPages) {
            currentPage = Math.max(1, maxPages);
        }

        renderTable();
    }

    function renderTable() {
        tableBody.innerHTML = "";

        const start = (currentPage - 1) * rowsPerPage;
        const end = start + rowsPerPage;
        const pageItems = filteredCoaches.slice(start, end);

        if (filteredCoaches.length === 0) {
            tableBody.innerHTML = `
                <tr>
                    <td colspan="4" style="text-align:center;height:310px;color:var(--text-color);">
                        No coaches found.
                    </td>
                </tr>
            `;

            updatePagination();
            updateInfoText(0, 0);
            return;
        }

        pageItems.forEach(coach => {
            const isSuspended = coach.isSuspended;
            const isLocked = coach.isLocked;

            let suspendBadge = "";

            if (isSuspended) {
                const untilLabel = coach.suspended_until
                    ? `Until ${new Date(coach.suspended_until).toLocaleDateString("en-PH", {
                        month: "short",
                        day: "numeric",
                        year: "numeric"
                    })}`
                    : "Indefinite";

                const reason = coach.suspension_reason
                    ? ` title="${coach.suspension_reason.replace(/"/g, "&quot;")}"`
                    : "";

                suspendBadge = `
                    <span class="suspend-badge"${reason}>
                        ${untilLabel}
                    </span>
                `;
            }

            const lockedBadge = isLocked
                ? `<span class="suspend-badge" title="Locked due to failed login attempts">Locked</span>`
                : "";

            const unlockBtn = isLocked
                ? `
                        <button
                            class="action-btn unlock"
                            title="Unlock Account"
                        >
                            <i class="bx bx-lock-open"></i>
                        </button>
                    `
                : "";

            tableBody.insertAdjacentHTML("beforeend", `
                <tr class="${isSuspended ? "is-suspended" : ""}" data-id="${coach.id}">
                    <td>
                        <span class="coach-name">${coach.name}</span>
                        ${suspendBadge}
                        ${lockedBadge}
                    </td>

                    <td>
                        <div class="coach-contact">${coach.contact}</div>
                        <div class="coach-email">${coach.email}</div>
                    </td>

                    <td style="text-align:center;">
                        <span class="status-badge ${
                            coach.status === "active"
                                ? "badge-active"
                                : "badge-inactive"
                        }">
                            ${coach.status || "pending"}
                        </span>
                    </td>

                    <td style="text-align:center;">
                        ${unlockBtn}
                        <button
                            class="action-btn suspend"
                            title="${isSuspended ? "Lift Suspension" : "Suspend Coach"}"
                        >
                            <i class="bx ${isSuspended ? "bx-play-circle" : "bx-user-x"}"></i>
                        </button>
                    </td>
                </tr>
            `);
        });

        const emptyRows = rowsPerPage - pageItems.length;

        for (let i = 0; i < emptyRows; i++) {
            tableBody.insertAdjacentHTML("beforeend", `
                <tr class="empty-row">
                    <td colspan="4" style="height:65px;">&nbsp;</td>
                </tr>
            `);
        }

        updatePagination();
        updateInfoText(start, end);
    }

    function updatePagination() {
        if (!paginationWrapper) return;

        paginationWrapper.innerHTML = "";

        const pageCount = Math.ceil(filteredCoaches.length / rowsPerPage);

        if (pageCount <= 1) return;

        const prevBtn = document.createElement("button");
        prevBtn.innerHTML = "<i class='bx bx-chevron-left'></i> Prev";
        prevBtn.disabled = currentPage === 1;

        prevBtn.addEventListener("click", () => {
            if (currentPage > 1) {
                currentPage--;
                renderTable();
            }
        });

        const pageLabel = document.createElement("span");
        pageLabel.className = "page-indicator";
        pageLabel.textContent = `Page ${currentPage} of ${pageCount}`;

        const nextBtn = document.createElement("button");
        nextBtn.innerHTML = "Next <i class='bx bx-chevron-right'></i>";
        nextBtn.disabled = currentPage === pageCount;

        nextBtn.addEventListener("click", () => {
            if (currentPage < pageCount) {
                currentPage++;
                renderTable();
            }
        });

        paginationWrapper.appendChild(prevBtn);
        paginationWrapper.appendChild(pageLabel);
        paginationWrapper.appendChild(nextBtn);
    }

    function updateInfoText(start, end) {
        const total = filteredCoaches.length;

        document.getElementById("totalEntries")?.replaceChildren(
            document.createTextNode(total)
        );

        document.getElementById("showingStart")?.replaceChildren(
            document.createTextNode(total === 0 ? 0 : start + 1)
        );

        document.getElementById("showingEnd")?.replaceChildren(
            document.createTextNode(Math.min(end, total))
        );
    }

    function openSuspendModal(coach) {
        currentTargetId = coach.id;
        currentActionType = "suspend";

        const isRestoring = coach.isSuspended;

        actionModal.classList.add("active");

        reasonSelectWrapper.style.display = isRestoring ? "none" : "block";
        reasonWrapper.style.display = "none";
        durationWrapper.style.display = "none";

        reasonSelect.value = "";
        reasonInput.value = "";
        durationSelect.value = "7";

        modalTitle.textContent = isRestoring
            ? "Restore Account"
            : "Suspend Account";

        modalTitle.style.color = isRestoring
            ? "var(--primary-color)"
            : "var(--warn)";

        modalDescription.textContent = isRestoring
            ? `Lift the suspension for ${coach.name}?`
            : `Choose the suspension reason and duration for ${coach.name}.`;

        confirmBtn.textContent = isRestoring
            ? "Lift Suspension"
            : "Confirm Suspension";

        confirmBtn.className = "modal-btn btn-confirm";
    }

    function openUnlockModal(coach) {
        currentTargetId = coach.id;
        currentActionType = "unlock";

        actionModal.classList.add("active");

        reasonSelectWrapper.style.display = "none";
        reasonWrapper.style.display = "none";
        durationWrapper.style.display = "none";

        reasonSelect.value = "";
        reasonInput.value = "";

        modalTitle.textContent = "Unlock Account";
        modalTitle.style.color = "var(--primary-color)";
        modalDescription.textContent =
            `Unlock ${coach.name}'s account? They will be able to log in again.`;

        confirmBtn.textContent = "Unlock";
        confirmBtn.className = "modal-btn btn-confirm";
    }

    function closeSuspendModal() {
        actionModal.classList.remove("active");
        currentTargetId = null;
        currentActionType = null;
        reasonInput.value = "";
        reasonSelect.value = "";
    }

    reasonSelect?.addEventListener("change", (e) => {
        const val = e.target.value;
        if (val) {
            durationWrapper.style.display = "block";
            if (val === "Other") {
                reasonWrapper.style.display = "block";
            } else {
                reasonWrapper.style.display = "none";
                reasonInput.value = "";
            }
        }
    });

    async function handleUnlock() {
        const { error } = await supabase.rpc("unlock_user_account", {
            p_user_id: currentTargetId
        });

        if (error) {
            console.error("Unlock failed:", error);
            showAlert("Failed to unlock account.", "error");
            return;
        }

        showAlert("Account unlocked successfully.", "success");
        closeSuspendModal();
        await fetchCoaches();
    }

    async function handleSuspension() {
        if (!currentTargetId) return;

        if (currentActionType === "unlock") {
            await handleUnlock();
            return;
        }

        const coach = coaches.find(c => c.id === currentTargetId);

        if (!coach) return;

        const isRestoring = coach.isSuspended;

        if (isRestoring) {
            const { error } = await supabase
                .from("profiles")
                .update({
                    status: "active",
                    suspended_until: null,
                    suspension_reason: null
                })
                .eq("id", currentTargetId);

            if (error) {
                showAlert("Failed to lift suspension.", "error");
                return;
            }

            showAlert("Coach suspension lifted.", "success");
        } else {
            const selectedReason = reasonSelect.value;

            if (!selectedReason) {
                showAlert("Please select a suspension reason.", "warning");
                reasonSelect.focus();
                return;
            }

            let finalReason = selectedReason;
            if (selectedReason === "Other") {
                const customReason = reasonInput.value.trim();
                finalReason = customReason ? `Other: ${customReason}` : "Other";
            }

            const days = parseInt(durationSelect.value, 10);
            const until = new Date();

            until.setDate(until.getDate() + days);

            const { error } = await supabase
                .from("profiles")
                .update({
                    status: "suspended",
                    suspended_until: until.toISOString(),
                    suspension_reason: finalReason
                })
                .eq("id", currentTargetId);

            if (error) {
                showAlert("Failed to suspend coach.", "error");
                return;
            }

            showAlert("Coach suspended successfully.", "success");
        }

        closeSuspendModal();
        await fetchCoaches();
    }

    openModalBtn?.addEventListener("click", () => {
        coachModal.classList.add("active");
    });

    closeModalBtn?.addEventListener("click", () => {
        coachModal.classList.remove("active");
        coachForm.reset();
    });

    document.getElementById("coachPhone")?.addEventListener("input", e => {
        e.target.value = e.target.value.replace(/\D/g, "").slice(0, 11);
    });

    document.getElementById("coachPhone")?.addEventListener("keypress", e => {
        if (!/[0-9]/.test(e.key)) e.preventDefault();
    });

    coachForm?.addEventListener("submit", async e => {
        e.preventDefault();

        const username = document.getElementById("coachUsername").value.trim();
        const full_name = document.getElementById("coachName").value.trim();
        const contact_number = document.getElementById("coachPhone").value.trim();
        const email = document.getElementById("coachEmail").value.trim();
        const club = document.getElementById("coachClub").value.trim(); // Nakalagay na sa input pero hindi muna isasama sa supabase query para iwas error sa column

        if (!full_name || !email || !username) {
            showAlert("Please fill in all required fields.", "error");
            return;
        }

        if (!/^09\d{9}$/.test(contact_number)) {
            showAlert("Mobile number must be 11 digits and start with 09.", "error");
            return;
        }

        const {
            data: { session }
        } = await supabase.auth.getSession();

        if (!session) {
            showAlert("Session expired. Please log in again.", "error");
            return;
        }

        try {
            const res = await fetch(
                "https://onygjhuelglxbfagvpjp.supabase.co/functions/v1/create-coach",
                {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        "Authorization": `Bearer ${session.access_token}`
                    },
                    body: JSON.stringify({
                        full_name,
                        email,
                        username,
                        contact_number,
                        club // Pwede itong tanggapin ng Edge Function mo kung kailangan
                    })
                }
            );

            const result = await res.json();

            if (!res.ok) {
                showAlert(
                    "Failed to create coach: " + (result.error || "Unknown error"),
                    "error"
                );
                return;
            }

            showAlert("Coach added successfully!", "success");

            coachForm.reset();
            coachModal.classList.remove("active");

            await fetchCoaches();
        } catch (error) {
            console.error(error);
            showAlert("Something went wrong while creating the coach.", "error");
        }
    });

    tableBody.addEventListener("click", e => {
        const button = e.target.closest(".action-btn.suspend, .action-btn.unlock");

        if (!button) return;

        const row = button.closest("tr");
        const coach = coaches.find(c => c.id === row.dataset.id);

        if (!coach) return;

        if (button.classList.contains("unlock")) {
            openUnlockModal(coach);
        } else {
            openSuspendModal(coach);
        }
    });

    closeActionModal?.addEventListener("click", closeSuspendModal);

    confirmBtn?.addEventListener("click", handleSuspension);

    searchInput?.addEventListener("input", () => {
        currentPage = 1;
        applySearchFilter();
    });

    fetchCoaches();
});