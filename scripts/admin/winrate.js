import { supabase } from "../supabase/supabaseClient.js";

export async function recordMatchResult(winnerName, loserName, tournamentId) {
    if (!winnerName || !loserName) return;
    const cleanWinner = cleanName(winnerName);
    const cleanLoser  = cleanName(loserName);
    if (cleanWinner === "BYE" || cleanLoser === "BYE") return;

    const [winnerId, loserId] = await Promise.all([
        getProfileId(cleanWinner),
        getProfileId(cleanLoser)
    ]);

    if (!winnerId || !loserId) {
        console.warn("Could not find profile(s) for:", cleanWinner, cleanLoser);
        return;
    }

    const { error } = await supabase.from("match_results").insert([
        {
            tournament_id: tournamentId,
            winner_id:     winnerId,
            loser_id:      loserId,
            winner_name:   cleanWinner,
            loser_name:    cleanLoser,
            recorded_at:   new Date().toISOString()
        }
    ]);

    if (error) {
        console.error("Failed to record match result:", error.message);
        return;
    }

    await updateWinRate(winnerId);
    await updateWinRate(loserId);
}

async function updateWinRate(profileId) {
    const { data: wins, error: wErr } = await supabase
        .from("match_results")
        .select("id", { count: "exact" })
        .eq("winner_id", profileId);

    const { data: losses, error: lErr } = await supabase
        .from("match_results")
        .select("id", { count: "exact" })
        .eq("loser_id", profileId);

    if (wErr || lErr) {
        console.error("Win rate fetch error:", wErr || lErr);
        return;
    }

    const totalWins   = wins?.length   ?? 0;
    const totalLosses = losses?.length ?? 0;
    const totalGames  = totalWins + totalLosses;
    const winRate     = totalGames > 0 ? totalWins / totalGames : 0;

    const { error: uErr } = await supabase
        .from("profiles")
        .update({ winrate: parseFloat(winRate.toFixed(4)) })
        .eq("id", profileId);

    if (uErr) console.error("Failed to update win rate:", uErr.message);
    else console.log(`Win rate updated — Player ${profileId}: ${(winRate * 100).toFixed(1)}%`);
}

export async function getPlayerWinRateStats(profileId) {
    const [{ data: wins }, { data: losses }] = await Promise.all([
        supabase.from("match_results").select("id").eq("winner_id", profileId),
        supabase.from("match_results").select("id").eq("loser_id",  profileId)
    ]);

    const w = wins?.length   ?? 0;
    const l = losses?.length ?? 0;
    const total = w + l;

    return {
        wins:           w,
        losses:         l,
        winRate:        total > 0 ? w / total : 0,
        winRatePercent: total > 0 ? `${((w / total) * 100).toFixed(1)}%` : "N/A"
    };
}

function cleanName(name = "") {
    return name
        .replace(/\s\(L\)$/, "")
        .replace(" (Winners)", "")
        .replace(" (Loser)", "")
        .replace(" (Losers)", "")
        .trim();
}

async function getProfileId(fullName) {
    const { data, error } = await supabase
        .from("profiles")
        .select("id")
        .eq("full_name", fullName)
        .maybeSingle();

    if (error) console.error("Profile lookup error:", error.message);
    return data?.id ?? null;
}