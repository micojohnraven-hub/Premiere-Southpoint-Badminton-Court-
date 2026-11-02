import { supabase } from "../supabase/supabaseClient.js";
import { initCarousel } from "./analyticsCarousel.js";

const LEVEL_ORDER = [
    "Not Qualified",
    "Beginner",
    "Intermediate",
    "Advanced"
];

const CHART_COLORS = [
    "#05b905",
    "#43ca43",
    "#f59e0b",
    "#ef4444",
    "#3b82f6",
    "#a855f7"
];

const MONTH_LABELS = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"
];

let charts = {};

document.addEventListener("DOMContentLoaded", () => {
    loadAllAnalytics();

    document
        .getElementById("refreshAnalyticsBtn")
        .addEventListener("click", loadAllAnalytics);
});

async function loadAllAnalytics() {
    const btn = document.getElementById("refreshAnalyticsBtn");

    btn.classList.add("spinning");

    try {
        await Promise.all([
            loadCourtUtilization(),
            loadBookingTrends(),
            loadPeakHours(),
            loadPlayerEngagement(),
            loadTournamentAnalytics()
        ]);
    } finally {
        btn.classList.remove("spinning");
    }
}

function getStartOfYear() {
    return `${new Date().getFullYear()}-01-01`;
}

function getEndOfYear() {
    return `${new Date().getFullYear()}-12-31`;
}

function getCurrentYear() {
    return new Date().getFullYear();
}

async function loadCourtUtilization() {
    const { data: courts } = await supabase
        .from("courts")
        .select("id, name, is_active");

    const { data: reservations } = await supabase
        .from("reservations")
        .select("court_id, duration_hours, reservation_date, status")
        .gte("reservation_date", getStartOfYear())
        .lte("reservation_date", getEndOfYear())
        .in("status", [
            "confirmed",
            "playing",
            "completed"
        ]);

        console.log("RESERVATIONS DATA:", reservations);

    const hoursByCourtId = {};

    (reservations || []).forEach(reservation => {
        hoursByCourtId[reservation.court_id] =
            (hoursByCourtId[reservation.court_id] || 0) +
            (reservation.duration_hours || 0);
    });

    const sortedCourts = [...(courts || [])].sort((a, b) => {
        const numA = parseInt(
            a.name.match(/\d+/)?.[0] || "0",
            10
        );

        const numB = parseInt(
            b.name.match(/\d+/)?.[0] || "0",
            10
        );

        return numA - numB;
    });

    const labels = sortedCourts.map(court => court.name);

    const data = sortedCourts.map(
        court => hoursByCourtId[court.id] || 0
    );

    const activeCourts = (courts || [])
        .filter(court => court.is_active)
        .length;

    document.getElementById("statActiveCourts").innerText =
        `${activeCourts} / ${(courts || []).length}`;

    const totalBookedDays = new Set(
        (reservations || []).map(
            reservation => reservation.reservation_date
        )
    ).size;

    document.getElementById("statTotalBookedDays").innerText =
        totalBookedDays;

    if (data.length > 0) {
        const topIndex = data.indexOf(Math.max(...data));

        document.getElementById("statTopCourt").innerText =
            data[topIndex] > 0
                ? labels[topIndex]
                : "—";
    }

    renderBarChart(
        "courtUtilizationChart",
        labels,
        data,
        "Hours Booked"
    );
}

async function loadBookingTrends() {
    const { data: reservations } = await supabase
        .from("reservations")
        .select("reservation_date, status")
        .gte("reservation_date", getStartOfYear())
        .lte("reservation_date", getEndOfYear());

    const rows = reservations || [];
    const countsByMonth = new Array(12).fill(0);

    rows.forEach(reservation => {
        const monthIndex = new Date(
            `${reservation.reservation_date}T00:00:00`
        ).getMonth();

        if (monthIndex >= 0 && monthIndex <= 11) {
            countsByMonth[monthIndex]++;
        }
    });

    const labels = MONTH_LABELS;
    const data = countsByMonth;

    document.getElementById("statTotalBookings").innerText =
        rows.length;

    const completed = rows.filter(
        reservation => reservation.status === "completed"
    ).length;

    const cancelled = rows.filter(
        reservation =>
            reservation.status === "cancelled" ||
            reservation.status === "no_show"
    ).length;

    document.getElementById("statCompletionRate").innerText =
        rows.length > 0
            ? `${Math.round((completed / rows.length) * 100)}%`
            : "0%";

    document.getElementById("statCancelRate").innerText =
        rows.length > 0
            ? `${Math.round((cancelled / rows.length) * 100)}%`
            : "0%";

    renderLineChart(
        "bookingTrendsChart",
        labels,
        data,
        "Bookings"
    );

    const statusCounts = {};

    rows.forEach(reservation => {
        statusCounts[reservation.status] =
            (statusCounts[reservation.status] || 0) + 1;
    });

    renderDoughnutChart(
        "bookingStatusChart",
        Object.keys(statusCounts),
        Object.values(statusCounts)
    );
}

function parseHourFrom12h(timeStr) {
    if (!timeStr) return null;

    const match = timeStr
        .trim()
        .toUpperCase()
        .match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/);

    if (!match) return null;

    let hour = parseInt(match[1], 10);

    const period = match[3];

    if (period === "AM" && hour === 12) {
        hour = 0;
    }

    if (period === "PM" && hour !== 12) {
        hour += 12;
    }

    return hour;
}

function formatHour12(hour24) {
    const period = hour24 >= 12 ? "PM" : "AM";

    const displayHour =
        hour24 % 12 === 0
            ? 12
            : hour24 % 12;

    return `${displayHour}:00 ${period}`;
}

async function loadPeakHours() {
    const { data: reservations } = await supabase
        .from("reservations")
        .select("start_time")
        .gte("reservation_date", getStartOfYear())
        .lte("reservation_date", getEndOfYear());

    const hours = [];

    for (let hour = 6; hour <= 23; hour++) {
        hours.push(hour);
    }

    const countsByHour = {};

    hours.forEach(hour => {
        countsByHour[hour] = 0;
    });

    (reservations || []).forEach(reservation => {
        const hour = parseHourFrom12h(
            reservation.start_time
        );

        if (hour !== null && hour >= 6 && hour <= 23) {
            countsByHour[hour]++;
        }
    });

    const labels = hours.map(
        hour => formatHour12(hour)
    );

    const data = hours.map(
        hour => countsByHour[hour]
    );

    const maxCount = Math.max(...data);

    document.getElementById("statPeakHour").innerText =
        maxCount > 0
            ? labels[data.indexOf(maxCount)]
            : "—";

    renderBarChart(
        "peakHoursChart",
        labels,
        data,
        "Reservations"
    );
}

async function loadPlayerEngagement() {
    const { data: profiles } = await supabase
        .from("profiles")
        .select(
            "full_name, player_level, status, games_played, created_at"
        )
        .eq("role", "player");

    const rows = profiles || [];

    document.getElementById("statTotalPlayers").innerText =
        rows.length;

    document.getElementById("statActivePlayers").innerText =
        rows.filter(
            player => player.status === "active"
        ).length;

    const startOfYear = new Date(
        new Date().getFullYear(),
        0,
        1
    );

    const newThisYear = rows.filter(
        player =>
            player.created_at &&
            new Date(player.created_at) >= startOfYear
    ).length;

    document.getElementById("statNewPlayers").innerText =
        newThisYear;

    const levelCounts = {};

    LEVEL_ORDER.forEach(level => {
        levelCounts[level] = 0;
    });

    rows.forEach(player => {
        if (
            player.player_level &&
            Object.prototype.hasOwnProperty.call(
                levelCounts,
                player.player_level
            )
        ) {
            levelCounts[player.player_level]++;
        }
    });

    renderDoughnutChart(
        "playerLevelChart",
        Object.keys(levelCounts),
        Object.values(levelCounts)
    );

    const topPlayers = [...rows]
        .sort(
            (a, b) =>
                (b.games_played || 0) -
                (a.games_played || 0)
        )
        .slice(0, 5);

    renderRankedTable(
        "topPlayersTable",
        topPlayers,
        (player, rank) => `
            <tr>
                <td>
                    <span class="rank-badge">${rank}</span>
                    ${escapeHtml(
                        player.full_name || "Unknown"
                    )}
                </td>
                <td>
                    ${escapeHtml(
                        player.player_level || "—"
                    )}
                </td>
                <td>
                    ${player.games_played || 0}
                </td>
            </tr>
        `
    );
}

async function loadTournamentAnalytics() {
    const { data: tournaments } = await supabase
        .from("tournaments")
        .select("id, title, date, status")
        .gte("date", getStartOfYear())
        .lte("date", getEndOfYear())
        .order("date", { ascending: false });

    const { data: registrations } = await supabase
        .from("tournament_registrations")
        .select("tournament_id");

    const { data: matchResults } = await supabase
        .from("match_results")
        .select("tournament_id, winner_id");

    const tourneyRows = tournaments || [];
    const regRows = registrations || [];
    const matchRows = matchResults || [];

    document.getElementById("statTotalTournaments").innerText =
        tourneyRows.length;

    document.getElementById("statVerificationRate").innerText =
        regRows.length;

    const recentTournaments = tourneyRows.slice(0, 5);

    const tournamentOverview = recentTournaments.map(tournament => {
        const registrationsCount = regRows.filter(
            registration =>
                registration.tournament_id === tournament.id
        ).length;

        const matchesCount = matchRows.filter(
            match =>
                match.tournament_id === tournament.id
        ).length;

        return {
            title: tournament.title,
            registrations: registrationsCount,
            matches: matchesCount
        };
    });

    renderTournamentOverview(
        "tournamentOverviewTable",
        tournamentOverview
    );

    const winCounts = {};

    matchRows.forEach(match => {
        if (match.winner_id) {
            winCounts[match.winner_id] =
                (winCounts[match.winner_id] || 0) + 1;
        }
    });

    const winnerIds = Object.keys(winCounts);
    let winnerProfiles = [];

    if (winnerIds.length) {
        const { data } = await supabase
            .from("profiles")
            .select("id, full_name")
            .in("id", winnerIds);

        winnerProfiles = data || [];
    }

    const topWinners = winnerIds
        .map(id => {
            const player = winnerProfiles.find(
                profile => profile.id === id
            );

            return [
                player?.full_name || "Unknown",
                winCounts[id]
            ];
        })
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5);

    renderRankedTable(
        "topWinnersTable",
        topWinners,
        ([name, wins], rank) => `
            <tr>
                <td>
                    <span class="rank-badge">${rank}</span>
                    ${escapeHtml(name)}
                </td>
                <td>${wins}</td>
            </tr>
        `
    );
}

function renderTournamentOverview(tableId, rows) {
    const tbody = document.querySelector(
        `#${tableId} tbody`
    );

    if (!tbody) return;

    if (!rows.length) {
        tbody.innerHTML = `
            <tr>
                <td colspan="3" class="analytics-empty">
                    No tournaments available this year.
                </td>
            </tr>
        `;
        return;
    }

    tbody.innerHTML = rows.map(tournament => `
        <tr>
            <td>${escapeHtml(tournament.title)}</td>
            <td>${tournament.registrations}</td>
            <td>${tournament.matches}</td>
        </tr>
    `).join("");
}

function destroyIfExists(id) {
    if (charts[id]) {
        charts[id].destroy();
        delete charts[id];
    }
}

function renderBarChart(
    canvasId,
    labels,
    data,
    label
) {
    destroyIfExists(canvasId);

    const ctx = document.getElementById(canvasId);

    if (!ctx) return;

    charts[canvasId] = new Chart(ctx, {
        type: "bar",

        data: {
            labels,

            datasets: [{
                label,
                data,
                backgroundColor: "#05b905",
                borderRadius: 6
            }]
        },

        options: {
            responsive: true,
            maintainAspectRatio: false,

            plugins: {
                legend: {
                    display: false
                }
            },

            scales: {
                y: {
                    beginAtZero: true,

                    ticks: {
                        precision: 0
                    }
                }
            }
        }
    });
}

function renderLineChart(
    canvasId,
    labels,
    data,
    label
) {
    destroyIfExists(canvasId);

    const ctx = document.getElementById(canvasId);

    if (!ctx) return;

    charts[canvasId] = new Chart(ctx, {
        type: "line",

        data: {
            labels,

            datasets: [{
                label,
                data,
                borderColor: "#05b905",
                backgroundColor:
                    "rgba(5, 185, 5, 0.1)",
                fill: true,
                tension: 0.3
            }]
        },

        options: {
            responsive: true,
            maintainAspectRatio: false,

            plugins: {
                legend: {
                    display: false
                }
            },

            scales: {
                y: {
                    beginAtZero: true,

                    ticks: {
                        precision: 0
                    }
                }
            }
        }
    });
}

function renderTournamentPerformanceChart(
    labels,
    registrations,
    verified,
    matches
) {
    destroyIfExists(
        "tournamentPerformanceChart"
    );

    const ctx = document.getElementById(
        "tournamentPerformanceChart"
    );

    if (!ctx || labels.length === 0) {
        if (ctx) {
            ctx.parentElement.innerHTML =
                '<p class="analytics-empty">No data available yet.</p>';
        }

        return;
    }

    charts.tournamentPerformanceChart =
        new Chart(ctx, {
            type: "bar",

            data: {
                labels,

                datasets: [
                    {
                        label: "Participants",
                        data: registrations,
                        backgroundColor: "#05b905",
                        borderRadius: 6
                    },
                    {
                        label: "Verified",
                        data: verified,
                        backgroundColor: "#3b82f6",
                        borderRadius: 6
                    },
                    {
                        label: "Matches",
                        data: matches,
                        backgroundColor: "#f59e0b",
                        borderRadius: 6
                    }
                ]
            },

            options: {
                responsive: true,
                maintainAspectRatio: false,

                plugins: {
                    legend: {
                        position: "bottom"
                    }
                },

                scales: {
                    y: {
                        beginAtZero: true,

                        ticks: {
                            precision: 0
                        }
                    }
                }
            }
        });
}

function renderDoughnutChart(
    canvasId,
    labels,
    data
) {
    destroyIfExists(canvasId);

    const ctx = document.getElementById(canvasId);

    if (!ctx) return;

    if (
        labels.length === 0 ||
        data.every(value => value === 0)
    ) {
        ctx.parentElement.innerHTML =
            '<p class="analytics-empty">No data available yet.</p>';

        return;
    }

    charts[canvasId] = new Chart(ctx, {
        type: "doughnut",

        data: {
            labels,

            datasets: [{
                data,
                backgroundColor: CHART_COLORS
            }]
        },

        options: {
            responsive: true,
            maintainAspectRatio: false,

            plugins: {
                legend: {
                    position: "bottom"
                }
            }
        }
    });
}

function renderRankedTable(
    tableId,
    rows,
    rowTemplateFn
) {
    const tbody = document.querySelector(
        `#${tableId} tbody`
    );

    if (!tbody) return;

    if (rows.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="3" class="analytics-empty">
                    No data available yet.
                </td>
            </tr>
        `;

        return;
    }

    tbody.innerHTML = rows
        .map((row, index) =>
            rowTemplateFn(
                row,
                index + 1
            )
        )
        .join("");
}

function escapeHtml(value) {
    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

document.addEventListener("DOMContentLoaded", () => {
    initCarousel(".analytics-carousel");
    loadAllAnalytics();

    document
        .getElementById("refreshAnalyticsBtn")
        .addEventListener("click", loadAllAnalytics);
});