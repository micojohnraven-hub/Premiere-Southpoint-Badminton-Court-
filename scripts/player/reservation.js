import { supabase } from "../supabase/supabaseClient.js";
import { saveLog } from "../sysAdmin/sysLogs.js";

let currentUser = null;
let allReservations = [];
let activeFilter = "all";
let cancelTargetId = null;
let notifChannel = null;
let reservationChannel = null;
let promotedQR = null;
let promotedRow = null;
let promotedTimer = null;
let expiryTimer = null;
const autoOpenedIds = new Set();
const queueTakenShown = new Set();

// ─── INIT ───
async function init() {
    const { data: { session } } =
        await supabase.auth.getSession();

    const user = session?.user;

    if (!user) {
        window.location.href = "../auth/login.html";
        return;
    }

    currentUser = user;

    loadCachedReservations();

    setupFilters();
    setupCancelModal();
    setupPlayerNotifications();
    setupReservationRealtime();
    setupPromotedPaymentForm();
    loadPromotedQR();

    await Promise.all([
        loadReservations(),
        loadPlayerNotifications(user.id)
    ]);

    await handlePromotedRedirect();
}

// ─── CACHE ───
function getCacheKey() {
    return `reservations_cache_${currentUser.id}`;
}

function loadCachedReservations() {
    try {
        const raw = sessionStorage.getItem(getCacheKey());
        if (!raw) return;

        const cached = JSON.parse(raw);
        if (!Array.isArray(cached)) return;

        const normalized = cached.map(normalizeExpiredPromoted);

        allReservations = normalized;
        updateStats(normalized);
        renderReservations(normalized);
    } catch {
        sessionStorage.removeItem(getCacheKey());
    }
}

function saveReservationsCache(data) {
    try {
        sessionStorage.setItem(getCacheKey(), JSON.stringify(data));
    } catch {
        sessionStorage.removeItem(getCacheKey());
    }
}

// ─── RESERVATIONS ───
function isVisibleReservation(r) {
    if (r.status === "held") return !!r.queue_promoted_at;
    if (r.status === "cancelled" && r.hold_expires_at && !r.queue_promoted_at) return false;
    return true;
}

function getPromotedDeadline(r) {
    if (r.status === "pending" && r.expires_at) return r.expires_at;
    if (r.status === "held" && r.queue_promoted_at && r.hold_expires_at) return r.hold_expires_at;
    return null;
}

function isExpiredPromoted(r) {
    const deadline = getPromotedDeadline(r);
    return !!deadline && new Date(deadline) <= new Date();
}

function normalizeExpiredPromoted(r) {
    if (!isExpiredPromoted(r)) return r;

    return {
        ...r,
        status: "cancelled",
        expires_at: null,
        hold_expires_at: null
    };
}

function isAwaitingSelection(r) {
    return !!getPromotedDeadline(r) && !isExpiredPromoted(r);
}

function scheduleExpiryRefresh(data) {
    clearTimeout(expiryTimer);

    const upcoming = data
        .map(getPromotedDeadline)
        .filter(Boolean)
        .map(d => new Date(d).getTime())
        .filter(t => t > Date.now());

    if (upcoming.length === 0) return;

    const delay = Math.min(...upcoming) - Date.now() + 500;

    expiryTimer = setTimeout(async () => {
        await supabase.rpc("release_expired_holds");
        await loadReservations();
    }, delay);
}

async function loadReservations() {
    const { data, error } = await supabase
        .from("reservations")
        .select("*, courts(name)")
        .eq("user_id", currentUser.id)
        .order("created_at", { ascending: false });

    if (error) {
        console.error(error);
        return;
    }

    const visible = data
        .map(normalizeExpiredPromoted)
        .filter(isVisibleReservation);

    allReservations = visible;
    saveReservationsCache(visible);
    updateStats(visible);
    renderReservations(visible);
    scheduleExpiryRefresh(visible);
}

function updateStats(data) {
    document.getElementById("statConfirmed").textContent =
        data.filter(r => r.status === "confirmed").length;

    document.getElementById("statPending").textContent =
        data.filter(r =>
            ["pending", "pending_verification", "held"].includes(r.status)
        ).length;

    document.getElementById("statQueued").textContent =
        data.filter(r => r.status === "queued").length;

    document.getElementById("statCancelled").textContent =
        data.filter(r => r.status === "cancelled").length;
}

function renderReservations(data) {
    const list = document.getElementById("reservationsList");

    const filtered = activeFilter === "all"
        ? data
        : data.filter(r =>
            r.status === activeFilter ||
            (activeFilter === "pending" && r.status === "held")
        );

    if (filtered.length === 0) {
        list.innerHTML = `
            <div class="empty-state">
                <i class='bx bx-calendar-x'></i>
                <p>No ${activeFilter === "all"
                    ? ""
                    : activeFilter + " "}reservations found.</p>
            </div>
        `;
        return;
    }

    const badgeMap = {
        confirmed: "Confirmed",
        pending: "Pending Payment",
        pending_verification: "Awaiting Verification",
        held: "Slot Held",
        queued: "Queued",
        cancelled: "Cancelled",
        no_show: "No Show"
    };

    list.innerHTML = filtered.map(r => {
        const canCancel = [
            "pending",
            "pending_verification",
            "queued",
            "confirmed"
        ].includes(r.status);

        const awaiting = isAwaitingSelection(r);

        const formattedStatus = r.status
            ? r.status.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase())
            : "";
        const badgeLabel = badgeMap[r.status] || formattedStatus;

        const paymentLabel = awaiting
            ? "Select payment method"
            : r.payment_method;

        return `
            <div class="res-card">
                <div class="res-icon">
                    <i class='bx bx-tennis-ball'></i>
                </div>

                <div class="res-main">
                    <h4>${r.courts?.name || "Court"}</h4>

                    <div class="res-meta">
                        <span>
                            <i class='bx bx-calendar-alt'></i>
                            ${r.reservation_date}
                        </span>

                        <span>
                            <i class='bx bx-time-five'></i>
                            ${r.start_time} – ${r.end_time}
                        </span>

                        <span>
                            <i class='bx bx-stopwatch'></i>
                            ${r.duration_hours}hr${r.duration_hours > 1 ? "s" : ""}
                        </span>

                        <span>
                            <i class='bx bx-credit-card'></i>
                            ${paymentLabel}
                        </span>
                    </div>
                </div>

                <div class="res-right">
                    <span class="res-amount">
                        ₱${Number(r.total_amount).toFixed(2)}
                    </span>

                    <span class="badge ${r.status}">
                        ${badgeLabel}
                    </span>

                    ${awaiting
                        ? `
                            <button
                                class="btn-pay-now"
                                data-id="${r.id}">
                                Pay Now
                            </button>
                        `
                        : ""}

                    ${canCancel
                        ? `
                            <button
                                class="btn-cancel"
                                data-id="${r.id}"
                                data-court="${r.courts?.name}"
                                data-date="${r.reservation_date}">
                                Cancel
                            </button>
                        `
                        : ""}
                </div>
            </div>
        `;
    }).join("");

    list.querySelectorAll(".btn-cancel").forEach(btn => {
        btn.addEventListener("click", () => {
            openCancelModal(
                btn.dataset.id,
                btn.dataset.court,
                btn.dataset.date
            );
        });
    });

    list.querySelectorAll(".btn-pay-now").forEach(btn => {
        btn.addEventListener("click", () => {
            openPromotedPaymentModal(btn.dataset.id);
        });
    });
}

function setupFilters() {
    document.querySelectorAll(".tab-btn").forEach(btn => {
        btn.addEventListener("click", () => {
            document
                .querySelectorAll(".tab-btn")
                .forEach(b => b.classList.remove("active"));

            btn.classList.add("active");
            activeFilter = btn.dataset.filter;

            renderReservations(allReservations);
        });
    });
}

// ─── LIVE RESERVATION UPDATES ───
function setupReservationRealtime() {
    if (reservationChannel) {
        supabase.removeChannel(reservationChannel);
    }

    reservationChannel = supabase
        .channel(`player-reservations-${currentUser.id}`)
        .on(
            "postgres_changes",
            {
                event: "UPDATE",
                schema: "public",
                table: "reservations",
                filter: `user_id=eq.${currentUser.id}`
            },
            async payload => {
                const row = payload.new;

                if (
                    row.status === "cancelled" &&
                    row.cancelled_from_queue &&
                    !queueTakenShown.has(row.id)
                ) {
                    queueTakenShown.add(row.id);
                    showQueueSlotTakenModal(row);
                }

                const deadline = getPromotedDeadline(row);

                if (
                    deadline &&
                    new Date(deadline) > new Date() &&
                    !autoOpenedIds.has(row.id)
                ) {
                    autoOpenedIds.add(row.id);
                    await openPromotedPaymentModal(row);
                }

                await loadReservations();
            }
        )
        .subscribe();
}

// ─── QUEUE SLOT TAKEN ───
function showQueueSlotTakenModal(row) {
    let modal = document.getElementById("queueTakenModal");

    if (!modal) {
        modal = document.createElement("div");
        modal.id = "queueTakenModal";
        modal.className = "modal";
        document.body.appendChild(modal);
    }

    const known = allReservations.find(r => r.id === row.id);
    const courtLabel = known?.courts?.name ? `${known.courts.name} ` : "";

    modal.innerHTML = `
        <div class="modal-content">
            <i class='bx bx-error-circle' style="font-size:3rem;color:#ef4444;display:block;margin-bottom:12px;"></i>
            <h3>Queued Slot Now Taken</h3>
            <p>
                The slot you were queued for (${courtLabel}${row.reservation_date}, ${row.start_time} – ${row.end_time})
                was confirmed by another player. We can suggest other available slots for you.
            </p>
            <div class="modal-btns">
                <button class="btn-secondary" id="btnQueueTakenClose">Later</button>
                <button class="btn-primary" id="btnQueueTakenFind">Find Another Slot</button>
            </div>
        </div>
    `;

    modal.style.display = "flex";

    document.getElementById("btnQueueTakenClose").onclick = () => {
        modal.style.display = "none";
    };

    document.getElementById("btnQueueTakenFind").onclick = () => {
        window.location.href = `CourtList.html?queue_conflict=${row.id}`;
    };
}

// ─── CANCEL MODAL ───
function openCancelModal(id, courtName, date) {
    cancelTargetId = id;

    document.getElementById("cancelModalText").textContent =
        `Cancel your reservation for ${courtName} on ${date}? The next person in queue will be automatically promoted.`;

    document.getElementById("cancelModal").style.display = "flex";
}

function setupCancelModal() {
    const modal = document.getElementById("cancelModal");

    document.getElementById("btnCancelNo")
        .addEventListener("click", () => {
            modal.style.display = "none";
            cancelTargetId = null;
        });

    document.getElementById("btnCancelYes")
        .addEventListener("click", async () => {
            if (!cancelTargetId) return;

            modal.style.display = "none";

            const res = allReservations.find(
                r => r.id === cancelTargetId
            );

            const { error: cancelError } =
                await supabase.rpc("cancel_player_reservation", {
                    p_reservation_id: cancelTargetId,
                    p_user_id: currentUser.id
                });

            if (cancelError) {
                await saveLog(
                    "SYSTEM",
                    "Reservation cancellation failed",
                    currentUser.email || "Unknown_User",
                    "warning"
                );

                showAlert("Failed to cancel: " + cancelError.message, "error");
                cancelTargetId = null;
                return;
            }

            if (res) {
                const { error: notifError } =
                    await supabase
                        .from("notifications")
                        .insert({
                            user_id: currentUser.id,
                            title: "Reservation Cancelled ❌",
                            message:
                                `You cancelled your reservation for ${res.courts?.name} on ${res.reservation_date} (${res.start_time}–${res.end_time}).`
                        });

                if (notifError) {
                    console.warn(
                        "Notification failed:",
                        notifError.message
                    );
                }

                await saveLog(
                    "SYSTEM",
                    `Reservation cancelled: ${res.courts?.name || "Court"} on ${res.reservation_date}`,
                    currentUser.email || "Unknown_User",
                    "success"
                );
            }

            cancelTargetId = null;

            await loadReservations();
            await loadPlayerNotifications(currentUser.id);
        });
}

// ─── NOTIFICATIONS ───
function setupPlayerNotifications() {
    if (notifChannel) {
        supabase.removeChannel(notifChannel);
    }

    notifChannel = supabase
        .channel(`player-notifications-${currentUser.id}`)
        .on(
            "postgres_changes",
            {
                event: "INSERT",
                schema: "public",
                table: "notifications",
                filter: `user_id=eq.${currentUser.id}`
            },
            async payload => {
                const notif = payload.new;

                if (notif?.message) {
                    showAlert(
                        `${notif.title}: ${notif.message}`,
                        "info"
                    );
                }

                await loadPlayerNotifications(
                    currentUser.id
                );
                await loadReservations();
            }
        )
        .subscribe();
}

function isPromotedNotif(type, title = "") {
    return type === "slot_promoted" || title.toLowerCase().includes("slot");
}

async function loadPlayerNotifications(userId) {
    const { data, error } = await supabase
        .from("notifications")
        .select(
            "id, title, message, is_read, created_at, type, reservation_id"
        )
        .eq("user_id", userId)
        .order("created_at", { ascending: false });

    const list = document.getElementById("notifList");

    if (error || !data || data.length === 0) {
        list.innerHTML =
            `<li class="notif-empty">No new notifications.</li>`;

        await refreshPlayerNotifBadge(userId);
        return;
    }

    list.innerHTML = data.map(notif => `
        <li
            class="notif-item ${notif.is_read ? "" : "unread"}"
            data-id="${notif.id}"
            data-type="${notif.type || "general"}"
            data-reservation-id="${notif.reservation_id || ""}"
            style="cursor:pointer;"
        >
            <div class="notif-icon ${getNotifIconClass(notif.title)}">
                <i class='bx ${getNotifIcon(notif.title)}'></i>
            </div>

            <div class="notif-text">
                <p><strong>${notif.title}</strong></p>
                <p>${notif.message}</p>
                <span>
                    ${getTimeAgo(new Date(notif.created_at))}
                </span>

                ${notif.type === "queue_cancelled"
                    ? `
                        <span
                            style="
                                color:#16a34a;
                                font-weight:600;
                                font-size:0.8rem;
                            ">
                            Tap to choose another slot →
                        </span>
                    `
                    : isPromotedNotif(notif.type, notif.title)
                    ? `
                        <span
                            style="
                                color:#ef4444;
                                font-weight:600;
                                font-size:0.8rem;
                                display:block;
                                margin-top:4px;
                            ">
                            ⚠️ Note: Only for 10 minutes before the start game / expiration! Tap to pay →
                        </span>
                    `
                    : ""}
            </div>
        </li>
    `).join("");

    list.querySelectorAll(".notif-item[data-id]").forEach(item => {
        item.addEventListener("click", async () => {
            await markPlayerNotifRead(item, userId);

            const notifType = item.dataset.type;
            const title = item.querySelector("strong")?.textContent || "";
            const reservationId = item.dataset.reservationId;

            if (notifType === "queue_cancelled") {
                window.location.href = reservationId
                    ? `CourtList.html?queue_conflict=${reservationId}`
                    : "CourtList.html";
                return;
            }

            if (isPromotedNotif(notifType, title)) {
                if (reservationId) {
                    window.location.href = `reservation.html?promoted_id=${reservationId}`;
                } else {
                    window.location.href = "reservation.html";
                }
            }
        });
    });

    await refreshPlayerNotifBadge(userId);
}

async function markPlayerNotifRead(item, userId) {
    if (!item.classList.contains("unread")) return;

    const notifId = item.dataset.id;

    const { error } = await supabase
        .from("notifications")
        .update({ is_read: true })
        .eq("id", notifId);

    if (error) return;

    item.classList.remove("unread");
    await refreshPlayerNotifBadge(userId);
}

async function refreshPlayerNotifBadge(userId) {
    const { data } = await supabase
        .from("notifications")
        .select("id")
        .eq("user_id", userId)
        .eq("is_read", false);

    const badge = document.getElementById("notifBadge");
    if (!badge) return;

    const count = data?.length || 0;
    badge.textContent = count > 0 ? count : "";
    badge.style.display = count > 0 ? "flex" : "none";
}

function getNotifIconClass(title = "") {
    if (title.toLowerCase().includes("accept")) {
        return "completed";
    }

    if (
        title.toLowerCase().includes("decline") ||
        title.toLowerCase().includes("unavailable")
    ) {
        return "reminder";
    }

    return "new-req";
}

function getNotifIcon(title = "") {
    if (title.toLowerCase().includes("accept")) {
        return "bx-check-circle";
    }

    if (
        title.toLowerCase().includes("decline") ||
        title.toLowerCase().includes("unavailable")
    ) {
        return "bx-x-circle";
    }

    return "bx-bell";
}

// ─── PROMOTED PAYMENT QR ───
async function loadPromotedQR() {
    if (promotedQR) return promotedQR;

    const { data, error } = await supabase
        .from("payment_qr_codes")
        .select("id, provider, account_name, qr_image_url")
        .eq("owner_role", "business_admin")
        .eq("is_active", true)
        .maybeSingle();

    promotedQR = error ? null : data;

    if (promotedQR?.qr_image_url) {
        const preload = new Image();
        preload.src = promotedQR.qr_image_url;
    }

    return promotedQR;
}

function ensurePromotedQRBlock() {
    let block = document.getElementById("promotedQRBlock");
    if (block) return block;

    const container = document.getElementById("promotedProofContainer");
    if (!container) return null;

    block = document.createElement("div");
    block.id = "promotedQRBlock";
    block.style.cssText = "text-align:center;margin-bottom:14px;";
    block.innerHTML = `
        <p style="margin:0 0 8px;font-size:0.85rem;color:#6b7280;">
            Scan the QR code to pay via GCash / Maya
        </p>
        <img
            id="promotedQRImage"
            alt="Payment QR"
            style="width:200px;max-width:100%;border-radius:12px;border:1px solid #e5e7eb;display:none;">
        <p id="promotedQRAccount" style="margin:8px 0 0;font-size:0.85rem;font-weight:600;color:#374151;"></p>
        <p id="promotedQRAmount" style="margin:4px 0 0;font-size:1.1rem;font-weight:800;color:#16a34a;"></p>
    `;

    container.insertBefore(block, container.firstChild);
    return block;
}

function renderPromotedQR(row) {
    const block = ensurePromotedQRBlock();
    if (!block) return;

    const image = document.getElementById("promotedQRImage");
    const account = document.getElementById("promotedQRAccount");
    const amount = document.getElementById("promotedQRAmount");

    amount.textContent = `₱${Number(row.total_amount).toFixed(2)}`;

    if (!promotedQR) {
        image.style.display = "none";
        account.textContent = "E-wallet payment is currently unavailable. Please choose Cash or contact the front desk.";
        return;
    }

    image.src = promotedQR.qr_image_url;
    image.style.display = "inline-block";
    account.textContent = `${promotedQR.provider} • ${promotedQR.account_name}`;
}

// ─── PROMOTED PAYMENT MODAL ───
async function handlePromotedRedirect() {
    const params = new URLSearchParams(window.location.search);
    const promotedId = params.get("promoted_id");

    if (!promotedId) return;

    window.history.replaceState({}, "", window.location.pathname);

    const { data, error } = await supabase
        .from("reservations")
        .select("*")
        .eq("id", promotedId)
        .eq("user_id", currentUser.id)
        .single();

    if (error || !data) {
        showAlert("Reservation not found.", "error");
        return;
    }

    const deadline = getPromotedDeadline(data);

    if (!deadline) {
        showAlert("This reservation no longer needs payment details.", "info");
        return;
    }

    if (new Date(deadline) <= new Date()) {
        showAlert("Your 10-minute payment window has expired.", "warning");
        return;
    }

    autoOpenedIds.add(data.id);
    await openPromotedPaymentModal(data);
}

function startPromotedCountdown(deadlineIso) {
    clearInterval(promotedTimer);

    const form = document.getElementById("promotedPaymentForm");
    if (!form || !deadlineIso) return;

    const deadline = new Date(deadlineIso).getTime();

    let el = document.getElementById("promotedCountdown");
    if (!el) {
        el = document.createElement("p");
        el.id = "promotedCountdown";
        el.style.cssText = "text-align:center;font-size:0.85rem;font-weight:700;color:#b45309;margin:0 0 10px;";
        form.insertBefore(el, form.firstChild);
    }

    const tick = async () => {
        const remaining = deadline - Date.now();

        if (remaining <= 0) {
            clearInterval(promotedTimer);
            closePromotedModal();
            showAlert("Your 10-minute payment window has expired.", "warning");
            await supabase.rpc("release_expired_holds");
            await loadReservations();
            return;
        }

        const minutes = Math.floor(remaining / 60000);
        const seconds = Math.floor((remaining % 60000) / 1000);
        el.textContent = `Slot held for you: ${minutes}:${String(seconds).padStart(2, "0")}`;
    };

    tick();
    promotedTimer = setInterval(tick, 1000);
}

async function openPromotedPaymentModal(target) {
    const modal = document.getElementById("promotedPaymentModal");
    const inputId = document.getElementById("modalReservationId");

    if (!modal || !inputId) return;

    let row = typeof target === "object"
        ? target
        : allReservations.find(r => r.id === target);

    if (!row) {
        const { data } = await supabase
            .from("reservations")
            .select("*")
            .eq("id", target)
            .eq("user_id", currentUser.id)
            .maybeSingle();

        row = data;
    }

    if (!row) return;

    promotedRow = row;

    document.getElementById("promotedPaymentForm")?.reset();
    document.getElementById("promotedProofContainer")?.classList.remove("show");

    inputId.value = row.id;

    const methodSelect = document.getElementById("modalPaymentMethod");
    if (
        methodSelect &&
        row.payment_method &&
        [...methodSelect.options].some(o => o.value === row.payment_method)
    ) {
        methodSelect.value = row.payment_method;
        togglePromotedProofField(methodSelect.value);
    }

    modal.classList.add("show");

    renderPromotedQR(row);
    startPromotedCountdown(getPromotedDeadline(row));

    if (!promotedQR) {
        await loadPromotedQR();
        renderPromotedQR(row);
    }
}

function closePromotedModal() {
    clearInterval(promotedTimer);
    promotedTimer = null;
    document.getElementById("promotedPaymentModal")?.classList.remove("show");
}

function togglePromotedProofField(method) {
    const container = document.getElementById("promotedProofContainer");
    if (!container) return;

    container.classList.toggle("show", method === "E-wallet");
}

function setupPromotedPaymentForm() {
    const form = document.getElementById("promotedPaymentForm");
    if (!form) return;

    form.addEventListener("submit", async e => {
        e.preventDefault();

        const submitBtn = document.getElementById("promotedSubmitBtn");
        const reservationId = document.getElementById("modalReservationId").value;
        const paymentMethod = document.getElementById("modalPaymentMethod").value;
        const refNum = document.getElementById("promotedReferenceNumber")?.value.trim();
        const file = document.getElementById("promotedPaymentScreenshot")?.files[0];

        if (!paymentMethod) {
            showAlert("Please select a payment method.", "warning");
            return;
        }

        if (paymentMethod === "E-wallet" && (!file || !refNum)) {
            showAlert("Please upload your payment screenshot and enter the reference number.", "warning");
            return;
        }

        submitBtn.disabled = true;

        if (paymentMethod === "E-wallet") {
            const qr = await loadPromotedQR();

            if (!qr) {
                showAlert("E-wallet payment is currently unavailable. Please choose Cash or contact the front desk.", "warning");
                submitBtn.disabled = false;
                return;
            }
        }

        let screenshotUrl = null;

        if (paymentMethod === "E-wallet") {
            const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
            const filePath = `payments/${Date.now()}_${safeName}`;

            const { error: uploadError } = await supabase.storage
                .from("payment-screenshots")
                .upload(filePath, file, { cacheControl: "3600", upsert: false, contentType: file.type });

            if (uploadError) {
                showAlert("Failed to upload screenshot: " + uploadError.message, "error");
                submitBtn.disabled = false;
                return;
            }

            const { data: publicUrlData } = supabase.storage
                .from("payment-screenshots")
                .getPublicUrl(filePath);

            screenshotUrl = publicUrlData.publicUrl;
        }

        const newStatus = paymentMethod === "E-wallet"
            ? "pending_verification"
            : "pending";

        const updateFields = {
            payment_method: paymentMethod,
            reference_number: paymentMethod === "E-wallet" ? refNum : null,
            payment_screenshot: screenshotUrl,
            status: newStatus,
            expires_at: null,
            hold_expires_at: null
        };

        if (paymentMethod === "E-wallet") {
            updateFields.payment_qr_id = promotedQR.id;
        }

        const isHeld = promotedRow?.id === reservationId && promotedRow?.status === "held";
        const nowIso = new Date().toISOString();

        let query = supabase
            .from("reservations")
            .update(updateFields)
            .eq("id", reservationId)
            .eq("user_id", currentUser.id);

        query = isHeld
            ? query.eq("status", "held").gt("hold_expires_at", nowIso)
            : query.eq("status", "pending").gt("expires_at", nowIso);

        const { data: updated, error: updateError } = await query.select("id");

        submitBtn.disabled = false;

        if (updateError) {
            showAlert("Failed to submit payment details: " + updateError.message, "error");
            return;
        }

        if (!updated || updated.length === 0) {
            showAlert("This slot can no longer be updated. Your payment window may have expired.", "warning");
            closePromotedModal();
            await loadReservations();
            return;
        }

        closePromotedModal();

        showAlert(
            paymentMethod === "E-wallet"
                ? "Payment details submitted. Waiting for staff verification."
                : "Cash selected. Please pay at the counter.",
            "success"
        );

        await loadReservations();
    });
}

// ─── UI HELPERS ───
function showAlert(message, type = "info") {
    document.getElementById("globalToast")?.remove();

    const colors = {
        success: "#16a34a",
        error: "#ef4444",
        warning: "#f59e0b",
        info: "#3b82f6"
    };

    const toast = document.createElement("div");
    toast.id = "globalToast";
    toast.textContent = message;
    toast.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        background: ${colors[type] || colors.info};
        color: white;
        padding: 12px 16px;
        border-radius: 10px;
        box-shadow: 0 10px 25px rgba(0,0,0,0.15);
        z-index: 99999999;
        font-size: 14px;
        font-weight: 600;
        max-width: 320px;
    `;

    document.body.appendChild(toast);

    setTimeout(() => toast.remove(), 3500);
}

function getTimeAgo(date) {
    const diff =
        Math.floor((Date.now() - date.getTime()) / 1000);

    if (diff < 60) return "Just now";
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;

    return `${Math.floor(diff / 86400)}d ago`;
}

function toggleNotifPanel() {
    document
        .getElementById("notifPanel")
        .classList.toggle("open");
}

async function clearNotifs() {
    await supabase
        .from("notifications")
        .update({ is_read: true })
        .eq("user_id", currentUser.id)
        .eq("is_read", false);

    document
        .querySelectorAll(".notif-item.unread")
        .forEach(item => {
            item.classList.remove("unread");
        });

    document.getElementById("notifBadge").style.display =
        "none";

    document
        .getElementById("notifPanel")
        .classList.remove("open");
}

document.addEventListener("click", e => {
    const wrapper =
        document.querySelector(".notif-wrapper");

    if (
        wrapper &&
        !wrapper.contains(e.target)
    ) {
        document
            .getElementById("notifPanel")
            ?.classList.remove("open");
    }
});

// ─── EXPORTS ───
window.toggleNotifPanel = toggleNotifPanel;
window.clearNotifs = clearNotifs;
window.closePromotedModal = closePromotedModal;
window.togglePromotedProofField = togglePromotedProofField;

init();