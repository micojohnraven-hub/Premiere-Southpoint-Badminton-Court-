// ─── IMPORTS ───
import { supabase } from './scripts/supabase/supabaseClient.js';

// ─── CONSTANTS ───
const OPEN_HOUR = 8;
const CLOSE_HOUR = 22;
const MAX_DAYS_AHEAD = 60;
const TIME_ZONE = 'Asia/Manila';
const MAINTENANCE_STATUSES = ['maintenance', 'closed', 'unavailable', 'disabled'];
const LOGIN_URL = '/pages/auth/login.html';

const tabsEl = document.getElementById('courtTabs');
const calendarEl = document.getElementById('calendar');
const schedEl = document.getElementById('schedCard');
const slotsEl = document.getElementById('slotList');
const hoursEl = document.getElementById('hoursList');
const contactBlock = document.getElementById('contactBlock');
const contactList = document.getElementById('contactList');
const footerContact = document.getElementById('footerContact');

// ─── TIME HELPERS ───
function toMinutes(value) {
  if (!value) return null;
  const match = String(value).trim().match(/^(\d{1,2}):(\d{2})(?::\d{2})?\s*(am|pm)?$/i);
  if (!match) return null;
  let hours = Number(match[1]);
  const meridiem = match[3] ? match[3].toLowerCase() : null;
  if (meridiem === 'pm' && hours < 12) hours += 12;
  if (meridiem === 'am' && hours === 12) hours = 0;
  return hours * 60 + Number(match[2]);
}

function formatMinutes(total) {
  const hours24 = Math.floor(total / 60) % 24;
  const hours12 = hours24 % 12 === 0 ? 12 : hours24 % 12;
  return `${hours12}:${String(total % 60).padStart(2, '0')} ${hours24 >= 12 ? 'PM' : 'AM'}`;
}

function getNow() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).formatToParts(new Date());
  const get = (type) => parts.find((p) => p.type === type).value;
  return {
    date: `${get('year')}-${get('month')}-${get('day')}`,
    minutes: Number(get('hour')) * 60 + Number(get('minute'))
  };
}

function addDays(dateString, days) {
  const [y, m, d] = dateString.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

function toDateString(y, m, d) {
  return `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function utcDate(dateString) {
  const [y, m, d] = dateString.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

// ─── STATE ───
const now = getNow();
const maxDate = addDays(now.date, MAX_DAYS_AHEAD);
const todayParts = now.date.split('-').map(Number);

const state = {
  courts: [],
  byCourt: new Map(),
  hours: new Map(),
  courtId: null,
  date: now.date,
  year: todayParts[0],
  month: todayParts[1] - 1
};

// ─── COURT HELPERS ───
function escapeHtml(value) {
  const div = document.createElement('div');
  div.textContent = value;
  return div.innerHTML;
}

function courtName(court, index) {
  return court.name || court.court_name || court.label || `Court ${court.court_number ?? index + 1}`;
}

function isMaintenance(court) {
  return MAINTENANCE_STATUSES.includes(String(court.status || '').toLowerCase());
}

function bookingsOn(courtId, date) {
  return (state.byCourt.get(courtId) || []).filter((b) => b.reservation_date === date);
}

function overlaps(bookings, start, end) {
  return bookings.some((b) => {
    const bs = toMinutes(b.start_time);
    const be = toMinutes(b.end_time);
    return bs !== null && be !== null && start < be && end > bs;
  });
}

function courtDot(court) {
  if (isMaintenance(court)) return 'maintenance';
  const active = overlaps(bookingsOn(court.id, now.date), now.minutes, now.minutes + 1);
  return active ? 'occupied' : 'available';
}

function hoursFor(date) {
  const row = state.hours.get(utcDate(date).getUTCDay());
  if (!row) return { closed: false, open: OPEN_HOUR * 60, close: CLOSE_HOUR * 60 };
  if (row.is_closed) return { closed: true, open: 0, close: 0 };
  const open = toMinutes(row.open_time);
  let close = toMinutes(row.close_time);
  if (open === null || close === null) return { closed: false, open: OPEN_HOUR * 60, close: CLOSE_HOUR * 60 };
  if (close <= open) close += 1440;
  return { closed: false, open, close };
}

function buildSlots(court, date) {
  const hours = hoursFor(date);
  if (hours.closed) return [];
  const bookings = bookingsOn(court.id, date);
  const isToday = date === now.date;
  const slots = [];
  for (let start = hours.open; start + 60 <= hours.close; start += 60) {
    const end = start + 60;
    let status = 'open';
    if (isMaintenance(court)) status = 'closed';
    else if (isToday && end <= now.minutes) status = 'past';
    else if (overlaps(bookings, start, end)) status = 'booked';
    else if (isToday && start <= now.minutes) status = 'past';
    slots.push({ start, end, status });
  }
  return slots;
}

function selectedCourt() {
  return state.courts.find((c) => c.id === state.courtId);
}

// ─── RENDER ───
function renderTabs() {
  tabsEl.innerHTML = state.courts.map((court, i) => `
    <button type="button" class="court-tab" data-court="${court.id}" aria-pressed="${court.id === state.courtId}">
      <span class="dot dot-${courtDot(court)}"></span>${escapeHtml(courtName(court, i))}
    </button>`).join('');
}

function renderCalendar() {
  const first = new Date(Date.UTC(state.year, state.month, 1));
  const offset = (first.getUTCDay() + 6) % 7;
  const daysInMonth = new Date(Date.UTC(state.year, state.month + 1, 0)).getUTCDate();
  const label = first.toLocaleDateString('en-PH', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  const atStart = state.year === todayParts[0] && state.month === todayParts[1] - 1;
  const nextFirst = toDateString(state.year, state.month + 1, 1);
  const dows = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'].map((d) => `<span class="cal-dow">${d}</span>`).join('');
  const blanks = '<span></span>'.repeat(offset);
  let days = '';
  for (let d = 1; d <= daysInMonth; d += 1) {
    const date = toDateString(state.year, state.month, d);
    const disabled = date < now.date || date > maxDate;
    const off = hoursFor(date).closed;
    days += `<button type="button" class="cal-day ${date === now.date ? 'is-today' : ''} ${off ? 'is-off' : ''}"
      data-date="${date}" aria-pressed="${date === state.date}" ${disabled ? 'disabled' : ''}>${d}</button>`;
  }
  calendarEl.innerHTML = `
    <div class="cal-head">
      <h3>${label}</h3>
      <div class="cal-nav">
        <button type="button" data-nav="-1" aria-label="Previous month" ${atStart ? 'disabled' : ''}>‹</button>
        <button type="button" data-nav="1" aria-label="Next month" ${nextFirst > maxDate ? 'disabled' : ''}>›</button>
      </div>
    </div>
    <div class="cal-grid">${dows}${blanks}${days}</div>`;
}

function renderSlots() {
  const court = selectedCourt();
  if (!court) {
    slotsEl.innerHTML = '<li class="muted">No courts are listed yet. Please check back soon.</li>';
    return;
  }
  if (hoursFor(state.date).closed) {
    slotsEl.innerHTML = '<li class="muted">Southpoint is closed on this day.</li>';
    return;
  }
  const labels = { open: 'Available', booked: 'Booked', past: 'Passed', closed: 'Closed' };
  slotsEl.innerHTML = buildSlots(court, state.date).map((s) => `
    <li class="slot is-${s.status}">
      <span class="slot-time">${formatMinutes(s.start)} – ${formatMinutes(s.end)}</span>
      <span class="slot-state">${labels[s.status]}</span>
    </li>`).join('');
}

function summaryText(slots, hours) {
  if (hours.closed) return 'Closed on this day';
  const open = slots.filter((s) => s.status === 'open').length;
  const booked = slots.filter((s) => s.status === 'booked').length;
  if (slots.length && slots.every((s) => s.status === 'closed')) return 'Closed for maintenance';
  if (!open && booked) return 'Fully booked';
  if (!open) return 'No hours left today';
  if (open === slots.length) return `All ${open} hours open`;
  const parts = [`${open} ${open === 1 ? 'hour' : 'hours'} open`];
  if (booked) parts.push(`${booked} booked`);
  return parts.join(', ');
}

function renderSchedule() {
  const court = selectedCourt();
  if (!court) {
    schedEl.innerHTML = '';
    return;
  }
  const slots = buildSlots(court, state.date);
  const dateLabel = utcDate(state.date).toLocaleDateString('en-PH', {
    weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC'
  });
  const index = state.courts.indexOf(court);
  schedEl.innerHTML = `
    <h3>Schedule</h3>
    <div class="sched-summary">
      ${escapeHtml(dateLabel)}
      <span>${escapeHtml(courtName(court, index))}: ${summaryText(slots, hoursFor(state.date))}</span>
    </div>
    <a class="btn" href="${LOGIN_URL}">Log in to book</a>`;
}

function renderHours() {
  if (!hoursEl) return;
  if (!state.hours.size) {
    hoursEl.innerHTML = '<li class="muted">Opening hours will be posted soon.</li>';
    return;
  }
  const order = [1, 2, 3, 4, 5, 6, 0];
  const names = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  hoursEl.innerHTML = order.map((day) => {
    const row = state.hours.get(day);
    if (!row) return '';
    const text = row.is_closed
      ? 'Closed'
      : `${formatMinutes(toMinutes(row.open_time))} – ${formatMinutes(toMinutes(row.close_time))}`;
    return `<li><span>${names[day]}</span>${escapeHtml(text)}</li>`;
  }).join('');
}

function renderAll() {
  renderHours();
  renderTabs();
  renderCalendar();
  renderSlots();
  renderSchedule();
}

// ─── EVENTS ───
tabsEl.addEventListener('click', (event) => {
  const tab = event.target.closest('[data-court]');
  if (!tab) return;
  state.courtId = Number(tab.dataset.court) || tab.dataset.court;
  renderAll();
});

calendarEl.addEventListener('click', (event) => {
  const nav = event.target.closest('[data-nav]');
  if (nav) {
    const next = new Date(Date.UTC(state.year, state.month + Number(nav.dataset.nav), 1));
    state.year = next.getUTCFullYear();
    state.month = next.getUTCMonth();
    renderCalendar();
    return;
  }
  const day = event.target.closest('[data-date]');
  if (!day || day.disabled) return;
  state.date = day.dataset.date;
  renderAll();
});

// ─── LOAD ───
function groupBookings(bookings) {
  const byCourt = new Map();
  bookings.forEach((b) => {
    if (!byCourt.has(b.court_id)) byCourt.set(b.court_id, []);
    byCourt.get(b.court_id).push(b);
  });
  return byCourt;
}

function groupHours(rows) {
  const isoWeek = rows.some((r) => r.day_of_week === 7);
  const map = new Map();
  rows.forEach((r) => map.set(isoWeek ? r.day_of_week % 7 : r.day_of_week, r));
  return map;
}

async function loadData() {
  const [courtsResult, bookingsResult, hoursResult] = await Promise.all([
    supabase.from('courts').select('*'),
    supabase.rpc('get_public_court_bookings'),
    supabase.from('business_hours').select('*')
  ]);

  console.log('bookings', bookingsResult.error, bookingsResult.data);
console.log('courts', courtsResult.data);
  if (courtsResult.error) {
    console.error(courtsResult.error);
    slotsEl.innerHTML = '<li class="muted">Courts could not be loaded. Refresh the page or log in to see them.</li>';
    return;
  }
  if (bookingsResult.error) console.error(bookingsResult.error);
  if (hoursResult.error) console.error(hoursResult.error);
  state.hours = groupHours(hoursResult.data || []);
  if (!state.hours.size && !hoursResult.error) {
    console.warn('business_hours returned no rows. Check the guest read policy on business_hours.');
  }
  state.courts = [...courtsResult.data].sort((a, b) =>
    courtName(a, 0).localeCompare(courtName(b, 0), undefined, { numeric: true })
  );
  state.byCourt = groupBookings(bookingsResult.data || []);
  state.courtId = state.courts.length ? state.courts[0].id : null;
  renderAll();
}

// ─── CONTACTS ───
const CONTACT_KEYS = ['contact_phone', 'contact_email', 'contact_facebook'];
let contactTimer = null;

function formatPhone(raw) {
  const digits = raw.replace(/\D/g, '');
  if (/^09\d{9}$/.test(digits)) return `${digits.slice(0, 4)} ${digits.slice(4, 7)} ${digits.slice(7)}`;
  return raw;
}

function phoneHref(raw) {
  const digits = raw.replace(/\D/g, '');
  if (/^09\d{9}$/.test(digits)) return `tel:+63${digits.slice(1)}`;
  return `tel:${raw.replace(/[^\d+]/g, '')}`;
}

function buildContacts(values) {
  const items = [];
  if (values.contact_phone) {
    items.push({ label: 'Phone', text: formatPhone(values.contact_phone), href: phoneHref(values.contact_phone) });
  }
  if (values.contact_email) {
    items.push({ label: 'Email', text: values.contact_email, href: `mailto:${values.contact_email}` });
  }
  if (/^https?:\/\//i.test(values.contact_facebook || '')) {
    items.push({ label: 'Facebook', text: 'Visit our page', href: values.contact_facebook });
  }
  return items;
}

function renderContacts(items) {
  const link = (item) => `<a href="${escapeHtml(item.href)}" target="${item.label === 'Facebook' ? '_blank' : '_self'}" rel="noopener">${escapeHtml(item.text)}</a>`;
  if (contactBlock) contactBlock.hidden = !items.length;
  if (contactList) {
    contactList.innerHTML = items.map((item) => `<li><span>${item.label}</span>${link(item)}</li>`).join('');
  }
  if (footerContact) {
    footerContact.innerHTML = items.map((item) => `<li>${item.label}: ${link(item)}</li>`).join('');
  }
}

async function loadContacts() {
  const { data, error } = await supabase
    .from('business_settings')
    .select('key, value')
    .in('key', CONTACT_KEYS);
  if (error) {
    console.error(error);
    return;
  }
  const values = {};
  (data || []).forEach((row) => { values[row.key] = (row.value || '').trim(); });
  renderContacts(buildContacts(values));
}

function scheduleContactReload() {
  clearTimeout(contactTimer);
  contactTimer = setTimeout(loadContacts, 250);
}

function subscribeContacts() {
  supabase
    .channel('landing-contact-info')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'business_settings' }, (payload) => {
      const row = payload.new && payload.new.key ? payload.new : payload.old;
      if (!row || !row.key || CONTACT_KEYS.includes(row.key)) scheduleContactReload();
    })
    .subscribe();
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) loadContacts();
  });
}

// ─── INIT ───
renderCalendar();
loadData();
loadContacts();
subscribeContacts();