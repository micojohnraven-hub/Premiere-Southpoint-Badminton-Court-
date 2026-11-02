import { supabase } from "../supabase/supabaseClient.js";

let currentNavDate = new Date();
let specialEvents = {};
let activeAction = null;
let selectedDateKey = "";

document.addEventListener('DOMContentLoaded', () => {
    initCalendar();
    loadDashboardStats();
    loadTodaysSchedule();
    loadSpecialEvents();
    setupAdminEventListeners();
});

// ─── DASHBOARD STATS ───
async function loadDashboardStats() {
    const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' });

    const { data: courts } = await supabase.from('courts').select('id, is_active');
    const activeCourtsList = (courts || []).filter(c => c.is_active);
    const totalActiveCourts = activeCourtsList.length;

    const { data: playingNow } = await supabase
        .from('reservations')
        .select('court_id')
        .eq('reservation_date', todayStr)
        .eq('status', 'playing');

    const courtsInUse = new Set((playingNow || []).map(r => r.court_id)).size;
    const occupancyPct = totalActiveCourts > 0 ? Math.round((courtsInUse / totalActiveCourts) * 100) : 0;

    document.getElementById('statOccupancy').innerText = `${occupancyPct}%`;
    document.getElementById('statActiveCourts').innerText = `${courtsInUse} / ${totalActiveCourts}`;
    document.getElementById('statAvailableSlots').innerText = `${totalActiveCourts - courtsInUse} available slots`;

    const { data: players } = await supabase.from('profiles').select('id, created_at').eq('role', 'player');
    const rows = players || [];

    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);
    const newThisMonth = rows.filter(p => new Date(p.created_at) >= startOfMonth).length;

    document.getElementById('statTotalPlayers').innerText = rows.length;
    document.getElementById('statNewPlayersTrend').innerText = `+${newThisMonth} joined this month`;
}

// ─── TODAY'S SCHEDULE ───
async function loadTodaysSchedule() {
    const container = document.getElementById('todaysScheduleList');
    if (!container) return;

    const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' });

    const { data: courts } = await supabase.from('courts').select('id, name');
    const courtNameById = {};
    (courts || []).forEach(c => courtNameById[c.id] = c.name);

    const { data: reservations, error } = await supabase
        .from('reservations')
        .select('court_id, start_time, end_time, status, profiles(full_name)')
        .eq('reservation_date', todayStr)
        .neq('status', 'cancelled')
        .order('start_time', { ascending: true });

    if (error) {
        console.error('Schedule fetch error:', error);
        container.innerHTML = '<p class="schedule-empty">Unable to load schedule.</p>';
        return;
    }

    const rows = reservations || [];

    if (rows.length === 0) {
        container.innerHTML = '<p class="schedule-empty">No bookings scheduled for today.</p>';
        return;
    }

    container.innerHTML = rows.map(r => `
        <div class="schedule-item status-${r.status}">
            <div class="schedule-time">
                <span>${r.start_time}</span>
                <small>${r.end_time}</small>
            </div>
            <div class="schedule-details">
                <p><strong>${courtNameById[r.court_id] || 'Court'}</strong></p>
                <span>${r.profiles?.full_name || 'Unknown player'}</span>
            </div>
            <span class="status-badge">${formatStatus(r.status)}</span>
        </div>
    `).join('');
}

function formatStatus(status) {
    return status.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

// ─── CALENDAR ───
function initCalendar() {
    const grid = document.getElementById('calGrid');
    const label = document.getElementById('calMonth');
    if (!grid || !label) return;

    const year = currentNavDate.getFullYear();
    const month = currentNavDate.getMonth();

    label.innerText = currentNavDate.toLocaleString('default', { month: 'long', year: 'numeric' });

    const firstDayIndex = new Date(year, month, 1).getDay();
    const lastDay = new Date(year, month + 1, 0).getDate();

    const headers = Array.from(grid.querySelectorAll('.day-name'));
    grid.innerHTML = '';
    headers.forEach(h => grid.appendChild(h));

    for (let i = 0; i < firstDayIndex; i++) {
        grid.appendChild(document.createElement('div'));
    }

    for (let i = 1; i <= lastDay; i++) {
        const dayDiv = document.createElement('div');
        dayDiv.innerText = i;
        dayDiv.classList.add('cal-day');

        const dateKey = `${year}-${(month + 1).toString().padStart(2, '0')}-${i.toString().padStart(2, '0')}`;
        const today = new Date();

        if (i === today.getDate() && month === today.getMonth() && year === today.getFullYear()) {
            dayDiv.classList.add('cal-today');
        }

        if (specialEvents[dateKey]) {
            dayDiv.classList.add('has-event');
            dayDiv.title = specialEvents[dateKey].title;
        }

        dayDiv.onclick = () => openEventModal(dateKey);
        grid.appendChild(dayDiv);
    }
}

function changeMonth(delta) {
    currentNavDate.setMonth(currentNavDate.getMonth() + delta);
    initCalendar();
}

function openEventModal(dateKey) {
    selectedDateKey = dateKey;
    const modal = document.getElementById('eventModal');
    const deleteBtn = document.getElementById('btnDeleteEvent');

    document.getElementById('eventDateDisplay').innerText = `Date: ${dateKey}`;

    if (specialEvents[dateKey]) {
        document.getElementById('eventTitle').value = specialEvents[dateKey].title;
        document.getElementById('eventDesc').value = specialEvents[dateKey].desc;
        deleteBtn.style.display = "block";
    } else {
        document.getElementById('eventTitle').value = "";
        document.getElementById('eventDesc').value = "";
        deleteBtn.style.display = "none";
    }

    modal.style.display = 'flex';
    setTimeout(() => modal.classList.add('show'), 10);
}

function closeEventModal() {
    const modal = document.getElementById('eventModal');
    modal.classList.remove('show');
    setTimeout(() => modal.style.display = 'none', 300);
}

// ─── SPECIAL EVENTS (persisted to Supabase) ───
async function loadSpecialEvents() {
    const { data, error } = await supabase
        .from('special_events')
        .select('event_date, title, description');

    if (error) {
        console.error('Failed to load special events:', error);
        return;
    }

    specialEvents = {};
    (data || []).forEach(row => {
        specialEvents[row.event_date] = { title: row.title, desc: row.description || '' };
    });

    initCalendar();
}

async function saveSpecialEvent() {
    const title = document.getElementById('eventTitle').value.trim();
    const desc = document.getElementById('eventDesc').value.trim();

    if (!title) {
        alert("Please enter an event title.");
        return;
    }

    const { data: { user } } = await supabase.auth.getUser();

    const { error } = await supabase
        .from('special_events')
        .upsert({
            event_date: selectedDateKey,
            title,
            description: desc,
            created_by: user?.id || null,
            updated_at: new Date().toISOString(),
        }, { onConflict: 'event_date' });

    if (error) {
        console.error(error);
        showAdminNotification("Failed to save event: " + error.message);
        return;
    }

    specialEvents[selectedDateKey] = { title, desc };
    showAdminNotification(`Event "${title}" saved!`);
    initCalendar();
    closeEventModal();
}

async function deleteSpecialEvent() {
    if (!specialEvents[selectedDateKey]) return;
    const title = specialEvents[selectedDateKey].title;

    const { error } = await supabase
        .from('special_events')
        .delete()
        .eq('event_date', selectedDateKey);

    if (error) {
        console.error(error);
        showAdminNotification("Failed to delete event: " + error.message);
        return;
    }

    delete specialEvents[selectedDateKey];
    showAdminNotification(`Event "${title}" deleted.`);
    initCalendar();
    closeEventModal();
}

// ─── OPERATIONS / CONFIRM MODAL ───
function openConfirm(type) {
    activeAction = type;
    const modal = document.getElementById('confirmModal');

    if (type === 'ops') {
        document.getElementById('modalTitle').innerText = "Update Operations";
        document.getElementById('modalText').innerText = "Apply these new operating hours to all court bookings?";
    }

    modal.style.display = 'flex';
    setTimeout(() => modal.classList.add('show'), 10);
}

function closeConfirm() {
    const modal = document.getElementById('confirmModal');
    modal.classList.remove('show');
    setTimeout(() => {
        modal.style.display = 'none';
        activeAction = null;
    }, 300);
}

async function handleConfirm() {
    if (activeAction === 'ops') {
        const success = await saveOperatingHours();
        if (success) showAdminNotification("Facility schedule updated successfully!");
    }
    closeConfirm();
}

function setupAdminEventListeners() {
    const confirmBtn = document.getElementById('modalConfirmBtn');
    if (confirmBtn) confirmBtn.addEventListener('click', handleConfirm);

    window.addEventListener('click', (e) => {
        if (e.target.classList.contains('modal-overlay')) {
            closeConfirm();
            closeEventModal();
        }
    });
}

function showAdminNotification(message) {
    const notification = document.createElement('div');
    notification.style.cssText = `
        position: fixed; bottom: 20px; right: 20px; 
        background: var(--primary-color); color: white; 
        padding: 12px 25px; border-radius: 8px; 
        box-shadow: 0 4px 12px rgba(0,0,0,0.15); 
        z-index: 10000; animation: slideUp 0.3s ease-out;
        font-weight: 500; font-size: 14px;
    `;
    notification.innerText = message;
    document.body.appendChild(notification);

    setTimeout(() => {
        notification.style.opacity = '0';
        notification.style.transition = '0.5s';
        setTimeout(() => notification.remove(), 500);
    }, 3000);
}

window.changeMonth = changeMonth;
window.openConfirm = openConfirm;
window.closeConfirm = closeConfirm;
window.saveSpecialEvent = saveSpecialEvent;
window.deleteSpecialEvent = deleteSpecialEvent;
window.closeEventModal = closeEventModal;