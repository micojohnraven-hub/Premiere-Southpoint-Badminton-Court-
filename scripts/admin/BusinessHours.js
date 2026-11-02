// ─── IMPORTS ───
import { supabase } from "../supabase/supabaseClient.js";
import { saveLog } from "../../scripts/sysAdmin/sysLogs.js";

// ─── CONSTANTS ───
const listEl = document.getElementById("businessHoursList");
const saveBtn = document.getElementById("saveHoursBtn");

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const DISPLAY_ORDER = [1, 2, 3, 4, 5, 6, 0];
const DEFAULT_OPEN = "08:00";
const DEFAULT_CLOSE = "22:00";

let rowsByDay = new Map();
let isoWeek = false;
let timeStyle = { mode: "24", pad: true };

// ─── STYLES ───
const style = document.createElement("style");
style.textContent = `
    .hours-controls { display: flex; align-items: center; justify-content: flex-end; flex-wrap: wrap; gap: 0.6rem; }
    .hours-controls .settings-input { width: 130px; }
    .hours-closed { display: flex; align-items: center; gap: 0.4rem; font-weight: 600; cursor: pointer; }
`;
document.head.appendChild(style);

// ─── TOAST ───
function showToast(message, type = "info") {
    document.getElementById("hoursToast")?.remove();

    const colors = {
        success: "#16a34a",
        error: "#ef4444",
        warning: "#f59e0b",
        info: "#3b82f6"
    };

    const toast = document.createElement("div");
    toast.id = "hoursToast";
    toast.textContent = message;
    toast.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        z-index: 99999;
        max-width: 320px;
        padding: 12px 16px;
        color: #fff;
        background: ${colors[type] || colors.info};
        border-radius: 10px;
        box-shadow: 0 10px 25px rgba(0, 0, 0, .15);
        font-size: 14px;
        font-weight: 600;
    `;

    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 3500);
}

// ─── TIME HELPERS ───
function toMinutes(value) {
    const match = String(value || "").trim().match(/^(\d{1,2}):(\d{2})(?::\d{2})?\s*(am|pm)?$/i);
    if (!match) return null;
    let hours = Number(match[1]);
    const meridiem = match[3] ? match[3].toLowerCase() : null;
    if (meridiem === "pm" && hours < 12) hours += 12;
    if (meridiem === "am" && hours === 12) hours = 0;
    return hours * 60 + Number(match[2]);
}

function toInputValue(value, fallback) {
    const minutes = toMinutes(value);
    if (minutes === null) return fallback;
    const hh = String(Math.floor(minutes / 60)).padStart(2, "0");
    const mm = String(minutes % 60).padStart(2, "0");
    return `${hh}:${mm}`;
}

function detectTimeStyle(rows) {
    const sample = rows.map(r => r.open_time).find(Boolean) || "";
    if (/am|pm/i.test(sample)) return { mode: "12", pad: /^0\d/.test(sample) };
    if (/^\d{1,2}:\d{2}:\d{2}$/.test(sample)) return { mode: "seconds", pad: /^0\d/.test(sample) };
    return { mode: "24", pad: !/^\d:/.test(sample) };
}

function formatForDb(inputValue) {
    const [h, m] = inputValue.split(":").map(Number);
    if (timeStyle.mode === "12") {
        const hours12 = h % 12 === 0 ? 12 : h % 12;
        const hh = timeStyle.pad ? String(hours12).padStart(2, "0") : String(hours12);
        return `${hh}:${String(m).padStart(2, "0")} ${h >= 12 ? "PM" : "AM"}`;
    }
    const hh = timeStyle.pad ? String(h).padStart(2, "0") : String(h);
    const base = `${hh}:${String(m).padStart(2, "0")}`;
    return timeStyle.mode === "seconds" ? `${base}:00` : base;
}

function dbToDay(dayOfWeek) {
    return isoWeek ? dayOfWeek % 7 : dayOfWeek;
}

function dayToDb(day) {
    return isoWeek ? (day === 0 ? 7 : day) : day;
}

// ─── RENDER ───
function renderRows() {
    listEl.innerHTML = DISPLAY_ORDER.map(day => {
        const row = rowsByDay.get(day);
        const closed = row ? Boolean(row.is_closed) : false;
        const open = toInputValue(row?.open_time, DEFAULT_OPEN);
        const close = toInputValue(row?.close_time, DEFAULT_CLOSE);

        return `
            <div class="settings-form-row" data-day="${day}">
                <div class="row-info">
                    <h4>${DAY_NAMES[day]}</h4>
                    <p>${row ? "Opening and closing time." : "Not set yet. Save to add this day."}</p>
                </div>

                <div class="hours-controls">
                    <label class="hours-closed">
                        <input type="checkbox" class="hours-closed-input" ${closed ? "checked" : ""}>
                        Closed
                    </label>
                    <input type="time" class="settings-input hours-open" value="${open}" ${closed ? "disabled" : ""}>
                    <span>to</span>
                    <input type="time" class="settings-input hours-close" value="${close}" ${closed ? "disabled" : ""}>
                </div>
            </div>
        `;
    }).join("");
}

// ─── LOAD ───
async function loadHours() {
    if (!listEl || !saveBtn) return;

    const { data, error } = await supabase
        .from("business_hours")
        .select("*")
        .order("day_of_week", { ascending: true });

    if (error) {
        console.error("Failed to load business hours:", error);
        listEl.innerHTML = '<p class="settings-note">Failed to load business hours.</p>';
        return;
    }

    const rows = data || [];
    isoWeek = rows.some(r => r.day_of_week === 7);
    timeStyle = detectTimeStyle(rows);
    rowsByDay = new Map(rows.map(r => [dbToDay(r.day_of_week), r]));

    renderRows();
}

// ─── SAVE ───
function collectRows() {
    return [...listEl.querySelectorAll("[data-day]")].map(el => ({
        day: Number(el.dataset.day),
        closed: el.querySelector(".hours-closed-input").checked,
        open: el.querySelector(".hours-open").value || DEFAULT_OPEN,
        close: el.querySelector(".hours-close").value || DEFAULT_CLOSE
    }));
}

async function saveHours() {
    const entries = collectRows();

    for (const entry of entries) {
        if (!entry.closed && toMinutes(entry.close) <= toMinutes(entry.open)) {
            showToast(`Closing time must be later than opening time on ${DAY_NAMES[entry.day]}.`, "warning");
            return;
        }
    }

    const operations = [];
    const changedDays = [];

    entries.forEach(entry => {
        const payload = {
            open_time: formatForDb(entry.open),
            close_time: formatForDb(entry.close),
            is_closed: entry.closed
        };
        const existing = rowsByDay.get(entry.day);

        if (!existing) {
            changedDays.push(DAY_NAMES[entry.day]);
            operations.push(
                supabase.from("business_hours").insert({ day_of_week: dayToDb(entry.day), ...payload })
            );
            return;
        }

        const same =
            toMinutes(existing.open_time) === toMinutes(payload.open_time) &&
            toMinutes(existing.close_time) === toMinutes(payload.close_time) &&
            Boolean(existing.is_closed) === payload.is_closed;

        if (same) return;

        changedDays.push(DAY_NAMES[entry.day]);
        operations.push(
            supabase.from("business_hours").update(payload).eq("id", existing.id)
        );
    });

    if (!operations.length) {
        showToast("No business hour changes were made.", "info");
        return;
    }

    saveBtn.disabled = true;
    saveBtn.textContent = "Saving...";

    const results = await Promise.all(operations);
    const failed = results.find(result => result.error);

    saveBtn.disabled = false;
    saveBtn.textContent = "Save Business Hours";

    if (failed) {
        console.error(failed.error);
        showToast("Failed to save business hours: " + failed.error.message, "error");
        await loadHours();
        return;
    }

    await saveLog(
        "SETTINGS",
        `Updated business hours for ${changedDays.join(", ")}.`,
        "System Admin",
        "info"
    );

    showToast("Business hours updated successfully.", "success");
    await loadHours();
}

// ─── EVENTS ───
listEl?.addEventListener("change", event => {
    const checkbox = event.target.closest(".hours-closed-input");
    if (!checkbox) return;

    const row = checkbox.closest("[data-day]");
    row.querySelector(".hours-open").disabled = checkbox.checked;
    row.querySelector(".hours-close").disabled = checkbox.checked;
});

saveBtn?.addEventListener("click", saveHours);

// ─── INIT ───
loadHours();