    import { supabase } from "../supabase/supabaseClient.js";
    import { checkAndShowAnnouncements, loadUserAnnouncements} from "../../scripts/shared/Announcement.js";

    document.addEventListener("DOMContentLoaded", async () => {

        const {
            data: { session }
        } = await supabase.auth.getSession();

        if (!session) {
            window.location.href = "../auth/login.html";
            return;
        }

        const user = session.user;

        const { data: profile } = await supabase
            .from("profiles")
            .select("*")
            .eq("id", user.id)
            .single();

        await checkAndShowAnnouncements(user.id);
        await loadUserAnnouncements(user.id);
        await loadAssessmentHistory(user.id);

        const nameEl = document.querySelector(".name-section h1");

        if (nameEl) {
            nameEl.textContent =
                profile?.full_name ||
                user.user_metadata?.full_name ||
                "No Name";
        }

        const userEmailEl = document.getElementById("userEmail");

        if (userEmailEl) {
            userEmailEl.innerHTML =
                `<i class='bx bx-envelope'></i> ${user.email}`;
        }

        const avatar = document.getElementById("avatarPreview");
        const placeholder = document.querySelector(".avatar-placeholder");

        if (avatar) {
            const googleAvatar =
                user.user_metadata?.avatar_url ||
                user.user_metadata?.picture;

            const finalAvatar =
                profile?.avatar_url ||
                googleAvatar ||
                "";

            if (finalAvatar) {
                avatar.src = finalAvatar;
                avatar.style.display = "block";

                if (placeholder) {
                    placeholder.style.display = "none";
                }
            }
        }

        const { data: assessment } = await supabase
            .from("player_assessments")
            .select("*")
            .eq("player_id", user.id)
            .order("assessed_at", { ascending: false })
            .limit(1);

        const { data: actualCoaches } = await supabase
            .from("profiles")
            .select("id, full_name")
            .eq("role", "coach")
            .eq("status", "active");

        const latestAssessment = assessment?.[0] ?? null;

        const currentLevel =
            profile?.player_level && latestAssessment
                ? profile.player_level
                : null;

        const badge = document.getElementById("playerLevelBadge");

        if (badge) {
            badge.textContent = currentLevel || "Not Assessed";

            badge.style.background =
                currentLevel === "Advanced"
                    ? "#15803d"
                    : currentLevel === "Intermediate"
                    ? "#cece40"
                    : currentLevel === "Beginner"
                    ? "#1d4ed8"
                    : currentLevel === "Not Qualified"
                    ? "#dc2626"
                    : "#6b7280";

            badge.style.color = "#fff";
            badge.style.padding = "4px 14px";
            badge.style.borderRadius = "20px";
            badge.style.fontSize = "18px";
            badge.style.fontWeight = "600";
        }

        const winrate = profile?.winrate ?? null;
        const winrateBadge = document.getElementById("playerWinrateBadge");
        const winrateValue = document.getElementById("winrateValue");

        if (winrate !== null && winrate > 0) {
            if (winrateValue) {
                winrateValue.textContent =
                    (winrate * 100).toFixed(1) + "%";
            }

            if (winrateBadge) {
                winrateBadge.style.display = "inline-flex";
            }
        } else {
            if (winrateBadge) {
                winrateBadge.style.display = "none";
            }
        }

        const LEVEL_CONFIG = {
            Beginner: {
                requirements: [
                    {
                        text: "Basic Strokes (Clear, Drop, Serve, Smash)",
                        key: "basic_strokes",
                        type: "Technique"
                    },
                    {
                        text: "Basic Footwork (Front, Back, Side Movement)",
                        key: "basic_footwork",
                        type: "Agility"
                    },
                    {
                        text: "Proper Gripping (Forehand/Backhand)",
                        key: "proper_gripping",
                        type: "Accuracy"
                    },
                    {
                        text: "Basic Rally Construction",
                        key: "rally_construction",
                        type: "Strategy"
                    }
                ]
            },

            Intermediate: {
                requirements: [
                    {
                        text: "Consistency in Clear-Drop-Smash sequences",
                        key: "stroke_consistency",
                        type: "Technique"
                    },
                    {
                        text: "Net Play Accuracy",
                        key: "net_play_accuracy",
                        type: "Accuracy"
                    },
                    {
                        text: "Strategic Shot Selection",
                        key: "shot_selection",
                        type: "Strategy"
                    },
                    {
                        text: "Awareness of Positioning",
                        key: "positioning_awareness",
                        type: "Agility"
                    }
                ]
            },

            Advanced: {
                requirements: [
                    {
                        text: "Mastery of All Strokes",
                        key: "stroke_mastery",
                        type: "Technique"
                    },
                    {
                        text: "Precision and Power",
                        key: "precision_power",
                        type: "Strength"
                    },
                    {
                        text: "Efficient Footwork and Speed",
                        key: "footwork_speed",
                        type: "Agility"
                    },
                    {
                        text: "Strategies",
                        key: "strategies",
                        type: "Strategy"
                    },
                    {
                        text: "Deceptions",
                        key: "deceptions",
                        type: "Strategy"
                    },
                    {
                        text: "Recovery Between Rallies",
                        key: "recovery",
                        type: "Agility"
                    }
                ]
            }
        };

        const SKILL_TIPS = {
            Technique: [
                "Practice your overhead clear daily — focus on full arm extension and wrist snap at contact.",
                "Drill your backhand drop shot repeatedly; use a wall or feeder to build muscle memory.",
                "Work on your smash angle — hit from high contact point and follow through downward."
            ],

            Agility: [
                "Do 6-point footwork drills on the badminton court every session — front corners, mid, and back corners.",
                "Practice chasse steps to the rear court and lunge returns to the net repeatedly.",
                "Improve your split-step reaction: pause at center, split-step when opponent hits, then move."
            ],

            Accuracy: [
                "Place targets (towels or cones) on court and aim your net drops and lifts at them.",
                "Practice cross-court net kills — focus on a flat, tight trajectory just above the tape.",
                "Drill straight and cross-court drops from the rear court — alternate every 10 shots."
            ],

            Strategy: [
                "Study your opponent early — identify if they're weak on backhand or slow at the net.",
                "Practice the lift → clear → drop → net kill pattern to build rally construction habits.",
                "Work on serve variation: low serve, flick serve, and drive serve to keep opponents guessing."
            ],

            Strength: [
                "Do wrist curls and forearm exercises to improve smash power and racket control.",
                "Train explosive lunges — these directly improve your ability to reach wide shots.",
                "Add jump rope to your routine — it builds the calf strength needed for quick court movement."
            ]
        };

        const getRandomTip = (type) => {
            const tips =
                SKILL_TIPS[type] ||
                ["Keep practicing consistently!"];

            return tips[Math.floor(Math.random() * tips.length)];
        };

        const initAvatarUpload = () => {
            const trigger = document.getElementById("avatarTrigger");
            const input = document.getElementById("avatarInput");
            const preview = document.getElementById("avatarPreview");
            const placeholder = document.querySelector(".avatar-placeholder");

            if (!trigger || !input) return;

            trigger.addEventListener("click", () => {
                input.click();
            });

            input.addEventListener("change", (e) => {
                const file = e.target.files[0];

                if (!file) return;

                const reader = new FileReader();

                reader.onload = (event) => {
                    preview.src = event.target.result;
                    preview.style.display = "block";

                    if (placeholder) {
                        placeholder.style.display = "none";
                    }
                };

                reader.readAsDataURL(file);
            });
        };

        if (!currentLevel || currentLevel === "Not Qualified") {

            const list =
                document.getElementById("progressionList");

            const progressBar =
                document.getElementById("mainProgressBar");

            const progressText =
                document.getElementById("nextLevelStatus");

            const progressPercentLabel =
                document.getElementById("progressPercent");

            const container =
                document.getElementById("aiContent");

            const coachContainer =
                document.getElementById("coachList");

            if (list) {
                list.innerHTML = `
                    <div class="req-item alert">
                        <i class='bx bx-info-circle'></i>
                        <span>
                            ${
                                currentLevel === "Not Qualified"
                                    ? "You are Not Qualified yet. More practice needed before re-assessment."
                                    : "You have not been assessed yet. Apply for an assessment batch to get your level."
                            }
                        </span>
                    </div>
                `;
            }

            if (progressBar) {
                progressBar.style.width = "0%";
            }

            if (progressPercentLabel) {
                progressPercentLabel.textContent = "0%";
            }

            if (progressText) {
                progressText.textContent =
                    currentLevel === "Not Qualified"
                        ? "Work on your basics before your next assessment."
                        : "Get assessed to start your journey.";
            }

            if (container) {
                container.innerHTML = `
                    <div
                        class="ai-floating-bubble"
                        style="
                            background:var(--primary-pale);
                            padding:20px;
                            border-radius:15px;
                            border:1px solid var(--primary-light);
                        "
                    >
                        <h4
                            style="
                                color:var(--primary);
                                display:flex;
                                align-items:center;
                                gap:8px;
                                margin-bottom:12px;
                            "
                        >
                            Skill Development Path
                        </h4>

                        <p
                            style="
                                font-size:14px;
                                color:var(--text-mid);
                                line-height:1.6;
                            "
                        >
                            ${
                                currentLevel === "Not Qualified"
                                    ? "Focus on mastering the basics before your next assessment attempt."
                                    : "Apply for a coach assessment to unlock your personalized performance path."
                            }
                        </p>
                    </div>
                `;
            }

            if (coachContainer) {
                coachContainer.innerHTML = `
                    <p style="font-size:13px;color:#6b7280;">
                        No recommendations yet — get assessed first.
                    </p>
                `;
            }

            initAvatarUpload();
            return;
        }

        const levelOrder = [
            "Beginner",
            "Intermediate",
            "Advanced"
        ];

        const currentIndex =
            levelOrder.indexOf(currentLevel);

        const nextLevel =
            levelOrder[currentIndex + 1] || null;

        const targetLevel =
            nextLevel || currentLevel;

        const currentLevelData = {
            requirements:
                LEVEL_CONFIG[targetLevel].requirements.map(req => ({
                    ...req,
                    score: latestAssessment
                        ? (latestAssessment[req.key] || 0)
                        : 0,
                    done: latestAssessment
                        ? (latestAssessment[req.key] || 0) >= 3
                        : false
                }))
        };

        const renderLevelProgression = () => {

            const list =
                document.getElementById("progressionList");

            if (!list) return;

            const maxScorePerRequirement = 5;

            const passingPercentage =
                currentLevel === "Beginner"
                    ? 60
                    : currentLevel === "Intermediate"
                    ? 75
                    : currentLevel === "Advanced"
                    ? 85
                    : 60;

            const targetLevel =
                currentLevel === "Beginner"
                    ? "Intermediate"
                    : currentLevel === "Intermediate"
                    ? "Advanced"
                    : "Advanced";

            const requirements =
                LEVEL_CONFIG[targetLevel].requirements.map(req => ({
                    ...req,
                    score: latestAssessment
                        ? (latestAssessment[req.key] || 0)
                        : 0
                }));

            const totalScore =
                requirements.reduce(
                    (sum, req) =>
                        sum +
                        Math.min(
                            req.score || 0,
                            maxScorePerRequirement
                        ),
                    0
                );

            const maxScore =
                requirements.length *
                maxScorePerRequirement;

            const percentage =
                maxScore > 0
                    ? Math.min(
                        100,
                        Math.round(
                            (totalScore / maxScore) * 100
                        )
                    )
                    : 0;

            list.innerHTML = requirements.map(req => {

                const score = req.score || 0;

                const bgColor =
                    score >= 4
                        ? "done-green"
                        : score >= 3
                        ? "done-yellow"
                        : "pending";

                return `
                    <div class="req-item ${bgColor}">
                        <i class='bx ${
                            score >= 3
                                ? "bxs-check-circle"
                                : "bx-circle"
                        }'></i>

                        <span style="flex:1">
                            ${req.text}
                        </span>
                    </div>
                `;
            }).join("");

            const progressBar =
                document.getElementById("mainProgressBar");

            const progressText =
                document.getElementById("nextLevelStatus");

            const progressPercentLabel =
                document.getElementById("progressPercent");

            if (progressBar) {
                progressBar.style.width =
                    percentage + "%";
            }

            if (progressPercentLabel) {
                progressPercentLabel.textContent =
                    percentage + "%";
            }

            if (progressText) {
                progressText.textContent =
                    currentLevel === "Advanced"
                        ? `${percentage}% Level Mastery — Maintain your Advanced standing`
                        : `${percentage}% Level Mastery — Need ${passingPercentage}% to pass ${targetLevel}`;
            }
        };

        const renderCoaches = () => {

            const container =
                document.getElementById("coachList");

            if (!container) return;

            if (!actualCoaches?.length) {
                container.innerHTML = `
                    <p style="font-size:13px;color:#6b7280;">
                        No coaches available right now.
                    </p>
                `;
                return;
            }

            const targetLevel =
                currentLevel === "Beginner"
                    ? "Intermediate"
                    : currentLevel === "Intermediate"
                    ? "Advanced"
                    : "Advanced";

            const requirements =
                LEVEL_CONFIG[targetLevel].requirements.map(req => ({
                    ...req,
                    score: latestAssessment
                        ? (latestAssessment[req.key] || 0)
                        : 0
                }));

            const sortedByScore =
                [...requirements].sort(
                    (a, b) => a.score - b.score
                );

            const focusType =
                sortedByScore[0]?.type ||
                "Overall";

            const primary =
                actualCoaches[0];

            const secondary =
                actualCoaches[1] || null;

            container.innerHTML =
                [primary, secondary]
                    .filter(Boolean)
                    .map((coach, i) => `
                        <div class="coach-card">

                            <div
                                class="coach-avatar"
                                style="
                                    width:48px;
                                    height:48px;
                                    border-radius:50%;
                                    background:#dcfce7;
                                    display:flex;
                                    align-items:center;
                                    justify-content:center;
                                    font-size:20px;
                                    font-weight:800;
                                    color:#16a34a;
                                    flex-shrink:0;
                                "
                            >
                                ${coach.full_name
                                    .charAt(0)
                                    .toUpperCase()}
                            </div>

                            <div class="coach-info">
                                <h4>${coach.full_name}</h4>

                                <p>
                                    Certified Badminton Coach
                                </p>

                                <span
                                    class="coach-tag"
                                    style="
                                        background:${
                                            i === 0
                                                ? "var(--primary)"
                                                : "#64748b"
                                        }
                                    "
                                >
                                    ${
                                        i === 0
                                            ? "Focus: " + focusType
                                            : "Recommended"
                                    }
                                </span>
                            </div>

                        </div>
                    `)
                    .join("");
        };

        const renderAIInsights = () => {

            const container =
                document.getElementById("aiContent");

            if (!container) return;

            const targetLevel =
                currentLevel === "Beginner"
                    ? "Intermediate"
                    : currentLevel === "Intermediate"
                    ? "Advanced"
                    : "Advanced";

            const requirements =
                LEVEL_CONFIG[targetLevel].requirements.map(req => ({
                    ...req,
                    score: latestAssessment
                        ? (latestAssessment[req.key] || 0)
                        : 0
                }));

            const sortedByScore =
                [...requirements].sort(
                    (a, b) => a.score - b.score
                );

            const weakTasks =
                sortedByScore.slice(0, 2);

            const heading =
                currentLevel === "Advanced"
                    ? "Maintain your Advanced standing. Keep improving on:"
                    : `To reach <b>${targetLevel}</b>, focus on your weakest skills:`;

            const weakList =
                weakTasks.map(task => `
                    <div
                        style="
                            background:white;
                            border-left:4px solid ${
                                task.score >= 4
                                    ? "#16a34a"
                                    : task.score >= 3
                                    ? "#eab308"
                                    : "#ef4444"
                            };
                            border-radius:8px;
                            padding:12px 14px;
                            margin-top:10px;
                        "
                    >
                        <div
                            style="
                                font-weight:700;
                                font-size:14px;
                                color:var(--text-dark);
                            "
                        >
                            ${task.text}
                        </div>

                        <div
                            style="
                                font-size:12px;
                                margin-top:4px;
                                color:#6b7280;
                            "
                        >
                            Focus: <b>${task.type}</b>
                        </div>

                        <div
                            style="
                                margin-top:8px;
                                font-size:12px;
                                color:#475569;
                                background:#f8fafc;
                                border-radius:6px;
                                padding:8px 10px;
                                line-height:1.5;
                            "
                        >
                            💡 <i>${getRandomTip(task.type)}</i>
                        </div>
                    </div>
                `).join("");

            container.innerHTML = `
                <div
                    class="ai-floating-bubble"
                    style="
                        background:var(--primary-pale);
                        padding:20px;
                        border-radius:15px;
                        border:1px solid var(--primary-light);
                    "
                >
                    <h4
                        style="
                            color:var(--primary);
                            display:flex;
                            align-items:center;
                            gap:8px;
                            margin-bottom:5px;
                        "
                    >
                        Skill Development Path
                    </h4>

                    <p
                        style="
                            font-size:14px;
                            color:var(--text-mid);
                            line-height:1.6;
                            margin-bottom:4px;
                        "
                    >
                        ${heading}
                    </p>

                    ${weakList}
                </div>
            `;
        };

        renderLevelProgression();
        renderCoaches();
        renderAIInsights();
        initAvatarUpload();
    });

    async function loadAssessmentHistory(userId) {

        const container =
            document.getElementById("assessmentHistory");

        if (!container) return;

        const { data, error } = await supabase
            .from("player_assessments")
            .select(`
                *,
                coach:profiles!coach_id ( full_name )
            `)
            .eq("player_id", userId)
            .order("assessed_at", {
                ascending: false
            });

        if (error) {
            console.error(
                "Assessment History Error:",
                error
            );
            return;
        }

        if (!data?.length) {
            container.innerHTML = `
                <p
                    style="
                        grid-column:1/-1;
                        text-align:center;
                        padding:20px;
                        color:#94a3b8;
                    "
                >
                    No assessment history found.
                </p>
            `;
            return;
        }

        container.innerHTML = data.map(asmt => {

            const date =
                new Date(
                    asmt.assessed_at
                ).toLocaleDateString(
                    "en-PH",
                    {
                        year: "numeric",
                        month: "short",
                        day: "numeric"
                    }
                );

            return `
                <div
                    class="ann-history-item"
                    onclick="window.showAssessmentDetails(${asmt.id})"
                >
                    <div class="ann-h-header">
                        <span class="ann-h-title"> Coach
                            ${asmt.coach?.full_name || "Admin"}
                        </span>

                        <span class="ann-h-date">
                            Assessment • ${date}
                        </span>
                    </div>
                </div>
            `;
        }).join("");

        window.allAssessments = data;
    }

window.showAssessmentDetails = (id) => {
    const asmt = window.allAssessments.find(
        a => Number(a.id) === Number(id)
    );

    if (!asmt) return;

    const body = document.getElementById("detailModalBody");

    const skillLabels = {
        basic_strokes: "Basic Strokes",
        basic_footwork: "Basic Footwork",
        proper_gripping: "Proper Gripping",
        rally_construction: "Rally Construction",
        stroke_consistency: "Stroke Consistency",
        net_play_accuracy: "Net Play Accuracy",
        shot_selection: "Shot Selection",
        positioning_awareness: "Positioning Awareness",
        stroke_mastery: "Stroke Mastery",
        precision_power: "Precision Power",
        footwork_speed: "Footwork Speed",
        strategies: "Strategies",
        deceptions: "Deceptions",
        recovery: "Recovery"
    };

    const level =
        asmt.level ||
        asmt.assessment_level ||
        asmt.player_level ||
        "Assessment";

    const coachName =
        asmt.coach?.full_name || "Admin";

    const date = new Date(
        asmt.assessed_at
    ).toLocaleDateString("en-PH", {
        year: "numeric",
        month: "long",
        day: "numeric"
    });

    const skills = Object.entries(skillLabels)
        .filter(([key]) =>
            asmt[key] !== null &&
            asmt[key] !== undefined &&
            asmt[key] > 0
        );

    const scoreHtml = skills.map(([key, label]) => {
        const score = asmt[key];

        return `
            <div class="assessment-skill">
                <span>${label}</span>
                <strong>${score} / 5</strong>
            </div>
        `;
    }).join("");

    body.innerHTML = `
        <div class="assessment-details">

            <div class="assessment-summary">

                <div class="assessment-level">
                    <span>Assessment Level</span>
                    <strong>${level}</strong>
                </div>

                <div class="assessment-meta">
                    <div>
                        <span>Coach</span>
                        <strong>${coachName}</strong>
                    </div>

                    <div>
                        <span>Date Assessed</span>
                        <strong>${date}</strong>
                    </div>
                </div>

            </div>

            <div class="assessment-section">

                <h4>Skill Assessment</h4>

                <div class="assessment-skills">
                    ${scoreHtml}
                </div>

            </div>

            ${
                asmt.coach_feedback
                    ? `
                        <div class="assessment-section remarks-section">
                            <h4>Coach Remarks</h4>

                            <div class="coach-remarks">
                                ${asmt.coach_feedback}
                            </div>
                        </div>
                    `
                    : ""
            }

        </div>
    `;

    document.getElementById(
        "assessmentDetailModal"
    ).style.display = "flex";
};

    window.closeAssessmentModal = () => {

        const modal =
            document.getElementById(
                "assessmentDetailModal"
            );

        if (modal) {
            modal.style.display = "none";
        }
    };