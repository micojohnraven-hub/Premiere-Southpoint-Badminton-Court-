import { supabase } from "../supabase/supabaseClient.js";

function getLocalDateString(date = new Date()) {
    const d = new Date(date);
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    return d.toISOString().split("T")[0];
}

let selectedCoach = null;
let coachSlots = [];
let selectedAvailabilityId = null;
let selectedDateValue = null;
let selectedTimeLabel = null;
let selectedSessionType = null;
let isSubmittingPost = false;
let availabilityChannel = null;
let coachListChannel = null;
let isSubmittingCoachRequest = false;
let playerRequestChannel = null;
let lastSeenStatusMap = new Map();
let notificationChannel = null;
let coachPackages = {};
let selectedBaseFee = 1000;
let selectedPackageSessions = null;
let completingRequestId = null;
let pendingBatchId = null;
let selectedCourtId = null;
let selectedCourtFee = 0;
let paymentQR = null;

const coachGrid = document.getElementById("coachGrid");
const bookingModal = document.getElementById("bookingModal");
const qrModal = document.getElementById("qrModal");
const cashModal = document.getElementById("cashModal");
const successModal = document.getElementById("successModal");
const bookingForm = document.getElementById("bookingForm");
const postScheduleModal = document.getElementById("postScheduleModal");

document.addEventListener("DOMContentLoaded", async () => {
    await loadCoaches();
    setupQRModalListeners();
    await setupRealtimeCoachList();
    await setupRealtimePlayerRequestNotifications();
    await setupRealtimeNotificationBell();
    await loadMyPostedSchedules();
    await loadMyPackageSessions();

    startAutoRefresh();

    const postDateInput = document.getElementById("postDate");
    if (postDateInput) {
        postDateInput.setAttribute("min", getLocalDateString());
    }

    const postEndDateInput = document.getElementById("postEndDate");
    if (postEndDateInput) {
        postEndDateInput.setAttribute("min", getLocalDateString());
    }

    if (postDateInput && postEndDateInput) {
        postDateInput.addEventListener("change", () => {
            if (postDateInput.value) {
                postEndDateInput.setAttribute("min", postDateInput.value);
                if (postEndDateInput.value && postEndDateInput.value < postDateInput.value) {
                    postEndDateInput.value = "";
                }
            }
        });
    }

    const savePostBtn = document.getElementById("savePostBtn");
    if (savePostBtn) {
        savePostBtn.addEventListener("click", savePlayerPost);
    }

    await loadAssessmentBatches();

    document.getElementById('confirmApplyBtn')?.addEventListener('click', applyToAssessmentBatch);

    supabase
        .channel('assessment-batches-player')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'assessment_batches' }, async () => {
            await loadAssessmentBatches();
        })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'assessment_applications' }, async () => {
            await loadAssessmentBatches();
        })
        .subscribe();
        
});

// ─── AUTO REFRESH  ───────────────────────────────
function isAnyModalOpen() {
    return [bookingModal, qrModal, cashModal, successModal, postScheduleModal]
        .some(m => m && m.style.display === "flex");
}

function startAutoRefresh() {
    const POLL_INTERVAL = 30_000;
    let pollTimer = null;

    async function runRefresh() {
        if (document.visibilityState !== "visible") return;
        if (isAnyModalOpen()) return;

        await Promise.all([
            loadCoaches(),
            loadMyPostedSchedules(),
            loadMyPackageSessions(),
            loadAssessmentBatches(),
        ]);
    }

    function startPolling() {
        if (pollTimer) return;
        pollTimer = setInterval(runRefresh, POLL_INTERVAL);
    }

    function stopPolling() {
        if (pollTimer) {
            clearInterval(pollTimer);
            pollTimer = null;
        }
    }

    document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") {
            runRefresh(); 
            startPolling();
        } else {
            stopPolling();
        }
    });

    const modalObserver = new MutationObserver(() => {
        if (isAnyModalOpen()) {
            stopPolling();
        } else {
            startPolling();
        }
    });

    [bookingModal, qrModal, cashModal, successModal, postScheduleModal]
        .filter(Boolean)
        .forEach(m => modalObserver.observe(m, { attributes: true, attributeFilter: ["style"] }));
    startPolling();
}

function setupQRModalListeners() {
    const fileInput      = document.getElementById('paymentScreenshot');
    const previewWrapper = document.getElementById('uploadPreviewWrapper');
    const previewImg     = document.getElementById('uploadPreview');
    const uploadLabel    = document.getElementById('uploadLabel');
    const dropZone       = document.getElementById('uploadDropZone');

    if (!fileInput || !dropZone) return;

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

    const btnCancelQR = document.getElementById('btnCancelQR');
    if (btnCancelQR) {
        btnCancelQR.onclick = () => {
            qrModal.style.display = 'none';
            resetQRModal();
            bookingModal.style.display = 'flex';
        };
    }

const btnPaid = document.getElementById('btnPaid');
if (btnPaid) {
    btnPaid.onclick = async () => {
        const refInput    = document.getElementById('referenceNumberInput');
        const refError    = document.getElementById('refError');
        const uploadError = document.getElementById('uploadError');
        const policyAck   = document.getElementById('policyAck');
        const policyError = document.getElementById('policyError');
        const refValue    = refInput ? refInput.value.trim() : '';
        const file        = fileInput ? fileInput.files[0] : null;
        let hasError      = false;

        if (!paymentQR) {
            showToast("Payment details are missing. Please go through the payment step again.");
            return;
        }

        if (!refValue) {
            if (refError) refError.style.display = 'block';
            if (refInput) refInput.focus();
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

        if (policyAck && !policyAck.checked) {
            if (policyError) policyError.style.display = 'block';
            hasError = true;
        } else {
            if (policyError) policyError.style.display = 'none';
        }

        if (hasError) return;

        await processFinalPayment('E-wallet', refValue, file);
    };
}
}

function resetQRModal() {
    const refInput  = document.getElementById('referenceNumberInput');
    const fileInput = document.getElementById('paymentScreenshot');
    if (refInput)  refInput.value = '';
    if (fileInput) fileInput.value = '';
    const previewImg     = document.getElementById('uploadPreview');
    const previewWrapper = document.getElementById('uploadPreviewWrapper');
    const dropZone       = document.getElementById('uploadDropZone');
    const uploadLabel    = document.getElementById('uploadLabel');
    if (previewImg)     previewImg.src = '';
    if (previewWrapper) previewWrapper.style.display = 'none';
    if (dropZone)       dropZone.style.display = 'block';
    if (uploadLabel)    uploadLabel.textContent = 'Click to upload screenshot';
    const refError    = document.getElementById('refError');
    const uploadError = document.getElementById('uploadError');
    const policyAck   = document.getElementById('policyAck');
    const policyError = document.getElementById('policyError');
    if (refError)    refError.style.display = 'none';
    if (uploadError) uploadError.style.display = 'none';
    if (policyAck)   policyAck.checked = false;
    if (policyError) policyError.style.display = 'none';
}

// ─── PAYMENT QR ───
async function loadPaymentQR(isPackage) {
    let query = supabase
        .from("payment_qr_codes")
        .select("id, provider, account_name, qr_image_url")
        .eq("is_active", true);

    if (isPackage) {
        query = query.eq("owner_id", selectedCoach.id).eq("owner_role", "coach");
    } else {
        query = query.eq("owner_role", "business_admin");
    }

    const { data, error } = await query.maybeSingle();

    paymentQR = error ? null : data;
    return !!paymentQR;
}

function renderPaymentQR(isPackage) {
    document.getElementById("paymentQRImage").src = paymentQR.qr_image_url;
    document.getElementById("qrAccountInfo").textContent = `${paymentQR.provider} • ${paymentQR.account_name}`;
    document.getElementById("qrPayeeNote").textContent = isPackage
        ? "This payment goes directly to your coach. Southpoint does not hold or refund coach payments."
        : "This is the court reservation fee, paid to Southpoint.";
}

// ─── LOAD COACHES ───────────────────────────────────────────

async function loadCoaches() {
    const today = getLocalDateString();

    const [slotRes, packageRes] = await Promise.all([
        supabase
            .from("coach_availability")
            .select("coach_id, session_fee")
            .eq("status", "available")
            .gte("slot_date", today),
        supabase
            .from("coach_packages")
            .select("coach_id, price, sessions")
    ]);

    if (slotRes.error) {
        coachGrid.innerHTML = `<p style="padding:20px;">Failed to load coaches.</p>`;
        return;
    }

    const slotRows = slotRes.data || [];
    const packageRows = packageRes.data || [];

    const slotCoachIds = [...new Set(slotRows.map(r => r.coach_id))];
    const coachFeeMap = {};
    slotRows.forEach(s => {
        if (!coachFeeMap[s.coach_id]) coachFeeMap[s.coach_id] = Number(s.session_fee || 200);
    });

    const packageCoachIds = [...new Set(packageRows.map(r => r.coach_id))];
    const allCoachIds = [...new Set([...slotCoachIds, ...packageCoachIds])];

    if (!allCoachIds.length) {
        coachGrid.innerHTML = `<p class="no-posts-text">No coaches available right now.</p>`;
        return;
    }

    const { data, error } = await supabase
        .from("profiles")
        .select("id, full_name, session_fee")
        .eq("role", "coach")
        .eq("status", "active")
        .in("id", allCoachIds);

    if (error) {
        coachGrid.innerHTML = `<p style="padding:20px;">Failed to load coaches.</p>`;
        return;
    }

    const coachesWithInfo = (data || []).map(coach => ({
        ...coach,
        slot_fee: coachFeeMap[coach.id] ?? Number(coach.session_fee || 200),
        hasSlots: slotCoachIds.includes(coach.id),
        hasPackages: packageCoachIds.includes(coach.id)
    }));

    displayCoaches(coachesWithInfo);
}

// ─── DISPLAY COACHES  ──────────────────────────────────

function displayCoaches(coaches) {
    if (!coaches.length) {
        coachGrid.innerHTML = `<p class="no-posts-text">No coaches available right now.</p>`;
        return;
    }

    const cardsHTML = coaches.map((coach, index) => {
        const fee = Number(coach.slot_fee || 200).toFixed(2);
        const badgeLabel = coach.hasSlots 
            ? `₱${fee} <span style="font-size:11px; font-weight:400;">per session</span>`
            : `<span style="font-size:12px;">Package Only</span>`;

        return `
            <div class="coach-card" id="coach-${coach.id}">
                <div class="card-top-row">
                    <span class="specialty-badge">Coach</span>
                    <span class="card-number">#${String(index + 1).padStart(2, "0")}</span>
                </div>
                <h2>${coach.full_name}</h2>
                <p class="coach-desc">Professional coach available for private sessions.</p>
                <div class="card-footer">
                    <div class="price-block">
                        <span class="price-text">${badgeLabel}</span> 
                    </div>
                    <button class="book-btn" 
                        data-id="${coach.id}" 
                        data-name="${coach.full_name}" 
                        data-fee="${coach.slot_fee || 200}" 
                        data-slots="${coach.hasSlots}">Book</button>
                </div>
            </div>
        `;
    }).join('');

    coachGrid.innerHTML = cardsHTML;

    coachGrid.querySelectorAll(".book-btn").forEach(btn => {
        btn.addEventListener("click", async () => {
            const { id, name, fee, slots } = btn.dataset;
            await openBookingModal(id, name, Number(fee), slots === "true");
        });
    });
}

// ─── BOOKING MODAL ────────────────────────────────────────────────────────────

async function openBookingModal(coachId, coachName, sessionFee, hasSlots = true) {
    selectedBaseFee = Number(sessionFee || 200);
    selectedCoach = { id: coachId, name: coachName, fee: selectedBaseFee };
    resetBookingChoices();

    const datesSection = document.getElementById("availableDates")?.closest(".form-group");
    const timesSection = document.getElementById("availableTimes")?.closest(".form-group");
    if (datesSection) datesSection.style.display = hasSlots ? '' : 'none';
    if (timesSection) timesSection.style.display = hasSlots ? '' : 'none';

    bookingModal.style.display = "flex";
    await Promise.all([
        hasSlots ? loadCoachSlots() : Promise.resolve(),
        loadCoachPackages(coachId)
    ]);
    subscribeToCoachAvailability();
}

async function loadCoachPackages(coachId) {
    const { data, error } = await supabase
        .from("coach_packages")
        .select("*")
        .eq("coach_id", coachId);

    coachPackages = {};
    if (!error && data) {
        data.forEach(p => {
            const key = `${p.sessions}`;
            coachPackages[key] = p.price;
        });
    }

    renderPackageOptions();
}

function renderPackageOptions() {
    const container = document.getElementById("packageOptions");
    if (!container) return;

    const hasPackages = Object.keys(coachPackages).length > 0;

    if (!hasPackages) {
        container.innerHTML = `<p class="muted-hint">No package offers available for this coach.</p>`;
        return;
    }

    const packageDefs = [
        { sessions: 5,  label: "5 Sessions",  icon: "bx-star" },
        { sessions: 10, label: "10 Sessions", icon: "bx-medal" },
        { sessions: 20, label: "20 Sessions", icon: "bx-trophy" },
    ];

    const available = packageDefs.filter(p => coachPackages[`${p.sessions}`]);

    if (!available.length) {
        container.innerHTML = `<p class="muted-hint">No package offers available.</p>`;
        return;
    }

    const cardsHTML = available.map(p => {
        const price = coachPackages[`${p.sessions}`];
        return `
            <label class="package-option-card">
                <input type="radio" name="selectedPackage" value="${p.sessions}">
                <div class="pkg-opt-inner">
                    <i class='bx ${p.icon}' style="font-size:20px; color:#16a34a;"></i>
                    <div>
                        <span class="pkg-opt-label">${p.label}</span>
                        <span class="pkg-opt-price">₱${Number(price).toLocaleString()}</span>
                    </div>
                </div>
            </label>
        `;
    }).join('');

    container.innerHTML = `
        <div id="packageToggleHeader" style="
            display:flex; align-items:center; justify-content:space-between;
            cursor:pointer; padding:10px 14px; background:#f0fdf4;
            border:1.5px solid #bbf7d0; border-radius:10px; margin-bottom:8px;
            user-select:none;
        ">
            <span style="font-size:13px; font-weight:700; color:#16a34a;">
                <i class='bx bx-package' style="vertical-align:middle; margin-right:6px;"></i>
                View Session Packages
            </span>
            <i class='bx bx-chevron-down' id="packageToggleIcon" style="
                font-size:18px; color:#16a34a;
                transition: transform 0.2s ease;
            "></i>
        </div>
        <div id="packageOptionsBody" style="display:none;">
            ${cardsHTML}
        </div>
    `;

    const toggleHeader = document.getElementById("packageToggleHeader");
    const packageBody = document.getElementById("packageOptionsBody");
    const toggleIcon = document.getElementById("packageToggleIcon");

    toggleHeader.addEventListener("click", () => {
        const isOpen = packageBody.style.display !== "none";
        packageBody.style.display = isOpen ? "none" : "";
        toggleIcon.style.transform = isOpen ? "rotate(0deg)" : "rotate(180deg)";

        if (isOpen) {
            selectedPackageSessions = null;
            selectedAvailabilityId = null;
            selectedDateValue = null;
            selectedTimeLabel = null;
            selectedSessionType = 'solo';
            selectedCourtId = null;
            selectedCourtFee = 0;

            document.getElementById("sessionDate").value = "";
            document.getElementById("sessionTime").value = "";

            const datesSection = document.getElementById("availableDates")?.closest(".form-group");
            const timesSection = document.getElementById("availableTimes")?.closest(".form-group");
            if (datesSection) datesSection.style.display = "none";
            if (timesSection) timesSection.style.display = "none";

            document.querySelectorAll("#availableDates .slot-item").forEach(el => el.classList.remove("active"));
            document.querySelectorAll("#availableTimes .slot-item").forEach(el => el.classList.remove("active"));

            document.querySelectorAll('input[name="selectedPackage"]').forEach(r => r.checked = false);

            if (selectedCoach) selectedCoach.fee = selectedBaseFee;
            updatePriceUI();
        }
    });

    container.querySelectorAll('input[name="selectedPackage"]').forEach(radio => {
        radio.addEventListener("change", () => {
            const sessions = parseInt(radio.value);
            const price = coachPackages[`${sessions}`];
            if (price && selectedCoach) {
                selectedPackageSessions = sessions;
                selectedCoach.fee = Number(price);

                selectedCourtId = null;
                selectedCourtFee = 0;

                document.querySelectorAll("#availableDates .slot-item").forEach(el => el.classList.remove("active"));
                document.querySelectorAll("#availableTimes .slot-item").forEach(el => el.classList.remove("active"));
                selectedAvailabilityId = null;
                selectedTimeLabel = null;
                selectedDateValue = null;
                document.getElementById("sessionDate").value = "";
                document.getElementById("sessionTime").value = "";

                updatePriceUI();
            }
        });
    });
}

// ─── COURT FEE LOOKUP ──────────────────────────────────────────────────────
async function fetchCourtFee() {
  const { data, error } = await supabase
    .from("business_settings")
    .select("value")
    .eq("key", "court_rate")
    .single();

  if (error) {
    console.error("Failed to fetch court fee:", error);
    return 0;
  }

  const courtFee = Number(data?.value);

  return Number.isFinite(courtFee) ? courtFee : 0;
}

function updatePriceUI() {
    if (!selectedCoach) return;

    const coachAmountLabel = document.getElementById("coachAmountLabel");
    const cashAmountLabel = document.getElementById("cashAmountLabel");
    const selectedCoachInfo = document.getElementById("selectedCoachInfo");

    const isPackage = !!document.querySelector('input[name="selectedPackage"]:checked');

    const amountToPayNow = isPackage ? selectedCoach.fee : selectedCourtFee;

    if (coachAmountLabel) coachAmountLabel.textContent = `₱${amountToPayNow.toFixed(2)}`;
    if (cashAmountLabel) cashAmountLabel.textContent = `₱${amountToPayNow.toFixed(2)}`;

    if (!selectedCoachInfo) return;

    const selectedPackageInput = document.querySelector('input[name="selectedPackage"]:checked');

    const leftSubtext = selectedPackageInput
        ? `${selectedPackageInput.value} Sessions Package`
        : (selectedDateValue && selectedTimeLabel
            ? `${selectedDateValue} • ${selectedTimeLabel}`
            : "Select date and time");

    if (isPackage) {
        selectedCoachInfo.innerHTML = `
            <div class="selected-coach-banner" style="justify-content:space-between; align-items:center;">
                <div>
                    <p class="selected-coach-name">${selectedCoach.name}</p>
                    <p class="selected-coach-tag">${leftSubtext}</p>
                </div>
                <div style="text-align:right;">
                    <p class="selected-coach-name">₱${selectedCoach.fee.toFixed(2)}</p>
                    <p class="selected-coach-tag">Package Rate</p>
                </div>
            </div>
        `;
        return;
    }

    selectedCoachInfo.innerHTML = `
        <div class="selected-coach-banner" style="flex-direction:column; gap:10px; align-items:stretch;">
            <div>
                <p class="selected-coach-name">${selectedCoach.name}</p>
                <p class="selected-coach-tag">${leftSubtext}</p>
            </div>

            <div class="payment-summary-block" style="border-top:1px dashed #d1d5db; padding-top:10px;">
                <div style="display:flex; justify-content:space-between; font-size:13px;">
                    <span>Court Reservation Fee</span>
                    <span>₱${selectedCourtFee.toFixed(2)}</span>
                </div>
                <div style="display:flex; justify-content:space-between; font-weight:700; margin-top:4px; border-top:1px solid #e5e7eb; padding-top:4px;">
                    <span>Amount to Pay</span>
                    <span>₱${selectedCourtFee.toFixed(2)}</span>
                </div>
                <div style="display:flex; justify-content:space-between; font-size:13px; color:#6b7280; margin-top:10px;">
                    <span>Coach Session Fee</span>
                    <span>₱${selectedCoach.fee.toFixed(2)}</span>
                </div>
                <p style="font-size:11px; color:#9ca3af; margin-top:2px;">
                    * Pay the coach directly during your scheduled session.
                </p>
            </div>
        </div>
    `;
}

function resetBookingChoices() {
    coachSlots = [];
    selectedAvailabilityId = null;
    selectedDateValue = null;
    selectedTimeLabel = null;
    selectedSessionType = 'solo';
    coachPackages = {};
    completingRequestId = null;
    selectedCourtId = null;
    selectedCourtFee = 0;

    const el = (id) => document.getElementById(id);
    if (el("sessionDate")) el("sessionDate").value = "";
    if (el("sessionTime")) el("sessionTime").value = "";
    if (el("availableDates")) el("availableDates").innerHTML = "";
    if (el("availableTimes")) el("availableTimes").innerHTML = "";
    if (el("packageOptions")) el("packageOptions").innerHTML = "";

    const datesSection = el("availableDates")?.closest(".form-group");
    const timesSection = el("availableTimes")?.closest(".form-group");
    if (datesSection) datesSection.style.display = "none";
    if (timesSection) timesSection.style.display = "none";

    const packageBody = document.getElementById("packageOptionsBody");
    const packageToggle = document.getElementById("packageToggleIcon");
    if (packageBody) packageBody.style.display = "none";
    if (packageToggle) packageToggle.style.transform = "rotate(0deg)";

    updatePriceUI();
}

// ─── SLOTS ────────────────────────────────────────────────────────────────────

async function loadCoachSlots() {
    if (!selectedCoach) return;

    const today = getLocalDateString();

    const { data: slotData, error: slotError } = await supabase
        .from('coach_availability')
        .select('*')
        .eq('coach_id', selectedCoach.id)
        .eq('status', 'available')
        .gte('slot_date', today)
        .order('slot_date', { ascending: true })
        .order('start_time', { ascending: true });

    if (slotError) { console.error(slotError); return; }

    coachSlots = slotData || [];
    renderDates();
}

function renderDates() {
    const container = document.getElementById("availableDates");
    const timeContainer = document.getElementById("availableTimes");
    container.innerHTML = "";
    timeContainer.innerHTML = "";

    const uniqueDates = [...new Set(coachSlots.map(s => s.slot_date))];

    if (!uniqueDates.length) {
        container.innerHTML = `<p style="font-size:13px; color:#666;">No available dates.</p>`;
        return;
    }

    uniqueDates.forEach(date => {
        const btn = document.createElement("div");
        btn.className = "slot-item";
        btn.textContent = formatDateChip(date);
        btn.addEventListener("click", () => {
            document.querySelectorAll("#availableDates .slot-item").forEach(el => el.classList.remove("active"));
            btn.classList.add("active");
            selectedDateValue = date;
            document.getElementById("sessionDate").value = date;
            selectedAvailabilityId = null;
            selectedTimeLabel = null;
            selectedCourtId = null;
            selectedCourtFee = 0;
            document.getElementById("sessionTime").value = "";
            renderTimes(date);
        });
        container.appendChild(btn);
    });

    window._renderDates = renderDates;
}

function renderTimes(date) {
    const container = document.getElementById("availableTimes");
    container.innerHTML = "";
    const filtered = coachSlots.filter(s => s.slot_date === date);

    if (!filtered.length) {
        container.innerHTML = `<p style="font-size:13px; color:#666;">No available times.</p>`;
        return;
    }

    filtered.forEach(slot => {
        const btn = document.createElement("div");
        btn.className = "slot-item";

        const label = `${formatTime12h(slot.start_time)} - ${formatTime12h(slot.end_time)}`;

        btn.innerHTML = `
            <span>${label}</span>
            <span style="font-size:10px; background:#eff6ff; color:#3b82f6; padding:2px 6px; border-radius:6px; font-weight:700;">
                SOLO
            </span>
        `;
        btn.style.cssText = "display:flex; align-items:center; justify-content:space-between; gap:8px;";

        btn.addEventListener("click", async () => {
            document.querySelectorAll("#availableTimes .slot-item").forEach(el => el.classList.remove("active"));
            btn.classList.add("active");

            selectedAvailabilityId = slot.id;
            selectedCourtId = slot.court_id;
            selectedTimeLabel = label;
            selectedSessionType = 'solo';
            selectedBaseFee = Number(slot.session_fee || 200);
            selectedCoach.fee = selectedBaseFee;

            document.getElementById("sessionTime").value = label;

            const cashAmountLabel = document.getElementById("cashAmountLabel");
            const coachAmountLabel = document.getElementById("coachAmountLabel");
            if (coachAmountLabel) coachAmountLabel.textContent = "Loading...";
            if (cashAmountLabel) cashAmountLabel.textContent = "Loading...";

            const start = new Date(`2000-01-01 ${slot.start_time}`);
            const end = new Date(`2000-01-01 ${slot.end_time}`);

            const durationHours = (end - start) / (1000 * 60 * 60);

            selectedCourtFee = await fetchCourtFee();

            renderPackageOptions();
            document.querySelectorAll('input[name="selectedPackage"]').forEach(r => r.checked = false);
            document.querySelectorAll('.package-option-card').forEach(el => el.classList.remove("active"));

            selectedCoach.fee = selectedBaseFee;
            updatePriceUI();
        });

        container.appendChild(btn);
    });
}

// ─── SAVE COACHING REQUEST ────────────────────────────────────────────────────
async function saveCoachingRequest(method, referenceNumber = null, screenshot_url = null) {
    if (completingRequestId) {
        const updatePayload = {
            payment_method: method,
            reference_number: referenceNumber,
            status: 'pending'
        };
        if (screenshot_url) updatePayload.payment_screenshot = screenshot_url;

        const { data: updatedRows, error } = await supabase
            .from('coaching_requests')
            .update(updatePayload)
            .eq('id', completingRequestId)
            .select();

        if (error) {
            console.error("Update error:", error);
            showToast(error.message || "Failed to complete booking.");
            return null;
        }

        const data = updatedRows?.[0];
        if (!data) {
            showToast("Booking not found. Please try again.");
            return null;
        }

        completingRequestId = null;
        return {
            date: data.session_date,
            time: data.session_time,
            referenceNumber,
            amount: data.amount,
            courtFee: data.court_fee,
            coachFee: data.coach_fee
        };
    }

    const selectedPackageInput = document.querySelector('input[name="selectedPackage"]:checked');
    const packageSessions = selectedPackageInput ? parseInt(selectedPackageInput.value) : null;

    if (packageSessions && selectedCoach?.id) {
        const { data: authData } = await supabase.auth.getUser();
        const user = authData?.user;

        if (user) {
            const { data: existing, error: checkErr } = await supabase
                .from('coaching_requests')
                .select('id, status, package_sessions')
                .eq('player_id', user.id)
                .eq('coach_id', selectedCoach.id)
                .eq('request_type', 'Package Session')
                .in('status', ['pending', 'pending_verification', 'accepted'])
                .limit(1);

            if (checkErr) {
                console.error("Duplicate check failed:", checkErr);
            } else if (existing?.length) {
                const existingReq = existing[0];
                const statusLabel = {
                    'pending': 'pending payment',
                    'pending_verification': 'awaiting verification',
                    'accepted': 'already active'
                }[existingReq.status] || existingReq.status;

                showToast(`You already have a ${existingReq.package_sessions}-session package with this coach that is ${statusLabel}. Please complete your current package first.`);
                return null;
            }
        }
    }

    const { data, error } = await supabase.rpc("create_coaching_request", {
        p_availability_id: selectedAvailabilityId,
        p_payment_method: method,
        p_reference_number: referenceNumber,
        p_package_sessions: packageSessions,
        p_coach_id: selectedCoach?.id ?? null,
        p_session_date: selectedDateValue || null,
        p_session_time: selectedTimeLabel || null
    });

    if (error) {
        console.error("RPC error:", error);
        showToast(error.message || "Failed to save coaching request.");
        return null;
    }

    if (!data?.success) {
        showToast(data?.message || "Failed to save coaching request.");
        return null;
    }

    if (screenshot_url && data?.request_id) {
        await supabase
            .from('coaching_requests')
            .update({ payment_screenshot: screenshot_url })
            .eq('id', data.request_id);

        await supabase
            .from('reservations')
            .update({ payment_screenshot: screenshot_url })
            .eq('coaching_request_id', data.request_id);
    }

    return {
        date: data.session_date,
        time: data.session_time,
        referenceNumber,
        amount: data.amount,
        courtFee: data.court_fee,
        coachFee: data.coach_fee
    };
}

// ─── BOOKING FORM SUBMIT ──────────────────────────────────────────────────────

if (bookingForm) {
    bookingForm.addEventListener("submit", async (e) => {
        e.preventDefault();

        const submitBtn = bookingForm.querySelector('button[type="submit"]');
        const paymentInput = document.querySelector('input[name="payment"]:checked');
        const isPackageOnly = !!selectedPackageSessions;

        if (!selectedCoach) { showToast("Please select a coach first."); return; }

        if (!isPackageOnly) {
            if (!selectedDateValue) { showToast("Please select an available date."); return; }
            if ((!selectedAvailabilityId || !selectedTimeLabel) && !completingRequestId) {
                showToast("Please select an available time slot."); return;
            }
            if (!selectedCourtFee && !completingRequestId) {
                showToast("Unable to load court fee for this slot. Please try again."); return;
            }
        }

        if (!paymentInput) { showToast("Please select payment method."); return; }

        const paymentMethod = paymentInput.value;
        const amountToPayNow = isPackageOnly ? selectedCoach.fee : selectedCourtFee;

        if (paymentMethod === "E-wallet") {
            if (submitBtn) submitBtn.disabled = true;
            const ready = await loadPaymentQR(isPackageOnly);
            if (submitBtn) submitBtn.disabled = false;

            if (!ready) {
                showToast(
                    isPackageOnly
                        ? "This coach has not set up E-Wallet payment yet. Please choose another payment method."
                        : "E-Wallet payment is currently unavailable. Please choose Cash or contact the front desk."
                );
                return;
            }

            resetQRModal();
            renderPaymentQR(isPackageOnly);
            document.getElementById('qrAmount').textContent = `₱${amountToPayNow.toFixed(2)}`;
            bookingModal.style.display = "none";
            qrModal.style.display = "flex";
            return;
        }

        bookingModal.style.display = "none";
        document.getElementById('cashAmountLabel').textContent = `₱${amountToPayNow.toFixed(2)}`;
        cashModal.style.display = "flex";
    });
}

// ─── PROCESS FINAL PAYMENT ─────────────────────────

async function processFinalPayment(method, referenceNumber = null, file = null) {
    if (isSubmittingCoachRequest) return;

    if (method === 'E-wallet' && !paymentQR) {
            showToast("Payment details are missing. Please go through the payment step again.");
            return;
        }
        
    try {
        const isPackageOnly = !!selectedPackageSessions;

        if (!selectedCoach || (!isPackageOnly && (!selectedDateValue || !selectedAvailabilityId))) {
            showToast("Please select date and time first.");
            return;
        }
        isSubmittingCoachRequest = true;

        if (method === 'Cash' && !referenceNumber) {
            referenceNumber = generateCoachingReference();
        }

        let screenshot_url = null;
        if (method === 'E-wallet' && file) {
            const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/heic'];
            if (!allowedTypes.includes(file.type)) {
                showToast("Invalid file type. Please upload a PNG, JPG, or WEBP image.");
                isSubmittingCoachRequest = false;
                return;
            }

            const MAX_SIZE = 5 * 1024 * 1024;
            if (file.size > MAX_SIZE) {
                showToast("File is too large. Maximum size allowed is 5MB.");
                isSubmittingCoachRequest = false;
                return;
            }

            const sanitizedName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
            const fileName = `coaching-payments/${Date.now()}_${sanitizedName}`;

            const { data: uploadData, error: uploadError } = await supabase.storage
                .from('payment-screenshots')
                .upload(fileName, file, {
                    cacheControl: '3600',
                    upsert: false,
                    contentType: file.type
                });

            if (uploadError) {
                showToast("Upload failed: " + uploadError.message);
                isSubmittingCoachRequest = false;
                return;
            }

            const { data: publicData } = supabase.storage
                .from('payment-screenshots')
                .getPublicUrl(fileName);

            screenshot_url = publicData.publicUrl;
        }

        const saved = await saveCoachingRequest(method, referenceNumber, screenshot_url);
        if (!saved) { isSubmittingCoachRequest = false; return; }

        qrModal.style.display = 'none';
        cashModal.style.display = 'none';
        resetQRModal();

        const packageSessions = selectedPackageSessions ?? 1;
        const packageLabel = packageSessions === 1 ? "Single Session" : `${packageSessions}-Session Package`;
        const statusText = method === "Cash" ? "Pending Counter Payment" : "Awaiting Verification";

        const hasCourtFee = saved.courtFee !== null && saved.courtFee !== undefined;

        document.getElementById("successDetails").innerHTML = `
            <div class="receipt-details">
                <div class="receipt-row"><span class="receipt-label">Reference No.</span><span class="receipt-value">${referenceNumber}</span></div>
                <div class="receipt-row"><span class="receipt-label">Coach</span><span class="receipt-value">${selectedCoach.name}</span></div>
                <div class="receipt-row"><span class="receipt-label">Package</span><span class="receipt-value">${packageLabel}</span></div>
                <div class="receipt-row"><span class="receipt-label">Method</span><span class="receipt-value">${method}</span></div>
                ${hasCourtFee ? `
                <div class="receipt-row"><span class="receipt-label">Court Reservation Fee</span><span class="receipt-value receipt-amount">₱${Number(saved.courtFee).toFixed(2)}</span></div>
                <div class="receipt-row" style="opacity:.7;"><span class="receipt-label">Coach Session Fee (pay at session)</span><span class="receipt-value">₱${Number(saved.coachFee).toFixed(2)}</span></div>
                ` : `
                <div class="receipt-row"><span class="receipt-label">Amount</span><span class="receipt-value receipt-amount">₱${Number(saved.amount).toFixed(2)}</span></div>
                `}
            </div>
            <div class="status-badge status-pending"><i class='bx bx-time'></i> ${statusText}</div>
        `;

        successModal.style.display = 'flex';
        await loadCoaches();
    } catch (err) {
        console.error(err);
        showToast("Something went wrong.");
    } finally {
        isSubmittingCoachRequest = false;
    }
}

// ─── ASSESSMENT BATCHES ──────────────────────────────────────────────────────
async function loadAssessmentBatches() {
    const container = document.getElementById('assessmentBatchList');
    if (!container) return;

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const today = getLocalDateString();

    const { data: batches, error } = await supabase
        .from('assessment_batches')
        .select('*, profiles!assessment_batches_coach_id_fkey(full_name)')
        .eq('status', 'open')
        .gte('schedule_date', today)
        .order('schedule_date', { ascending: true });

    if (error || !batches?.length) {
        container.innerHTML = `<p class="no-posts-text">No open assessments yet.</p>`;
        return;
    }

    const batchIds = batches.map(b => b.id);
    
    const [myAppsRes, confirmedCountsRes, myAssessmentRes] = await Promise.all([
        supabase.from('assessment_applications').select('batch_id, status').eq('player_id', user.id).in('batch_id', batchIds),
        supabase.from('assessment_applications').select('batch_id').in('batch_id', batchIds).eq('status', 'confirmed'),
        supabase.from('player_assessments').select('id, final_level, suggested_level, coach_feedback, assessed_at').eq('player_id', user.id).order('assessed_at', { ascending: false }).limit(1).maybeSingle()
    ]);

    const myApps = myAppsRes.data || [];
    const confirmedCounts = confirmedCountsRes.data || [];
    const myAssessment = myAssessmentRes.data;

    const myAppMap = {};
    myApps.forEach(app => {
        myAppMap[app.batch_id] = app.status;
    });

    const confirmedMap = {};
    confirmedCounts.forEach(a => {
        confirmedMap[a.batch_id] = (confirmedMap[a.batch_id] || 0) + 1;
    });

    container.innerHTML = batches.map(batch => {
        const formattedDate = new Date(batch.schedule_date + 'T00:00:00')
            .toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric', year: 'numeric' });

        const appStatus = myAppMap[batch.id];
        const isFull = (confirmedMap[batch.id] || 0) >= batch.max_slots;

        let actionBtn = '';
        if (appStatus === 'confirmed') {
            if (myAssessment) {
                actionBtn = `
                    <button class="assess-status confirmed view-assessment-btn" style="cursor:pointer;">
                        ✅ Confirmed — View Result
                    </button>`;
            } else {
                actionBtn = `<span class="assess-status confirmed">✅ Confirmed</span>`;
            }
        } else if (appStatus === 'pending') {
            actionBtn = `<span class="assess-status pending">⏳ Applied</span>`;
        } else if (appStatus === 'declined') {
            actionBtn = `<span class="assess-status declined">❌ Declined</span>`;
        } else if (isFull) {
            actionBtn = `<span class="assess-status full">Full</span>`;
        } else {
            actionBtn = `
                <button class="apply-batch-btn"
                    data-id="${batch.id}"
                    data-date="${formattedDate}"
                    data-time="${formatTimeRange12h(batch.schedule_time)}"
                    data-coach="${batch.profiles?.full_name || 'Coach'}">
                    Apply
                </button>`;
        }

        const confirmedSoFar = confirmedMap[batch.id] || 0;

        return `
            <div class="assess-batch-card">
                <div class="assess-batch-info">
                    <span class="assess-coach-name">
                        <i class='bx bx-user'></i> ${batch.profiles?.full_name || 'Coach'}
                    </span>
                    <span class="assess-date">${formattedDate}</span>
                    <span class="assess-time">
                        <i class='bx bx-time'></i> ${formatTimeRange12h(batch.schedule_time)}
                    </span>
                    <span class="assess-slots">${confirmedSoFar}/${batch.max_slots} slots filled</span>
                </div>
                <div class="assess-action">${actionBtn}</div>
            </div>`;
    }).join('');

    container.querySelectorAll('.apply-batch-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            pendingBatchId = btn.dataset.id;
            document.getElementById('applyAssessmentDetails').innerHTML = `
                <div style="background:#f0fdf4;border-radius:10px;padding:14px;text-align:left;">
                    <p style="margin:0 0 6px;font-size:13px;color:#6b7280;">Coach</p>
                    <p style="margin:0 0 12px;font-size:15px;font-weight:700;">👤 ${btn.dataset.coach}</p>
                    <p style="margin:0 0 6px;font-size:13px;color:#6b7280;">Date</p>
                    <p style="margin:0 0 12px;font-size:15px;font-weight:600;">📅 ${btn.dataset.date}</p>
                    <p style="margin:0 0 6px;font-size:13px;color:#6b7280;">Time</p>
                    <p style="margin:0;font-size:15px;font-weight:600;">🕐 ${btn.dataset.time}</p>
                </div>`;
            document.getElementById('applyAssessmentModal').style.display = 'flex';
        });
    });

    if (myAssessment) {
        container.querySelectorAll('.view-assessment-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const assessDate = new Date(myAssessment.assessed_at).toLocaleDateString('en-PH', {
                    month: 'long', day: 'numeric', year: 'numeric', timeZone: 'Asia/Manila'
                });

                const levelColors = {
                    'Advanced':      '#16a34a',
                    'Intermediate':  '#d97706',
                    'Beginner':      '#2563eb',
                    'Not Qualified': '#dc2626',
                };
                const levelColor = levelColors[myAssessment.final_level] || '#374151';

                document.getElementById('assessmentResultContent').innerHTML = `
                    <div style="text-align:center;margin-bottom:20px;">
                        <p style="font-size:12px;color:#6b7280;margin:0;">Assessed on ${assessDate}</p>
                        <div style="display:inline-block;margin-top:10px;padding:10px 28px;border-radius:20px;background:${levelColor}20;border:2px solid ${levelColor};">
                            <span style="font-size:18px;font-weight:800;color:${levelColor};">
                                ${myAssessment.final_level}
                            </span>
                        </div>
                    </div>

                    ${myAssessment.coach_feedback ? `
                        <div style="background:#f0fdf4;border-radius:10px;padding:16px;margin-top:8px;">
                            <p style="font-size:12px;font-weight:700;color:#374151;margin:0 0 8px;">
                                <i class='bx bx-comment-detail'></i> Coach Feedback
                            </p>
                            <p style="font-size:13px;color:#4b5563;margin:0;line-height:1.6;">
                                ${myAssessment.coach_feedback}
                            </p>
                        </div>
                    ` : `
                        <div style="text-align:center;padding:16px;">
                            <p style="font-size:13px;color:#9ca3af;">No feedback from coach yet.</p>
                        </div>
                    `}
                `;

                document.getElementById('assessmentResultModal').style.display = 'flex';
            });
        });
    }
}

async function applyToAssessmentBatch() {
    if (!pendingBatchId) return;

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const btn = document.getElementById('confirmApplyBtn');
    btn.disabled = true;
    btn.textContent = 'Applying...';

    const { data: existing } = await supabase
        .from('assessment_applications')
        .select('id')
        .eq('batch_id', pendingBatchId)
        .eq('player_id', user.id)
        .limit(1);

    if (existing?.length) {
        showToast("You already applied to this batch.");
        document.getElementById('applyAssessmentModal').style.display = 'none';
        btn.disabled = false;
        btn.textContent = 'Confirm Apply';
        pendingBatchId = null;
        return;
    }

    const { error } = await supabase
        .from('assessment_applications')
        .insert({ batch_id: pendingBatchId, player_id: user.id, status: 'pending' });

    btn.disabled = false;
    btn.textContent = 'Confirm Apply';
    document.getElementById('applyAssessmentModal').style.display = 'none';

    if (error) {
        showToast("Failed to apply. Please try again.");
        console.error(error);
    } else {
        showToast("Applied successfully! Wait for the coach to confirm.");
        await loadAssessmentBatches();
    }

    pendingBatchId = null;
}

// ─── PLAYER POST SCHEDULE ─────────────────────────────────────────────────────

async function savePlayerPost() {
    if (isSubmittingPost) return;

    const date = document.getElementById("postDate")?.value;
    const endDate = document.getElementById("postEndDate")?.value || null;
    const startTime = document.getElementById("postStartTime")?.value;
    const endTime = document.getElementById("postEndTime")?.value;
    const notes = document.getElementById("postNotes")?.value || "";
    const preference = 'solo';

    if (!date || !startTime || !endTime) {
        showToast("Please fill all required fields.");
        return;
    }

    if (startTime >= endTime) {
        showToast("End time must be later than start time.");
        return;
    }

    if (endDate && endDate < date) {
        showToast("End date cannot be before start date.");
        return;
    }

    const { data: authRes } = await supabase.auth.getUser();
    const user = authRes?.user;

    if (!user) {
        showToast("Please login first.");
        return;
    }

    isSubmittingPost = true;
    const savePostBtn = document.getElementById("savePostBtn");
    const originalBtnText = savePostBtn ? savePostBtn.textContent : null;
    if (savePostBtn) {
        savePostBtn.disabled = true;
        savePostBtn.textContent = "Posting...";
    }

    try {
        const { data: existingPosts, error: checkError } = await supabase
            .from("player_schedule_posts")
            .select("id, preferred_date, preferred_start, preferred_end, status")
            .eq("player_id", user.id)
            .eq("preferred_date", date)
            .in("status", ["open"]);

        if (checkError) {
            console.error("Overlap check failed:", checkError);
            showToast("Failed to validate existing schedules.");
            return;
        }

        const hasOverlap = (existingPosts || []).some(post => {
            return startTime < post.preferred_end && endTime > post.preferred_start;
        });

        if (hasOverlap) {
            showToast("You already posted a schedule that overlaps with this time.");
            return;
        }

        const insertPayload = {
            player_id: user.id,
            preferred_date: date,
            preferred_start: startTime,
            preferred_end: endTime,
            session_preference: preference,
            notes: notes,
            status: 'open'
        };

        if (endDate) {
            insertPayload.preferred_end_date = endDate;
        }

        const { error } = await supabase
            .from("player_schedule_posts")
            .insert([insertPayload]);

        if (error) {
            console.error(error);
            showToast("Failed to save coaching request.");
            return;
        }

        document.getElementById("postScheduleModal").style.display = "none";
        document.getElementById("postDate").value = "";
        document.getElementById("postEndDate").value = "";
        document.getElementById("postStartTime").value = "";
        document.getElementById("postEndTime").value = "";
        document.getElementById("postNotes").value = "";

        showToast("Schedule posted! Coaches can now see and claim your slot.");

        await loadMyPostedSchedules();
    } finally {
        isSubmittingPost = false;
        if (savePostBtn) {
            savePostBtn.disabled = false;
            savePostBtn.textContent = originalBtnText;
        }
    }
}

async function loadMyPostedSchedules() {
    const container = document.getElementById("myPostedSchedules");
    if (!container) return;

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const [postsRes, bookingsRes] = await Promise.all([
        supabase
            .from("player_schedule_posts")
            .select(`
                *,
                claimed_coach:profiles!player_schedule_posts_claimed_by_fkey(
                    id, full_name
                )
            `)
            .eq("player_id", user.id)
            .order("preferred_date", { ascending: true }),
        supabase
            .from("coaching_requests")
            .select(`
                id, coach_name, request_type, session_date, session_time,
                amount, status, payment_method, post_id, package_sessions, created_at
            `)
            .eq("player_id", user.id)
            .not("session_date", "is", null)
            .order("session_date", { ascending: true })
    ]);

    if (postsRes.error || bookingsRes.error) {
        container.innerHTML = `<p class="no-posts-text">Failed to load schedules.</p>`;
        return;
    }

    const today = getLocalDateString();
    const posts = postsRes.data || [];
    const bookings = (bookingsRes.data || []).filter(b => !b.package_sessions);

    // Kapag may booking na galing sa post, booking na lang ang ipapakita (para walang duplicate)
    const postIdsWithBooking = new Set(bookings.map(b => b.post_id).filter(Boolean));

    const postItems = posts
        .filter(post => !postIdsWithBooking.has(post.id))
        .map(post => ({
            source: "post",
            id: post.id,
            date: post.preferred_date,
            start: post.preferred_start,
            end: post.preferred_end,
            status: post.status,
            notes: post.notes,
            endDate: post.preferred_end_date,
            claimedCoach: post.claimed_coach?.full_name || null,
            upcoming: (post.preferred_end_date || post.preferred_date) >= today
        }));

    const bookingItems = bookings.map(b => ({
        source: "booking",
        id: b.id,
        date: b.session_date,
        time: b.session_time,
        coach: b.coach_name,
        requestType: b.request_type,
        status: b.status,
        amount: b.amount,
        paymentMethod: b.payment_method,
        fromPost: !!b.post_id,
        upcoming: isScheduleStillUpcoming(b.session_date, b.session_time)
    }));

    // Upcoming muna (pinakamalapit una), tapos past (pinakabago una)
    const allItems = [...postItems, ...bookingItems].sort((a, b) => {
        if (a.upcoming !== b.upcoming) return a.upcoming ? -1 : 1;
        const diff = new Date(a.date) - new Date(b.date);
        return a.upcoming ? diff : -diff;
    });

    if (!allItems.length) {
        container.innerHTML = `<p class="no-posts-text">No schedules yet.</p>`;
        return;
    }

    container.innerHTML = allItems.map(item => {
        const formattedDate = new Date(item.date + "T00:00:00")
            .toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });

        if (item.source === "post") {
            let endDateLabel = "";
            if (item.endDate) {
                const formattedEnd = new Date(item.endDate + "T00:00:00")
                    .toLocaleDateString("en-US", { month: "short", day: "numeric" });
                endDateLabel = ` – ${formattedEnd}`;
            }

            const displayNotes = (item.notes || "").replace(/\[Until: \d{4}-\d{2}-\d{2}\]\s?/, "").trim();

            let statusColor = "#6b7280";
            let statusLabel = "⏳ Waiting for Coach";
            if (item.status === "claimed") { statusColor = "#16a34a"; statusLabel = "✓ Claimed by Coach"; }
            else if (item.status === "cancelled") { statusColor = "#9ca3af"; statusLabel = "Cancelled"; }

            return `
                <div class="my-post-card">
                    <div class="my-post-row">
                        <span class="my-post-date">Posted Schedule • ${formattedDate}${endDateLabel}</span>
                        <span style="font-size:11px; font-weight:700; color:${statusColor};">${statusLabel}</span>
                    </div>
                    <div class="my-post-time">${formatTime12h(item.start)} – ${formatTime12h(item.end)}</div>
                    ${item.status === "claimed" && item.claimedCoach ? `<div style="font-size:12px; color:#374151; margin-top:6px;">Coach: <strong>${item.claimedCoach}</strong></div>` : ""}
                    ${displayNotes ? `<div style="font-size:11px; color:#9ca3af; margin-top:4px;">${displayNotes}</div>` : ""}
                    ${item.status === "open" ? `<div class="cancel-post-wrap"><button class="cancel-post-btn" data-id="${item.id}">Cancel</button></div>` : ""}
                </div>
            `;
        }

        const statusInfo = getBookingStatusInfo(item.status);

        return `
            <div class="my-post-card">
                <div class="my-post-row">
                    <span class="my-post-date">${item.fromPost ? "Posted Schedule (Coach Claimed)" : "Booking Request"} • ${formattedDate}</span>
                    <span style="font-size:11px; font-weight:700; color:${statusInfo.color};">${statusInfo.label}</span>
                </div>
                <div class="my-post-time">${item.time || "-"}</div>
                <div style="font-size:12px; color:#374151; margin-top:6px;">Coach: <strong>${item.coach || "Coach"}</strong></div>
                <div style="font-size:11px; color:#6b7280; margin-top:4px;">${item.requestType || "Individual Session"} • ${item.paymentMethod || "-"} • ₱${Number(item.amount || 0).toLocaleString()}</div>
            </div>
        `;
    }).join("");

    container.querySelectorAll(".cancel-post-btn").forEach(btn => {
        btn.addEventListener("click", async () => {
            btn.disabled = true;
            btn.textContent = "Cancelling...";

            const { error } = await supabase
                .from("player_schedule_posts")
                .update({ status: "cancelled" })
                .eq("id", btn.dataset.id)
                .eq("player_id", user.id);

            if (error) {
                console.error(error);
                showToast("Failed to cancel schedule.");
                btn.disabled = false;
                btn.textContent = "Cancel";
                return;
            }

            await loadMyPostedSchedules();
        });
    });
}

function getBookingStatusInfo(status) {
    const map = {
        coach_claimed: { label: "Coach Claimed – Complete Booking", color: "#7c3aed" },
        pending: { label: " Pending Payment", color: "#d97706" },
        pending_verification: { label: "Pending Verification", color: "#2563eb" },
        accepted: { label: "Accepted", color: "#16a34a" },
        declined: { label: "Declined / Cancelled", color: "#dc2626" },
        cancelled: { label: "Cancelled", color: "#dc2626" },
        completed: { label: "Completed", color: "#475569" }
    };
    return map[status] || { label: status || "Unknown", color: "#6b7280" };
}

// ─── REALTIME ─────────────────────────────────────────────────────────────────

async function setupRealtimePlayerRequestNotifications() {
    const { data: authData } = await supabase.auth.getUser();
    const user = authData?.user;
    if (!user) return;

    const { data: existingRows } = await supabase
        .from("coaching_requests")
        .select("id, status")
        .eq("player_id", user.id);

    (existingRows || []).forEach(row => lastSeenStatusMap.set(row.id, row.status));

    if (playerRequestChannel) supabase.removeChannel(playerRequestChannel);

    playerRequestChannel = supabase
        .channel(`player-request-status-${user.id}`)
        .on("postgres_changes", {
            event: "*", schema: "public", table: "coaching_requests",
            filter: `player_id=eq.${user.id}`
        }, async (payload) => {
            const row = payload.new;
            if (!row) return;
            const oldStatus = lastSeenStatusMap.get(row.id);
            lastSeenStatusMap.set(row.id, row.status);
            if (oldStatus !== row.status) {
                if (row.status === "accepted") showToast(`Your request with ${row.coach_name} was accepted.`);
                else if (row.status === "declined") showToast(`Your request with ${row.coach_name} was declined.`);
                else if (row.status === "coach_claimed") showToast(`A coach claimed your schedule post! Complete your booking.`);
            }
            await loadCoaches();
            if (bookingModal.style.display === "flex" && selectedCoach) await loadCoachSlots();
        })
        .subscribe();
}

async function setupRealtimeNotificationBell() {
    const { data: authData } = await supabase.auth.getUser();
    const user = authData?.user;
    if (!user) return;

    if (notificationChannel) supabase.removeChannel(notificationChannel);

    notificationChannel = supabase
        .channel(`player-notifications-${user.id}`)
        .on("postgres_changes", {
            event: "INSERT", schema: "public", table: "notifications",
            filter: `user_id=eq.${user.id}`
        }, async (payload) => {
            if (payload.new?.message) showToast(payload.new.message);
            await loadCoaches();
            await loadMyPostedSchedules();
            await loadMyPackageSessions();
            if (bookingModal.style.display === "flex" && selectedCoach) await loadCoachSlots();
        })
        .subscribe();
}

function subscribeToCoachAvailability() {
    if (!selectedCoach) return;
    if (availabilityChannel) supabase.removeChannel(availabilityChannel);
    availabilityChannel = supabase
        .channel(`coach-availability-${selectedCoach.id}`)
        .on("postgres_changes", {
            event: "*", schema: "public", table: "coach_availability",
            filter: `coach_id=eq.${selectedCoach.id}`
        }, async () => {
            if (bookingModal.style.display === "flex") await loadCoachSlots();
            await loadCoaches();
        })
        .subscribe();
}

async function setupRealtimeCoachList() {
    if (coachListChannel) supabase.removeChannel(coachListChannel);
    coachListChannel = supabase
        .channel("coach-list-realtime")
        .on("postgres_changes", { event: "*", schema: "public", table: "coach_availability" }, async () => {
            await loadCoaches();
            if (bookingModal.style.display === "flex" && selectedCoach) await loadCoachSlots();
        })
        .subscribe();
}

// ─── MY PACKAGE SESSIONS (PLAYER) ─────────────────────────────────────────────

async function loadMyPackageSessions() {
    const container = document.getElementById('myPackageSessionsList');
    if (!container) return;

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const { data: requests, error } = await supabase
        .from('coaching_requests')
        .select('id, coach_name, package_sessions, amount, status')
        .eq('player_id', user.id)
        .eq('status', 'accepted')
        .not('package_sessions', 'is', null)
        .order('created_at', { ascending: false });

    if (error || !requests?.length) {
        container.innerHTML = `<p class="no-posts-text">No active package sessions yet.</p>`;
        return;
    }

    const requestIds = requests.map(r => r.id);
    const { data: sessions } = await supabase
        .from('package_sessions')
        .select('*')
        .in('request_id', requestIds)
        .order('session_number', { ascending: true });

    const sessionMap = {};
    (sessions || []).forEach(s => {
        if (!sessionMap[s.request_id]) sessionMap[s.request_id] = [];
        sessionMap[s.request_id].push(s);
    });

    container.innerHTML = requests.map(req => {
        const reqSessions = sessionMap[req.id] || [];
        const total       = req.package_sessions;
        const completed   = reqSessions.filter(s => s.status === 'completed').length;
        const scheduled   = reqSessions.filter(s => s.status === 'scheduled').length;
        const unscheduled = total - completed - scheduled;
        const progressPct = total ? Math.round((completed / total) * 100) : 0;
        
        const sortedSessions = [...reqSessions].sort((a, b) => {
            const aDone = a.status === 'completed';
            const bDone = b.status === 'completed';
            if (aDone === bDone) return a.session_number - b.session_number;
            return aDone ? 1 : -1;
        });

        const sessionRows = sortedSessions.map(s => {
            const hasSchedule = s.session_date && s.session_time;
            const statusClass = s.status === 'completed' ? 'done' : hasSchedule ? 'scheduled' : 'unscheduled';
            const statusLabel = s.status === 'completed' ? '✓ Done' : hasSchedule ? '📅 Scheduled' : 'Unscheduled';
            const dateLabel   = hasSchedule
                ? `${new Date(s.session_date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })} · ${formatTime12h(s.session_time)}`
                : 'No schedule yet';

            return `
                <div class="pkg-session-row">
                    <div>
                        <div class="pkg-session-label">Session ${s.session_number}</div>
                        <div class="pkg-session-date">${dateLabel}</div>
                    </div>
                    <span class="pkg-status ${statusClass}">${statusLabel}</span>
                </div>
            `;
        }).join('');

        return `
            <div class="pkg-session-card">
                <div class="pkg-session-header" onclick="
                    const b=this.nextElementSibling;
                    const c=this.querySelector('.pkg-chevron');
                    const open=b.style.display!=='none';
                    b.style.display=open?'none':'block';
                    c.style.transform=open?'rotate(0deg)':'rotate(180deg)';
                ">
                    <div>
                        <div style="font-size:15px;font-weight:700;color:#111827;">${req.coach_name}</div>
                        <div style="font-size:12px;color:#6b7280;margin-top:2px;">${total}-Session Package</div>
                    </div>
                    <div class="pkg-session-status">
                        <div class="pkg-chip-group">
                            ${scheduled > 0 ? `<span class="pkg-chip pkg-chip-scheduled">${scheduled} scheduled</span>` : ''}
                            ${unscheduled > 0 ? `<span class="pkg-chip pkg-chip-unscheduled">${unscheduled} unscheduled</span>` : ''}
                            ${completed > 0 ? `<span class="pkg-chip pkg-chip-done">${completed} done</span>` : ''}
                        </div>
                        <i class='bx bx-chevron-down pkg-chevron' style="font-size:18px;color:#6b7280;transition:transform 0.2s;"></i>
                    </div>
                </div>
                <div class="pkg-session-body" style="display:none;">
                    <div class="pkg-progress-labels">
                        <span>Progress</span>
                        <span>${completed}/${total} completed</span>
                    </div>
                    <div class="pkg-progress-track">
                        <div class="pkg-progress-fill" style="width:${progressPct}%"></div>
                    </div>
                    ${sessionRows}
                </div>
            </div>
        `;
    }).join('');
}

// ─── HELPERS ─────────────────────────────────────────────────────────────────
function isScheduleStillUpcoming(dateStr, timeRange) {
    if (!dateStr) return false;

    const now = new Date();
    const today = getLocalDateString();

    if (dateStr > today) return true;
    if (dateStr < today) return false;

    if (!timeRange) return true;

    const endTimeText = timeRange.split("-")[1]?.trim();
    if (!endTimeText) return true;

    const endDateTime = new Date(`${dateStr} ${endTimeText}`);

    return endDateTime >= now;
}

function generateCoachingReference() {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, "0");
    const d = String(now.getDate()).padStart(2, "0");
    const rand = Math.floor(100000 + Math.random() * 900000);
    return `COACH-${y}${m}${d}-${rand}`;
}

function formatTime12h(timeStr) {
    if (!timeStr) return "";
    let [hours, minutes] = timeStr.split(":");
    hours = Number(hours);
    const ampm = hours >= 12 ? "PM" : "AM";
    hours = hours % 12 || 12;
    return `${hours < 10 ? "0" + hours : hours}:${minutes} ${ampm}`;
}

function formatTimeRange12h(rangeStr) {
    if (!rangeStr) return "";
    const parts = rangeStr.split("-").map(p => p.trim());
    if (parts.length !== 2) return formatTime12h(rangeStr);
    return `${formatTime12h(parts[0])} - ${formatTime12h(parts[1])}`;
}

function formatDateChip(dateStr) {
    return new Date(dateStr).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function closeModal() {
    [bookingModal, qrModal, cashModal, successModal].forEach(m => { if (m) m.style.display = "none"; });
    if (bookingForm) bookingForm.reset();
    const refInput = document.getElementById("referenceNumberInput");
    const refError = document.getElementById("refError");
    if (refInput) refInput.value = "";
    if (refError) refError.style.display = "none";
    if (availabilityChannel) { supabase.removeChannel(availabilityChannel); availabilityChannel = null; }
    resetBookingChoices();
    selectedCoach = null;
}

function backToBooking(currentModalId) {
    const modal = document.getElementById(currentModalId);
    if (modal) modal.style.display = "none";
    bookingModal.style.display = "flex";
}

function showToast(message) {
    const old = document.getElementById("globalToast");
    if (old) old.remove();
    const toast = document.createElement("div");
    toast.id = "globalToast";
    toast.textContent = message;
    toast.style.cssText = `position:fixed;top:20px;right:20px;background:#16a34a;color:white;padding:12px 16px;border-radius:10px;box-shadow:0 10px 25px rgba(0,0,0,0.15);z-index:99999;font-size:14px;font-weight:600;max-width:320px;`;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 3500);
}

window.onclick = (event) => { if (event.target.classList.contains("modal")) closeModal(); };
window.openBookingModal = openBookingModal;
window.backToBooking = backToBooking;
window.processFinalPayment = processFinalPayment;
window.closeModal = closeModal;