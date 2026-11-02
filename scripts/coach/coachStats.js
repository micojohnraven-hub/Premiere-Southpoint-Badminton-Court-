import { supabase } from "../supabase/supabaseClient.js";

// ── SKILL DEFINITIONS ─────────────────────────────────────────────
const SKILLS = {
    beginner: [
        { key: "basic_strokes",      label: "Basic Strokes (Clear, Drop, Serve, Smash)" },
        { key: "basic_footwork",     label: "Basic Footwork (Front, Back, Side Movement)" },
        { key: "proper_gripping",    label: "Proper Gripping (Forehand / Backhand)" },
        { key: "rally_construction", label: "Basic Rally Construction" },
    ],
    intermediate: [
        { key: "stroke_consistency",    label: "Consistency in Stroke Combinations (Clear-Drop-Smash)" },
        { key: "net_play_accuracy",     label: "Net Play Accuracy" },
        { key: "shot_selection",        label: "Shot Selection" },
        { key: "positioning_awareness", label: "Awareness of Positioning" },
    ],
    advanced: [
        { key: "stroke_mastery", label: "Mastery of All Strokes" },
        { key: "precision_power", label: "Precision and Power" },
        { key: "footwork_speed",  label: "Efficient Footwork and Speed" },
        { key: "strategies",      label: "Strategies" },
        { key: "deceptions",      label: "Deceptions" },
        { key: "recovery",        label: "Recovery Between Rallies" },
    ],
};

// ── THRESHOLDS ────────────────────────────────────
const THRESHOLDS = {
    beginner:     { minStar: 3, passPct: 0.60 },
    intermediate: { minStar: 3, passPct: 0.75 },
    advanced:     { minStar: 4, passPct: 0.80 },
};

// ── DSS LOGIC ─────────────────────────────────────────────────────
function avgScore(scores) {
    const valid = scores.filter(s => s !== null && s !== undefined && s > 0);
    if (!valid.length) return 0;
    return valid.reduce((a, b) => a + b, 0) / valid.length;
}

function levelPassed(group, scores, minStar, passPct) {
    const skills = SKILLS[group];
    const passed = skills.filter(s => (scores[s.key] || 0) >= minStar).length;
    return (passed / skills.length) >= passPct;
}

function isPerfectScore(scores) {
    const allKeys = [...SKILLS.beginner, ...SKILLS.intermediate, ...SKILLS.advanced].map(s => s.key);
    return allKeys.every(k => (scores[k] || 0) === 5);
}

// ── BATCH LOCK HELPER ──────────────────────────────────────────────
function computeBatchLock(latestAssessedAt, batchInfo) {
    if (!batchInfo) return false;

    const assessedForCurrentBatch = !!latestAssessedAt
        && !!batchInfo.applied_at
        && new Date(latestAssessedAt) >= new Date(batchInfo.applied_at);

    let batchExpired = false;
    if (batchInfo.schedule_date && batchInfo.schedule_time) {
        const endTimePart = batchInfo.schedule_time.split("-").pop().trim();
        const batchEnd = new Date(`${batchInfo.schedule_date}T${endTimePart}:00+08:00`);
        batchExpired = new Date() > batchEnd;
    }

    return assessedForCurrentBatch || batchExpired;
}

// ── STATE ─────────────────────────────────────────────────────────
let currentCoach = null;
let selectedPlayer = null;
let currentScores = {};
let suggestedLevel = null;
let allPlayers = [];
let currentStep = "beginner";

// ── INIT ──────────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", async () => {
    const { data: { user } } = await supabase.auth.getUser();
    currentCoach = user;

    document.getElementById("logoutBtn")?.addEventListener("click", async (e) => {
        e.preventDefault();
        await supabase.auth.signOut();
        window.location.href = "../../pages/auth/login.html";
    });

    document.getElementById("playerSearch")?.addEventListener("input", (e) => {
        filterPlayers(e.target.value);
    });

    await loadPlayers();
});

// ── LOAD PLAYERS ──────────────────────────────────────────────────
async function loadPlayers() {
    const list = document.getElementById("playerList");
    if (!list) return;

    const { data: assessmentApps } = await supabase
        .from("assessment_applications")
        .select(`
            player_id,
            batch_id,
            applied_at,
            profiles!assessment_applications_player_id_fkey(full_name),
            assessment_batches!inner(coach_id, schedule_date, schedule_time)
        `)
        .eq("assessment_batches.coach_id", currentCoach.id)
        .eq("status", "confirmed")
        .order("applied_at", { ascending: false });

    const filteredApps = (assessmentApps || []).filter(
        a => a.assessment_batches?.coach_id === currentCoach.id
    );

    if (!filteredApps.length) {
        list.innerHTML = `<div class="empty-players">No players yet.</div>`;
        return;
    }

    const seen = new Set();
    const combined = [];

    filteredApps.forEach(a => {
        if (!seen.has(a.player_id)) {
            seen.add(a.player_id);
            combined.push({
                id: a.player_id,
                name: a.profiles?.full_name || "Unknown",
                batchInfo: {
                    applied_at:    a.applied_at,
                    schedule_date: a.assessment_batches?.schedule_date,
                    schedule_time: a.assessment_batches?.schedule_time,
                },
            });
        }
    });

    const playerIds = combined.map(r => r.id);

    const { data: profiles } = await supabase
        .from("profiles")
        .select("id, player_level")
        .in("id", playerIds);

    const levelMap = {};
    (profiles || []).forEach(p => { levelMap[p.id] = p.player_level; });

    const { data: assessments } = await supabase
        .from("player_assessments")
        .select("player_id, assessed_at")
        .in("player_id", playerIds)
        .order("assessed_at", { ascending: false });

    const latestAssessedMap = {};
    (assessments || []).forEach(a => {
        if (!latestAssessedMap[a.player_id]) latestAssessedMap[a.player_id] = a.assessed_at;
    });

    allPlayers = combined.map(r => {
        const isLocked = computeBatchLock(latestAssessedMap[r.id] || null, r.batchInfo);
        return {
            id: r.id,
            name: r.name,
            level: levelMap[r.id] || null,
            isLocked,
        };
    });

    allPlayers.sort((a, b) => {
        if (a.isLocked === b.isLocked) return 0;
        return a.isLocked ? 1 : -1;
    });

    renderPlayerList(allPlayers);
}

// ── RENDER PLAYERS ────────────────────────────────────────────────
function renderPlayerList(players) {
    const list = document.getElementById("playerList");
    if (!players.length) {
        list.innerHTML = `<div class="empty-players">No players found.</div>`;
        return;
    }

    list.innerHTML = players.map(p => {
        const levelClass = p.level 
            ? `level-${p.level.toLowerCase().replace(" ", "-")}` 
            : "level-unassessed";
        const levelLabel = p.level || "Not Assessed";
        const initial = p.name.charAt(0).toUpperCase();

        return `
            <div class="player-item${p.isLocked ? ' player-item-locked' : ''}" data-id="${p.id}" onclick="selectPlayer('${p.id}')">
                <div class="player-avatar">${initial}</div>
                <div class="player-info-mini">
                    <div class="pname">${p.name}</div>
                    <span class="plevel ${levelClass}">${levelLabel}</span>
                </div>
                ${p.isLocked ? `<i class='bx bx-check-circle' style="margin-left:auto;color:#9ca3af;font-size:16px;" title="Already assessed / window closed"></i>` : ''}
            </div>
        `;
    }).join("");
}

function filterPlayers(keyword) {
    const filtered = allPlayers.filter(p =>
        p.name.toLowerCase().includes(keyword.toLowerCase())
    );
    renderPlayerList(filtered);
}

// ── SELECT PLAYER ─────────────────────────────────────────────────
window.selectPlayer = async function(playerId) {
    document.querySelectorAll(".player-item").forEach(el => {
        el.classList.toggle("active", el.dataset.id === playerId);
    });

    selectedPlayer = allPlayers.find(p => p.id === playerId);
    currentScores = {};
    suggestedLevel = null;
    currentStep = "beginner";

    await renderAssessmentForm(selectedPlayer);
};

// ── RENDER ASSESSMENT FORM ────────────────────────────────────────
async function renderAssessmentForm(player) {
    const panel = document.getElementById("assessmentPanel");

    // ── latest assessment
    const { data: prevAssessment } = await supabase
        .from("player_assessments")
        .select("*")
        .eq("player_id", player.id)
        .order("assessed_at", { ascending: false })
        .limit(1)
        .maybeSingle();

    // ── Fetch batch para sa time checking
    const { data: batchApp } = await supabase
        .from("assessment_applications")
        .select(`
            applied_at,
            assessment_batches(schedule_date, schedule_time)
        `)
        .eq("player_id", player.id)
        .eq("status", "confirmed")
        .order("applied_at", { ascending: false })
        .limit(1)
        .maybeSingle();

    // ── Check if batch schedule is expired
    let batchExpired = false;
    if (batchApp?.assessment_batches) {
        const { schedule_date, schedule_time } = batchApp.assessment_batches;
        const endTimePart = schedule_time.split("-").pop().trim(); // "17:39"
        const batchEnd = new Date(`${schedule_date}T${endTimePart}:00+08:00`);
        const now = new Date();
        batchExpired = now > batchEnd;
    }

    const hasPrev = !!prevAssessment;
    const assessedForCurrentBatch = hasPrev && batchApp?.applied_at
        && new Date(prevAssessment.assessed_at) >= new Date(batchApp.applied_at);
    const isLocked = assessedForCurrentBatch || batchExpired;

    const prevDate = hasPrev
        ? new Date(prevAssessment.assessed_at).toLocaleDateString("en-PH", {
            month: "short", day: "numeric", year: "numeric",
            timeZone: "Asia/Manila"
          })
        : null;

    // ── Banner message
    let bannerHTML = "";
    if (assessedForCurrentBatch) {
        bannerHTML = `
            <div class="prev-assessment-banner">
                <i class='bx bx-check-circle'></i>
                <span>Assessment completed on <strong>${prevDate}</strong> for this batch — locked. Apply to a new assessment batch to reassess.</span>
            </div>`;
    } else if (batchExpired) {
        bannerHTML = `
            <div class="prev-assessment-banner" style="background:#fee2e2;border-color:#fca5a5;">
                <i class='bx bx-time-five' style="color:#dc2626"></i>
                <span style="color:#dc2626">Assessment window has ended — locked and read-only.</span>
            </div>`;
    } else if (hasPrev) {
        bannerHTML = `
            <div class="prev-assessment-banner" style="background:#eff6ff;border-color:#bfdbfe;">
                <i class='bx bx-history' style="color:#2563eb"></i>
                <span style="color:#2563eb">Previously assessed on <strong>${prevDate}</strong>. Confirmed for a new batch — you may assess now.</span>
            </div>`;
    }

    if (assessedForCurrentBatch) {
        const allKeys = [...SKILLS.beginner, ...SKILLS.intermediate, ...SKILLS.advanced].map(s => s.key);
        allKeys.forEach(k => { currentScores[k] = prevAssessment[k]; });
        suggestedLevel = prevAssessment.suggested_level;
    } else {
        currentScores = {};
        suggestedLevel = null;

    }

    currentStep = "beginner";

    panel.innerHTML = `
        <div class="assessment-card">
            <div class="assessment-card-header">
                <div>
                    <h2>${player.name}</h2>
                    <p>Rate each skill from 1 (poor) to 5 (excellent)</p>
                </div>
                ${player.level ? `<span class="plevel level-${player.level.toLowerCase().replace(" ", "-")}">${player.level}</span>` : ''}
            </div>

            ${bannerHTML}

            <div class="step-indicator">
                <div class="step active" id="step-beginner"><i class='bx bx-star'></i> Beginner</div>
                <div class="step-divider">→</div>
                <div class="step" id="step-intermediate"><i class='bx bx-medal'></i> Intermediate</div>
                <div class="step-divider">→</div>
                <div class="step" id="step-advanced"><i class='bx bx-trophy'></i> Advanced</div>
            </div>

            <div id="skillSection"></div>

            ${isLocked ? '' : `
                <button class="btn-assess" id="btnNext" onclick="nextStep()">
                    <i class='bx bx-right-arrow-alt'></i> Evaluate Beginner Skills
                </button>
            `}
        </div>

        <div class="dss-card" id="dssCard">
            <div class="dss-header">
                <div class="dss-icon" id="dssIcon"><i class='bx bx-trophy'></i></div>
                <div>
                    <div class="dss-title">DSS Evaluation Result</div>
                    <div class="dss-subtitle" id="dssSubtitle">Based on skill ratings</div>
                </div>
            </div>
            <div id="dssSuggestedBadge"></div>
            <div class="score-bars" id="dssBars"></div>
            <div class="feedback-section" style="margin-top:16px;">
                <label><i class='bx bx-comment-detail'></i> Coach Feedback / Notes (optional)</label>
                <textarea id="coachFeedback" rows="3" placeholder="e.g. Shows great footwork but needs to work on net play consistency..."></textarea>
            </div>
            <div class="submit-row">
                <button class="btn-submit-final" id="btnSubmitFinal" onclick="submitAssessment()">
                    <i class='bx bx-check-shield'></i> Save & Apply Level
                </button>
            </div>
        </div>
    `;

    if (assessedForCurrentBatch) {
        renderCurrentStep(prevAssessment);

        // Payagan mag-browse sa steps para makita lahat ng ratings kahit locked
        ["beginner", "intermediate", "advanced"].forEach(step => {
            const stepEl = document.getElementById(`step-${step}`);
            if (stepEl) {
                stepEl.style.cursor = "pointer";
                stepEl.addEventListener("click", () => {
                    currentStep = step;
                    renderCurrentStep(prevAssessment);
                    document.querySelectorAll(".star-rating input[type='radio']").forEach(r => r.disabled = true);
                });
            }
        });

        document.querySelectorAll(".star-rating input[type='radio']").forEach(r => r.disabled = true);
        document.querySelectorAll(".override-btn").forEach(b => {
            b.disabled = true;
            b.style.opacity = "0.5";
            b.style.cursor = "not-allowed";
        });

        const fb = document.getElementById("coachFeedback");
        if (fb) {
            fb.value = prevAssessment.coach_feedback || "";
            fb.disabled = true;
            fb.style.opacity = "0.6";
        }

        const btnSubmit = document.getElementById("btnSubmitFinal");
        if (btnSubmit) {
            btnSubmit.disabled = true;
            btnSubmit.innerHTML = `<i class='bx bx-check-circle'></i> Already Assessed`;
            btnSubmit.style.opacity = "0.6";
            btnSubmit.style.cursor = "not-allowed";
        }

    } else if (isLocked && batchExpired) {
        renderCurrentStep(hasPrev ? prevAssessment : null);
        document.querySelectorAll(".star-rating input[type='radio']").forEach(r => r.disabled = true);

        const btnSubmit = document.getElementById("btnSubmitFinal");
        if (btnSubmit) {
            btnSubmit.disabled = true;
            btnSubmit.innerHTML = `<i class='bx bx-time-five'></i> Assessment Window Closed`;
            btnSubmit.style.opacity = "0.6";
            btnSubmit.style.cursor = "not-allowed";
        }
        document.getElementById("dssCard").style.display = "none";

    } else {
        renderCurrentStep(null);
    }
}

// ── RENDER CURRENT STEP ───────────────────────────────────────────
function renderCurrentStep(prevData = null) {
    const section = document.getElementById("skillSection");
    const btn = document.getElementById("btnNext");

    if (!section) return; 

    const titles = {
        beginner:     { icon: "bx-star",   label: "Beginner Skills",     color: "beginner" },
        intermediate: { icon: "bx-medal",  label: "Intermediate Skills", color: "intermediate" },
        advanced:     { icon: "bx-trophy", label: "Advanced Skills",     color: "advanced" },
    };

    const t = titles[currentStep];
    section.innerHTML = `
        <div class="skill-section">
            <div class="skill-section-title ${t.color}">
                <i class='bx ${t.icon}'></i> ${t.label}
            </div>
            ${renderSkillRows(currentStep, prevData)}
        </div>
    `;

    if (btn) { 
        const btnLabels = {
            beginner:     "Evaluate Beginner Skills",
            intermediate: "Evaluate Intermediate Skills",
            advanced:     "Evaluate Advanced Skills",
        };
        btn.innerHTML = `<i class='bx bx-right-arrow-alt'></i> ${btnLabels[currentStep]}`;
    }

    ["beginner", "intermediate", "advanced"].forEach(s => {
        document.getElementById(`step-${s}`)?.classList.remove("active", "done", "failed");
    });
    document.getElementById(`step-${currentStep}`)?.classList.add("active");

    bindStarRatings();
}

// ── NEXT STEP ─────────────────────────────────────────────────────
window.nextStep = function() {
    SKILLS[currentStep].forEach(skill => {
        const checked = document.querySelector(`input[name="${skill.key}"]:checked`);
        currentScores[skill.key] = checked ? parseInt(checked.value) : 0;
    });

    const passed = levelPassed(
        currentStep,
        currentScores,
        THRESHOLDS[currentStep].minStar,
        THRESHOLDS[currentStep].passPct
    );

    document.getElementById(`step-${currentStep}`)?.classList.remove("active");
    document.getElementById(`step-${currentStep}`)?.classList.add(passed ? "done" : "failed");

    if (!passed) {
        // Gating — hindi pumasa, stop agad
        if (currentStep === "beginner") {
            suggestedLevel = "Not Qualified";
        } else if (currentStep === "intermediate") {
            suggestedLevel = "Beginner";
        } else if (currentStep === "advanced") {
            suggestedLevel = "Intermediate";
        }
        showDSSResult();
        return;
    }

    if (currentStep === "beginner") {
        currentStep = "intermediate";
        renderCurrentStep();
    } else if (currentStep === "intermediate") {
        currentStep = "advanced";
        renderCurrentStep();
    } else if (currentStep === "advanced") {
        suggestedLevel = "Advanced";
        showDSSResult();
    }
};

// ── SHOW DSS RESULT ───────────────────────────────────────────────
function showDSSResult() {
    const allKeys = [...SKILLS.beginner, ...SKILLS.intermediate, ...SKILLS.advanced].map(s => s.key);
    const bAvg = avgScore(SKILLS.beginner.map(s => currentScores[s.key]));
    const iAvg = avgScore(SKILLS.intermediate.map(s => currentScores[s.key]));
    const aAvg = avgScore(SKILLS.advanced.map(s => currentScores[s.key]));


    const dssCard = document.getElementById("dssCard");
    dssCard.classList.add("visible");

    const isNotQualified = suggestedLevel === "Not Qualified";
    const iconEl = document.getElementById("dssIcon");


    iconEl.className = `dss-icon ${isNotQualified ? "not-qualified" : suggestedLevel.toLowerCase()}`;
    iconEl.innerHTML = suggestedLevel === "Advanced"
        ? "<i class='bx bx-trophy'></i>"
        : suggestedLevel === "Intermediate"
        ? "<i class='bx bx-medal'></i>"
        : suggestedLevel === "Beginner"
        ? "<i class='bx bx-star'></i>"
        : "<i class='bx bx-x-circle'></i>";

    document.getElementById("dssSubtitle").textContent =
        `Suggested level based on ${allKeys.filter(k => currentScores[k] > 0).length} rated skills`;

    const bPassed = levelPassed("beginner",     currentScores, THRESHOLDS.beginner.minStar,     THRESHOLDS.beginner.passPct);
    const iPassed = levelPassed("intermediate", currentScores, THRESHOLDS.intermediate.minStar, THRESHOLDS.intermediate.passPct);
    const aPassed = levelPassed("advanced",     currentScores, THRESHOLDS.advanced.minStar,     THRESHOLDS.advanced.passPct);

    document.getElementById("dssSuggestedBadge").innerHTML = `
        <div style="margin-bottom:16px;">
            <span class="dss-suggested ${isNotQualified ? "not-qualified" : suggestedLevel.toLowerCase()}">
                <i class='bx ${isNotQualified ? "bx-x-circle" : "bx-check-circle"}'></i>
                Suggested Level: ${suggestedLevel}
            </span>
        </div>
        <div style="font-size:12px;color:#6b7280;margin-bottom:12px;">
            <span style="margin-right:12px;">${bPassed ? '✅' : '❌'} Beginner (60%)</span>
            <span style="margin-right:12px;">${iPassed ? '✅' : '❌'} Intermediate (75%)</span>
            <span>${aPassed ? '✅' : '❌'} Advanced (80%)</span>
        </div>
        ${isNotQualified ? `
            <div style="font-size:12px;color:#dc2626;background:#fee2e2;padding:10px;border-radius:8px;margin-bottom:12px;">
                <i class='bx bx-info-circle'></i> Player did not meet the minimum Beginner requirements. More practice needed before re-assessment.
            </div>
        ` : ''}
    `;

    document.getElementById("dssBars").innerHTML = `
        <div class="score-bar-row">
            <div class="score-bar-label">
                <span>Beginner Skills</span>
                <span>${bAvg.toFixed(1)} / 5.0</span>
            </div>
            <div class="score-bar-track">
                <div class="score-bar-fill beginner" style="width:${(bAvg / 5) * 100}%"></div>
            </div>
        </div>
        <div class="score-bar-row">
            <div class="score-bar-label">
                <span>Intermediate Skills</span>
                <span>${iAvg.toFixed(1)} / 5.0</span>
            </div>
            <div class="score-bar-track">
                <div class="score-bar-fill intermediate" style="width:${(iAvg / 5) * 100}%"></div>
            </div>
        </div>
        <div class="score-bar-row">
            <div class="score-bar-label">
                <span>Advanced Skills</span>
                <span>${aAvg.toFixed(1)} / 5.0</span>
            </div>
            <div class="score-bar-track">
                <div class="score-bar-fill advanced" style="width:${(aAvg / 5) * 100}%"></div>
            </div>
        </div>
    `;

    document.getElementById("btnSubmitFinal").style.display = "flex";
    document.getElementById("dssCard").scrollIntoView({ behavior: "smooth", block: "start" });

document.getElementById("btnNext").style.display = "none"; 

document.querySelectorAll(".star-rating input[type='radio']").forEach(radio => {
    radio.disabled = true;
});
}

// ── RENDER SKILL ROWS ─────────────────────────────────────────────
function renderSkillRows(group, prevData) {
    return SKILLS[group].map(skill => {
        const prevVal = prevData ? (prevData[skill.key] || 0) : 0;
        const stars = [5, 4, 3, 2, 1].map(val => `
            <input type="radio" name="${skill.key}" id="${skill.key}_${val}" value="${val}" ${prevVal === val ? "checked" : ""}>
            <label for="${skill.key}_${val}" title="${val} star${val > 1 ? 's' : ''}">★</label>
        `).join("");

        return `
            <div class="skill-row">
                <span class="skill-label">${skill.label}</span>
                <div class="star-rating">${stars}</div>
            </div>
        `;
    }).join("");
}

// ── BIND STAR RATINGS ─────────────────────────────────────────────
function bindStarRatings() {
    const allKeys = [...SKILLS.beginner, ...SKILLS.intermediate, ...SKILLS.advanced].map(s => s.key);
    allKeys.forEach(key => {
        document.querySelectorAll(`input[name="${key}"]`).forEach(radio => {
            if (radio.checked) currentScores[key] = parseInt(radio.value);
            radio.addEventListener("change", () => {
                currentScores[key] = parseInt(radio.value);
            });
        });
    });
}

// ── SUBMIT ASSESSMENT ─────────────────────────────────────────────
window.submitAssessment = async function() {
    if (!selectedPlayer) return;

    const finalLevel = suggestedLevel;
    const feedback = document.getElementById("coachFeedback")?.value?.trim() || null;

    const btn = document.getElementById("btnSubmitFinal");
    btn.disabled = true;
    btn.innerHTML = `<i class='bx bx-loader-alt bx-spin'></i> Saving...`;

    const allKeys = [...SKILLS.beginner, ...SKILLS.intermediate, ...SKILLS.advanced].map(s => s.key);
    const scorePayload = {};

    allKeys.forEach(key => {
        scorePayload[key] = currentScores[key] || null;
    });

    const { error: insertError } = await supabase
        .from("player_assessments")
        .insert({
            player_id: selectedPlayer.id,
            coach_id: currentCoach.id,
            ...scorePayload,
            suggested_level: suggestedLevel,
            final_level: finalLevel,
            coach_feedback: feedback,
        });

    if (insertError) {
        console.error("INSERT ERROR:", insertError);
        showToast("❌ Failed to save assessment.", false);
        btn.disabled = false;
        btn.innerHTML = `<i class='bx bx-check-shield'></i> Save & Apply Level`;
        return;
    }

    const currentLevel = selectedPlayer.level; 

    const levelOrder = { "Not Qualified": 0, "Beginner": 1, "Intermediate": 2, "Advanced": 3 };
    const currentLevelRank = levelOrder[currentLevel] ?? -1;
    const shouldUpdate = !currentLevel || levelOrder[finalLevel] >= levelOrder[currentLevel];

    if (shouldUpdate) {
        const { error: updateError } = await supabase
            .from("profiles")
            .update({ player_level: finalLevel })
            .eq("id", selectedPlayer.id);

        if (updateError) {
            showToast("❌ Assessment saved but failed to update player level.", false);
            btn.disabled = false;
            btn.innerHTML = `<i class='bx bx-check-shield'></i> Save & Apply Level`;
            return;
        }

        const p = allPlayers.find(p => p.id === selectedPlayer.id);
            if (p) p.level = finalLevel;
            selectedPlayer.level = finalLevel;
    }

    await loadPlayers(); 
    setTimeout(() => {
        document.querySelectorAll(".player-item").forEach(el => {
            el.classList.toggle("active", el.dataset.id === selectedPlayer.id);
        });
    }, 100);

    showToast(
        finalLevel === "Not Qualified"
            ? `⚠️ ${selectedPlayer.name} is Not Qualified. Assessment saved.`
            : shouldUpdate
            ? `✅ ${selectedPlayer.name} assessed as ${finalLevel}!`
            : `ℹ️ Assessment saved. Level stays at ${currentLevel}.`,
        finalLevel !== "Not Qualified"
    );

        btn.disabled = true;
        btn.innerHTML = `<i class='bx bx-check-circle'></i> Assessment Saved`;
        btn.style.opacity = "0.6";
        btn.style.cursor = "not-allowed";

        const fb = document.getElementById("coachFeedback");
        if (fb) { fb.disabled = true; fb.style.opacity = "0.6"; }
};

// ── TOAST ─────────────────────────────────────────────────────────
function showToast(message, success = true) {
    const toast = document.getElementById("toast");
    toast.innerHTML = `<i class='bx ${success ? "bx-check-circle" : "bx-error-circle"}'></i> ${message}`;
    toast.style.background = success ? "#111827" : "#ef4444";
    toast.classList.add("show");
    setTimeout(() => toast.classList.remove("show"), 3500);
}