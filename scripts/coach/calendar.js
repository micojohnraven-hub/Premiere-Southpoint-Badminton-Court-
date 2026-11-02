import { supabase } from "../supabase/supabaseClient.js";

    let scheduleChannel = null;
    let playerScheduleChannel = null;
    let courtRateChannel = null;
    let slotToRemove = null;
    let isManualRefreshing = false;
    let pendingClaimDataset = null;
    let currentCoachId = null;
    let coachCourts = [];
    let coachHours = [];
    let coachSelectedCourt = null;
    let coachSelectedSlots = [];
    let coachStartSlot = null;
    let coachBookedSlots = [];
    let isSavingSlot = false;
    let courtRegularRate = 250; 
    let coachSessionRate = 200;

    document.addEventListener('DOMContentLoaded', async () => {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;
        currentCoachId = user.id;

        const schedGrid = document.getElementById('calendarDays');
        const schedMonth = document.getElementById('monthDisplay');
        const dashGrid = document.getElementById('dashGrid');
        const dashMonth = document.getElementById('dashMonth');

        let displayDate = new Date();

        await fetchCourtRegularRate();
        setupRealtimeCourtRate();

        if (schedGrid && schedMonth) {
            await initScheduleCalendar(displayDate, schedGrid, schedMonth);
        }

        if (dashGrid && dashMonth) {
            generateDashboardCalendar(displayDate, dashGrid, dashMonth);
        }

        // Confirm remove modal
        document.getElementById('confirmRemoveBtn')?.addEventListener('click', async () => {
            if (!slotToRemove) return;
            document.getElementById('confirmModal').style.display = 'none';
            await deleteSlot(slotToRemove);
            slotToRemove = null;
        });

        // Main tabs
        const tabBtns = document.querySelectorAll('.tab-btn');
        tabBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                tabBtns.forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                const tab = btn.dataset.tab;
                document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
                document.getElementById(`tab-${tab}`)?.classList.add('active');
                if (tab === 'player-requests') loadPlayerPostedSchedules();
                if (tab === 'assessment-batches') loadBatches();
            });
        });

        // Session type toggle
        const sessTypeBtns = document.querySelectorAll('.sess-type-btn');
        sessTypeBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                const type = btn.dataset.type;
                if (!type) return;
                sessTypeBtns.forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                const typeInput = document.getElementById('slotSessionType');
                const indivEl = document.getElementById('typeIndividual');
                const pkgEl = document.getElementById('typePackage');
                if (typeInput) typeInput.value = type;
                if (indivEl) indivEl.style.display = type === 'individual' ? '' : 'none';
                if (pkgEl) pkgEl.style.display = type === 'package' ? '' : 'none';
                if (type === 'package') renderPkgPicker();
            });
        });

        // Packages modal save
        document.getElementById('savePackageBtn')?.addEventListener('click', savePackages);

        await loadPackages();

        // Claim post modal
        document.getElementById('confirmClaimBtn')?.addEventListener('click', async () => {
            if (!pendingClaimDataset) return;
            const feeInput = document.getElementById('claimFeeInput');
            const sessionFee = feeInput && Number(feeInput.value) > 0
                ? Number(feeInput.value)
                : Math.round((() => {
                    const [sh, sm] = pendingClaimDataset.start.split(':').map(Number);
                    const [eh, em] = pendingClaimDataset.end.split(':').map(Number);
                    return ((eh * 60 + em) - (sh * 60 + sm)) / 60;
                })() * courtRegularRate);
            document.getElementById('claimFeeModal').style.display = 'none';
            await executeClaimPlayerPost(pendingClaimDataset, sessionFee);
            pendingClaimDataset = null;
        });

        document.getElementById('cancelClaimBtn')?.addEventListener('click', () => {
            document.getElementById('claimFeeModal').style.display = 'none';
            pendingClaimDataset = null;
        });

        document.getElementById('bestAvailableOnly')?.addEventListener('change', () => {
        if (document.getElementById('slotDate').value && coachSelectedCourt) {
            renderCoachTimeGrid();
        }
        });

        // ── ASSESSMENT BATCH ──
        const batchDateInput = document.getElementById("batchDate");
        if (batchDateInput) batchDateInput.min = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' });

        document.getElementById("saveBatchBtn")?.addEventListener("click", createBatch);

        // Realtime for batch applications
        supabase
            .channel(`batch-applications-${currentCoachId}`)
            .on("postgres_changes", {
                event: "*", schema: "public", table: "assessment_applications",
            }, () => {
                updateBatchBadge();
                const activeTab = document.querySelector(".tab-btn.active");
                if (activeTab?.dataset?.tab === "assessment-batches") loadBatches();
            })
            .subscribe();

        await updateBatchBadge();

        setInterval(async () => {
            await closeExpiredBatches();
        }, 60000);
    });


    // ─── HELPERS ─────────────────────────────────────────────────────────────────

    function formatTime12h(timeStr) {
        if (!timeStr) return "";
        let [hours, minutes] = timeStr.split(':');
        hours = Number(hours);
        const ampm = hours >= 12 ? 'PM' : 'AM';
        hours = hours % 12 || 12;
        const displayHours = hours < 10 ? "0" + hours : hours;
        return `${displayHours}:${minutes} ${ampm}`;
    }
    
    function formatTimeRange12h(rangeStr) {
        if (!rangeStr) return "";
        const parts = rangeStr.split("-").map(p => p.trim());
        if (parts.length !== 2) return formatTime12h(rangeStr);
        return `${formatTime12h(parts[0])} - ${formatTime12h(parts[1])}`;
    }

    function normalizeTo24Hour(timeStr) {
        if (!timeStr) return null;
        const str = timeStr.trim();
        const meridiemMatch = str.match(/(AM|PM)$/i);
        if (meridiemMatch) {
            const meridiem = meridiemMatch[1].toUpperCase();
            const [h, m] = str.replace(/(AM|PM)/i, '').trim().split(':').map(Number);
            let hour24 = h;
            if (meridiem === 'PM' && h !== 12) hour24 += 12;
            if (meridiem === 'AM' && h === 12) hour24 = 0;
            return `${String(hour24).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
        }
        return str.slice(0, 5);
    }

    function showToast(message, success = true) {
        const old = document.getElementById('globalToast');
        if (old) old.remove();
        const toast = document.createElement('div');
        toast.id = 'globalToast';
        toast.style.cssText = `
            position:fixed;bottom:30px;left:50%;transform:translateX(-50%);
            background:${success ? "#0ecf58" : "#ef4444"};color:#fff;
            padding:12px 24px;border-radius:50px;font-size:16px;font-weight:600;
            display:flex;align-items:center;gap:8px;z-index:9999;
            box-shadow:0 8px 24px rgba(0,0,0,0.15);
        `;
        toast.innerHTML = `<i class='bx ${success ? "bx-check-circle" : "bx-error-circle"}'></i> ${message}`;
        document.body.appendChild(toast);
        setTimeout(() => toast.remove(), 3500);
    }

    // ─── MODAL RESET / CLOSE ────────────────────────────────────────────────────
    function resetSlotModalForm() {
        ['slotDate', 'slotTime', 'slotEndTime', 'slotFee', 'slotCourtId'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.value = "";
        });

        document.querySelectorAll('.court-tab-btn').forEach(b => b.classList.remove('active'));

        coachSelectedCourt = null;
        coachSelectedSlots = [];
        coachStartSlot = null;
        coachBookedSlots = [];

        document.getElementById('slotSessionType').value = "individual";
        document.getElementById('slotSelectedPkg').value = "";

        document.querySelectorAll('.sess-type-btn').forEach(b => b.classList.remove('active'));
        document.querySelector('.sess-type-btn[data-type="individual"]')?.classList.add('active');

        document.getElementById('typeIndividual').style.display = '';
        document.getElementById('typePackage').style.display = 'none';

        ['slotPkg5', 'slotPkg10', 'slotPkg20', 'slotPkgNotes'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.value = "";
        });

        const bestAvailCheckbox = document.getElementById('bestAvailableOnly');
        if (bestAvailCheckbox) bestAvailCheckbox.checked = false;

        const timeSlotsGrid = document.getElementById('coachTimeSlots');
        if (timeSlotsGrid) {
            timeSlotsGrid.innerHTML = `<p style="grid-column:1/-1;color:#9ca3af;font-size:13px;padding:12px 0;">Pick a date and court first.</p>`;
        }

        const hint = document.getElementById('coachSlotHint');
        if (hint) hint.innerText = '';
    }

    function closeSlotModal() {
        document.getElementById('schedModal').style.display = 'none';
        resetSlotModalForm();
    }

    function resetBatchModalForm() {
        ['batchDate', 'batchStartTime', 'batchEndTime'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.value = "";
        });

        const maxSlotsInput = document.getElementById('batchMaxSlots');
        if (maxSlotsInput) maxSlotsInput.value = "20";
    }

    function closeBatchModal() {
        document.getElementById('batchModal').style.display = 'none';
        resetBatchModalForm();
    }

    window.closeSlotModal = closeSlotModal;
    window.closeBatchModal = closeBatchModal;

    // ─── COURT REGULAR RATE (business_settings) ────────────────────────────────────
    async function fetchCourtRegularRate() {
        const { data, error } = await supabase
            .from('business_settings')
            .select('value')
            .eq('key', 'court_rate')
            .single();

        const parsed = Number(data?.value);

        if (!isNaN(parsed) && parsed > 0) {
            courtRegularRate = parsed;
        }

    }

function setupRealtimeCourtRate() {
    if (courtRateChannel) supabase.removeChannel(courtRateChannel);

    courtRateChannel = supabase
        .channel('coach-court-rate-realtime')
        .on(
            'postgres_changes',
            {
                event: '*',
                schema: 'public',
                table: 'business_settings',
                filter: 'key=eq.court_rate'
            },
            (payload) => {
                const parsed = Number(payload.new?.value);

                if (!isNaN(parsed) && parsed > 0) {
                    courtRegularRate = parsed;
                }
            }
        )
        .subscribe();
}

    function generateDashboardCalendar(dateObj, grid, monthLabel) {
        const currentMonth = dateObj.getMonth();
        const currentYear = dateObj.getFullYear();
        const now = new Date();
        const monthNames = ["January","February","March","April","May","June","July","August","September","October","November","December"];
        monthLabel.innerText = `${monthNames[currentMonth]} ${currentYear}`;
        const firstDay = new Date(currentYear, currentMonth, 1).getDay();
        const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();
        grid.innerHTML = "";
        for (let i = 0; i < firstDay; i++) grid.appendChild(document.createElement('div'));
        for (let i = 1; i <= daysInMonth; i++) {
            const dayDiv = document.createElement('div');
            dayDiv.innerText = i;
            if (now.getDate() === i && now.getMonth() === currentMonth && now.getFullYear() === currentYear) {
                dayDiv.classList.add('today');
            }
            grid.appendChild(dayDiv);
        }
    }

    function showConfirmDialog(message, onConfirm, confirmLabel = 'Remove') {
        const old = document.getElementById('_customConfirm');
        if (old) old.remove();

        const overlay = document.createElement('div');
        overlay.id = '_customConfirm';
        overlay.className = 'confirm-overlay';
        overlay.innerHTML = `
            <div class="confirm-box">
                <div class="confirm-body">${message}</div>
                <div class="confirm-actions">
                    <button id="_confirmNo" class="confirm-btn confirm-btn-cancel">Cancel</button>
                    <button id="_confirmYes" class="confirm-btn confirm-btn-danger">${confirmLabel}</button>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);

        overlay.querySelector('#_confirmYes').addEventListener('click', () => {
            overlay.remove();
            onConfirm();
        });
        overlay.querySelector('#_confirmNo').addEventListener('click', () => overlay.remove());
        overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
    }

    // ─── SCHEDULE CALENDAR ────────────────────────────────────────────────────────

    async function initScheduleCalendar(displayDate, calGrid, calMonth) {
        const prevBtn = document.getElementById('prevMonth');
        const nextBtn = document.getElementById('nextMonth');
        const saveSlotBtn = document.getElementById('saveSlotBtn');
        const dateInput = document.getElementById('slotDate');
        const minDate = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' });
        if (dateInput) dateInput.setAttribute("min", minDate);

        await loadCourtsForModal();
        await loadCoachSlots();
        await generateScheduleCalendar(displayDate, calGrid, calMonth);
        await setupRealtimeSchedule();
        await setupRealtimePlayerSchedules();

        dateInput?.addEventListener('change', () => updateCoachTimeSlots());

        prevBtn?.addEventListener('click', async () => {
            displayDate.setMonth(displayDate.getMonth() - 1);
            await generateScheduleCalendar(displayDate, calGrid, calMonth);
        });
        nextBtn?.addEventListener('click', async () => {
            displayDate.setMonth(displayDate.getMonth() + 1);
            await generateScheduleCalendar(displayDate, calGrid, calMonth);
        });
        saveSlotBtn?.addEventListener('click', async () => {
            await handleNewSlot(dateInput, displayDate, calGrid, calMonth);
        });
    }

    async function generateScheduleCalendar(dateObj, grid, monthLabel) {
        const currentMonth = dateObj.getMonth();
        const currentYear = dateObj.getFullYear();
        const now = new Date();
        const monthNames = ["January","February","March","April","May","June","July","August","September","October","November","December"];
        monthLabel.innerText = `${monthNames[currentMonth]} ${currentYear}`;
        const firstDay = new Date(currentYear, currentMonth, 1).getDay();
        const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();
        grid.innerHTML = "";
        const occupiedDates = await getOccupiedDates();
        for (let i = 1; i <= daysInMonth; i++) {
            const dayDiv = document.createElement('div');
            dayDiv.innerText = i;
            const fullDate = `${currentYear}-${String(currentMonth+1).padStart(2,'0')}-${String(i).padStart(2,'0')}`;
            if (now.toDateString() === new Date(currentYear, currentMonth, i).toDateString()) {
                dayDiv.classList.add('today-dot');
            }
            if (occupiedDates.includes(fullDate)) dayDiv.classList.add('occupied');
            grid.appendChild(dayDiv);
        }
    }

    async function getOccupiedDates() {
        const occupied = new Set();

        document.querySelectorAll('.court-card').forEach(card => {
            const dateAttr = card.getAttribute('data-date');
            if (dateAttr) occupied.add(dateAttr);
        });

        const { data: authData } = await supabase.auth.getUser();
        const user = authData?.user;
        if (user) {
            const { data: requests, error } = await supabase
                .from('coaching_requests')
                .select('session_date')
                .eq('coach_id', user.id)
                .not('session_date', 'is', null)
                .in('status', ['pending', 'pending_verification', 'accepted', 'coach_claimed']);

            if (error) {
                console.error('Failed to load coaching requests for calendar:', error);
            } else {
                (requests || []).forEach(r => {
                    if (r.session_date) occupied.add(r.session_date);
                });
            }
        }

        return [...occupied];
    }

    async function removeExpiredSlots(userId) {
        const now = new Date();
        const phNow = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Manila' }));
        const todayDate = phNow.toLocaleDateString('en-CA');
        const currentTime = `${String(phNow.getHours()).padStart(2,'0')}:${String(phNow.getMinutes()).padStart(2,'0')}:${String(phNow.getSeconds()).padStart(2,'0')}`;
        await supabase.from('coach_availability').delete().eq('coach_id', userId).eq('status', 'available').lt('slot_date', todayDate);
        await supabase.from('coach_availability').delete().eq('coach_id', userId).eq('status', 'available').eq('slot_date', todayDate).lte('start_time', currentTime);
    }

    // ─── LOAD COACH SLOTS ─────────────────────────────────────────────────────────
    async function loadCoachSlots() {
        const grid = document.getElementById('courtGrid');
        if (!grid) return;
        const { data: authData } = await supabase.auth.getUser();
        const user = authData?.user;
        if (!user) { grid.innerHTML = ''; return; }
        await removeExpiredSlots(user.id);

        const { data: slotData, error: slotError } = await supabase
            .from('coach_availability').select('*').eq('coach_id', user.id).in('status', ['available', 'booked'])
            .order('slot_date', { ascending: true }).order('start_time', { ascending: true });
        if (slotError) { console.error(slotError); return; }

        const { data: packageData } = await supabase.from('coach_packages').select('*').eq('coach_id', user.id).order('sessions', { ascending: true });

        // Itago ang booked slots na lumipas na
        const phNow = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Manila' }));
        const todayStr = phNow.toLocaleDateString('en-CA');
        const nowHHMM = `${String(phNow.getHours()).padStart(2, '0')}:${String(phNow.getMinutes()).padStart(2, '0')}`;

        const slots = (slotData || []).filter(s => {
            if (s.status !== 'booked') return true;
            if (s.slot_date < todayStr) return false;
            if (s.slot_date === todayStr && s.end_time.slice(0, 5) <= nowHHMM) return false;
            return true;
        });
        const packages = packageData || [];

        // Kunin ang booking details ng mga booked slots
        const bookedIds = slots.filter(s => s.status === 'booked').map(s => s.id);
        const bookingMap = {};
        if (bookedIds.length) {
            const { data: reqs, error: reqErr } = await supabase
                .from('coaching_requests')
                .select('availability_id, player_name, status')
                .in('availability_id', bookedIds)
                .in('status', ['pending', 'pending_verification', 'accepted']);
            if (reqErr) console.error(reqErr);
            (reqs || []).forEach(r => { bookingMap[r.availability_id] = r; });
        }

        const bookingStatusLabel = {
            pending_verification: 'Awaiting payment verification',
            pending: 'Awaiting your response',
            accepted: 'Accepted'
        };

        if (!slots.length && !packages.length) {
            grid.innerHTML = `
                <div class="empty-state">
                    <p>No training slots or packages yet</p>
                    <span>Create one above to get started</span>
                </div>`;
            return;
        }

        const slotCards = slots.map(slot => {
            const selectedDate = new Date(slot.slot_date + 'T00:00:00');
            const formattedDate = selectedDate.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
            const isBooked = slot.status === 'booked';
            const booking = bookingMap[slot.id];

            const bookedInfo = isBooked ? `
                <span class="badge" style="background:#fef3c7;color:#b45309;">Booked</span>
                ${booking ? `
                    <p style="font-size:12px;color:#4b5563;margin-top:6px;">
                        <strong>${booking.player_name || 'Player'}</strong><br>
                        ${bookingStatusLabel[booking.status] || booking.status}
                    </p>` : ''}
            ` : `<span class="badge badge-vacant">Available</span>`;

            return `
                <div class="court-card" data-date="${slot.slot_date}" data-id="${slot.id}">
                    <div class="c-header">
                        <strong>${formattedDate}</strong>
                        <span class="type-badge type-solo"><i class='bx bx-user'></i> Individual</span>
                    </div>
                    <div class="c-body">
                        <i class='bx bx-calendar-check' style="font-size:44px;color:${isBooked ? '#d97706' : '#16a34a'};"></i>
                        <h4>${formatTime12h(slot.start_time)} – ${formatTime12h(slot.end_time)}</h4>
                        <p>Session Fee: <strong>₱${Number(slot.session_fee || 0).toLocaleString()}</strong></p>
                        ${bookedInfo}
                    </div>
                    <button class="btn btn-danger remove-slot-btn" data-id="${slot.id}">${isBooked ? 'Cancel Booking' : 'Remove Slot'}</button>
                </div>`;
        });

        const packageCards = packages.map(pkg => `
            <div class="court-card package-card" data-package-id="${pkg.id}">
                <div class="c-header">
                    <strong>Package Offer</strong>
                    <span class="type-badge type-pkg"><i class='bx bx-gift'></i> ${pkg.sessions} Sessions</span>
                </div>
                <div class="c-body">
                    <i class='bx bx-gift' style="font-size:44px;color:#16a34a;"></i>
                    <h4>${pkg.sessions}-Session Package</h4>
                    <p>Package Price: <strong>₱${Number(pkg.price || 0).toLocaleString()}</strong></p>
                    ${pkg.notes ? `<p class="slot-inclusions"><i class='bx bx-list-check'></i> ${pkg.notes}</p>` : ''}
                    <span class="badge badge-vacant">Available</span>
                </div>
                <button class="btn btn-danger remove-package-btn" data-id="${pkg.id}">Remove Package</button>
            </div>`);

        grid.innerHTML = [...slotCards, ...packageCards].join('');

        document.querySelectorAll('.remove-slot-btn').forEach(btn => {
            btn.addEventListener('click', () => requestRemoveSlot(btn.dataset.id));
        });
        document.querySelectorAll('.remove-package-btn').forEach(btn => {
            btn.addEventListener('click', async () => {
                showConfirmDialog("Remove this package?", async () => {
                    await deletePackage(btn.dataset.id);
                });
            });
        });
    }

    // ─── COURT PICKER (MODAL) ──────────────────────────────────────────────────
    async function loadCourtsForModal() {
        const { data, error } = await supabase.from('courts').select('*').order('id');
        if (error) { console.error(error); return; }
        coachCourts = data || [];
        renderCourtTabs();
    }

    function renderCourtTabs() {
        const wrap = document.getElementById('courtTabs');
        if (!wrap) return;
        wrap.innerHTML = coachCourts.map(court => {
            const disabled = !court.is_active;
            return `
                <button type="button" class="court-tab-btn ${disabled ? 'disabled-court' : ''}"
                    data-id="${court.id}" ${disabled ? 'disabled' : ''}>
                    ${court.name}
                </button>`;
        }).join('');
        wrap.querySelectorAll('.court-tab-btn:not([disabled])').forEach(btn => {
            btn.addEventListener('click', () => {
                wrap.querySelectorAll('.court-tab-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                coachSelectedCourt = coachCourts.find(c => c.id === Number(btn.dataset.id));
                document.getElementById('slotCourtId').value = coachSelectedCourt.id;
                updateCoachTimeSlots();
            });
        });
    }

    async function loadCoachBusinessHours(date) {
        const dayOfWeek = new Date(date + 'T00:00:00').getDay();
        const { data, error } = await supabase
            .from('business_hours')
            .select('open_time, close_time, is_closed')
            .eq('day_of_week', dayOfWeek)
            .single();
        if (error || !data || data.is_closed) { coachHours = []; return; }
        const [startH, startM] = data.open_time.split(':').map(Number);
        const [endH, endM] = data.close_time.split(':').map(Number);
        const startTotal = startH * 60 + startM;
        const endTotal = endH * 60 + endM;
        coachHours = [];
        for (let t = startTotal; t <= endTotal; t += 60) {
            const h = Math.floor(t / 60);
            const m = t % 60;
            coachHours.push(`${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`);
        }
    }

    async function getCoachBookedSlots(courtId, date) {
        const { data: reservationData, error: reservationError } = await supabase
            .from('reservations')
            .select('start_time, end_time')
            .eq('court_id', courtId)
            .eq('reservation_date', date)
            .in('status', ['confirmed', 'pending', 'pending_verification']);
        if (reservationError) { console.error(reservationError); return []; }

        const { data: ownSlotData, error: ownSlotError } = await supabase
            .from('coach_availability')
            .select('start_time, end_time')
            .eq('coach_id', currentCoachId)
            .eq('court_id', courtId)
            .eq('slot_date', date)
            .eq('status', 'available');
        if (ownSlotError) console.error(ownSlotError);

        const booked = new Set();

        const markRange = (start_time, end_time) => {
            const startTime24 = normalizeTo24Hour(start_time);
            const endTime24 = normalizeTo24Hour(end_time);

            const startIdx = coachHours.indexOf(startTime24);
            const endIdx = coachHours.indexOf(endTime24);

            for (let i = startIdx; i < endIdx; i++) {
                if (i >= 0) {
                    booked.add(coachHours[i]);
                }
            }
        };

        (reservationData || []).forEach(({ start_time, end_time }) => markRange(start_time, end_time));
        (ownSlotData || []).forEach(({ start_time, end_time }) => markRange(start_time, end_time));

        return [...booked];
    }

    async function updateCoachTimeSlots() {
        const grid = document.getElementById('coachTimeSlots');
        const dateValue = document.getElementById('slotDate').value;
        if (!grid) return;
        if (!dateValue || !coachSelectedCourt) {
            grid.innerHTML = `<p style="grid-column:1/-1;color:#9ca3af;font-size:13px;padding:12px 0;">Please select a date and a court first.</p>`;
            return;
        }
        grid.innerHTML = `<p style="grid-column:1/-1;color:#9ca3af;font-size:13px;padding:12px 0;">Loading available time slots...</p>`;
        await loadCoachBusinessHours(dateValue);
        coachBookedSlots = await getCoachBookedSlots(coachSelectedCourt.id, dateValue);
        coachSelectedSlots = [];
        coachStartSlot = null;
        document.getElementById('slotTime').value = '';
        document.getElementById('slotEndTime').value = '';
        renderCoachTimeGrid();
    }

function renderCoachTimeGrid() {
    const grid = document.getElementById('coachTimeSlots');
    const bestOnly = document.getElementById('bestAvailableOnly')?.checked;
    const dateValue = document.getElementById('slotDate')?.value;

    if (!grid) return;

    const now = new Date();
    const phNow = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Manila' }));
    const phDate = phNow.toLocaleDateString('en-CA');
    const phTime = `${String(phNow.getHours()).padStart(2, '0')}:${String(phNow.getMinutes()).padStart(2, '0')}:${String(phNow.getSeconds()).padStart(2, '0')}`;

    const rows = coachHours
        .map((startTime, index) => {
            const endTime = coachHours[index + 1];
            if (!endTime) return null;

            const isBooked = coachBookedSlots.includes(startTime);
            
            const isPast = (dateValue === phDate) && (endTime + ':00' <= phTime);

            return {
                startTime,
                endTime,
                index,
                isBooked,
                isPast
            };
        })
        .filter(Boolean)
        .filter(row => !bestOnly || (!row.isBooked && !row.isPast));

    if (!rows.length) {
        grid.innerHTML = `
            <p style="grid-column:1/-1;color:#9ca3af;font-size:13px;padding:12px 0;">
                No available slots for this date/court.
            </p>`;
        return;
    }

grid.innerHTML = rows.map(({ startTime, endTime, index, isBooked, isPast }) => {
        // Unahin i-check kung Past na; kung past na, gray siya. Kung hindi, tsaka i-check kung Occupied (red).
        let slotClass = '';
        let statusText = 'Available';

        if (isPast) {
            slotClass = 'past';
            statusText = 'Past';
        } else if (isBooked) {
            slotClass = 'occupied';
            statusText = 'Occupied';
        }

        return `
            <div 
                class="coach-slot ${slotClass}" 
                data-index="${index}"
                data-start="${startTime}"
                data-end="${endTime}"
            >
                <span class="time-text">
                    ${formatTime12h(startTime)} – ${formatTime12h(endTime)}
                </span>

                <span class="status-tag">
                    ${statusText}
                </span>
            </div>
        `;
    }).join('');

    grid.querySelectorAll('.coach-slot:not(.occupied):not(.past)').forEach(el => {
        el.addEventListener('click', () => {
            handleCoachSlotClick(Number(el.dataset.index));
        });
    });

    updateCoachSlotHint();

    if (coachSelectedSlots.length > 0) {
        const selectedStart = coachHours.indexOf(coachSelectedSlots[0]);
        const selectedEnd = coachHours.indexOf(
            coachSelectedSlots[coachSelectedSlots.length - 1]
        );
        highlightCoachRange(selectedStart, selectedEnd - 1);
    }
}

function handleCoachSlotClick(index) {
    const startTime = coachHours[index];
    const endTime = coachHours[index + 1];

    if (!startTime || !endTime) return;

    if (coachStartSlot === null) {
        coachStartSlot = index;

        coachSelectedSlots = [
            startTime,
            endTime
        ];

        document.getElementById('slotTime').value = startTime;
        document.getElementById('slotEndTime').value = endTime;

        const feeInput = document.getElementById('slotFee');

        feeInput.value = 200;

        highlightCoachRange(index, index);
        updateCoachSlotHint();
        return;
    }

    const startIndex = Math.min(coachStartSlot, index);
    const endIndex = Math.max(coachStartSlot, index);

    for (let i = startIndex; i <= endIndex; i++) {
        if (coachBookedSlots.includes(coachHours[i])) {
            showToast("Selected time range is unavailable.", false);

            coachStartSlot = null;
            coachSelectedSlots = [];

            document.getElementById('slotTime').value = '';
            document.getElementById('slotEndTime').value = '';

            const feeInput = document.getElementById('slotFee');

            if (feeInput) {
                feeInput.value = '';
            }

            highlightCoachRange(-1, -1);
            updateCoachSlotHint();
            return;
        }
    }

    const finalStart = coachHours[startIndex];
    const finalEnd = coachHours[endIndex + 1];

    if (!finalStart || !finalEnd) {
        showToast("Invalid time range.", false);
        return;
    }

    coachSelectedSlots = coachHours.slice(
        startIndex,
        endIndex + 2
    );

    document.getElementById('slotTime').value = finalStart;
    document.getElementById('slotEndTime').value = finalEnd;

    const [sh, sm] = finalStart.split(':').map(Number);
    const [eh, em] = finalEnd.split(':').map(Number);

    const durationHours =
        ((eh * 60 + em) - (sh * 60 + sm)) / 60;

    const feeInput = document.getElementById('slotFee');

    if (feeInput) {
       feeInput.value = Math.round(durationHours * coachSessionRate);
    }

    highlightCoachRange(startIndex, endIndex);

    coachStartSlot = null;

    updateCoachSlotHint();
}

    function highlightCoachRange(from, to) {
        const slots = document.querySelectorAll('#coachTimeSlots .coach-slot');
        slots.forEach(slot => {
            slot.classList.remove('selected');
            const index = Number(slot.dataset.index);
            if (
                !slot.classList.contains('occupied') &&
                index >= from &&
                index <= to
            ) {
                slot.classList.add('selected');
            }
        });
    }

function updateCoachSlotHint() {
    const hint = document.getElementById('coachSlotHint');
    if (!hint) return;

    if (coachSelectedSlots.length >= 2) {
        const start = coachSelectedSlots[0];
        const end = coachSelectedSlots[coachSelectedSlots.length - 1];

        const [sh, sm] = start.split(':').map(Number);
        const [eh, em] = end.split(':').map(Number);

        const duration =
            ((eh * 60 + em) - (sh * 60 + sm)) / 60;

        hint.innerText =
            `Selected time: ${formatTime12h(start)} – ${formatTime12h(end)} (${duration} hour${duration !== 1 ? 's' : ''})`;
    } else {
        hint.innerText =
            'Click a time slot to select 1 hour, or select another slot to extend the duration.';
    }
}

async function deleteSlot(slotId) {
    const { error } = await supabase.from('coach_availability').delete().eq('id', slotId);
    if (error) { console.error(error); showToast("Failed to remove slot.", false); return false; }
    isManualRefreshing = true;
    await loadCoachSlots();
    isManualRefreshing = false;
    return true;
}

    async function deletePackage(packageId) {
        const { error } = await supabase.from('coach_packages').delete().eq('id', packageId);
        if (error) { console.error(error); showToast("Failed to remove package."); return; }
        isManualRefreshing = true;
        await loadCoachSlots();
        isManualRefreshing = false;
    }

    // ─── REMOVE SLOT (WITH BOOKING CHECK) ────────────────────────────────────────
    async function requestRemoveSlot(slotId) {
        const { data: slot, error } = await supabase
            .from('coach_availability')
            .select('id, slot_date, start_time, end_time, status')
            .eq('id', slotId)
            .single();

        if (error || !slot) {
            console.error(error);
            showToast("Slot not found.", false);
            return;
        }

        const { data: bookings, error: bookingErr } = await supabase
            .from('coaching_requests')
            .select('id, player_id, player_name, status, payment_method, amount')
            .eq('coach_id', currentCoachId)
            .eq('availability_id', slotId)
            .in('status', ['pending', 'pending_verification', 'accepted']);

        if (bookingErr) {
            console.error(bookingErr);
            showToast("Failed to check bookings.", false);
            return;
        }

        if (!bookings?.length) {
            showConfirmDialog("Remove this slot?", async () => {
                await deleteSlot(slotId);
            });
            return;
        }

        const statusLabel = {
            pending: 'Payment verified',
            pending_verification: 'Pending verification',
            accepted: 'Accepted'
        };

        const playerList = bookings.map(b => `
            <div class="booking-player-row">
                <strong>${b.player_name || 'Player'}</strong>
                <span class="booking-player-meta"> • ${statusLabel[b.status] || b.status}${b.payment_method ? ' • ' + b.payment_method : ''}</span>
            </div>
        `).join('');

        const msg = `
            <p class="booking-warning-title">⚠️ This slot has a booking</p>
            <p class="booking-warning-time">
                ${formatTime12h(slot.start_time)} – ${formatTime12h(slot.end_time)} • ${slot.slot_date}
            </p>
            ${playerList}
            <p class="booking-warning-note">
                If you continue, the booking will be declined, the court reservation will be cancelled, and the player will be notified.
                <br><strong>If the player has already paid, a refund must be handled separately.</strong>
            </p>
        `;

        showConfirmDialog(msg, async () => {
            await cancelBookingsAndRemoveSlot(slot, bookings);
        }, 'Cancel Booking & Remove');
    }

    async function cancelBookingsAndRemoveSlot(slot, bookings) {
        const { data, error } = await supabase.rpc('coach_cancel_bookings', {
            p_request_ids: bookings.map(b => String(b.id))
        });

        if (error || !data?.success) {
            console.error("Cancel booking failed:", error || data);
            showToast("Failed to cancel booking. Slot was not removed.", false);
            return;
        }

        const removed = await deleteSlot(slot.id);
        if (removed) showToast("Slot removed. Player(s) notified.");
    }

    // ─── CREATE NEW SLOT ──────────────────────────────────────────────────────────

    async function handleNewSlot(dateInput, displayDate, calGrid, calMonth) {
        if (isSavingSlot) return;

        isSavingSlot = true;

        const saveBtn = document.getElementById('saveSlotBtn');

        if (saveBtn) {
            saveBtn.disabled = true;
            saveBtn.dataset.originalText = saveBtn.innerHTML;
            saveBtn.innerHTML = `<i class='bx bx-loader-alt bx-spin'></i> Saving...`;
        }

        try {
            const sessionType = document.getElementById('slotSessionType').value;
            const { data: authData } = await supabase.auth.getUser();
            const user = authData?.user;

            if (!user) {
                showToast("User not found.", false);
                return;
            }

            if (sessionType === 'package') {
                const pkg5 = Number(document.getElementById('slotPkg5')?.value || 0);
                const pkg10 = Number(document.getElementById('slotPkg10')?.value || 0);
                const pkg20 = Number(document.getElementById('slotPkg20')?.value || 0);
                const pkgNotes = document.getElementById('slotPkgNotes')?.value?.trim() || null;

                if (!pkg5 && !pkg10 && !pkg20) {
                    showToast("Please enter at least one package price.", false);
                    return;
                }

                const packageRows = [];

                if (pkg5 > 0) {
                    packageRows.push({
                        coach_id: user.id,
                        sessions: 5,
                        price: pkg5,
                        notes: pkgNotes
                    });
                }

                if (pkg10 > 0) {
                    packageRows.push({
                        coach_id: user.id,
                        sessions: 10,
                        price: pkg10,
                        notes: pkgNotes
                    });
                }

                if (pkg20 > 0) {
                    packageRows.push({
                        coach_id: user.id,
                        sessions: 20,
                        price: pkg20,
                        notes: pkgNotes
                    });
                }

                const { error } = await supabase
                    .from('coach_packages')
                    .upsert(packageRows, {
                        onConflict: 'coach_id,sessions',
                        ignoreDuplicates: false
                    });

                if (error) {
                    showToast("Failed to save package.", false);
                    return;
                }

                document.getElementById('schedModal').style.display = 'none';
                resetSlotModalForm();

                await loadCoachSlots();

                showToast("Package saved successfully!");
                return;
            }

            const dateValue = document.getElementById('slotDate').value;
            const startTime = document.getElementById('slotTime').value;
            const endTime = document.getElementById('slotEndTime').value;
            const courtId = document.getElementById('slotCourtId')?.value;

            if (!dateValue) {
                showToast("Please select a training date.", false);
                return;
            }

            if (!courtId) {
                showToast("Please select a court first.", false);
                return;
            }

            if (!startTime || !endTime) {
                showToast("Please select a start and end time.", false);
                return;
            }

            if (startTime >= endTime) {
                showToast("End time must be after start time.", false);
                return;
            }

        /* const now = new Date();
            const phNow = new Date(
                now.toLocaleString('en-US', { timeZone: 'Asia/Manila' })
            );

            const phDate = phNow.toLocaleDateString('en-CA');

            const phTime =
                `${String(phNow.getHours()).padStart(2, '0')}:` +
                `${String(phNow.getMinutes()).padStart(2, '0')}:` +
                `${String(phNow.getSeconds()).padStart(2, '0')}`;

            if (dateValue === phDate && endTime + ':00' <= phTime) {
                showToast("End time has already passed.", false);
                return;
            } */

            const now = new Date();
            const phNow = new Date(
                now.toLocaleString('en-US', { timeZone: 'Asia/Manila' })
            );

            const { data: existingSlots, error: checkError } = await supabase
                .from('coach_availability')
                .select('id, start_time, end_time, court_id')
                .eq('coach_id', user.id)
                .eq('status', 'available')
                .eq('slot_date', dateValue)
                .eq('court_id', Number(courtId));

            if (checkError) {
                console.error(checkError);
                showToast("Failed to validate slots.", false);
                return;
            }

            const conflict = (existingSlots || []).some(slot =>
                startTime < slot.end_time.slice(0, 5) &&
                endTime > slot.start_time.slice(0, 5)
            );

            if (conflict) {
                showToast("This time slot already exists.", false);
                return;
            }

            const [sh, sm] = startTime.split(':').map(Number);
            const [eh, em] = endTime.split(':').map(Number);

            const durationHours =
                ((eh * 60 + em) - (sh * 60 + sm)) / 60;

            const customFee = document.getElementById('slotFee')?.value;

            const sessionFee =
                customFee && Number(customFee) > 0
                    ? Number(customFee)
                    : Math.round(durationHours * coachSessionRate);

            const { data: newSlot, error } = await supabase
                .from('coach_availability')
                .insert([{
                    coach_id: user.id,
                    slot_date: dateValue,
                    start_time: startTime,
                    end_time: endTime,
                    court_id: Number(courtId),
                    status: 'available',
                    session_fee: sessionFee,
                    session_type: 'individual',
                    pkg_sessions: null,
                    pkg_notes: null
                }])
                .select()
                .single();

            if (error) {
                console.error(error);
                showToast("Failed to save slot.", false);
                return;
            }

            await loadCoachSlots();
            await generateScheduleCalendar(
                displayDate,
                calGrid,
                calMonth
            );

            document.getElementById('schedModal').style.display = 'none';
            resetSlotModalForm();

            showToast("Slot saved successfully!");

        } finally {
            isSavingSlot = false;

            if (saveBtn) {
                saveBtn.disabled = false;
                saveBtn.innerHTML =
                    saveBtn.dataset.originalText || 'Save Slot';
            }
        }
    }

    // ─── PACKAGES ─────────────────────────────────────────────────────────────────

    function getLocalPackages() {
        try { return JSON.parse(localStorage.getItem('coach_packages') || '{}'); } catch { return {}; }
    }

    function saveLocalPackages(data) {
        localStorage.setItem('coach_packages', JSON.stringify(data));
    }

    async function loadPackages() {
        const pkgData = getLocalPackages();
        ['5', '10', '20'].forEach(n => {
            const input = document.getElementById(`pkg_${n}`);
            if (input && pkgData[`pkg_${n}`]) input.value = pkgData[`pkg_${n}`];
        });
        const inclusionsInput = document.getElementById('pkgInclusions');
        if (inclusionsInput && pkgData.inclusions) inclusionsInput.value = pkgData.inclusions;
    }

    async function savePackages() {
        const pkgData = {};
        ['5', '10', '20'].forEach(n => {
            const val = document.getElementById(`pkg_${n}`)?.value;
            if (val && Number(val) > 0) pkgData[`pkg_${n}`] = Number(val);
        });
        const inclusions = document.getElementById('pkgInclusions')?.value?.trim();
        if (inclusions) pkgData.inclusions = inclusions;
        saveLocalPackages(pkgData);
        document.getElementById('packageModal').style.display = 'none';
        showToast("Packages saved!");
    }

    function renderPkgPicker() {
        const pkgData = getLocalPackages();
        const group = document.getElementById('pkgPickGroupSession');
        if (!group) return;
        const options = [
            { key: 'pkg_5', sessions: 5, icon: 'bx-star', label: '5 Sessions' },
            { key: 'pkg_10', sessions: 10, icon: 'bx-medal', label: '10 Sessions' },
            { key: 'pkg_20', sessions: 20, icon: 'bx-trophy', label: '20 Sessions' },
        ];
        group.innerHTML = options.map(opt => {
            const price = pkgData[opt.key];
            const disabled = !price;
            return `
                <button type="button" class="pkg-pick-btn ${disabled ? 'pkg-pick-disabled' : ''}" data-sessions="${opt.sessions}" ${disabled ? 'disabled' : ''}>
                    <i class='bx ${opt.icon}'></i>
                    <span class="pkg-pick-label">${opt.label}</span>
                    <span class="pkg-pick-price">${price ? `₱${Number(price).toLocaleString()}` : 'Not set'}</span>
                </button>`;
        }).join('');
        if (!options.some(o => pkgData[o.key])) group.innerHTML += `<p class="field-hint" style="margin-top:8px;">No packages set yet.</p>`;
        group.querySelectorAll('.pkg-pick-btn:not([disabled])').forEach(btn => {
            btn.addEventListener('click', () => {
                group.querySelectorAll('.pkg-pick-btn').forEach(b => b.classList.remove('selected'));
                btn.classList.add('selected');
                document.getElementById('slotSelectedPkg').value = btn.dataset.sessions;
            });
        });
    }

    // ─── PLAYER POSTED SCHEDULES ──────────────────────────────────────────────────

    async function loadPlayerPostedSchedules() {
        const container = document.getElementById('playerScheduleList');
        if (!container) return;
        container.innerHTML = `<p style="color:#888;padding:16px;">Loading player requests...</p>`;
        const now = new Date();
        const phToday = new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().split('T')[0];
        const { data, error } = await supabase
            .from('player_schedule_posts')
            .select(`*, profiles!player_schedule_posts_player_id_fkey(full_name)`)
            .eq('status', 'open').gte('preferred_date', phToday).order('preferred_date', { ascending: true });
        if (error || !data?.length) {
            container.innerHTML = `
                <div class="empty-state">
                    <i class='bx bx-inbox'></i>
                    <p>No player posts yet</p>
                    <span>Player requests will show up here</span>
                </div>`;
        return; 
        }
        container.innerHTML = data.map(post => {
            const postDate = new Date(post.preferred_date + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
            return `
                <div class="player-post-card modern-post-card" data-id="${post.id}">
                    <div class="pp-header-modern">
                        <div class="pp-player-line"><strong>${post.profiles?.full_name || 'Unknown'}</strong></div>
                        <div class="pp-date-modern">${postDate}</div>
                    </div>
                    <div class="pp-time-modern"><i class='bx bx-time-five'></i><span>${formatTime12h(post.preferred_start)} – ${formatTime12h(post.preferred_end)}</span></div>
                    ${post.notes ? `<p class="pp-notes-modern">"${post.notes}"</p>` : ''}
                    <button class="btn btn-primary claim-btn full-claim-btn"
                        data-id="${post.id}" data-player="${post.player_id}"
                        data-name="${post.profiles?.full_name || ''}"
                        data-date="${post.preferred_date}"
                        data-start="${post.preferred_start}"
                        data-end="${post.preferred_end}">Claim This Slot</button>
                </div>`;
        }).join('');
        document.querySelectorAll('.claim-btn').forEach(btn => {
            btn.addEventListener('click', async () => { await claimPlayerPost(btn.dataset); });
        });
    }

   async function claimPlayerPost(dataset) {
    const [sh, sm] = dataset.start.split(':').map(Number);
    const [eh, em] = dataset.end.split(':').map(Number);

    const durationMinutes = (eh * 60 + em) - (sh * 60 + sm);
    const durationHours = durationMinutes / 60;

    const hours = Math.floor(durationMinutes / 60);
    const minutes = durationMinutes % 60;

    pendingClaimDataset = dataset;

    const detailsEl = document.getElementById('claimFeeDetails');

    if (detailsEl) {
        let durationText = '';

        if (hours > 0) {
            durationText += `${hours} hour${hours !== 1 ? 's' : ''}`;
        }

        if (minutes > 0) {
            if (durationText) durationText += ' ';
            durationText += `${minutes} minute${minutes !== 1 ? 's' : ''}`;
        }

        detailsEl.innerHTML = `
            <strong>Player:</strong> ${dataset.name}<br>
            <strong>Date:</strong> ${dataset.date}<br>
            <strong>Time:</strong> ${formatTime12h(dataset.start)} – ${formatTime12h(dataset.end)}<br>
            <strong>Duration:</strong> ${durationText}`;
    }

    const feeInput = document.getElementById('claimFeeInput');

    if (feeInput) {
        feeInput.value = Math.round(durationHours * courtRegularRate);
    }

    document.getElementById('claimFeeModal').style.display = 'flex';
}

    async function executeClaimPlayerPost(dataset, sessionFee) {
        const { data: authData } = await supabase.auth.getUser();
        const user = authData?.user;
        if (!user) return;
        const { data: existingReq, error: existingReqError } = await supabase.from('coaching_requests').select('id').eq('post_id', dataset.id).limit(1);
        if (existingReqError) { showToast("Failed to validate."); return; }
        if (existingReq?.length) { showToast("Request already exists."); await loadPlayerPostedSchedules(); return; }
        const { data: coachProfile } = await supabase.from('profiles').select('full_name').eq('id', user.id).single();
        const { error: updateError } = await supabase.from('player_schedule_posts').update({ status: 'claimed', claimed_by: user.id }).eq('id', dataset.id).eq('status', 'open');
        if (updateError) { showToast("Failed to claim: " + updateError.message); return; }
        const { error: reqError } = await supabase.from('coaching_requests').insert([{
            player_id: dataset.player, player_name: dataset.name, coach_id: user.id,
            coach_name: coachProfile?.full_name || 'Coach', session_date: dataset.date,
            session_time: `${formatTime12h(dataset.start)} - ${formatTime12h(dataset.end)}`,
            payment_method: null, amount: sessionFee, status: 'coach_claimed', from_player_post: true, post_id: dataset.id
        }]);
        if (reqError) {
            await supabase.from('player_schedule_posts').update({ status: 'open', claimed_by: null }).eq('id', dataset.id);
            showToast("Failed to create coaching request."); return;
        }
        await supabase.from('notifications').insert([{
            user_id: dataset.player, title: 'Coach Claimed Your Slot',
            message: `A coach has claimed your schedule post for ${dataset.date}. Please complete your booking!`, type: 'coach_claimed'
        }]);
        showToast(`Claimed! ${dataset.name} will be notified.`);
        await loadPlayerPostedSchedules();
    }

    // ─── REALTIME ─────────────────────────────────────────────────────────────────

    async function setupRealtimeSchedule() {
        const { data: authData } = await supabase.auth.getUser();
        const user = authData?.user;
        if (!user) return;
        if (scheduleChannel) supabase.removeChannel(scheduleChannel);
        scheduleChannel = supabase.channel(`coach-schedule-${user.id}`)
            .on("postgres_changes", { event: "*", schema: "public", table: "coach_availability", filter: `coach_id=eq.${user.id}` },
                async () => { if (!isManualRefreshing) await loadCoachSlots(); })
            .subscribe();
    }

    async function setupRealtimePlayerSchedules() {
        if (playerScheduleChannel) supabase.removeChannel(playerScheduleChannel);
        playerScheduleChannel = supabase.channel('player-schedule-posts-realtime')
            .on("postgres_changes", { event: "*", schema: "public", table: "player_schedule_posts" }, async () => {
                const activeTab = document.querySelector('.tab-btn.active');
                if (activeTab?.dataset?.tab === 'player-requests') await loadPlayerPostedSchedules();
                updatePlayerPostsBadge();
            }).subscribe();
        await updatePlayerPostsBadge();
    }

    async function updatePlayerPostsBadge() {
        const today = new Date().toISOString().split('T')[0];
        const { count } = await supabase.from('player_schedule_posts').select('id', { count: 'exact', head: true }).eq('status', 'open').gte('preferred_date', today);
        const badge = document.getElementById('playerPostsBadge');
        if (badge) { badge.textContent = count || 0; badge.style.display = count > 0 ? 'inline-flex' : 'none'; }
    }

    // ─── ASSESSMENT BATCH ─────────────────────────────────────────────────────────

    async function createBatch() {
        const date = document.getElementById("batchDate")?.value;
        const startTime = document.getElementById("batchStartTime")?.value;
        const endTime = document.getElementById("batchEndTime")?.value;
        const maxSlots = parseInt(document.getElementById("batchMaxSlots")?.value) || 20;
        if (!date || !startTime || !endTime) { showToast("Please complete all required fields.", false); return; }
        if (startTime >= endTime) { showToast("End time must be after start time.", false); return; }
        if (maxSlots < 1 || maxSlots > 20) { showToast("Max players must be between 1 and 20.", false); return; }
        const btn = document.getElementById("saveBatchBtn");
        btn.disabled = true;
        btn.innerHTML = `<i class='bx bx-loader-alt bx-spin'></i> Creating...`;
        const { error } = await supabase.from("assessment_batches").insert({
            coach_id: currentCoachId, schedule_date: date,
            schedule_time: `${startTime} - ${endTime}`, max_slots: maxSlots, status: "open",
        });
        btn.disabled = false;
        btn.innerHTML = `<i class='bx bx-check'></i> Create Batch`;
        if (error) { showToast("Failed to create batch.", false); console.error(error); return; }
        document.getElementById("batchModal").style.display = "none";
        ["batchDate","batchStartTime","batchEndTime"].forEach(id => { const el = document.getElementById(id); if (el) el.value = ""; });
        document.getElementById("batchMaxSlots").value = "20";
        showToast("Assessment batch created! Players can now apply.");
        document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
        document.querySelectorAll(".tab-panel").forEach(p => p.classList.remove("active"));
        document.querySelector(".tab-btn[data-tab='assessment-batches']")?.classList.add("active");
        document.getElementById("tab-assessment-batches")?.classList.add("active");
        await loadBatches();
    }

    async function closeExpiredBatches() {
    const now = new Date();

    const { data: batches, error } = await supabase
        .from("assessment_batches")
        .select("id, schedule_date, schedule_time, status")
        .eq("status", "open");

    if (error) {
        console.error("Failed to check expired batches:", error);
        return;
    }

    const expiredIds = [];

    (batches || []).forEach(batch => {
        const [start, end] = batch.schedule_time
            .split("-")
            .map(t => t.trim());

        const endDateTime = new Date(
            `${batch.schedule_date}T${end}:00`
        );

        if (now >= endDateTime) {
            expiredIds.push(batch.id);
        }
    });

    if (!expiredIds.length) return;

    const { error: updateError } = await supabase
        .from("assessment_batches")
        .update({ status: "closed" })
        .in("id", expiredIds);

    if (updateError) {
        console.error("Failed to close expired batches:", updateError);
    }
}

    async function loadBatches() {
        await closeExpiredBatches();

        const list = document.getElementById("batchList");
        if (!list) return;
        list.innerHTML = `<div class="empty-batch">Loading...</div>`;
        const { data: batches, error } = await supabase
            .from("assessment_batches")
            .select("*")
            .eq("coach_id", currentCoachId)
            .order("created_at", { ascending: false });
            
        if (error || !batches?.length) { 
            list.innerHTML = `
                <div class="empty-state">
                    <i class='bx bx-calendar-star'></i>
                    <p>No assessment batches yet</p>
                    <span>Batches you create will appear here</span>
                </div>`;
        return; }
        const batchIds = batches.map(b => b.id);
        const { data: apps } = await supabase.from("assessment_applications").select("batch_id, status").in("batch_id", batchIds);
        const appMap = {};
        (apps || []).forEach(a => {
            if (!appMap[a.batch_id]) appMap[a.batch_id] = { total: 0, pending: 0, confirmed: 0 };
            appMap[a.batch_id].total++;
            if (a.status === "pending") appMap[a.batch_id].pending++;
            if (a.status === "confirmed") appMap[a.batch_id].confirmed++;
        });

        const sortedBatches = [...batches].sort((a, b) => {
            const aClosed = a.status === "closed" || a.status === "completed";
            const bClosed = b.status === "closed" || b.status === "completed";

            if (aClosed !== bClosed) {
                return aClosed ? 1 : -1;
            }

            return new Date(b.created_at) - new Date(a.created_at);
        });

        list.innerHTML = sortedBatches.map(batch => {
            const counts = appMap[batch.id] || { total: 0, pending: 0, confirmed: 0 };
            const confirmed = counts.confirmed;
            const max = batch.max_slots;
            const isFull = confirmed >= max;
            const isClosed = batch.status === "closed" || batch.status === "completed";
            const statusLabel = isClosed ? "Closed" : isFull ? "Full" : "Open";
            const statusClass = isClosed ? "closed" : isFull ? "full" : "open";
            const formattedDate = new Date(batch.schedule_date + "T00:00:00").toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric", year: "numeric" });
            return `
                <div class="batch-card">
                    <div class="batch-card-info">
                        <span class="bdate">${formattedDate}</span>
                        <span class="btime">
                            <i class='bx bx-time'></i>
                            ${formatTimeRange12h(batch.schedule_time)}
                            · ${formatScheduleDuration(batch.schedule_time)}
                        </span>
                        <span style="font-size:12px;color:#6b7280;margin-top:2px;">
                            ${confirmed}/${max} confirmed
                            ${counts.pending > 0 ? `· <strong style="color:#b45309;">${counts.pending} pending</strong>` : ""}
                        </span>
                    </div>
                    <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
                        <span class="batch-slot-pill ${statusClass}">${statusLabel}</span>
                        <div class="batch-card-actions">
                            <button class="btn-view-applicants" onclick="openApplicants(${batch.id}, '${formattedDate}', ${max}, ${confirmed})">
                                <i class='bx bx-group'></i> View Applicants (${counts.total})
                            </button>
                            ${!isClosed ? `<button class="btn-close-batch" onclick="closeBatch(${batch.id})">Close</button>` : ""}
                        </div>
                    </div>
                </div>`;
        }).join("");
    }

    window.openApplicants = async function(batchId, dateLabel, maxSlots, confirmedCount) {
        document.getElementById("applicantsModalTitle").textContent = `Applicants — ${dateLabel}`;
        document.getElementById("applicantsModalSubtitle").textContent = `${confirmedCount}/${maxSlots} slots confirmed.`;
        document.getElementById("applicantsList").innerHTML = `<p style="color:#9ca3af;font-size:13px;">Loading...</p>`;
        document.getElementById("applicantsModal").style.display = "flex";

        const { data: batch, error: batchError } = await supabase
            .from("assessment_batches")
            .select("status")
            .eq("id", batchId)
            .single();

        if (batchError) {
            console.error(batchError);
            document.getElementById("applicantsList").innerHTML =
                `<p style="color:#ef4444;font-size:13px;">Failed to load batch.</p>`;
            return;
        }

        const isClosed =
            batch.status === "closed" ||
            batch.status === "completed";

        const { data: apps, error } = await supabase
            .from("assessment_applications")
            .select(`
                id,
                status,
                applied_at,
                profiles!assessment_applications_player_id_fkey(full_name, username)
            `)
            .eq("batch_id", batchId)
            .order("applied_at", { ascending: true });

        if (error || !apps?.length) {
            document.getElementById("applicantsList").innerHTML =
                `<p style="color:#9ca3af;font-size:13px;text-align:center;padding:20px 0;">
                    No applicants yet.
                </p>`;
            return;
        }

        const slotsFull = confirmedCount >= maxSlots;

        document.getElementById("applicantsList").innerHTML = apps.map(app => {
            const name =
                app.profiles?.full_name ||
                app.profiles?.username ||
                "Unknown";

            const appliedDate = new Date(app.applied_at)
                .toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric"
                });

            let actionButtons = "";

            if (app.status === "pending" && !isClosed) {
                actionButtons = `
                    <div class="applicant-btns">
                        <button
                            class="btn-confirm-app"
                            onclick="updateApplication(
                                ${app.id},
                                'confirmed',
                                ${batchId},
                                '${dateLabel}',
                                ${maxSlots}
                            )"
                            ${slotsFull ? "disabled" : ""}
                        >
                            Confirm
                        </button>

                        <button
                            class="btn-decline-app"
                            onclick="updateApplication(
                                ${app.id},
                                'declined',
                                ${batchId},
                                '${dateLabel}',
                                ${maxSlots}
                            )"
                        >
                            Decline
                        </button>
                    </div>
                `;
            }

            return `
                <div class="applicant-row" id="approw-${app.id}">
                    <div>
                        <div class="applicant-name">${name}</div>
                        <div class="applicant-date">Applied ${appliedDate}</div>
                    </div>

                    <div style="display:flex;align-items:center;gap:8px;">
                        <span class="applicant-status ${app.status}">
                            ${app.status}
                        </span>

                        ${actionButtons}
                    </div>
                </div>
            `;
        }).join("");
    };

    window.updateApplication = async function(
        appId,
        newStatus,
        batchId,
        dateLabel,
        maxSlots
    ) {
        const { data: batch, error: batchError } = await supabase
            .from("assessment_batches")
            .select("status")
            .eq("id", batchId)
            .single();

        if (batchError) {
            showToast("Failed to validate batch.", false);
            return;
        }

        if (
            batch.status === "closed" ||
            batch.status === "completed"
        ) {
            showToast(
                "This assessment batch is already closed.",
                false
            );

            await openApplicants(
                batchId,
                dateLabel,
                maxSlots,
                0
            );

            return;
        }

        const { data: currentApp, error: currentAppError } = await supabase
            .from("assessment_applications")
            .select("status, player_id")
            .eq("id", appId)
            .single();

        if (currentAppError || !currentApp) {
            showToast("Application not found.", false);
            return;
        }

        if (currentApp.status !== "pending") {
            showToast(
                "This application has already been processed.",
                false
            );

            await openApplicants(
                batchId,
                dateLabel,
                maxSlots,
                0
            );

            return;
        }

        if (newStatus === "confirmed") {
            const { count } = await supabase
                .from("assessment_applications")
                .select("id", {
                    count: "exact",
                    head: true
                })
                .eq("batch_id", batchId)
                .eq("status", "confirmed");

            if ((count || 0) >= maxSlots) {
                showToast(
                    "This assessment batch is already full.",
                    false
                );

                await openApplicants(
                    batchId,
                    dateLabel,
                    maxSlots,
                    count || 0
                );

                return;
            }
        }

        const { error } = await supabase
            .from("assessment_applications")
            .update({
                status: newStatus
            })
            .eq("id", appId)
            .eq("status", "pending");

        if (error) {
            showToast("Failed to update.", false);
            return;
        }

        if (currentApp.player_id) {
            await supabase
                .from("notifications")
                .insert({
                    user_id: currentApp.player_id,
                    title:
                        newStatus === "confirmed"
                            ? "Assessment Confirmed! ✅"
                            : "Assessment Application Update",
                    message:
                        newStatus === "confirmed"
                            ? `Your assessment for ${dateLabel} is confirmed! Please attend on schedule.`
                            : `Your assessment application for ${dateLabel} was not accepted this time.`,
                    is_read: false
                });
        }

        showToast(
            newStatus === "confirmed"
                ? "Player confirmed!"
                : "Player declined."
        );

        const { data: updatedApps } = await supabase
            .from("assessment_applications")
            .select("status")
            .eq("batch_id", batchId)
            .eq("status", "confirmed");

        await openApplicants(
            batchId,
            dateLabel,
            maxSlots,
            updatedApps?.length || 0
        );

        await loadBatches();
        await updateBatchBadge();
    };

    window.closeBatch = async function(batchId) {
        showConfirmDialog("Close this batch? Players can no longer apply.", async () => {
            await supabase.from("assessment_batches").update({ status: "closed" }).eq("id", batchId);
            showToast("Batch closed.");
            await loadBatches();
        });
    };

    async function updateBatchBadge() {
        const badge = document.getElementById("batchApplicantsBadge");
        if (!badge) return;
        const { data: batches } = await supabase.from("assessment_batches").select("id").eq("coach_id", currentCoachId).eq("status", "open");
        if (!batches?.length) { badge.style.display = "none"; return; }
        const { count } = await supabase.from("assessment_applications").select("id", { count: "exact", head: true }).in("batch_id", batches.map(b => b.id)).eq("status", "pending");
        badge.textContent = count || 0;
        badge.style.display = count > 0 ? "inline-flex" : "none";
    }

    function formatScheduleDuration(startTime, endTime) {
    if (!startTime || !endTime) {
        return 'N/A';
    }

    const [sh, sm] = startTime.split(':').map(Number);
    const [eh, em] = endTime.split(':').map(Number);

    let durationMinutes = (eh * 60 + em) - (sh * 60 + sm);

    if (durationMinutes < 0) {
        durationMinutes += 24 * 60;
    }

    const hours = Math.floor(durationMinutes / 60);
    const minutes = durationMinutes % 60;

    if (hours === 0) {
        return `${minutes} minute${minutes !== 1 ? 's' : ''}`;
    }

    if (minutes === 0) {
        return `${hours} hour${hours !== 1 ? 's' : ''}`;
    }

    return `${hours} hour${hours !== 1 ? 's' : ''} ${minutes} minute${minutes !== 1 ? 's' : ''}`;
}