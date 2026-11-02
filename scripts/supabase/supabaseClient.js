import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm';

const supabaseUrl = "https://onygjhuelglxbfagvpjp.supabase.co";
const supabaseKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9ueWdqaHVlbGdseGJmYWd2cGpwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE1OTAyMzYsImV4cCI6MjA4NzE2NjIzNn0.oFbGCwQouwtzNjEkXTtqE9l-dR9NeWjUbj7tQzgwP0o"

export const supabase = createClient(supabaseUrl, supabaseKey);
export const GOOGLE_TOKEN_KEY = 'google_access_token';

// ─── CACHE ───
const CACHE_PREFIX = 'sp_cache:';
const memoryCache = new Map();
const inflightRequests = new Map();

function readStored(key) {
    try {
        const raw = sessionStorage.getItem(CACHE_PREFIX + key);
        return raw ? JSON.parse(raw) : null;
    } catch {
        return null;
    }
}

function writeStored(key, entry) {
    try {
        sessionStorage.setItem(CACHE_PREFIX + key, JSON.stringify(entry));
    } catch {
        return;
    }
}

export async function cached(key, fetcher, { ttl = 60000, persist = false } = {}) {
    const now = Date.now();

    const memoryHit = memoryCache.get(key);
    if (memoryHit && memoryHit.expires > now) return memoryHit.value;

    if (persist) {
        const stored = readStored(key);
        if (stored && stored.expires > now) {
            memoryCache.set(key, stored);
            return stored.value;
        }
    }

    if (inflightRequests.has(key)) return inflightRequests.get(key);

    const request = (async () => {
        try {
            const value = await fetcher();
            const entry = { value, expires: Date.now() + ttl };
            memoryCache.set(key, entry);
            if (persist) writeStored(key, entry);
            return value;
        } finally {
            inflightRequests.delete(key);
        }
    })();

    inflightRequests.set(key, request);
    return request;
}

export function invalidateCache(prefix = '') {
    for (const key of [...memoryCache.keys()]) {
        if (key.startsWith(prefix)) memoryCache.delete(key);
    }
    try {
        for (const storageKey of Object.keys(sessionStorage)) {
            if (storageKey.startsWith(CACHE_PREFIX + prefix)) sessionStorage.removeItem(storageKey);
        }
    } catch {
        return;
    }
}

supabase.auth.onAuthStateChange((event, session) => {
    if (event === 'SIGNED_IN' && session?.provider_refresh_token) {
        const refreshToken = session.provider_refresh_token;
        setTimeout(() => saveGoogleRefreshToken(refreshToken), 0);
    }
    if (event === 'SIGNED_OUT') invalidateCache();
});

async function saveGoogleRefreshToken(refreshToken) {
    const { error } = await supabase.rpc('save_google_refresh_token', { p_token: refreshToken });
    if (error) console.warn('Could not save Google token:', error.message);
}