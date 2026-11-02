import { supabase, cached, invalidateCache } from "../supabase/supabaseClient.js";
import { checkAndShowEmployeeAnnouncements, loadEmployeeAnnouncements } from "../../scripts/shared/Announcement.js";

let allReservations = [];

// ─── INIT ───
document.addEventListener('DOMContentLoaded', async () => {
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
        window.location.href = "../../pages/auth/login.html";
        return;
    }

    const { data: profile } = await supabase
        .from('profiles')
        .select('role, full_name')
        .eq('id', user.id)
        .single();

    if (!profile || profile.role === 'player') {
        showAlert("Access denied. Employee only.", 'error');
        window.location.href = "../../pages/auth/login.html";
        return;
    }

    document.querySelector('.bottom-content a')?.addEventListener('click', async (e) => {
        e.preventDefault();
        await supabase.auth.signOut();
        window.location.href = "../../pages/auth/login.html";
    });

    document.querySelector('.search-wrapper input')?.addEventListener('input', (e) => {
        const query = e.target.value.toLowerCase();
        document.querySelectorAll('.data-row').forEach(row => {
            row.style.display = row.innerText.toLowerCase().includes(query) ? '' : 'none';
        });
    });

    await supabase.rpc('release_expired_holds');
    await renderReservations();
    await loadStats();
    await loadEmployeeAnnouncements(user.id);
    await checkAndShowEmployeeAnnouncements(user.id);
    startAutoRefresh();

    supabase
        .channel('employee-reservations-realtime')
        .on('postgres_changes',
            { event: '*', schema: 'public', table: 'reservations' },
            async () => {
                await renderReservations();
                await loadStats();
            }
        )
        .on('postgres_changes',
            { event: '*', schema: 'public', table: 'courts' },
            async () => {
                invalidateCache('courts:');
                await loadStats();
            }
        )
        .subscribe();
});

// ─── AUTO REFRESH ───
let pollTimer = null;
let isRefreshing = false;

async function runRefresh() {
    if (document.visibilityState !== 'visible') return;
    if (isAnyModalOpen()) return;
    if (isRefreshing) return;

    isRefreshing = true;
    try {
        await supabase.rpc('release_expired_holds');
        await Promise.all([
            renderReservations(true),
            loadStats()
        ]);
    } catch (err) {
        console.error("Auto refresh error:", err);
    } finally {
        isRefreshing = false;
    }
}

function handleVisibilityChange() {
    if (document.visibilityState === 'visible') {
        runRefresh();
        startPolling();
    } else {
        stopPolling();
    }
}

function startPolling() {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = setInterval(runRefresh, 15_000);
}

function stopPolling() {
    if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
    }
}

function startAutoRefresh() {
    document.removeEventListener('visibilitychange', handleVisibilityChange);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    ['confirmModal', 'detailsModal'].forEach(id => {
        const el = document.getElementById(id);
        if (!el) return;

        new MutationObserver(() => {
            if (isAnyModalOpen()) {
                stopPolling();
            } else {
                runRefresh();
                startPolling();
            }
        }).observe(el, { attributes: true, attributeFilter: ['class'] });
    });

    startPolling();
}

function isAnyModalOpen() {
    const isStandardModalOpen = ['confirmModal', 'detailsModal'].some(id => {
        const el = document.getElementById(id);
        return el?.classList.contains('show');
    });
    const isCustomDialogOpen = !!document.getElementById('_confirmDialog');

    return isStandardModalOpen || isCustomDialogOpen;
}

// ─── SESSION ───
async function getEmployeeId() {
    const { data: { session } } = await supabase.auth.getSession();
    const id = session?.user?.id ?? null;

    if (!id) {
        showAlert("Your session expired. Please log in again.", 'error');
        setTimeout(() => { window.location.href = "../../pages/auth/login.html"; }, 1500);
    }

    return id;
}

// ─── HELPERS ───
function isAwaitingSelection(r) {
    return r.status === 'pending' && !!r.expires_at;
}

function formatExpiry(expiresAt) {
    return new Date(expiresAt).toLocaleTimeString('en-US', {
        timeZone: 'Asia/Manila',
        hour: '2-digit',
        minute: '2-digit',
        hour12: true
    });
}

async function promoteReservation(target, courtName) {
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

    const { error: promoteErr } = await supabase
        .from('reservations')
        .update({
            status: 'pending',
            expires_at: expiresAt
        })
        .eq('id', target.id)
        .eq('status', 'queued');

    if (promoteErr) return false;

    await supabase.from('notifications').insert({
        user_id:        target.user_id,
        reservation_id: target.id,
        type:           'slot_promoted',
        title:          'You get the slot! 🎾',
        message:        `The slot for ${courtName} on ${target.reservation_date} (${target.start_time}–${target.end_time}) is now yours! Please select your payment method and complete payment within 10 minutes to secure your booking.`
    });

    return true;
}

// ─── STATS ───
async function loadStats() {
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' });
    const nowPH = new Date().toLocaleTimeString('en-US', {
        timeZone: 'Asia/Manila',
        hour: '2-digit',
        minute: '2-digit',
        hour12: true
    });

    function toMinutes(timeStr) {
        if (!timeStr) return 0;
        const [time, meridiem] = timeStr.trim().split(' ');
        let [h, m] = time.split(':').map(Number);
        if (meridiem === 'PM' && h !== 12) h += 12;
        if (meridiem === 'AM' && h === 12) h = 0;
        return h * 60 + m;
    }
    const nowMinutes = toMinutes(nowPH);

    const [
        { data: todayReservations },
        allCourts
    ] = await Promise.all([
        supabase.from('reservations')
            .select('court_id, status, end_time')
            .eq('reservation_date', today),

        cached('courts:active', async () => {
            const { data, error } = await supabase
                .from('courts')
                .select('id')
                .eq('is_active', true);
            if (error) throw error;
            return data || [];
        }, { ttl: 60000 }).catch(() => [])
    ]);

    if (!todayReservations) return;

    const pendingCount = todayReservations.filter(r =>
        ['pending', 'pending_verification'].includes(r.status)
    ).length;

    const playingReservations = todayReservations.filter(r => r.status === 'playing');
    const uniqueActiveCourts = new Set(playingReservations.map(r => r.court_id)).size;

    const completedCount = todayReservations.filter(r =>
        r.status === 'confirmed' && toMinutes(r.end_time) < nowMinutes
    ).length;

    const totalCount = todayReservations.filter(r =>
        ['confirmed', 'completed', 'no_show'].includes(r.status)
    ).length;

    const statCards = document.querySelectorAll('.stat-card .s-info h2');
    if (statCards[0]) statCards[0].innerText = pendingCount;
    if (statCards[1]) statCards[1].innerText = `${uniqueActiveCourts}/${allCourts?.length || 0}`;
    if (statCards[2]) statCards[2].innerText = completedCount;
    if (statCards[3]) statCards[3].innerText = totalCount;
}

// ─── RENDER RESERVATIONS ───
let currentDataString = '';

async function renderReservations(silent = false) {
    const content = document.getElementById('dynamicContent');
    if (!content) return;

    if (!silent && (!allReservations || !allReservations.length)) {
        content.innerHTML = `<p style="padding:20px;color:#888;text-align:center;">
            <i class='bx bx-loader-alt bx-spin'></i> Loading reservations...
        </p>`;
    }

    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' });

    const { data, error } = await supabase
        .from('reservations')
        .select(`
            id, reservation_date, start_time, end_time,
            duration_hours, total_amount, payment_method,
            status, reference_number, payment_screenshot, court_id, created_at, expires_at,
            courts ( name ),
            profiles!reservations_user_id_fkey_profiles ( full_name, email, username )
        `)
        .gte('reservation_date', today)
        .in('status', ['pending_verification', 'pending', 'confirmed', 'queued', 'no_show'])
        .order('reservation_date', { ascending: true })
        .order('created_at', { ascending: true });

    if (error) {
        content.innerHTML = `<p style="padding:20px;color:#ef4444;text-align:center;">
            Failed to load: ${error.message}
        </p>`;
        return;
    }

    const newDataString = JSON.stringify(data);
    if (newDataString === currentDataString) return;
    currentDataString = newDataString;

    allReservations = data;

    if (!data || data.length === 0) {
        content.innerHTML = `
            <div style="padding:60px;text-align:center;color:#aaa;">
                <i class='bx bx-calendar-x' style="font-size:48px;display:block;margin-bottom:12px;"></i>
                <h3 style="margin:0 0 8px;color:#9ca3af;">No Reservations Found</h3>
                <p style="font-size:0.85rem;margin:0;">No upcoming bookings available.</p>
            </div>`;
        return;
    }

    const groups = {
        awaiting_selection: data.filter(r => isAwaitingSelection(r)),
        pending_verification: data.filter(r =>
            !isAwaitingSelection(r) &&
            r.payment_method !== 'Cash' &&
            ['pending', 'pending_verification'].includes(r.status)
        ),
        pending: data.filter(r =>
            !isAwaitingSelection(r) &&
            r.payment_method === 'Cash' &&
            ['pending', 'pending_verification'].includes(r.status)
        ),
        confirmed: data.filter(r => r.status === 'confirmed'),
        queued:    data.filter(r => r.status === 'queued'),
        no_show:   data.filter(r => r.status === 'no_show'),
        cancelled: data.filter(r => r.status === 'cancelled'),
    };

    const groupMeta = [
        { key: 'awaiting_selection',   label: ' Promoted — Awaiting Player Payment Selection', color: '#0ea5e9', icon: 'bx-hourglass' },
        { key: 'pending_verification', label: ' Pending GCash / E-Wallet Verification',        color: '#f59e0b', icon: 'bx-time-five' },
        { key: 'pending',              label: ' Awaiting Cash Payment at Counter',             color: '#3b82f6', icon: 'bx-dollar-circle' },
        { key: 'confirmed',            label: ' Confirmed',                                    color: '#22c55e', icon: 'bx-check-circle' },
        { key: 'queued',               label: ' Queued',                                      color: '#a855f7', icon: 'bx-refresh' },
        { key: 'no_show',              label: ' No Show',                                     color: '#f97316', icon: 'bx-user-x' },
        { key: 'cancelled',            label: ' Cancelled',                                   color: '#ef4444', icon: 'bx-x-circle' },
    ];

    let htmlBuffer = '';

    groupMeta.forEach(({ key, icon, label, color }) => {
        const items = groups[key];
        if (!items || !items.length) return;

        htmlBuffer += `
            <div style="
                display:flex;align-items:center;gap:8px;
                font-size:11px;font-weight:700;text-transform:uppercase;
                letter-spacing:.06em;color:${color};
                padding:10px 4px 6px;border-bottom:1px solid ${color}22;
                margin-bottom:8px;margin-top:16px;">
                <i class='bx ${icon}'></i> ${label}
            </div>
        `;

        items.forEach(item => {
            htmlBuffer += buildRow(item);
        });
    });

    content.innerHTML = htmlBuffer;
}

function buildRow(item) {
    const playerName = item.profiles?.full_name || item.profiles?.username || item.profiles?.email || 'Unknown';
    const courtName  = item.courts?.name || `Court ${item.court_id}`;
    const initial    = playerName.charAt(0).toUpperCase();
    const bookedAt   = new Date(item.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    const awaitingNote = isAwaitingSelection(item)
        ? `<p class="booked-at" style="color:#0ea5e9;"><i class='bx bx-hourglass'></i> Player must pay by ${formatExpiry(item.expires_at)}</p>`
        : '';

    return `
        <div class="data-row" id="row-${item.id}">
            <div class="player-info">
                <div class="avatar-text">${initial}</div>
                <div class="details">
                    <h4>${playerName}</h4>
                    <p>${courtName} | ${item.reservation_date} </br> ${item.start_time} – ${item.end_time}</p>
                    <p class="booked-at"><i class='bx bx-time-five'></i> Booked at ${bookedAt}</p>
                    ${awaitingNote}
                </div>
            </div>
            <div class="row-actions">
                ${getActionButton(item)}
            </div>
        </div>`;
}

function getActionButton(item) {
    const eyeBtn = `<button class="btn-eye" onclick="openDetailsModal('${item.id}')">
        <i class='bx bx-show'></i>
    </button>`;

    if (isAwaitingSelection(item)) {
        return `${eyeBtn}
            <button class="checkin-btn btn-cancel" onclick="cancelReservation('${item.id}')">
                <i class='bx bx-x'></i> Cancel</button>`;
    }

    if (item.payment_method === 'Cash' && ['pending', 'pending_verification'].includes(item.status)) {
        return `${eyeBtn}
            <button class="checkin-btn btn-checkin" onclick="confirmCheckin('${item.id}')">
                <i class='bx bx-log-in'></i> Check-in (Cash)</button>
            <button class="checkin-btn btn-cancel" onclick="cancelReservation('${item.id}')">
                <i class='bx bx-x'></i> Cancel</button>`;
    }

    if (item.status === 'pending_verification' || (item.status === 'pending' && item.payment_method !== 'Cash')) {
        return `${eyeBtn}
            <button class="checkin-btn btn-verify" onclick="verifyPayment('${item.id}')">
                <i class='bx bx-check-shield'></i> Verify Payment</button>
            <button class="checkin-btn btn-cancel" onclick="cancelReservation('${item.id}')">
                <i class='bx bx-x'></i> Cancel</button>`;
    }

    if (item.status === 'confirmed')
        return `${eyeBtn}
            <button class="checkin-btn btn-cancel" onclick="cancelReservation('${item.id}')">
                <i class='bx bx-x'></i> Cancel</button>`;

    if (item.status === 'queued')
        return `${eyeBtn}
            <button class="checkin-btn btn-promote" onclick="promoteFromQueue('${item.id}')">
                <i class='bx bx-up-arrow-alt'></i> Promote</button>`;

    if (item.status === 'no_show' || item.status === 'cancelled') return eyeBtn;

    return '';
}

// ─── DETAILS MODAL ───
function openDetailsModal(id) {
    const item = allReservations.find(r => r.id === id);
    if (!item) return;

    const awaiting = isAwaitingSelection(item);

    let screenshotUrl = null;
    if (!awaiting && item.payment_screenshot) {
        if (item.payment_screenshot.startsWith('http')) {
            screenshotUrl = item.payment_screenshot;
        } else {
            const { data } = supabase.storage
                .from('payment_screenshot')
                .getPublicUrl(item.payment_screenshot);
            screenshotUrl = data?.publicUrl;
        }
    }

    const paymentLabel = awaiting
        ? '<span style="color:#0ea5e9;font-weight:600;">Pending (Awaiting Player Selection)</span>'
        : item.payment_method;

    const expiryRow = awaiting
        ? `<div class="details-modal-row"><span>Pay Before</span><span>${formatExpiry(item.expires_at)}</span></div>`
        : '';

    const refRow = !awaiting && item.reference_number
        ? `<div class="details-modal-row"><span>Ref #</span><span>${item.reference_number}</span></div>`
        : '';

    let proofBlock;
    if (awaiting) {
        proofBlock = '<p style="font-size:0.8rem;color:#0ea5e9;margin-top:12px;">Player has not selected a payment method yet.</p>';
    } else if (screenshotUrl) {
        proofBlock = `<p style="font-size:0.75rem;color:#9ca3af;margin-top:12px;">Payment Proof</p>
                   <img src="${screenshotUrl}" class="details-modal-img" onclick="window.open('${screenshotUrl}')">`;
    } else if (item.payment_method === 'Cash') {
        proofBlock = '<p style="font-size:0.8rem;color:#9ca3af;margin-top:12px;">Cash payment — no proof required.</p>';
    } else {
        proofBlock = '<p style="font-size:0.8rem;color:#ef4444;margin-top:12px;">No screenshot uploaded</p>';
    }

    document.getElementById('detailsModalContent').innerHTML = `
        <h3 style="margin-bottom:16px;color:#333;">Reservation Details</h3>
        <div class="details-modal-scroll" style="max-height:70vh;overflow-y:auto;padding-right:4px;">
            <div class="details-modal-row"><span>Player</span><span>${item.profiles?.full_name || item.profiles?.username || 'Unknown'}</span></div>
            <div class="details-modal-row"><span>Court</span><span>${item.courts?.name || `Court ${item.court_id}`}</span></div>
            <div class="details-modal-row"><span>Date</span><span>${item.reservation_date}</span></div>
            <div class="details-modal-row"><span>Time</span><span>${item.start_time} – ${item.end_time}</span></div>
            <div class="details-modal-row"><span>Amount</span><span>₱${Number(item.total_amount).toFixed(2)}</span></div>
            <div class="details-modal-row"><span>Payment</span><span>${paymentLabel}</span></div>
            ${expiryRow}
            ${refRow}
            ${proofBlock}
        </div>
    `;

    document.getElementById('detailsModal').classList.add('show');
}

function closeDetailsModal() {
    document.getElementById('detailsModal').classList.remove('show');
}

// ─── ACTIONS ───
async function verifyPayment(id) {
    showConfirm({
        title:       "Verify Payment",
        message:     "Confirm GCash/Maya reference verified?",
        confirmText: "Verify",
        danger:      false,
        onConfirm:   async () => {
            const { data: res, error: fetchError } = await supabase
                .from('reservations')
                .select('user_id, coaching_request_id, courts(name), reservation_date, start_time, end_time')
                .eq('id', id)
                .single();

            if (fetchError || !res) { showAlert("Failed to fetch reservation.", 'error'); return; }

            if (res.coaching_request_id) {
                const { data: result, error } = await supabase.rpc('verify_reservation_payment', {
                    p_reservation_id: id,
                    p_employee_id:    (await supabase.auth.getUser()).data.user.id,
                });

                if (error) { showAlert("Failed: " + error.message, 'error'); return; }

                if (result === 'slot_already_taken') {
                    showAlert("Payment noted, but this coach slot was already taken by another player. Reservation auto-declined.", 'warning');
                    await Promise.all([renderReservations(true), loadStats()]);
                    return;
                }
                if (result !== 'success') { showAlert("Unable to verify: " + result, 'error'); return; }

                showAlert("Payment verified — sent to coach for confirmation.", 'success');
                await Promise.all([renderReservations(true), loadStats()]);
                return;
            }

            const { error } = await supabase
                .from('reservations')
                .update({ status: 'confirmed' })
                .eq('id', id);

            if (error) { showAlert("Failed: " + error.message, 'error'); return; }

            showAlert("Payment verified — reservation confirmed.", 'success');

            await Promise.all([
                supabase.from('notifications').insert({
                    user_id: res.user_id,
                    title:   'Payment Verified ✅',
                    message: `Your GCash/Maya payment for ${res.courts?.name} on ${res.reservation_date} (${res.start_time}–${res.end_time}) has been verified. Your reservation is confirmed!`
                }),
                renderReservations(true),
                loadStats()
            ]);
        }
    });
}

async function confirmCheckin(id) {
    showConfirm({
        title:       "Confirm Check-in",
        message:     "Confirm player has paid cash at the counter?",
        confirmText: "Confirm",
        danger:      false,
        onConfirm:   async () => {
            const { data: res, error: fetchError } = await supabase
                .from('reservations')
                .select('user_id, coaching_request_id, courts(name), reservation_date, start_time, end_time, profiles(full_name)')
                .eq('id', id)
                .single();

            if (fetchError || !res) { showAlert("Failed to fetch reservation.", 'error'); return; }

            const playerName = res.profiles?.full_name || 'Player';

            if (res.coaching_request_id) {
                const employeeId = await getEmployeeId();
                if (!employeeId) return;

                const { data: result, error } = await supabase.rpc('verify_reservation_payment', {
                    p_reservation_id: id,
                    p_employee_id:    employeeId,
                });

                if (error) { showAlert("Failed: " + error.message, 'error'); return; }

                if (result === 'slot_already_taken') {
                    showAlert("Cash noted, but this coach slot was already taken by another player. Reservation auto-declined.", 'warning');
                    await Promise.all([renderReservations(true), loadStats()]);
                    return;
                }
                if (result !== 'success') { showAlert("Unable to confirm: " + result, 'error'); return; }

                showAlert(`${playerName} checked in — sent to coach for confirmation.`, 'success');
                await Promise.all([renderReservations(true), loadStats()]);
                return;
            }

            const { error } = await supabase
                .from('reservations')
                .update({ status: 'confirmed' })
                .eq('id', id);

            if (error) { showAlert("Failed: " + error.message, 'error'); return; }

            showAlert(`${playerName} checked in.`, 'success');

            await Promise.all([
                supabase.from('notifications').insert({
                    user_id: res.user_id,
                    title:   'Reservation Confirmed ✅',
                    message: `Your cash payment for ${res.courts?.name} on ${res.reservation_date} (${res.start_time}–${res.end_time}) has been received. You're all set!`
                }),
                renderReservations(true),
                loadStats()
            ]);
        }
    });
}

async function cancelReservation(id) {
    showConfirm({
        title:       "Cancel Reservation",
        message:     "Cancel this reservation?",
        confirmText: "Cancel Reservation",
        danger:      true,
        onConfirm:   async () => {
            const { data: res, error: fetchError } = await supabase
                .from('reservations')
                .select('user_id, coaching_request_id, status, courts(name), reservation_date, start_time, end_time, court_id')
                .eq('id', id)
                .single();

            if (fetchError || !res) { showAlert("Failed to fetch reservation.", 'error'); return; }

            if (res.coaching_request_id && res.status === 'pending_verification') {
                const employeeId = await getEmployeeId();
                if (!employeeId) return;

                const { data: result, error } = await supabase.rpc('reject_reservation_payment', {
                    p_reservation_id: id,
                    p_employee_id:    employeeId,
                });

                if (error) { showAlert("Failed: " + error.message, 'error'); return; }
                if (result !== 'success') { showAlert("Unable to reject: " + result, 'error'); return; }

                showAlert("Payment rejected — coaching request declined.", 'warning');
                await renderReservations();
                return;
            }

            const { error: cancelErr } = await supabase
                .from('reservations')
                .update({ status: 'cancelled', expires_at: null })
                .eq('id', id);

            if (cancelErr) { showAlert("Failed: " + cancelErr.message, 'error'); return; }

            await supabase.from('notifications').insert({
                user_id: res.user_id,
                title:   'Reservation Cancelled ❌',
                message: `Your reservation for ${res.courts?.name} on ${res.reservation_date} (${res.start_time}–${res.end_time}) has been cancelled by staff.`
            });

            const { data: queuedList, error: queueErr } = await supabase
                .from('reservations')
                .select('id, user_id, reservation_date, start_time, end_time')
                .eq('court_id', res.court_id)
                .eq('reservation_date', res.reservation_date)
                .eq('status', 'queued')
                .order('created_at', { ascending: true });

            if (queueErr) {
                console.error("Error checking queue:", queueErr);
            }

            const nextInQueue = queuedList?.find(q =>
                q.start_time.trim().toLowerCase() === res.start_time.trim().toLowerCase() &&
                q.end_time.trim().toLowerCase() === res.end_time.trim().toLowerCase()
            );

            if (nextInQueue) {
                const promoted = await promoteReservation(nextInQueue, res.courts?.name || 'Court');

                if (promoted) {
                    showAlert("Reservation cancelled & next player in queue was automatically promoted to pending!", 'success');
                } else {
                    showAlert("Reservation cancelled, but failed to promote queued player.", 'warning');
                }
            } else {
                showAlert("Reservation cancelled.", 'warning');
            }

            await renderReservations();
            await loadStats();
        }
    });
}

async function promoteFromQueue(id) {
    showConfirm({
        title:       "Promote from Queue",
        message:     "Promote queued player to the next active reservation?",
        confirmText: "Promote",
        danger:      false,
        onConfirm:   async () => {
            const { data: queuedRes, error: fetchError } = await supabase
                .from('reservations')
                .select('id, user_id, court_id, reservation_date, start_time, end_time, courts(name)')
                .eq('id', id)
                .single();

            if (fetchError || !queuedRes) { showAlert("Failed to fetch queued reservation.", 'error'); return; }

            const { data: activeSameSlot, error: activeError } = await supabase
                .from('reservations')
                .select('id, status')
                .eq('court_id', queuedRes.court_id)
                .eq('reservation_date', queuedRes.reservation_date)
                .eq('start_time', queuedRes.start_time)
                .eq('end_time', queuedRes.end_time)
                .in('status', ['pending', 'pending_verification', 'confirmed']);

            if (activeError) { showAlert("Failed to validate slot status.", 'error'); return; }

            if (activeSameSlot?.length > 0) {
                showAlert("This slot is still occupied. The queued player cannot be promoted yet.", 'warning');
                return;
            }

            const promoted = await promoteReservation(queuedRes, queuedRes.courts?.name || 'Court');

            if (!promoted) { showAlert("Failed to promote queued player.", 'error'); return; }

            showAlert("Player promoted from queue.", 'success');
            await renderReservations();
        }
    });
}

// ─── CONFIRM MODAL ───
function openConfirm(type) {
    const modal      = document.getElementById('confirmModal');
    const confirmBtn = document.querySelector('.m-btn-confirm');
    modal.classList.add('show');
    confirmBtn.style.background = '';

    const actions = {
        maintenance: { title: "Report Court Issue",  text: "Flag a court for maintenance?",        fn: () => showAlert("⚠️ Court flagged.", 'warning')  },
        incident:    { title: "Log Player Incident", text: "Report behavior or equipment damage?", fn: () => showAlert("📋 Incident logged.", 'warning') },
        emergency:   { title: "⚠️ Manual Downtime",  text: "Deactivate ALL courts immediately?",
            fn: async () => {
                await supabase.from('courts').update({ is_active: false }).neq('id', 0);
                invalidateCache('courts:');
                showAlert("🔴 Emergency downtime triggered.", 'error');
                await loadStats();
            }
        },
    };

    const a = actions[type] || { title: "Confirm", text: "Proceed?", fn: () => {} };
    document.getElementById('modalTitle').innerText = a.title;
    document.getElementById('modalText').innerText  = a.text;
    if (type === 'emergency') confirmBtn.style.background = '#ef4444';
    confirmBtn.onclick = () => { a.fn(); closeConfirm(); };
}

function closeConfirm() {
    document.getElementById('confirmModal')?.classList.remove('show');
    document.querySelector('.m-btn-confirm').style.background = '';
}

// ─── SHOW CONFIRM ───
function showConfirm({ title, message, confirmText, danger, onConfirm }) {
    document.getElementById("_confirmDialog")?.remove();

    const overlay = document.createElement("div");
    overlay.id = "_confirmDialog";
    overlay.style.cssText = `
        display:flex; position:fixed; inset:0; z-index:99999;
        background:rgba(15,23,42,0.55); align-items:center;
        justify-content:center; backdrop-filter:blur(4px);
    `;

    overlay.innerHTML = `
        <div style="background:#fff;border-radius:16px;padding:28px 24px 20px;
            width:90%;max-width:380px;box-shadow:0 20px 60px rgba(0,0,0,0.15);">
            <h3 style="margin:0 0 8px;font-size:16px;font-weight:800;color:#111827;">${title}</h3>
            <p style="font-size:14px;color:#6b7280;margin:0 0 20px;line-height:1.55;">${message}</p>
            <div style="display:flex;gap:10px;">
                <button id="_confirmYes" style="flex:1;padding:11px;background:${danger ? '#ef4444' : '#16a34a'};
                    color:#fff;border:none;border-radius:10px;font-size:14px;font-weight:700;
                    cursor:pointer;font-family:inherit;">${confirmText}</button>
                <button id="_confirmNo" style="flex:1;padding:11px;background:#f1f5f9;
                    color:#374151;border:none;border-radius:10px;font-size:14px;font-weight:600;
                    cursor:pointer;font-family:inherit;">Cancel</button>
            </div>
        </div>
    `;

    document.body.appendChild(overlay);

    const close = () => overlay.remove();
    overlay.querySelector("#_confirmYes").addEventListener("click", () => { close(); onConfirm(); });
    overlay.querySelector("#_confirmNo").addEventListener("click", close);
    overlay.addEventListener("click", e => { if (e.target === overlay) close(); });
}

// ─── TOAST / ALERT ───
function showAlert(message, type = 'info') {
    const feed = document.getElementById('alertFeed');
    if (feed) {
        const colors = { success: '#22c55e', warning: '#f59e0b', error: '#ef4444', info: '#3b82f6' };
        const color  = colors[type] || colors.info;
        const el     = document.createElement('div');
        el.style.cssText = `font-size:12px;color:${color};padding:6px 10px;border-radius:6px;
            background:${color}18;margin-bottom:6px;border-left:3px solid ${color};`;
        el.innerText = `[${new Date().toLocaleTimeString()}] ${message}`;
        feed.prepend(el);
        feed.querySelector('p')?.remove();
        setTimeout(() => el.remove(), 15000);
    }

    const toastColors = { success: '#16a34a', warning: '#f59e0b', error: '#ef4444', info: '#3b82f6' };
    const old = document.getElementById("globalToast");
    if (old) old.remove();
    const toast = document.createElement("div");
    toast.id = "globalToast";
    toast.textContent = message;
    toast.style.cssText = `
        position:fixed;top:20px;right:20px;
        background:${toastColors[type] || toastColors.info};
        color:white;padding:12px 16px;border-radius:10px;
        box-shadow:0 10px 25px rgba(0,0,0,0.15);
        z-index:99999;font-size:14px;font-weight:600;max-width:320px;
    `;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 3500);
}

// ─── EXPORTS ───
window.openConfirm       = openConfirm;
window.closeConfirm      = closeConfirm;
window.verifyPayment     = verifyPayment;
window.confirmCheckin    = confirmCheckin;
window.cancelReservation = cancelReservation;
window.promoteFromQueue  = promoteFromQueue;
window.openDetailsModal  = openDetailsModal;
window.closeDetailsModal = closeDetailsModal;