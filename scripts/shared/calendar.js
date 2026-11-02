import { GOOGLE_TOKEN_KEY } from "../supabase/supabaseClient.js";

// ─── CONFIG ───
const CALENDAR_BASE = "https://www.googleapis.com/calendar/v3/calendars/primary/events";
const TIME_ZONE = "Asia/Manila";
const VENUE_NAME = "Premiere Southpoint Badminton Court";

// ─── TOKEN ───
export function getGoogleToken() {
    return sessionStorage.getItem(GOOGLE_TOKEN_KEY);
}

export function hasGoogleCalendarAccess() {
    return Boolean(getGoogleToken());
}

export function clearGoogleToken() {
    sessionStorage.removeItem(GOOGLE_TOKEN_KEY);
}

// ─── EVENT BUILDER ───
function toISO(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
        throw new Error("Invalid reservation date or time.");
    }
    return date.toISOString();
}

function buildEvent({ courtName, startISO, endISO, notes }) {
    const event = {
        summary: `Badminton ${courtName} - Premiere Southpoint`,
        location: VENUE_NAME,
        start: { dateTime: toISO(startISO), timeZone: TIME_ZONE },
        end: { dateTime: toISO(endISO), timeZone: TIME_ZONE },
        reminders: {
            useDefault: false,
            overrides: [
                { method: "popup", minutes: 60 },
                { method: "email", minutes: 1440 }
            ]
        }
    };

    if (notes) event.description = notes;
    return event;
}

// ─── CALENDAR REQUEST ───
async function calendarRequest(method, path, body) {
    const token = getGoogleToken();
    if (!token) {
        throw new Error("Not signed in with Google, so the calendar was skipped.");
    }

    const res = await fetch(`${CALENDAR_BASE}${path}`, {
        method,
        headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json"
        },
        body: body ? JSON.stringify(body) : undefined
    });

    if (res.status === 204) return null;

    if (method === "DELETE" && (res.status === 404 || res.status === 410)) {
        return null;
    }

    if (res.status === 401) {
        clearGoogleToken();
        throw new Error("Google session expired. Sign in with Google again.");
    }

    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error?.message ?? `Calendar request failed (${res.status}).`);
    }

    return res.json();
}

async function safely(action) {
    try {
        return await action();
    } catch (err) {
        console.warn("Google Calendar:", err.message);
        return null;
    }
}

// ─── PUBLIC API ───
export async function addReservationToCalendar(reservation) {
    return safely(async () => {
        const event = await calendarRequest("POST", "", buildEvent(reservation));
        return event.id;
    });
}

export async function updateReservationInCalendar(eventId, reservation) {
    if (!eventId) return null;

    return safely(async () => {
        const event = await calendarRequest(
            "PATCH",
            `/${encodeURIComponent(eventId)}`,
            buildEvent(reservation)
        );
        return event.id;
    });
}

export async function removeReservationFromCalendar(eventId) {
    if (!eventId) return false;

    const result = await safely(async () => {
        await calendarRequest("DELETE", `/${encodeURIComponent(eventId)}`);
        return true;
    });

    return result === true;
}