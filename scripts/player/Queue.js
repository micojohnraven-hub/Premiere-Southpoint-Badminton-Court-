import { supabase } from "../supabase/supabaseClient.js";

// ─── CONFIG ───

const CONFIG = {
    selectors: {
        tableBody: 'court-table-body',
        queueCount: 'stat-user-queues',
        totalQueues: 'total-active-queues',
        avgWaitTime: 'average-wait-time',
        userQueueContainer: 'user-queue-container',
        cardTimers: '.timer-text',
        tableTimers: '.wait-time',
        modal: 'courtDetailModal',
        paymentMethodValue: 'm-payment-method',
        paymentStatusBadge: 'm-payment-status',
        paymentActionContainer: 'payment-action-container'
    },
    sortDirection: { name: true, time: true },
    statsRefreshEveryTicks: 30,
    snapshotPrefix: 'sp_cache:queue:',
    snapshotMaxAgeMs: 1800000
};

// ─── STATE ───

let currentUser = null;
let currentProfile = null;
let userReservations = [];
let allActiveReservations = [];
let liveCourts = [];
let queuePositionRows = [];
let activeModalReservationId = null;
let isRefreshing = false;
let refreshAgain = false;
let tickCount = 0;

// ─── INIT ───

document.addEventListener('DOMContentLoaded', async () => {
    const { data: { session } } = await supabase.auth.getSession();

    if (!session?.user) {
        window.location.href = "../../pages/auth/login.html";
        return;
    }

    currentUser = session.user;

    document.getElementById('logoutBtn')?.addEventListener('click', async (e) => {
        e.preventDefault();
        await supabase.auth.signOut();
        window.location.href = "../../pages/auth/login.html";
    });

    renderSnapshot();

    const [verified] = await Promise.all([verifyPlayer(), loadQueueData()]);
    if (!verified) return;

    setInterval(updateAllTimers, 1000);
});

async function verifyPlayer() {
    const [userResult, profileResult] = await Promise.all([
        supabase.auth.getUser(),
        supabase.from('profiles').select('*').eq('id', currentUser.id).single()
    ]);

    const user = userResult.data?.user;

    if (userResult.error || !user) {
        window.location.href = "../../pages/auth/login.html";
        return false;
    }

    const profile = profileResult.data;

    if (profileResult.error || !profile) {
        alert("Your account profile could not be verified. Please log in again.");
        await supabase.auth.signOut();
        window.location.href = "../../pages/auth/login.html";
        return false;
    }

    if (profile.role !== 'player') {
        alert("Access denied. This page is for players only.");
        window.location.href = "../../pages/auth/login.html";
        return false;
    }

    currentUser = user;
    currentProfile = profile;
    return true;
}

// ─── SNAPSHOT ───

function saveSnapshot() {
    if (!currentUser) return;

    try {
        sessionStorage.setItem(CONFIG.snapshotPrefix + currentUser.id, JSON.stringify({
            savedAt: Date.now(),
            day: getPHToday(),
            courts: liveCourts,
            userReservations,
            queuePositionRows,
            allActiveReservations: allActiveReservations.map(res => ({
                id: res.id,
                user_id: res.user_id,
                court_id: res.court_id,
                reservation_date: res.reservation_date,
                start_time: res.start_time,
                end_time: res.end_time,
                status: res.status,
                created_at: res.created_at,
                profiles: res.profiles?.full_name
                    ? { full_name: maskName(res.profiles.full_name) }
                    : null
            }))
        }));
    } catch {
        return;
    }
}

function renderSnapshot() {
    try {
        const raw = sessionStorage.getItem(CONFIG.snapshotPrefix + currentUser.id);
        if (!raw) return false;

        const snapshot = JSON.parse(raw);

        if (Date.now() - snapshot.savedAt > CONFIG.snapshotMaxAgeMs) return false;
        if (snapshot.day !== getPHToday()) return false;

        const now = getPHNow();

        liveCourts = snapshot.courts || [];
        queuePositionRows = snapshot.queuePositionRows || [];
        allActiveReservations = snapshot.allActiveReservations || [];
        userReservations = (snapshot.userReservations || []).filter(res => {
            const end = new Date(`${res.reservation_date}T${to24Hour(res.end_time)}`);
            return end > now;
        });

        if (liveCourts.length > 0) {
            renderCourtOverview(liveCourts, allActiveReservations);
        }

        renderMyQueues();
        updateStats();
        return true;
    } catch {
        return false;
    }
}

// ─── LOAD DATA ───

async function loadQueueData({ skipCleanup = false } = {}) {
    if (isRefreshing) {
        refreshAgain = true;
        return;
    }

    isRefreshing = true;

    try {
        do {
            refreshAgain = false;

            const [, queuesLoaded] = await Promise.all([
                loadLiveCourtOverview(),
                loadMyQueues()
            ]);

            if (queuesLoaded) {
                renderMyQueues();
                saveSnapshot();
            }

            updateStats();
        } while (refreshAgain);
    } finally {
        isRefreshing = false;
    }

    if (!skipCleanup) runCleanup();
}

async function runCleanup() {
    const hasQueued = userReservations.length > 0
        || allActiveReservations.some(r => r.status === 'queued');

    try {
        await Promise.all([
            supabase.rpc('cleanup_expired_queued_reservations'),
            supabase.rpc('cleanup_stale_queues_after_30mins')
        ]);
    } catch (err) {
        console.error('Queue cleanup failed:', err);
        return;
    }

    if (hasQueued) await loadQueueData({ skipCleanup: true });
}

// ─── MY QUEUED RESERVATIONS ───

async function loadMyQueues() {
    const today = getPHToday();

    const [myResult, positionResult] = await Promise.all([
        supabase
            .from('reservations')
            .select(`*, courts(name)`)
            .eq('user_id', currentUser.id)
            .eq('status', 'queued')
            .order('created_at', { ascending: true }),
        supabase
            .from('reservations')
            .select('id, court_id, reservation_date, start_time, end_time, created_at')
            .eq('status', 'queued')
            .gte('reservation_date', today)
            .order('created_at', { ascending: true })
    ]);

    if (myResult.error) {
        console.error('Error loading queues:', myResult.error.message);
        renderEmptyQueues('Failed to load queues.');
        return false;
    }

    if (positionResult.error) {
        console.error('Error fetching court queues for positioning:', positionResult.error);
    }

    queuePositionRows = positionResult.data || [];

    const now = getPHNow();

    userReservations = (myResult.data || []).filter(res => {
        const end = new Date(`${res.reservation_date}T${to24Hour(res.end_time)}`);
        return end > now;
    });

    return true;
}

function renderMyQueues() {
    const container = document.getElementById(CONFIG.selectors.userQueueContainer);
    if (!container) return;

    if (userReservations.length === 0) {
        container.innerHTML = `<p class="no-posts-text">You have no active queues.</p>`;
        return;
    }

    const queueList = queuePositionRows;
    const now = getPHNow();

    const cards = userReservations.map((res) => {
        const courtName = res.courts?.name || 'Unknown Court';
        const joinedTime = new Date(res.created_at).toLocaleTimeString('en-US', {
            hour: '2-digit',
            minute: '2-digit',
            timeZone: 'Asia/Manila'
        });

        const myStart = toMinutes(res.start_time);
        const myEnd = toMinutes(res.end_time);

        const overlapping = queueList.filter(r => {
            if (r.court_id !== res.court_id || r.reservation_date !== res.reservation_date) {
                return false;
            }

            return toMinutes(r.start_time) < myEnd && toMinutes(r.end_time) > myStart;
        });

        const position = overlapping.findIndex(r => r.id === res.id) + 1 || 1;
        const waitSeconds = getQueueWaitSeconds(res, now);

        return `
            <div class="user-queue-card" data-id="${res.id}">
                <div class="card-top">
                    <span class="court-name">${escapeHtml(courtName)}</span>
                    <span class="position-badge">#${position} in Queue</span>
                </div>
                <div class="card-mid">
                    <div class="info-row">
                        <i class='bx bx-hourglass'></i>
                        <span>Est. Wait: <strong class="timer-text" data-seconds="${waitSeconds}" data-position="${position}">--</strong></span>
                    </div>
                    <div class="info-row">
                        <i class='bx bx-calendar'></i>
                        <span>Date: <strong>${escapeHtml(res.reservation_date)}</strong></span>
                    </div>
                    <div class="info-row">
                        <i class='bx bx-time'></i>
                        <span>Time: <strong>${escapeHtml(res.start_time)} – ${escapeHtml(res.end_time)}</strong></span>
                    </div>
                    <div class="info-row">
                        <i class='bx bx-log-in-circle'></i>
                        <span>Joined: ${joinedTime}</span>
                    </div>
                </div>
                <div class="card-btns">
                    <button class="btn-details" data-id="${res.id}">View Details</button>
                    <button class="btn-leave" data-id="${res.id}">Leave Queue</button>
                </div>
            </div>
        `;
    });

    container.innerHTML = cards.join('');

    container.querySelectorAll(CONFIG.selectors.cardTimers).forEach(timer => {
        renderCardTimer(timer, parseInt(timer.dataset.seconds, 10) || 0);
    });

    container.querySelectorAll('.btn-leave').forEach(btn => {
        btn.addEventListener('click', () => handleLeaveQueue(btn));
    });

    container.querySelectorAll('.btn-details').forEach(btn => {
        btn.addEventListener('click', () => handleViewDetails(btn.dataset.id));
    });
}

function renderEmptyQueues(message) {
    const container = document.getElementById(CONFIG.selectors.userQueueContainer);
    if (!container) return;

    container.innerHTML = `
        <div style="text-align:center; padding:40px; color:#888; width:100%;">
            <i class='bx bx-calendar-x' style="font-size:3rem;"></i>
            <p style="margin-top:8px;">${escapeHtml(message)}</p>
        </div>
    `;
}


// ─── WAIT TIME ───

function getQueueWaitSeconds(reservation, now) {
    const blockerEnds = allActiveReservations
        .filter(other =>
            other.id !== reservation.id &&
            other.court_id === reservation.court_id &&
            other.reservation_date === reservation.reservation_date &&
            (other.status === 'playing' || other.status === 'confirmed') &&
            to24Hour(other.start_time) < to24Hour(reservation.end_time) &&
            to24Hour(other.end_time) > to24Hour(reservation.start_time)
        )
        .map(other => new Date(`${other.reservation_date}T${to24Hour(other.end_time)}`).getTime());

    const reference = blockerEnds.length > 0
        ? new Date(Math.max(...blockerEnds))
        : new Date(`${reservation.reservation_date}T${to24Hour(reservation.start_time)}`);

    return Math.max(0, Math.floor((reference - now) / 1000));
}

function renderCardTimer(timer, seconds) {
    const position = parseInt(timer.dataset.position, 10) || 1;

    if (seconds > 0) {
        timer.textContent = formatWait(seconds);
        timer.style.color = "";
        return;
    }

    if (position === 1) {
        timer.textContent = "Ready!";
        timer.style.color = "var(--primary-color)";
        return;
    }

    timer.textContent = "Waiting for your turn";
    timer.style.color = "";
}

// ─── LIVE COURT OVERVIEW ───

async function loadLiveCourtOverview() {
    const today = getPHToday();

    const [courtResult, reservationResult] = await Promise.all([
        supabase
            .from('courts')
            .select('*')
            .eq('is_active', true)
            .order('id'),
        supabase
            .from('reservations')
            .select(`*, profiles(full_name, username)`)
            .eq('reservation_date', today)
            .in('status', ['playing', 'confirmed', 'queued'])
    ]);

    if (courtResult.error) {
        console.error('Error loading courts:', courtResult.error.message);
        return;
    }

    if (reservationResult.error) {
        console.error('Error loading reservations:', reservationResult.error.message);
        return;
    }

    liveCourts = courtResult.data || [];
    allActiveReservations = reservationResult.data || [];
    renderCourtOverview(liveCourts, allActiveReservations);
}

function maskName(name) {
    if (!name) return 'Player';

    const parts = name.trim().split(/\s+/);
    const first = parts[0];
    const firstMasked = first.length <= 1
        ? first
        : first[0] + '*'.repeat(first.length - 1);

    if (parts.length > 1) {
        return `${firstMasked} ${parts[1][0]}.`;
    }

    return firstMasked;
}

function getDisplayName(res) {
    if (!res) return '--';

    if (res.user_id === currentUser.id) return 'You';

    if (res.profiles?.full_name) {
        return maskName(res.profiles.full_name);
    }

    return 'Player';
}

function renderCourtOverview(courts, reservations) {
    const tbody = document.getElementById(CONFIG.selectors.tableBody);
    if (!tbody) return;

    const now = getPHNow();

    tbody.innerHTML = courts.map(court => {
        const courtRes = reservations
            .filter(r => r.court_id === court.id)
            .sort((a, b) => new Date(a.created_at) - new Date(b.created_at));

        let selectedRes = courtRes.find(r => r.status === 'playing') || null;
        let state = selectedRes ? 'playing' : 'available';

        if (!selectedRes) {
            selectedRes = courtRes
                .filter(r => r.status === 'confirmed')
                .sort((a, b) =>
                    new Date(`${a.reservation_date}T${to24Hour(a.start_time)}`) -
                    new Date(`${b.reservation_date}T${to24Hour(b.start_time)}`)
                )[0] || null;

            if (selectedRes) state = 'confirmed';
        }

        if (!selectedRes) {
            const queuedList = courtRes.filter(r => r.status === 'queued');

            if (queuedList.length > 0) {
                selectedRes = queuedList[0];
                state = 'queued';
            }
        }

        let playerLabel = '--';
        let waitSeconds = 0;
        let statusClass = 'open';
        let statusText = 'Available';

        if (state === 'playing') {
            const end = new Date(`${selectedRes.reservation_date}T${to24Hour(selectedRes.end_time)}`);
            waitSeconds = Math.max(0, Math.floor((end - now) / 1000));
            playerLabel = getDisplayName(selectedRes);
            statusClass = 'busy';
            statusText = 'Now Playing';
        } else if (state === 'confirmed') {
            const start = new Date(`${selectedRes.reservation_date}T${to24Hour(selectedRes.start_time)}`);
            waitSeconds = Math.max(0, Math.floor((start - now) / 1000));
            playerLabel = getDisplayName(selectedRes);
            statusClass = 'upcoming';
            statusText = '⏭ Reserved Next';
        } else if (state === 'queued') {
            playerLabel = getDisplayName(selectedRes);
            statusClass = 'queued';
            statusText = 'Queue Waiting';
        }

        return `
            <tr>
                <td class="player-name">${escapeHtml(court.name)}</td>
                <td>${escapeHtml(playerLabel)}</td>
                <td class="wait-time" data-seconds="${waitSeconds}">
                    ${secondsToTime(waitSeconds)}
                </td>
                <td><span class="status-badge ${statusClass}">${statusText}</span></td>
            </tr>
        `;
    }).join('');
}

// ─── STATS ───

function updateStats() {
    const totalEl = document.getElementById(CONFIG.selectors.totalQueues);
    if (totalEl) totalEl.innerText = allActiveReservations.length;

    const countEl = document.getElementById(CONFIG.selectors.queueCount);
    if (countEl) countEl.innerText = userReservations.length;

    const avgEl = document.getElementById(CONFIG.selectors.avgWaitTime);
    if (!avgEl) return;

    const queuedOnly = allActiveReservations.filter(r => r.status === 'queued');

    if (queuedOnly.length === 0) {
        avgEl.innerText = '0 mins';
        return;
    }

    const now = getPHNow();
    const totalWaitSeconds = queuedOnly.reduce(
        (sum, reservation) => sum + getQueueWaitSeconds(reservation, now),
        0
    );

    const avgMinutes = Math.round(totalWaitSeconds / queuedOnly.length / 60);

    avgEl.innerText = avgMinutes === 0 ? '0 mins' : formatWait(avgMinutes * 60);
}

// ─── LEAVE QUEUE ───

async function handleLeaveQueue(btn) {
    const card = btn.closest('.user-queue-card');
    const id = btn.dataset.id;
    const courtName = card.querySelector('.court-name')?.innerText || 'this court';

    const confirmed = await showConfirmModal(
        "Leave Queue?",
        `Are you sure you want to leave the queue for ${courtName}?`,
        "Leave Queue"
    );

    if (!confirmed) return;

    const { error } = await supabase.rpc('leave_queue_reservation', {
        p_reservation_id: id,
        p_user_id: currentUser.id
    });

    if (error) {
        alert('Failed to leave queue: ' + error.message);
        return;
    }

    card.style.opacity = '0';
    card.style.transform = 'scale(0.9)';
    card.style.transition = 'all 0.3s ease';

    setTimeout(() => {
        card.remove();
        userReservations = userReservations.filter(r => r.id !== id);
        allActiveReservations = allActiveReservations.filter(r => r.id !== id);
        queuePositionRows = queuePositionRows.filter(r => r.id !== id);

        if (userReservations.length === 0) renderMyQueues();

        updateMyQueueCount();
        updateStats();
        saveSnapshot();
    }, 300);
}

// ─── VIEW DETAILS ───

function handleViewDetails(id) {
    const res = userReservations.find(r => r.id === id);
    if (!res) return;

    activeModalReservationId = id;

    const courtName = res.courts?.name || 'Unknown';
    const userName = currentProfile?.full_name
        || currentUser.user_metadata?.full_name
        || currentUser.email;

    openModal(
        courtName,
        userName,
        res.duration_hours,
        res.reservation_date,
        `${res.start_time} – ${res.end_time}`,
        null,
        res.payment_method === 'E-wallet' ? 'e-wallet' : 'cash',
        res.status,
        res.total_amount
    );
}

// ─── MODAL ───

function openModal(courtName, userName, hours, date, time, staffName, method, status, totalAmount) {
    const modal = document.getElementById(CONFIG.selectors.modal);
    if (!modal) return;

    document.getElementById("m-court-name").innerText = courtName;
    document.getElementById("m-user-name").innerText = userName;
    document.getElementById("m-hours").innerText = `${hours} hr(s)`;
    document.getElementById("m-date-time").innerText = `${date} | ${time}`;

    const staffEl = document.getElementById("m-staff-name");
    if (staffEl) staffEl.innerText = staffName || "Not assigned";

    document.getElementById("m-total-price").innerText =
        `₱${Number(totalAmount || 0).toLocaleString('en-PH', {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
        })}`;

    const methodEl = document.getElementById(CONFIG.selectors.paymentMethodValue);
    const statusBadge = document.getElementById(CONFIG.selectors.paymentStatusBadge);
    const payContainer = document.getElementById(CONFIG.selectors.paymentActionContainer);

    methodEl.innerText = method === 'e-wallet' ? "E-Wallet" : "Cash";
    statusBadge.className = "payment-badge";

    if (method === 'e-wallet') {
        statusBadge.innerText = "Paid";
        statusBadge.classList.add('status-ewallet-paid');
        payContainer.classList.add('hidden');
    } else if (status === 'queued') {
        statusBadge.innerText = "Waiting in Queue";
        statusBadge.className = "payment-badge status-paid-half";
        payContainer.classList.add('hidden');
    } else {
        statusBadge.innerText = "Payment Pending";
        statusBadge.classList.add('status-pending');
        payContainer.classList.remove('hidden');
    }

    modal.style.display = "block";
}

function closeModal() {
    const modal = document.getElementById(CONFIG.selectors.modal);
    if (modal) modal.style.display = "none";
    activeModalReservationId = null;
}

async function processPayment() {
    if (!activeModalReservationId) return;

    const res = userReservations.find(r => r.id === activeModalReservationId);
    if (!res) return;

    const courtName = res.courts?.name || 'this court';

    const confirmed = await showConfirmModal(
        "Confirm Payment",
        `Process full payment for ${courtName}?`,
        "Confirm Payment"
    );

    if (!confirmed) return;

    const { error } = await supabase.rpc('process_reservation_payment', {
        p_reservation_id: activeModalReservationId,
        p_user_id: currentUser.id
    });

    if (error) {
        alert('Payment update failed: ' + error.message);
        return;
    }

    await loadQueueData();

    alert("Payment confirmed!");
}

function showConfirmModal(title, message, confirmText = "Confirm") {
    return new Promise((resolve) => {
        const modal = document.getElementById("confirmModal");
        const titleEl = document.getElementById("confirmModalTitle");
        const messageEl = document.getElementById("confirmModalMessage");
        const confirmBtn = document.getElementById("confirmModalConfirm");
        const cancelBtn = document.getElementById("confirmModalCancel");

        if (!modal || !titleEl || !messageEl || !confirmBtn || !cancelBtn) {
            resolve(false);
            return;
        }

        titleEl.innerText = title;
        messageEl.innerText = message;
        confirmBtn.innerText = confirmText;

        modal.style.display = "flex";

        const cleanup = (result) => {
            modal.style.display = "none";

            confirmBtn.onclick = null;
            cancelBtn.onclick = null;

            resolve(result);
        };

        confirmBtn.onclick = () => cleanup(true);
        cancelBtn.onclick = () => cleanup(false);
    });
}

// ─── TIMERS ───

function updateAllTimers() {
    tickCount += 1;

    document.querySelectorAll(CONFIG.selectors.cardTimers).forEach(timer => {
        let seconds = parseInt(timer.dataset.seconds, 10) || 0;

        if (seconds > 0) {
            seconds -= 1;
            timer.dataset.seconds = seconds;
        }

        renderCardTimer(timer, seconds);
    });

    document.querySelectorAll(CONFIG.selectors.tableTimers).forEach(cell => {
        let seconds = parseInt(cell.dataset.seconds, 10) || 0;

        if (seconds > 0) {
            seconds--;
            cell.dataset.seconds = seconds;
            cell.innerText = secondsToTime(seconds);
        } else {
            cell.innerText = "00:00";

            const statusBadge = cell.closest('tr')?.querySelector('.status-badge');

            if (statusBadge?.classList.contains('busy')) {
                statusBadge.innerText = "Available";
                statusBadge.className = "status-badge open";
            }
        }
    });

    if (tickCount % CONFIG.statsRefreshEveryTicks === 0) {
        updateStats();
    }

    if (document.querySelectorAll('.user-queue-card').length > 0) {
        const hasExpired = userReservations.some(res => {
            const end = new Date(`${res.reservation_date}T${to24Hour(res.end_time)}`);
            return end <= getPHNow();
        });

        if (hasExpired) {
            loadQueueData();
        }
    }
}

// ─── SORT ───

function sortQueueTable(criteria) {
    const tableBody = document.getElementById(CONFIG.selectors.tableBody);
    if (!tableBody) return;

    const rows = Array.from(tableBody.querySelectorAll('tr'));

    rows.sort((a, b) => {
        if (criteria === 'name') {
            const valA = a.querySelector('td:first-child')?.innerText.toLowerCase() || "";
            const valB = b.querySelector('td:first-child')?.innerText.toLowerCase() || "";

            return CONFIG.sortDirection.name
                ? valA.localeCompare(valB)
                : valB.localeCompare(valA);
        }

        if (criteria === 'time') {
            const valA = parseInt(a.querySelector('.wait-time')?.dataset.seconds, 10) || 0;
            const valB = parseInt(b.querySelector('.wait-time')?.dataset.seconds, 10) || 0;

            return CONFIG.sortDirection.time ? valA - valB : valB - valA;
        }

        return 0;
    });

    CONFIG.sortDirection[criteria] = !CONFIG.sortDirection[criteria];
    tableBody.append(...rows);
}

function updateMyQueueCount() {
    const count = document.querySelectorAll('.user-queue-card').length;
    const el = document.getElementById(CONFIG.selectors.queueCount);
    if (el) el.innerText = count;
}

// ─── HELPERS ───

function to24Hour(timeStr) {
    const [time, modifier] = timeStr.split(' ');
    let [hours, minutes] = time.split(':');

    hours = parseInt(hours, 10);

    if (modifier === 'PM' && hours !== 12) hours += 12;
    if (modifier === 'AM' && hours === 12) hours = 0;

    return `${String(hours).padStart(2, '0')}:${minutes}:00`;
}

function toMinutes(timeStr) {
    const [hours, minutes] = to24Hour(timeStr).split(':').map(Number);
    return hours * 60 + minutes;
}

function getPHNow() {
    return new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Manila' }));
}

function getPHToday() {
    const now = getPHNow();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function secondsToTime(totalSeconds) {
    if (totalSeconds <= 0) return "00:00";

    const h = Math.floor(totalSeconds / 3600);
    const m = Math.floor((totalSeconds % 3600) / 60);
    const s = totalSeconds % 60;
    const mStr = m.toString().padStart(2, '0');
    const sStr = s.toString().padStart(2, '0');

    return h > 0 ? `${h}:${mStr}:${sStr}` : `${mStr}:${sStr}`;
}

function pluralize(count, singular, plural) {
    return `${count} ${count === 1 ? singular : plural}`;
}

function formatWait(totalSeconds) {
    const seconds = Math.max(0, Math.floor(totalSeconds));

    if (seconds === 0) return "Now";

    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;

    if (days > 0) {
        return hours > 0
            ? `${pluralize(days, 'day', 'days')} ${pluralize(hours, 'hr', 'hrs')}`
            : pluralize(days, 'day', 'days');
    }

    if (hours > 0) {
        return minutes > 0
            ? `${pluralize(hours, 'hr', 'hrs')} ${pluralize(minutes, 'min', 'mins')}`
            : pluralize(hours, 'hr', 'hrs');
    }

    if (minutes > 0) {
        return secs > 0
            ? `${pluralize(minutes, 'min', 'mins')} ${pluralize(secs, 'sec', 'secs')}`
            : pluralize(minutes, 'min', 'mins');
    }

    return pluralize(secs, 'sec', 'secs');
}

function escapeHtml(value) {
    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

// ─── GLOBAL EXPORTS ───

window.closeModal = closeModal;
window.processPayment = processPayment;
window.sortQueueTable = sortQueueTable;