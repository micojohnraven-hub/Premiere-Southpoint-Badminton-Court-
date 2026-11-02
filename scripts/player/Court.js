import { supabase } from "../supabase/supabaseClient.js";
import { saveLog } from "../sysAdmin/sysLogs.js";

// ─── STATE ───
let isHomeowner = false;
let courts = [];
let hours = [];
let selectedRange = null;
let selectedCourt = null;
let selectedSlots = [];
let startSlot = null;
let currentUser = null;
let currentBookedSlots = [];
let queuedSlot = null;
let queuedPaymentMethod = null;
let selectedIssueCourtId = null;
let adminQR = null;
let isSaving = false;

let courtRate = 250;
let homeownerRate = 200;

let idleTimer = null;
const IDLE_TIME_LIMIT = 30000;

const businessHoursCache = {};

// ─── SLOT HOLD STATE ───
const HOLD_MINUTES = 10;
const ACTIVE_STATUSES = ['held', 'pending', 'pending_verification', 'confirmed', 'playing', 'queued'];
const OCCUPIED_STATUSES = ['held', 'pending', 'pending_verification', 'confirmed', 'playing'];
let heldReservationId = null;
let holdTimer = null;
let holdDeadline = 0;
let isHoldingSlot = false;

// ─── SELECTORS ───
const courtContainer = document.getElementById('courtContainer');
const bookingModal = document.getElementById('bookingModal');
const qrModal = document.getElementById('qrModal');
const cashModal = document.getElementById('cashModal');
const successModal = document.getElementById('successModal');
const dateInput = document.getElementById('reserveDate');
const timeSlotsContainer = document.getElementById('timeSlots');

function getValidBookingDate() {
    const now = getPHTime();
    const todayStr = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;

    if (!dateInput.value || dateInput.value < todayStr) {
        return todayStr;
    }
    return dateInput.value;
}

// ─── INIT ───
async function init() {
    const now = getPHTime();
    const today = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;

    if (dateInput) {
        dateInput.min = today;
        dateInput.value = getValidBookingDate();
    }

    const { data: { session } } = await supabase.auth.getSession();
    const user = session?.user;

    if (!user) {
        window.location.href = "../pages/auth/login.html";
        return;
    }
    currentUser = user;

    releaseMyHolds();
    loadCachedCourts();

    setupEventListeners();
    setupQRModalListeners();
    setupIdleDetection();

    listenToReservationChanges();
    listenToSlotChanges();
    listenToCourtChanges();

    const [homeownerResult, , courtsResult] = await Promise.all([
        supabase
            .from('homeowner_verifications')
            .select('status')
            .eq('player_id', user.id)
            .eq('status', 'approved')
            .maybeSingle(),
        loadBusinessSettings(),
        fetchCourts()
    ]);

    isHomeowner = !!homeownerResult?.data;

    if (courtsResult) {
        courts = courtsResult;
    }

    displayCourts();
    saveCourtsCache();

    await checkForPromotedHold();
    await checkForCancelledQueue();
}

function getRate() {
    return isHomeowner ? homeownerRate : courtRate;
}

// ─── COURTS CACHE ───
function getCourtsCacheKey() {
    return `courts_cache_${currentUser.id}`;
}

function loadCachedCourts() {
    try {
        const raw = localStorage.getItem(getCourtsCacheKey());
        if (!raw) return;

        const cached = JSON.parse(raw);
        if (!cached || !Array.isArray(cached.courts)) return;

        courts = cached.courts;
        isHomeowner = !!cached.isHomeowner;

        if (Number.isFinite(cached.courtRate)) courtRate = cached.courtRate;
        if (Number.isFinite(cached.homeownerRate)) homeownerRate = cached.homeownerRate;

        displayCourts();
    } catch {
        localStorage.removeItem(getCourtsCacheKey());
    }
}

function saveCourtsCache() {
    try {
        localStorage.setItem(getCourtsCacheKey(), JSON.stringify({
            courts,
            isHomeowner,
            courtRate,
            homeownerRate
        }));
    } catch {
        localStorage.removeItem(getCourtsCacheKey());
    }
}

// ─── SLOT HOLD ───
async function releaseMyHolds() {
    await supabase
        .from('reservations')
        .update({ status: 'cancelled' })
        .eq('user_id', currentUser.id)
        .eq('status', 'held')
        .is('queue_promoted_at', null);
}

async function holdSlot(paymentMethod, total) {
    isHoldingSlot = true;
    await releaseHold();
    await supabase.rpc('release_expired_holds');

    const duration = selectedSlots.length - 1;
    const startTime = selectedSlots[0];
    const endTime = selectedSlots[selectedSlots.length - 1];

    const { data, error } = await supabase
        .from('reservations')
        .insert({
            user_id: currentUser.id,
            court_id: selectedCourt.id,
            reservation_date: dateInput.value,
            start_time: startTime,
            end_time: endTime,
            duration_hours: duration,
            total_amount: total,
            payment_method: paymentMethod,
            status: 'held'
        })
        .select('id')
        .single();

    if (error) {
        isHoldingSlot = false;
        if (error.code === '23505') {
            showAlert("Sorry, this time slot was just taken by someone else.", "warning");
            await showConflictModal(paymentMethod, total, startTime, endTime, duration);
            await updateSlots();
            return false;
        }
        showAlert("Could not hold the slot. Please try again.", "error");
        return false;
    }

    heldReservationId = data.id;
    isHoldingSlot = false;
    startHoldCountdown();
    return true;
}

function startHoldCountdown(deadlineMs = null) {
    clearInterval(holdTimer);
    holdDeadline = deadlineMs || Date.now() + HOLD_MINUTES * 60 * 1000;
    renderHoldCountdown();

    holdTimer = setInterval(async () => {
        if (Date.now() >= holdDeadline) {
            await expireHold();
            return;
        }
        renderHoldCountdown();
    }, 1000);
}

function renderHoldCountdown() {
    const remaining = Math.max(0, holdDeadline - Date.now());
    const minutes = Math.floor(remaining / 60000);
    const seconds = Math.floor((remaining % 60000) / 1000);
    const text = `Slot held for you: ${minutes}:${String(seconds).padStart(2, '0')}`;

    [qrModal, cashModal].forEach(modal => {
        const content = modal ? modal.querySelector('.modal-content') : null;
        if (!content) return;

        let el = content.querySelector('.hold-countdown');
        if (!el) {
            el = document.createElement('p');
            el.className = 'hold-countdown';
            el.style.cssText = 'text-align:center;font-size:0.85rem;font-weight:700;color:#b45309;margin:8px 0;';
            content.insertBefore(el, content.firstChild);
        }
        el.textContent = text;
    });
}

async function releaseHold() {
    clearInterval(holdTimer);
    holdTimer = null;

    if (!heldReservationId) return;

    const id = heldReservationId;
    heldReservationId = null;

    await supabase
        .from('reservations')
        .update({ status: 'cancelled' })
        .eq('id', id)
        .eq('status', 'held');
}

function clearHoldState() {
    clearInterval(holdTimer);
    holdTimer = null;
    heldReservationId = null;
}

async function returnToBooking() {
    await releaseHold();
    openModal(bookingModal);
    await updateSlots(true);
}

async function expireHold() {
    [qrModal, cashModal, document.getElementById('strictPolicyModal')].forEach(closeModal);
    showAlert("Your slot hold expired. Please select a slot again.", "warning");
    await returnToBooking();
}

async function startPaymentFlow(paymentMethod, total) {
    const held = await holdSlot(paymentMethod, total);
    if (!held) return false;

    const opened = await openPaymentStep(paymentMethod, total);
    if (!opened) {
        await releaseHold();
        return false;
    }
    return true;
}

// ─── QUEUE PROMOTION ───
async function resumePromotedHold(row) {
    if (heldReservationId || isHoldingSlot) return;

    isHoldingSlot = true;

    await loadBusinessHours(row.reservation_date);
    const startIdx = hours.indexOf(row.start_time);
    const endIdx = hours.indexOf(row.end_time);

    if (startIdx === -1 || endIdx <= startIdx) {
        isHoldingSlot = false;
        return;
    }

    const court = courts.find(c => c.id === row.court_id);
    selectedCourt = {
        id: row.court_id,
        name: court ? court.name : `Court ${row.court_id}`,
        price_per_hour: getRate()
    };

    dateInput.value = row.reservation_date;
    selectedSlots = hours.slice(startIdx, endIdx + 1);
    selectedRange = { from: startIdx, to: endIdx - 1 };
    startSlot = null;

    heldReservationId = row.id;
    isHoldingSlot = false;
    startHoldCountdown(new Date(row.hold_expires_at).getTime());

    [
        bookingModal,
        successModal,
        document.getElementById('conflictModal'),
        document.getElementById('queueConflictModal'),
        document.getElementById('dss1PreferenceModal')
    ].forEach(closeModal);

    showAlert("Good news! The slot you queued for is now available. Please complete your payment before the timer runs out.", "success");

    const paymentMethod = row.payment_method || 'Cash';
    const total = (selectedSlots.length - 1) * getRate();
    const opened = await openPaymentStep(paymentMethod, total);

    if (!opened) await releaseHold();
}

async function checkForPromotedHold() {
    const { data } = await supabase
        .from('reservations')
        .select('*')
        .eq('user_id', currentUser.id)
        .eq('status', 'held')
        .not('queue_promoted_at', 'is', null)
        .gt('hold_expires_at', new Date().toISOString())
        .order('created_at')
        .limit(1)
        .maybeSingle();

    if (data) await resumePromotedHold(data);
}

// ─── PAYMENT QR ───
async function loadAdminQR() {
    const { data, error } = await supabase
        .from('payment_qr_codes')
        .select('id, provider, account_name, qr_image_url')
        .eq('owner_role', 'business_admin')
        .eq('is_active', true)
        .maybeSingle();

    adminQR = error ? null : data;
    return !!adminQR;
}

function renderPaymentQR() {
    document.getElementById('paymentQRImage').src = adminQR.qr_image_url;
    document.getElementById('qrAccountInfo').textContent = `${adminQR.provider} • ${adminQR.account_name}`;
}

async function openPaymentStep(paymentMethod, total) {
    if (paymentMethod === 'E-wallet') {
        const ready = await loadAdminQR();
        if (!ready) {
            showAlert("E-wallet payment is currently unavailable. Please choose Cash or contact the front desk.", "warning");
            openModal(bookingModal);
            return false;
        }
        renderPaymentQR();
        document.getElementById('qrAmount').innerText = `₱${total.toFixed(2)}`;
        openModal(qrModal);
        return true;
    }

    document.getElementById('cashAmountDisplay').innerText = `₱${total.toFixed(2)}`;
    openModal(cashModal);
    return true;
}

// ─── IDLE DETECTION & DSS 1 ───
function setupIdleDetection() {
    const resetTimer = () => {
        clearTimeout(idleTimer);
        idleTimer = setTimeout(triggerDSS1PreferenceModal, IDLE_TIME_LIMIT);
    };

    window.onload = resetTimer;
    window.onmousemove = resetTimer;
    window.onmousedown = resetTimer;
    window.ontouchstart = resetTimer;
    window.onclick = resetTimer;
    window.onkeypress = resetTimer;
}

async function triggerDSS1PreferenceModal() {
    if (document.querySelector('.modal[style*="display: flex"]')) return;

    let dss1Modal = document.getElementById('dss1PreferenceModal');
    if (!dss1Modal) {
        dss1Modal = document.createElement('div');
        dss1Modal.id = 'dss1PreferenceModal';
        dss1Modal.className = 'modal';
        document.body.appendChild(dss1Modal);
    }

    dss1Modal.innerHTML = `
        <div class="modal-content" style="max-width: 480px; text-align: center;">
            <span class="close-modal" id="closeDSS1">&times;</span>
            <h3 style="margin-bottom:8px; color:#1a1a2e;">Need help finding a slot?</h3>
            <p style="color:#666; font-size:14px; margin-bottom:18px;">
                Let's match you with the best court and time slot based on your preferences!
            </p>

            <div class="input-group" style="text-align:left;">
                <label style="font-size:13px; font-weight:600; color:#444;">1. Preferred Time of Day:</label>
                <select id="dssTimePref" style="width:100%; padding:10px; border-radius:8px; border:1px solid #ccc; margin-top:4px;">
                    <option value="morning">Morning (8:00 AM - 12:00 PM)</option>
                    <option value="afternoon">Afternoon (12:00 PM - 5:00 PM)</option>
                    <option value="evening">Evening (5:00 PM - 10:00 PM)</option>
                </select>
            </div>

            <div class="input-group" style="text-align:left; margin-top:12px;">
                <label style="font-size:13px; font-weight:600; color:#444;">2. Play Duration:</label>
                <select id="dssDurationPref" style="width:100%; padding:10px; border-radius:8px; border:1px solid #ccc; margin-top:4px;">
                    <option value="1">1 Hour Session</option>
                    <option value="2">2 Hours Session</option>
                    <option value="3">3 Hours Session</option>
                </select>
            </div>

            <button id="btnFindDSS1Options" class="primary-btn" style="margin-top:16px;">
                Find Available Slots
            </button>
            <div id="dss1ResultsContainer" style="margin-top:15px; display:none; text-align:left;"></div>
        </div>
    `;

    openModal(dss1Modal);

    document.getElementById('closeDSS1').onclick = () => closeModal(dss1Modal);

    document.getElementById('btnFindDSS1Options').onclick = async () => {
        const timePref = document.getElementById('dssTimePref').value;
        const duration = parseInt(document.getElementById('dssDurationPref').value, 10);

        document.getElementById('dss1ResultsContainer').style.display = 'block';
        document.getElementById('dss1ResultsContainer').innerHTML = '<p style="text-align:center;">Searching available slots...</p>';

        const recommendations = await computeDSS1Recommendations(timePref, duration);
        renderDSS1Options(recommendations, dss1Modal, duration);
    };
}

async function computeDSS1Recommendations(timePref, duration) {
    let targetDate = dateInput.value;
    let recommendations = [];

    async function collectSlots(dateStr, timePreference) {
        await loadBusinessHours(dateStr);
        if (!hours || hours.length === 0) return;

        let filterStart = 0;
        let filterEnd = hours.length;

        if (timePreference === 'morning') {
            filterStart = 0;
            filterEnd = Math.min(5, hours.length);
        } else if (timePreference === 'afternoon') {
            filterStart = Math.min(4, hours.length);
            filterEnd = Math.min(10, hours.length);
        } else if (timePreference === 'evening') {
            filterStart = Math.min(9, hours.length);
            filterEnd = hours.length;
        }

        const pastSlots = getPastSlotsForToday();

        for (const court of courts) {
            if (!court.is_active) continue;
            if (recommendations.length >= 3) break;

            let booked = await getBookedSlots(court.id, dateStr);

            const now = getPHTime();
            const todayStr = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
            if (dateStr === todayStr) {
                booked = [...new Set([...booked, ...pastSlots])];
            }

            for (let i = filterStart; i <= filterEnd - duration; i++) {
                if (recommendations.length >= 3) break;

                let isFree = true;
                for (let d = 0; d < duration; d++) {
                    if (booked.includes(hours[i + d])) {
                        isFree = false;
                        break;
                    }
                }

                const isAlreadyAdded = recommendations.some(
                    r => r.court_id === court.id && r.date === dateStr && r.start_time === hours[i]
                );

                if (isFree && hours[i] && hours[i + duration] && !isAlreadyAdded) {
                    recommendations.push({
                        court_id: court.id,
                        court_name: court.name,
                        start_time: hours[i],
                        end_time: hours[i + duration],
                        start_idx: i,
                        duration: duration,
                        date: dateStr
                    });
                    break;
                }
            }
        }
    }

    await collectSlots(targetDate, timePref);

    if (recommendations.length < 3) {
        await collectSlots(targetDate, 'any');
    }

    if (recommendations.length < 3) {
        const now = getPHTime();
        const nextDay = new Date(now);
        nextDay.setDate(nextDay.getDate() + 1);
        const tomorrowStr = `${nextDay.getFullYear()}-${String(nextDay.getMonth()+1).padStart(2,'0')}-${String(nextDay.getDate()).padStart(2,'0')}`;

        await collectSlots(tomorrowStr, timePref);

        if (recommendations.length < 3) {
            await collectSlots(tomorrowStr, 'any');
        }
    }

    return recommendations;
}

function renderDSS1Options(options, dss1Modal, duration) {
    const container = document.getElementById('dss1ResultsContainer');
    if (options.length === 0) {
        container.innerHTML = `
            <div style="background:#fef2f2; border:1px solid #fca5a5; padding:10px; border-radius:8px; color:#991b1b; font-size:13px; text-align:center;">
                No available slots found for today and tomorrow. Please try selecting another date manually.
            </div>
        `;
        return;
    }

    container.innerHTML = `
        <h4 style="font-size:14px; margin-bottom:8px; color:#16a34a;">Suggested Best Options (${options.length}):</h4>
        ${options.map((opt, idx) => `
            <div style="background:#f0fdf4; border:1px solid #bbf7d0; padding:10px; border-radius:8px; margin-bottom:8px; display:flex; justify-content:space-between; align-items:center;">
                <div>
                    <strong style="font-size:13px; color:#166534;">Option ${idx + 1}:${opt.court_name}</strong>
                    <p style="margin:2px 0 0 0; font-size:12px; color:#374151;">
                        📅 <strong>${opt.date}</strong> •${opt.start_time} – ${opt.end_time} (${duration} hr/s)
                    </p>
                </div>
                <button class="primary-btn btnSelectDSS1" data-idx="${idx}" style="width:auto; padding:6px 12px; font-size:12px; margin:0;">
                    Select
                </button>
            </div>
        `).join('')}
    `;

    document.querySelectorAll('.btnSelectDSS1').forEach(btn => {
        btn.onclick = (e) => {
            const idx = e.target.getAttribute('data-idx');
            const chosen = options[idx];
            closeModal(dss1Modal);

            dateInput.value = chosen.date;

            selectedCourt = {
                id: chosen.court_id,
                name: chosen.court_name,
                price_per_hour: getRate()
            };
            selectedSlots = hours.slice(chosen.start_idx, chosen.start_idx + chosen.duration + 1);

            openBooking(chosen.court_id, chosen.court_name);
        };
    });
}

// ─── BUSINESS HOURS & COURTS ───
async function loadBusinessHours(date) {
    const dayOfWeek = new Date(date + 'T00:00:00').getDay();

    let row = businessHoursCache[dayOfWeek];

    if (row === undefined) {
        const { data, error } = await supabase
            .from('business_hours')
            .select('open_time, close_time, is_closed')
            .eq('day_of_week', dayOfWeek)
            .single();

        if (error || !data) {
            hours = [];
            return;
        }

        row = data;
        businessHoursCache[dayOfWeek] = row;
    }

    if (row.is_closed) {
        hours = [];
        return;
    }

    hours = generateHours(row.open_time, row.close_time);
}

function generateHours(openTime, closeTime) {
    const [startH, startM] = openTime.split(':').map(Number);
    const [endH, endM] = closeTime.split(':').map(Number);

    const startTotal = startH * 60 + startM;
    const endTotal = endH * 60 + endM;

    const result = [];
    for (let t = startTotal; t <= endTotal; t += 60) {
        const h = Math.floor(t / 60);
        const m = t % 60;
        const period = h < 12 ? 'AM' : 'PM';
        const displayHour = h === 0 ? 12 : h > 12 ? h - 12 : h;
        const displayMin = String(m).padStart(2, '0');
        result.push(`${String(displayHour).padStart(2, '0')}:${displayMin} ${period}`);
    }
    return result;
}

// ─── REALTIME LISTENERS ───
function listenToCourtChanges() {
    supabase
        .channel('player-court-changes')
        .on(
            'postgres_changes',
            { event: '*', schema: 'public', table: 'courts' },
            async () => {
                await loadCourts();
            }
        )
        .subscribe();
}

function listenToSlotChanges() {
    supabase
        .channel('slot-changes')
        .on(
            'postgres_changes',
            { event: '*', schema: 'public', table: 'reservations' },
            async (payload) => {
                const row = payload.new;

                if (!row || !row.court_id) return;
                if (row.user_id === currentUser.id) return;
                if (heldReservationId || isHoldingSlot) return;
                if (!selectedCourt || bookingModal.style.display !== 'flex') return;
                if (row.court_id !== selectedCourt.id) return;
                if (row.reservation_date !== dateInput.value) return;

                await updateSlots(true);
            }
        )
        .subscribe();
}

function listenToReservationChanges() {
    supabase
        .channel('reservation-changes')
        .on(
            'postgres_changes',
            { event: 'UPDATE', schema: 'public', table: 'reservations' },
            async (payload) => {
                const updated = payload.new;

                if (
                    updated.status === 'held' &&
                    updated.queue_promoted_at &&
                    updated.user_id === currentUser.id
                ) {
                    await resumePromotedHold(updated);
                    return;
                }

                if (
                    updated.status !== 'cancelled' ||
                    !updated.cancelled_from_queue ||
                    updated.user_id !== currentUser.id
                ) return;

                dateInput.value = updated.reservation_date;
                await loadBusinessHours(updated.reservation_date);

                selectedCourt = courts.find(c => c.id === updated.court_id) || {
                    id: updated.court_id,
                    name: `Court ${updated.court_id}`,
                    price_per_hour: getRate()
                };

                const duration = hours.indexOf(updated.end_time) - hours.indexOf(updated.start_time);
                const total = duration * getRate();

                selectedSlots = [];
                startSlot = null;
                closeModal(successModal);

                await showQueueConflictModal(
                    updated.payment_method || "E-wallet",
                    total,
                    updated.start_time,
                    updated.end_time,
                    duration,
                    updated.id
                );
            }
        )
        .subscribe();
}

async function checkForCancelledQueue() {
    const now = getPHTime();
    const today = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;

    const params = new URLSearchParams(window.location.search);
    const conflictReservationId = params.get('queue_conflict');

    let data = null;

    if (conflictReservationId) {
        const { data: specific } = await supabase
            .from('reservations')
            .select('*')
            .eq('id', conflictReservationId)
            .eq('user_id', currentUser.id)
            .eq('cancelled_from_queue', true)
            .maybeSingle();

        data = specific;
        window.history.replaceState({}, '', window.location.pathname);
    }

    if (!data) {
        const tenMinsAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();

        const { data: recent } = await supabase
            .from('reservations')
            .select('*')
            .eq('user_id', currentUser.id)
            .eq('status', 'cancelled')
            .eq('cancelled_from_queue', true)
            .eq('reservation_date', today)
            .gte('updated_at', tenMinsAgo)
            .order('updated_at', { ascending: false })
            .limit(1)
            .maybeSingle();

        data = recent;
    }

    if (!data) return;

    dateInput.value = data.reservation_date;
    await loadBusinessHours(data.reservation_date);

    selectedCourt = courts.find(c => c.id === data.court_id) || {
        id: data.court_id,
        name: `Court ${data.court_id}`,
        price_per_hour: getRate()
    };

    const duration = hours.indexOf(data.end_time) - hours.indexOf(data.start_time);
    const total = duration * getRate();

    await showQueueConflictModal(
        data.payment_method || "E-wallet",
        total,
        data.start_time,
        data.end_time,
        duration,
        data.id
    );
}

// ─── ACTIVE QUEUE CONFLICT MODAL ───
async function showQueueConflictModal(paymentMethod, total, startTime, endTime, duration, queuedReservationId) {
    const startIdx = hours.indexOf(startTime);

    const sameCourtSuggestion = await findSameCourtAlternative(
        selectedCourt.id,
        dateInput.value,
        startIdx,
        duration
    );

    const differentCourtSuggestion = await findDifferentCourtSameTime(
        dateInput.value,
        startTime,
        endTime
    );

    async function cancelMyQueue() {
        await supabase
            .from('reservations')
            .update({ cancelled_from_queue: false })
            .eq('id', queuedReservationId);
    }

    let queueConflictModal = document.getElementById('queueConflictModal');
    if (!queueConflictModal) {
        queueConflictModal = document.createElement('div');
        queueConflictModal.id = 'queueConflictModal';
        queueConflictModal.className = 'modal';
        document.body.appendChild(queueConflictModal);
    }

    const sameCourtHTML = sameCourtSuggestion ? `
        <div style="background:#f0fdf4;border:1px solid #86efac;border-radius:10px;padding:12px;margin:12px 0;text-align:left;">
            <p style="margin:0;font-size:0.85rem;color:#166534;">
                <strong>Same Court, Different Time:</strong><br>
                ${sameCourtSuggestion.court_name} • ${sameCourtSuggestion.start} – ${sameCourtSuggestion.end}
            </p>
            <button id="btnAcceptSameCourtQueueSuggestion" class="primary-btn" style="margin-top:10px;">
                Book This Time
            </button>
        </div>
    ` : '';

    const differentCourtHTML = differentCourtSuggestion ? `
        <div style="background:#eff6ff;border:1px solid #93c5fd;border-radius:10px;padding:12px;margin:12px 0;text-align:left;">
            <p style="margin:0;font-size:0.85rem;color:#1d4ed8;">
                <strong>Same Time, Different Court:</strong><br>
                ${differentCourtSuggestion.court_name} • ${differentCourtSuggestion.start} – ${differentCourtSuggestion.end}
            </p>
            <button id="btnAcceptDifferentCourtQueueSuggestion" class="primary-btn" style="margin-top:10px;background:#2563eb;">
                Book This Court
            </button>
        </div>
    ` : '';

    queueConflictModal.innerHTML = `
        <div class="modal-content" style="max-width:460px;text-align:center;">
            <h3 style="color:#e74c3c;margin-bottom:12px;">
                <i class='bx bx-error-circle'></i> Queued Slot Now Taken
            </h3>
            <p style="color:#555;font-size:0.9rem;">
                The slot you were queued for — <strong>${selectedCourt.name}</strong> on
                <strong>${dateInput.value}</strong> (${startTime} – ${endTime}) has been confirmed by the primary player.
            </p>
            ${sameCourtHTML}
            ${differentCourtHTML}
            <button id="btnQueuePickAnother" class="secondary-btn" style="margin-top:10px;">
                <i class='bx bx-calendar'></i> Pick Another Slot
            </button>
        </div>
    `;

    openModal(queueConflictModal);

    if (sameCourtSuggestion) {
        document.getElementById('btnAcceptSameCourtQueueSuggestion').onclick = async () => {
            await cancelMyQueue();
            closeModal(queueConflictModal);
            dateInput.value = sameCourtSuggestion.date;
            selectedSlots = hours.slice(sameCourtSuggestion.index, sameCourtSuggestion.index + duration + 1);
            await startPaymentFlow(paymentMethod, (selectedSlots.length - 1) * getRate());
        };
    }

    if (differentCourtSuggestion) {
        document.getElementById('btnAcceptDifferentCourtQueueSuggestion').onclick = async () => {
            await cancelMyQueue();
            closeModal(queueConflictModal);
            selectedCourt = { id: differentCourtSuggestion.court_id, name: differentCourtSuggestion.court_name, price_per_hour: getRate() };
            selectedSlots = hours.slice(
                hours.indexOf(differentCourtSuggestion.start),
                hours.indexOf(differentCourtSuggestion.end) + 1
            );
            await startPaymentFlow(paymentMethod, (selectedSlots.length - 1) * getRate());
        };
    }

    document.getElementById('btnQueuePickAnother').onclick = async () => {
        await cancelMyQueue();
        closeModal(queueConflictModal);
        openModal(bookingModal);
        updateSlots();
    };
}

// ─── QR MODAL LISTENERS ───
function setupQRModalListeners() {
    const fileInput      = document.getElementById('paymentScreenshot');
    const previewWrapper = document.getElementById('uploadPreviewWrapper');
    const previewImg     = document.getElementById('uploadPreview');
    const uploadLabel    = document.getElementById('uploadLabel');
    const dropZone       = document.getElementById('uploadDropZone');

    if (!dropZone) return;

    dropZone.removeAttribute('onclick');
    dropZone.addEventListener('click', () => fileInput.click());

    fileInput.addEventListener('change', () => {
        const file = fileInput.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (e) => {
            previewImg.src = e.target.result;
            previewWrapper.style.display = 'block';
            dropZone.style.display = 'none';
            document.getElementById('uploadError').style.display = 'none';
        };
        reader.readAsDataURL(file);
        uploadLabel.textContent = file.name;
    });

    document.getElementById('removeUpload').addEventListener('click', () => {
        fileInput.value = '';
        previewImg.src = '';
        previewWrapper.style.display = 'none';
        dropZone.style.display = 'block';
        uploadLabel.textContent = 'Click to upload screenshot';
    });
}

// ─── BUSINESS SETTINGS & COURT LOADING ───
async function loadBusinessSettings() {
    const { data, error } = await supabase
        .from('business_settings')
        .select('key, value')
        .in('key', ['court_rate', 'homeowner_rate']);

    if (error) return;

    data?.forEach(({ key, value }) => {
        if (value === null || value === undefined) return;
        if (key === 'court_rate') courtRate = Number(value);
        if (key === 'homeowner_rate') homeownerRate = Number(value);
    });
}

async function fetchCourts() {
    const { data, error } = await supabase
        .from('courts')
        .select('*')
        .order('id');

    if (error) return null;

    return data;
}

async function loadCourts() {
    const data = await fetchCourts();

    if (!data) return;

    courts = data;
    displayCourts();
    saveCourtsCache();
}

// ─── COURT DISPLAY ───
function getClosureMeta(reason) {
    const known = {
        "Maintenance":   { label: "Under Maintenance", icon: "bx-wrench",        cls: "maintenance", btnText: "Maintenance" },
        "Private Event": { label: "Private Event",     icon: "bx-calendar-star", cls: "event",       btnText: "Reserved" },
        "Tournament":    { label: "Tournament",        icon: "bx-trophy",        cls: "tournament",  btnText: "In Tournament" },
    };
    return known[reason] || { label: reason || "Unavailable", icon: "bx-block", cls: "other", btnText: "Unavailable" };
}

function displayCourts() {
    courtContainer.innerHTML = courts.map(court => {
        const isClosed = !court.is_active;
        const meta = isClosed ? getClosureMeta(court.closed_reason) : null;
        return `
            <div class="court-card ${isClosed ? `court-closed court-closed-${meta.cls}` : 'court-has-photo'}">
                <div class="report-wrapper">
                    <i class='bx bx-error-circle report-icon' onclick="openPlayerIssueModal(${court.id}, '${court.name}')" title="Report Issue"></i>
                </div>
                <div class="court-img-placeholder">
                    ${isClosed
                        ? `<i class='bx ${meta.icon}'></i>`
                        : `<img src="/components/Badminton_Court.jpg" alt="${court.name}">`}
                </div>
                <h3>${court.name}</h3>
                ${
                    isClosed
                    ? `<p>${meta.label}</p>`
                    : `<p>₱${(isHomeowner ? homeownerRate : courtRate).toFixed(2)} / hour</p>`
                }
                ${
                    isClosed
                    ? `<button class="book-btn maintenance-btn" disabled>${meta.btnText}</button>`
                    : `<button class="book-btn" onclick="openBooking(${court.id}, '${court.name}')">Reserve Now</button>`
                }
            </div>
        `;
    }).join('');
}

function openModal(modal) {
    if (!modal) return;
    modal.style.display = "flex";
    modal.classList.remove('closing');
}

function closeModal(modal) {
    if (!modal) return;
    modal.classList.add('closing');
    setTimeout(() => {
        modal.style.display = "none";
        modal.classList.remove('closing');
    }, 300);
}

// ─── EVENT LISTENERS ───
function setupEventListeners() {
    window.addEventListener('click', async (e) => {
        if (!e.target.classList.contains('modal')) return;

        closeModal(e.target);

        const isPaymentStepModal = e.target === qrModal || e.target === cashModal || e.target.id === 'strictPolicyModal';
        if (isPaymentStepModal) {
            await returnToBooking();
        }
    });

    dateInput.addEventListener('click', () => {
        try { dateInput.showPicker(); } catch (err) {}
    });

    dateInput.onchange = () => {
        if (selectedCourt) updateSlots();
    };

    document.getElementById('closeBooking').onclick = () => closeModal(bookingModal);

    document.getElementById('btnCancelQR').onclick = async () => {
        closeModal(qrModal);
        await returnToBooking();
    };

    document.getElementById('btnCancelCash').onclick = async () => {
        closeModal(cashModal);
        await returnToBooking();
    };

    document.getElementById('btnPaid').onclick = async () => {
        const refInput  = document.getElementById('referenceNumberInput');
        const refError  = document.getElementById('refError');
        const fileInput = document.getElementById('paymentScreenshot');
        const uploadError = document.getElementById('uploadError');
        const refValue  = refInput ? refInput.value.trim() : '';
        const file      = fileInput ? fileInput.files[0] : null;
        let hasError    = false;

        if (!refValue) {
            if (refError) refError.style.display = 'block';
            hasError = true;
        } else {
            if (refError) refError.style.display = 'none';
        }

        if (!file) {
            if (uploadError) uploadError.style.display = 'block';
            hasError = true;
        } else {
            if (uploadError) uploadError.style.display = 'none';
        }

        if (hasError) return;

        closeModal(qrModal);
        const duration = selectedSlots.length - 1;
        const total = duration * getRate();
        showStrictPolicyConfirmationModal("E-wallet", total, refValue, file);
    };

    document.getElementById('btnConfirmCash').onclick = async () => {
        closeModal(cashModal);
        const duration = selectedSlots.length - 1;
        const total = duration * getRate();
        showStrictPolicyConfirmationModal("Cash", total, null, null);
    };

    document.getElementById('btnDone').onclick = () => location.reload();

    document.getElementById('btnConfirm').onclick = async () => {
        if (selectedSlots.length < 2) {
            return showAlert("Please select a start and end time (minimum 1 hour).", "warning");
        }

        const confirmBtn = document.getElementById('btnConfirm');
        const payment = document.querySelector('input[name="payment"]:checked').value;
        const duration = selectedSlots.length - 1;
        const total = duration * getRate();

        confirmBtn.disabled = true;
        const opened = await startPaymentFlow(payment, total);
        confirmBtn.disabled = false;

        if (opened) closeModal(bookingModal);
    };
}

// ─── STRICT POLICY & TIMER CONFIRMATION MODAL ───
function showStrictPolicyConfirmationModal(paymentMethod, total, referenceNumber = null, file = null) {
    let policyModal = document.getElementById('strictPolicyModal');
    if (!policyModal) {
        policyModal = document.createElement('div');
        policyModal.id = 'strictPolicyModal';
        policyModal.className = 'modal';
        document.body.appendChild(policyModal);
    }

    const startTime = selectedSlots[0];
    const endTime = selectedSlots[selectedSlots.length - 1];
    const duration = selectedSlots.length - 1;

    policyModal.innerHTML = `
        <div class="modal-content" style="max-width: 480px; text-align: center;">
            <div style="font-size:45px; color:#ef4444; margin-bottom:8px;">
                <i class='bx bx-time-five'></i>
            </div>
            <h3 style="color:#1a1a2e; margin-bottom:6px;">Strict On-Time Policy</h3>
            <p style="color:#dc2626; font-size:13px; font-weight:700; margin-bottom:12px; background:#fee2e2; padding:8px; border-radius:8px;">
                ⚠️ NO REFUND & NO EXTENSION POLICY
            </p>

            <div style="text-align:left; background:#f9fafb; padding:12px; border-radius:10px; font-size:13px; color:#374151; margin-bottom:14px; border:1px solid #e5e7eb;">
                <p style="margin:0 0 4px 0;"><strong>Court:</strong> ${selectedCourt.name}</p>
                <p style="margin:0 0 4px 0;"><strong>Date:</strong> ${dateInput.value}</p>
                <p style="margin:0 0 4px 0;"><strong>Time Slot:</strong> ${startTime} – ${endTime} (${duration}hr/s)</p>
                <p style="margin:0;"><strong>Total Amount:</strong> ₱${total.toFixed(2)} (${paymentMethod})</p>
            </div>

            <p style="font-size:12px; color:#6b7280; text-align:left; margin-bottom:16px; line-height:1.4;">
                Please arrive <strong>15-10 minutes before your booked time</strong>. Failure to arrive on time will result in the <strong>forfeiture of your slot with strictly NO REFUND</strong>.
            </p>

            <button id="btnFinalLockConfirm" class="primary-btn" disabled style="background:#9ca3af; cursor:not-allowed;">
                Please read policy (<span id="timerCountdown">7</span>s)
            </button>
            <button id="btnCancelFinal" class="secondary-btn" style="margin-top:8px;">
                Cancel / Edit
            </button>
        </div>
    `;

    openModal(policyModal);

    let timeLeft = 7;
    const confirmBtn = document.getElementById('btnFinalLockConfirm');
    const countdownSpan = document.getElementById('timerCountdown');

    const countdownInterval = setInterval(() => {
        timeLeft--;
        if (countdownSpan) countdownSpan.textContent = timeLeft;

        if (timeLeft <= 0) {
            clearInterval(countdownInterval);
            if (confirmBtn) {
                confirmBtn.disabled = false;
                confirmBtn.style.background = "var(--primary-color)";
                confirmBtn.style.cursor = "pointer";
                confirmBtn.innerHTML = "<i class='bx bx-check-circle'></i> I Understand, Confirm Reservation";
            }
        }
    }, 1000);

    document.getElementById('btnCancelFinal').onclick = async () => {
        clearInterval(countdownInterval);
        closeModal(policyModal);
        await returnToBooking();
    };

    confirmBtn.onclick = async () => {
        if (confirmBtn.disabled) return;
        clearInterval(countdownInterval);
        closeModal(policyModal);
        await saveReservation(paymentMethod, referenceNumber, file);
    };
}

// ─── OPEN BOOKING & SLOTS HANDLING ───
function openBooking(courtId, courtName) {
    selectedCourt = {
        id: courtId,
        name: courtName,
        price_per_hour: getRate()
    };

    selectedSlots = [];
    startSlot = null;

    document.getElementById('modalCourtName').innerText = courtName;
    openModal(bookingModal);
    updateSlots();
}

async function getSlotStatuses(courtId, date) {
    const { data, error } = await supabase
        .from('reservations')
        .select('start_time, end_time, status')
        .eq('court_id', courtId)
        .eq('reservation_date', date)
        .in('status', ACTIVE_STATUSES);

    if (error) return {};

    const slotStatusMap = {};
    data.forEach(({ start_time, end_time, status }) => {
        const startIdx = hours.indexOf(start_time);
        const endIdx = hours.indexOf(end_time);
        for (let i = startIdx; i < endIdx; i++) {
            if (i >= 0) {
                slotStatusMap[hours[i]] = status;
            }
        }
    });

    return slotStatusMap;
}

async function getBookedSlots(courtId, date) {
    const { data, error } = await supabase
        .from('reservations')
        .select('start_time, end_time')
        .eq('court_id', courtId)
        .eq('reservation_date', date)
        .in('status', ACTIVE_STATUSES);

    if (error) return [];

    const bookedSlots = [];
    data.forEach(({ start_time, end_time }) => {
        const startIdx = hours.indexOf(start_time);
        const endIdx = hours.indexOf(end_time);
        for (let i = startIdx; i < endIdx; i++) {
            if (i >= 0 && !bookedSlots.includes(hours[i])) {
                bookedSlots.push(hours[i]);
            }
        }
    });

    return bookedSlots;
}

function getPHTime() {
    return new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Manila' }));
}

function getPastSlotsForToday() {
    const now = getPHTime();
    const todayStr = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;

    if (dateInput.value !== todayStr) return [];

    return hours.filter(time => {
        const [hourStr, period] = time.split(' ');
        let [h] = hourStr.split(':').map(Number);
        if (period === 'PM' && h !== 12) h += 12;
        if (period === 'AM' && h === 12) h = 0;
        return h <= now.getHours();
    });
}

// ─── UPDATE SLOTS ───
async function updateSlots(preserveSelection = false) {
    if (!selectedCourt) return;

    const now = getPHTime();
    const todayStr = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;

    if (dateInput.value < todayStr) {
        dateInput.value = todayStr;
        showAlert("Past dates are disabled. Updated to today's date.", "info");
    }

    const previousRange = preserveSelection && selectedRange ? { ...selectedRange } : null;

    if (!preserveSelection) {
        timeSlotsContainer.innerHTML = `<p style="text-align:center;padding:20px;grid-column:1/-1;">Loading slots...</p>`;
    }

    const [, { data: reservations }] = await Promise.all([
        loadBusinessHours(dateInput.value),
        supabase
            .from('reservations')
            .select('start_time, end_time, status')
            .eq('court_id', selectedCourt.id)
            .eq('reservation_date', dateInput.value)
            .in('status', ACTIVE_STATUSES)
    ]);

    if (preserveSelection && (isHoldingSlot || heldReservationId)) return;

    const reservationMap = {};
    if (reservations) {
        reservations.forEach(r => {
            const sIdx = hours.indexOf(r.start_time);
            const eIdx = hours.indexOf(r.end_time);
            for (let i = sIdx; i < eIdx; i++) {
                if (i < 0) continue;
                const existing = reservationMap[hours[i]];
                if (!existing || existing === 'queued') reservationMap[hours[i]] = r.status;
            }
        });
    }

    timeSlotsContainer.innerHTML = hours.slice(0, -1).map((time, index) => {
        const endTime = hours[index + 1];
        const status = reservationMap[time];

        let isPast = false;
        if (dateInput.value === todayStr) {
            const [hourStr, period] = time.split(' ');
            let [h] = hourStr.split(':').map(Number);
            if (period === 'PM' && h !== 12) h += 12;
            if (period === 'AM' && h === 12) h = 0;
            isPast = h <= now.getHours();
        }

        let slotClass = 'vacant';
        let statusText = 'Available';

        if (isPast) {
            slotClass = 'past';
            statusText = 'Past';
        } else if (status === 'held') {
            slotClass = 'occupied';
            statusText = 'On Hold';
        } else if (OCCUPIED_STATUSES.includes(status)) {
            slotClass = 'occupied';
            statusText = 'Occupied';
        }
        return `
            <div class="slot ${slotClass}"
                data-index="${index}"
                data-status="${status || 'vacant'}"
                data-past="${isPast}"
                onclick="handleSlotClick(this, ${index}, '${status || ''}', ${isPast})">
                <span class="time-text">${time} – ${endTime}</span>
                <span class="status-tag">${statusText}</span>
            </div>
        `;
    }).join('');

    selectedSlots = [];
    selectedRange = null;
    startSlot = null;

    if (previousRange) {
        const slotEls = timeSlotsContainer.querySelectorAll('.slot');
        let stillFree = true;

        for (let i = previousRange.from; i <= previousRange.to; i++) {
            const el = slotEls[i];
            if (!el || el.classList.contains('occupied') || el.classList.contains('past')) {
                stillFree = false;
                break;
            }
        }

        if (stillFree) {
            selectedRange = previousRange;
            selectedSlots = hours.slice(selectedRange.from, selectedRange.to + 2);
            highlightRange(selectedRange.from, selectedRange.to);
        }
    }

    updateSelectionLabel();
}

// ─── HANDLE SLOT CLICK ───
async function handleSlotClick(el, blockIndex, status, isPast) {
    if (isPast) {
        showAlert("Cannot select past time slots.", "warning");
        return;
    }

    const time = hours[blockIndex];
    const endTime = hours[blockIndex + 1];

    if (status && status !== '' && status !== 'vacant') {
        const paymentMethod = document.querySelector('input[name="payment"]:checked').value;
        showConflictModal(paymentMethod, getRate(), time, endTime, 1);
        return;
    }

    if (!selectedRange) {
        selectedRange = { from: blockIndex, to: blockIndex };
    } else if (blockIndex === selectedRange.from - 1) {
        selectedRange.from = blockIndex;
    } else if (blockIndex === selectedRange.to + 1) {
        selectedRange.to = blockIndex;
    } else {
        selectedRange = { from: blockIndex, to: blockIndex };
    }

    if (selectedRange) {
        selectedSlots = hours.slice(selectedRange.from, selectedRange.to + 2);
        highlightRange(selectedRange.from, selectedRange.to);
    }
    updateSelectionLabel();
}

function highlightRange(from, to) {
    const slots = timeSlotsContainer.querySelectorAll('.slot');
    slots.forEach((slot, i) => {
        slot.classList.remove('selected');
        if (!slot.classList.contains('occupied') && i >= from && i <= to) {
            slot.classList.add('selected');
        }
    });
}

function updateSelectionLabel() {
    let label = document.getElementById('selectionHint');
    if (!label) {
        label = document.createElement('p');
        label.id = 'selectionHint';
        label.style.cssText = 'text-align:center;margin-top:8px;font-size:0.9rem;color:var(--primary-color);font-weight:600;';
        timeSlotsContainer.parentNode.insertBefore(label, timeSlotsContainer.nextSibling);
    }

    if (selectedSlots.length >= 2) {
        const duration = selectedSlots.length - 1;
        const total = duration * getRate();
        label.innerText = `Selected: ${selectedSlots[0]} – ${selectedSlots[selectedSlots.length - 1]} (${duration}hr/s · ₱${total.toFixed(2)})`;
    } else {
        label.innerText = 'Click a slot to select duration.';
    }
}

// ─── DSS 2 MODAL (PRE-QUEUE ALTERNATIVES) ───
async function showConflictModal(paymentMethod, total, startTime, endTime, duration) {
    const startIdx = hours.indexOf(startTime);

    const sameCourtSuggestion = await findSameCourtAlternative(
        selectedCourt.id,
        dateInput.value,
        startIdx,
        duration
    );

    const differentCourtSuggestion = await findDifferentCourtSameTime(
        dateInput.value,
        startTime,
        endTime
    );

    let conflictModal = document.getElementById('conflictModal');
    if (!conflictModal) {
        conflictModal = document.createElement('div');
        conflictModal.id = 'conflictModal';
        conflictModal.className = 'modal';
        document.body.appendChild(conflictModal);
    }

    const sameCourtHTML = sameCourtSuggestion ? `
        <div style="background:#f0fdf4;border:1px solid #86efac;border-radius:10px;padding:12px;margin:12px 0;text-align:left;">
            <p style="margin:0;font-size:0.85rem;color:#166534;">
                <strong>Same Court Alternative (${sameCourtSuggestion.date}):</strong><br>
                ${sameCourtSuggestion.court_name} • ${sameCourtSuggestion.start} – ${sameCourtSuggestion.end}
            </p>
            <button id="btnAcceptSameCourtSuggestion" class="primary-btn" style="margin-top:10px;">
                Book This Time
            </button>
        </div>
    ` : '';

    const differentCourtHTML = differentCourtSuggestion ? `
        <div style="background:#eff6ff;border:1px solid #93c5fd;border-radius:10px;padding:12px;margin:12px 0;text-align:left;">
            <p style="margin:0;font-size:0.85rem;color:#1d4ed8;">
                <strong>Same Time, Different Court:</strong><br>
                ${differentCourtSuggestion.court_name} • ${differentCourtSuggestion.start} – ${differentCourtSuggestion.end}
            </p>
            <button id="btnAcceptDifferentCourtSuggestion" class="primary-btn" style="margin-top:10px;background:#2563eb;">
                Book This Court
            </button>
        </div>
    ` : '';

    conflictModal.innerHTML = `
        <div class="modal-content" style="max-width:460px;text-align:center;">
            <h3 style="color:#e74c3c;margin-bottom:12px;">
                <i class='bx bx-error-circle'></i> Slot Occupied
            </h3>
            <p style="color:#555;font-size:0.9rem;">
                <strong>${selectedCourt.name}</strong> is occupied on <strong>${dateInput.value} (${startTime} – ${endTime})</strong>.
            </p>

            <div style="margin-top:12px;padding:12px;background:#fffbeb;border:1px solid #fcd34d;border-radius:10px;text-align:left;">
                <div style="font-weight:700;color:#b45309;font-size:0.9rem;margin-bottom:2px;">
                    Join the Queue:
                </div>
                <div style="color:#b45309;font-size:0.85rem;margin-bottom:8px;">
                    ${selectedCourt.name} • ${startTime} – ${endTime}
                </div>
                <button id="btnJoinQueue" class="primary-btn" style="background:#f59e0b;width:100%;">
                   Join Queue
                </button>
            </div>

            ${sameCourtHTML}
            ${differentCourtHTML}

            <button id="btnPickAnother" class="secondary-btn">
                <i class='bx bx-calendar'></i> Pick Another Slot
            </button>
        </div>
    `;

    openModal(conflictModal);

    if (sameCourtSuggestion) {
        document.getElementById('btnAcceptSameCourtSuggestion').onclick = async () => {
            closeModal(conflictModal);
            dateInput.value = sameCourtSuggestion.date;
            selectedSlots = hours.slice(sameCourtSuggestion.index, sameCourtSuggestion.index + duration + 1);
            const opened = await startPaymentFlow(paymentMethod, total);
            if (opened) closeModal(bookingModal);
        };
    }

    if (differentCourtSuggestion) {
        document.getElementById('btnAcceptDifferentCourtSuggestion').onclick = async () => {
            closeModal(conflictModal);
            selectedCourt = { id: differentCourtSuggestion.court_id, name: differentCourtSuggestion.court_name, price_per_hour: getRate() };
            selectedSlots = [differentCourtSuggestion.start, differentCourtSuggestion.end];
            const opened = await startPaymentFlow(paymentMethod, total);
            if (opened) closeModal(bookingModal);
        };
    }

    document.getElementById('btnJoinQueue').onclick = async () => {
        closeModal(conflictModal);
        await joinQueue(paymentMethod, total, startTime, endTime, duration);
    };

    document.getElementById('btnPickAnother').onclick = () => {
        closeModal(conflictModal);
        openModal(bookingModal);
    };
}

async function findSameCourtAlternative(courtId, date, startIdx, duration) {
    let bookedToday = await getBookedSlots(courtId, date);

    for (let i = startIdx + 1; i <= hours.length - 1 - duration; i++) {
        let free = true;
        for (let j = 0; j < duration; j++) {
            if (bookedToday.includes(hours[i + j])) { free = false; break; }
        }
        if (free) {
            const endTime = hours[i + duration] || hours[hours.length - 1];
            return {
                court_id: courtId,
                court_name: selectedCourt.name,
                start: hours[i],
                end: endTime,
                index: i,
                date: date
            };
        }
    }

    const now = getPHTime();
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowStr = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth()+1).padStart(2,'0')}-${String(tomorrow.getDate()).padStart(2,'0')}`;

    const { data: tomorrowRes } = await supabase
        .from('reservations')
        .select('start_time, end_time')
        .eq('court_id', courtId)
        .eq('reservation_date', tomorrowStr)
        .in('status', ACTIVE_STATUSES);

    const bookedTomorrow = [];
    if (tomorrowRes) {
        tomorrowRes.forEach(({ start_time, end_time }) => {
            const sIdx = hours.indexOf(start_time);
            const eIdx = hours.indexOf(end_time);
            for (let k = sIdx; k < eIdx; k++) {
                if (k >= 0 && !bookedTomorrow.includes(hours[k])) {
                    bookedTomorrow.push(hours[k]);
                }
            }
        });
    }

    for (let i = 0; i <= hours.length - 1 - duration; i++) {
        let free = true;
        for (let j = 0; j < duration; j++) {
            if (bookedTomorrow.includes(hours[i + j])) {
                free = false;
                break;
            }
        }
        if (free) {
            const endTime = hours[i + duration] || hours[hours.length - 1];
            return {
                court_id: courtId,
                court_name: selectedCourt.name,
                start: hours[i],
                end: endTime,
                index: i,
                date: tomorrowStr
            };
        }
    }

    return null;
}

async function findDifferentCourtSameTime(date, startTime, endTime) {
    const duration = hours.indexOf(endTime) - hours.indexOf(startTime);
    const startIdx = hours.indexOf(startTime);

    if (startIdx === -1 || startIdx + duration >= hours.length) return null;

    for (const court of courts) {
        if (court.id === selectedCourt.id) continue;
        const booked = await getBookedSlots(court.id, date);
        let free = true;
        for (let j = 0; j < duration; j++) {
            if (booked.includes(hours[startIdx + j])) { free = false; break; }
        }
        if (free) {
            const validEndTime = hours[startIdx + duration] || endTime;
            return {
                court_id: court.id,
                court_name: court.name,
                start: startTime,
                end: validEndTime,
                index: startIdx
            };
        }
    }
    return null;
}

// ─── GOOGLE CALENDAR ───
function toManilaISO(dateStr, timeLabel) {
    const [clock, period] = timeLabel.split(' ');
    let [h, m] = clock.split(':').map(Number);
    if (period === 'PM' && h !== 12) h += 12;
    if (period === 'AM' && h === 12) h = 0;
    return `${dateStr}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00+08:00`;
}

async function syncReservationToCalendar(reservationId, reservation) {
    if (!hasGoogleCalendarAccess()) return;

    const startISO = toManilaISO(reservation.reservation_date, reservation.start_time);
    let endISO = toManilaISO(reservation.reservation_date, reservation.end_time);

    if (new Date(endISO) <= new Date(startISO)) {
        endISO = new Date(new Date(endISO).getTime() + 24 * 60 * 60 * 1000).toISOString();
    }

    const notes = reservation.payment_method === 'E-wallet'
        ? "Awaiting payment verification. Arrive 15-10 minutes before your booked time."
        : "Pay in cash at the counter. Arrive 15-10 minutes before your booked time.";

    const eventId = await addReservationToCalendar({
        courtName: selectedCourt.name,
        startISO,
        endISO,
        notes
    });

    if (!eventId || !reservationId) return;

    const { error } = await supabase
        .from('reservations')
        .update({ google_event_id: eventId })
        .eq('id', reservationId);

    if (error) console.warn("Could not save Google event id:", error.message);
}

// ─── SAVE RESERVATION TO SUPABASE ───
async function saveReservation(paymentMethod, referenceNumber = null, file = null) {
    if (isSaving) return;

    if (selectedSlots.length < 2) {
        showAlert("Your time selection was lost. Please select your slot again.", "warning");
        await returnToBooking();
        return;
    }

    if (paymentMethod === 'E-wallet' && (!referenceNumber || !file || !adminQR)) {
        showAlert("Payment details are incomplete. Please go through the payment step again.", "warning");
        return;
    }

    isSaving = true;

    try {
        const duration = selectedSlots.length - 1;
        const total = duration * getRate();
        const startTime = selectedSlots[0];
        const endTime = selectedSlots[selectedSlots.length - 1];

        let screenshot_url = null;
        let uploadedPath = null;

        if (file) {
            const sanitizedName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
            uploadedPath = `payments/${Date.now()}_${sanitizedName}`;

            const { error: uploadError } = await supabase.storage
                .from('payment-screenshots')
                .upload(uploadedPath, file, { cacheControl: '3600', upsert: false, contentType: file.type });

            if (uploadError) {
                showAlert("Upload failed: " + uploadError.message, "error");
                return;
            }

            const { data: publicData } = supabase.storage
                .from('payment-screenshots')
                .getPublicUrl(uploadedPath);

            screenshot_url = publicData.publicUrl;
        }

        const reservationFields = {
            total_amount: total,
            payment_method: paymentMethod,
            status: paymentMethod === 'E-wallet' ? 'pending_verification' : 'pending'
        };

        if (referenceNumber) reservationFields.reference_number = referenceNumber;
        if (screenshot_url) reservationFields.payment_screenshot = screenshot_url;
        if (paymentMethod === 'E-wallet') reservationFields.payment_qr_id = adminQR.id;

        let error = null;
        let holdLost = false;

        if (heldReservationId) {
            const { data: updatedRows, error: updateError } = await supabase
                .from('reservations')
                .update({ ...reservationFields, hold_expires_at: null })
                .eq('id', heldReservationId)
                .eq('status', 'held')
                .select('id');

            error = updateError;
            holdLost = !updateError && (!updatedRows || updatedRows.length === 0);
        } else {
            const { error: insertError } = await supabase.from('reservations').insert({
                user_id: currentUser.id,
                court_id: selectedCourt.id,
                reservation_date: dateInput.value,
                start_time: startTime,
                end_time: endTime,
                duration_hours: duration,
                ...reservationFields
            });

            error = insertError;
        }

        if (error || holdLost) {
            if (uploadedPath) {
                await supabase.storage.from('payment-screenshots').remove([uploadedPath]);
            }

            if (holdLost) {
                clearHoldState();
                const refundNote = paymentMethod === 'E-wallet'
                    ? " If you already paid, please contact the front desk with your reference number."
                    : "";
                showAlert("Your slot hold expired before the reservation was completed." + refundNote, "warning");
                openModal(bookingModal);
                await updateSlots();
                return;
            }

            const isUniqueViolation = error.code === '23505';
            const isSlotConflict = isUniqueViolation && (
                error.message.includes('reservations_one_active_slot_idx') ||
                error.message.includes('reservations_no_overlap')
            );
            const isReferenceConflict = isUniqueViolation && error.message.includes('reference_number');

            if (isSlotConflict) {
                showAlert("Sorry, this time slot was just booked by someone else.", "warning");
                await showConflictModal(paymentMethod, total, startTime, endTime, duration);
                return;
            }

            if (isReferenceConflict) {
                showAlert("This reference number was already used. Please check your payment details.", "error");
                return;
            }

            showAlert("Booking failed. Please try again.", "error");
            return;
        }

        clearHoldState();
        showSuccess(paymentMethod, total, referenceNumber);
    } finally {
        isSaving = false;
    }
}

// ─── JOIN QUEUE ───
async function joinQueue(paymentMethod, total, startTime, endTime, duration) {
    const { error } = await supabase.from('reservations').insert({
        user_id: currentUser.id,
        court_id: selectedCourt.id,
        reservation_date: dateInput.value,
        start_time: startTime,
        end_time: endTime,
        duration_hours: duration,
        total_amount: total,
        payment_method: paymentMethod,
        status: 'queued'
    });

    if (error) {
        showAlert("Failed to join queue: " + error.message, "error");
        return;
    }

    showSuccessQueue(startTime, endTime, duration, total);
}

function showSuccessQueue(startTime, endTime, duration, total) {
    document.getElementById('successDetails').innerHTML = `
        <p><strong>Status:</strong> <span style="color:#f59e0b;font-weight:bold;">Queued</span></p>
        <p><strong>Court:</strong> ${selectedCourt.name}</p>
        <p><strong>Date:</strong> ${dateInput.value}</p>
        <p><strong>Time:</strong> ${startTime} – ${endTime}</p>
        <p><strong>Amount:</strong> ₱${total.toFixed(2)}</p>
    `;
    openModal(successModal);
}

function showSuccess(method, total, referenceNumber = null) {
    const duration = selectedSlots.length - 1;
    const startTime = selectedSlots[0];
    const endTime = selectedSlots[selectedSlots.length - 1];

    document.getElementById('successDetails').innerHTML = `
        <p><strong>Court:</strong> ${selectedCourt.name}</p>
        <p><strong>Date:</strong> ${dateInput.value}</p>
        <p><strong>Time:</strong> ${startTime} – ${endTime} (${duration}hr/s)</p>
        <p><strong>Total Amount:</strong> ₱${total.toFixed(2)}</p>
        <p><strong>Payment Method:</strong> ${method}</p>
        ${referenceNumber ? `<p><strong>Ref No.:</strong> ${referenceNumber}</p>` : ''}
    `;

    openModal(successModal);
}

// ─── ISSUE REPORTS ───
function openPlayerIssueModal(courtId, courtName) {
    selectedIssueCourtId = courtId;
    document.getElementById("playerIssueCourt").innerText = courtName;
    openModal(document.getElementById("playerIssueModal"));
}

function closePlayerIssueModal() {
    closeModal(document.getElementById("playerIssueModal"));
}

async function submitPlayerIssue() {
    const issueType = document.getElementById("playerIssueType").value;
    const description = document.getElementById("playerIssueDescription").value.trim();

    if (!description) {
        showAlert("Please enter a description.", "warning");
        return;
    }

    const { error } = await supabase.from("court_issues").insert({
        court_id: selectedIssueCourtId,
        issue_type: issueType,
        description: description,
        reported_by: currentUser.id,
        reporter_role: "player",
        status: "pending"
    });

    if (error) {
        showAlert("Failed to submit issue.", "error");
        return;
    }

    showAlert("Issue report submitted.", "success");
    closePlayerIssueModal();
}

function showAlert(message, type = "info") {
    document.getElementById("globalToast")?.remove();
    const colors = { success: "#16a34a", error: "#ef4444", warning: "#f59e0b", info: "#3b82f6" };
    const toast = document.createElement("div");
    toast.id = "globalToast";
    toast.textContent = message;
    toast.style.cssText = `
        position:fixed; top:20px; right:20px; background:${colors[type]}; color:white;
        padding:12px 16px; border-radius:10px; box-shadow:0 10px 25px rgba(0,0,0,0.15);
        z-index:999999; font-size:14px; font-weight:600; max-width:320px;
    `;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 3500);
}

// ─── EXPORTS ───
window.openBooking = openBooking;
window.handleSlotClick = handleSlotClick;
window.openPlayerIssueModal = openPlayerIssueModal;
window.closePlayerIssueModal = closePlayerIssueModal;
window.submitPlayerIssue = submitPlayerIssue;

init();