const studyForm = document.getElementById("study-form");
const dueDateInput = document.getElementById("due-date");
const outputSection = document.getElementById("plan-output");
const planTitle = document.getElementById("plan-title");
const planSummary = document.getElementById("plan-summary");
const generationSource = document.getElementById("generation-source");
const statsGrid = document.getElementById("stats-grid");
const dailyPlan = document.getElementById("daily-plan");
const focusTip = document.getElementById("focus-tip");
const coachNote = document.getElementById("coach-note");
const feedbackText = document.getElementById("feedback-text");
const progressValue = document.getElementById("progress-value");
const progressFill = document.getElementById("progress-fill");
const apiStatus = document.getElementById("api-status");
const formStatus = document.getElementById("form-status");
const submitButton = document.getElementById("submit-button");

const today = new Date();
const defaultDueDate = new Date(today);
defaultDueDate.setDate(defaultDueDate.getDate() + 7);

const appConfig = {
  apiBaseUrl: sanitizeEndpoint(window.LOCKIN_CONFIG?.apiBaseUrl || ""),
  studyPlanPath: window.LOCKIN_CONFIG?.studyPlanPath || "/study-plan",
  useLocalFallback: window.LOCKIN_CONFIG?.useLocalFallback !== false
};

dueDateInput.min = toDateInputValue(today);
dueDateInput.value = toDateInputValue(defaultDueDate);
renderApiStatus();

studyForm.addEventListener("submit", handleSubmit);

async function handleSubmit(event) {
  event.preventDefault();

  const studentData = getStudentData();
  if (!studentData.subjects.length || !studentData.goal || Number.isNaN(studentData.weeklyHours)) {
    setFormStatus("Add at least one subject, a goal, and weekly study hours before generating a plan.", "error");
    return;
  }

  setLoadingState(true);

  try {
    const responsePayload = await requestAIStudyPlan(studentData);
    const aiPlan = normalizeAIPlan(responsePayload.plan || responsePayload, studentData);
    renderPlan(aiPlan, studentData, {
      sourceLabel: `Generated with OpenAI ${responsePayload.model || "Responses API"}`
    });
    setFormStatus("AI study plan ready.", "success");
  } catch (error) {
    if (appConfig.useLocalFallback) {
      const fallbackPlan = buildFallbackStudyPlan(studentData);
      renderPlan(fallbackPlan, studentData, {
        sourceLabel: "Local demo plan (AI backend unavailable)"
      });
      setFormStatus(getFriendlyErrorMessage(error), "warning");
    } else {
      setFormStatus(getFriendlyErrorMessage(error), "error");
    }
  } finally {
    setLoadingState(false);
  }
}

function getStudentData() {
  const formData = new FormData(studyForm);
  return {
    studentName: sanitizeText(formData.get("studentName")) || "Student",
    gradeLevel: formData.get("gradeLevel"),
    subjects: splitTopics(formData.get("subjects")),
    goal: sanitizeText(formData.get("goal")),
    weeklyHours: Number(formData.get("weeklyHours")),
    sessionLength: Number(formData.get("sessionLength")),
    dueDate: new Date(String(formData.get("dueDate")) + "T12:00:00"),
    confidence: Number(formData.get("confidence")),
    distraction: formData.get("distraction")
  };
}

async function requestAIStudyPlan(studentData) {
  if (!appConfig.apiBaseUrl) {
    throw new Error("AI backend is not configured in config.js.");
  }

  const endpoint = `${appConfig.apiBaseUrl}${appConfig.studyPlanPath}`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      studentData: {
        ...studentData,
        dueDate: toDateInputValue(studentData.dueDate)
      }
    })
  });

  let payload = null;

  try {
    payload = await response.json();
  } catch (error) {
    payload = null;
  }

  if (!response.ok) {
    throw new Error(payload?.error || `AI request failed with status ${response.status}.`);
  }

  if (!payload?.plan && !payload?.days) {
    throw new Error("AI response was missing plan data.");
  }

  return payload;
}

function normalizeAIPlan(rawPlan, studentData) {
  const fallbackPlan = buildFallbackStudyPlan(studentData);
  if (!rawPlan || typeof rawPlan !== "object") {
    return fallbackPlan;
  }

  const daysUntilDue = getDaysUntil(studentData.dueDate);
  const rawDays = Array.isArray(rawPlan.days) ? rawPlan.days.slice(0, 7) : [];

  if (!rawDays.length) {
    return fallbackPlan;
  }

  const normalizedDays = rawDays.map((day, index) => {
    const date = new Date(today);
    date.setDate(today.getDate() + index);

    const tasks = Array.isArray(day.tasks)
      ? day.tasks.map((task) => sanitizeText(task)).filter(Boolean).slice(0, 6)
      : [];

    return {
      label: sanitizeText(day.label) || formatPlanDate(date),
      title: sanitizeText(day.title) || `Study block for ${studentData.subjects[index % studentData.subjects.length]}`,
      phaseLabel: sanitizeText(day.phaseLabel) || "AI plan",
      description: sanitizeText(day.description) || "Work through the session in order and finish with a quick self-check.",
      sessionCount: clamp(Number(day.sessionCount) || fallbackPlan.sessionsPerStudyDay, 1, 4),
      minutes: roundToNearestFive(Number(day.minutes) || fallbackPlan.minutesPerStudyDay),
      tasks: tasks.length ? tasks : fallbackPlan.days[index % fallbackPlan.days.length].tasks
    };
  });

  const minutesPerStudyDay = roundToNearestFive(
    Number(rawPlan.minutesPerStudyDay) ||
      Math.round(normalizedDays.reduce((sum, day) => sum + day.minutes, 0) / normalizedDays.length)
  );
  const sessionsPerStudyDay = clamp(
    Number(rawPlan.sessionsPerStudyDay) ||
      Math.round(normalizedDays.reduce((sum, day) => sum + day.sessionCount, 0) / normalizedDays.length),
    1,
    4
  );
  const readinessLabel = sanitizeText(rawPlan.readiness?.label || rawPlan.readinessLabel) || fallbackPlan.readiness.label;
  const readinessDetail = sanitizeText(rawPlan.readiness?.detail || rawPlan.readinessDetail) || fallbackPlan.readiness.detail;
  const supportiveNudge =
    sanitizeText(rawPlan.readiness?.supportiveNudge || rawPlan.supportiveNudge) || fallbackPlan.readiness.supportiveNudge;

  return {
    daysUntilDue,
    visibleDays: normalizedDays.length,
    studyDaysPerWeek: fallbackPlan.studyDaysPerWeek,
    weeklyMinutes: studentData.weeklyHours * 60,
    minutesPerStudyDay,
    sessionsPerStudyDay,
    readiness: {
      label: readinessLabel,
      detail: readinessDetail,
      supportiveNudge
    },
    days: normalizedDays,
    focusTip: sanitizeText(rawPlan.focusTip) || fallbackPlan.focusTip,
    coachNote: sanitizeText(rawPlan.coachNote) || fallbackPlan.coachNote,
    planSummary: sanitizeText(rawPlan.planSummary) || fallbackPlan.planSummary
  };
}

function renderPlan(plan, studentData, renderMeta = {}) {
  outputSection.classList.remove("hidden");
  planTitle.textContent = `${studentData.studentName}'s Lock-In study plan`;
  planSummary.textContent = plan.planSummary;
  focusTip.textContent = plan.focusTip;
  coachNote.textContent = plan.coachNote;

  if (renderMeta.sourceLabel) {
    generationSource.textContent = renderMeta.sourceLabel;
    generationSource.classList.remove("hidden");
  } else {
    generationSource.classList.add("hidden");
  }

  statsGrid.innerHTML = "";
  dailyPlan.innerHTML = "";

  const stats = [
    {
      label: "Deadline",
      value: `${plan.daysUntilDue} day${plan.daysUntilDue === 1 ? "" : "s"}`,
      detail: "Time left until the target date."
    },
    {
      label: "Daily focus",
      value: `${plan.minutesPerStudyDay} min`,
      detail: "Recommended minutes on each full study day."
    },
    {
      label: "Sessions",
      value: `${plan.sessionsPerStudyDay} blocks`,
      detail: "Each day is split into manageable focus sessions."
    },
    {
      label: "Readiness",
      value: plan.readiness.label,
      detail: plan.readiness.detail
    }
  ];

  stats.forEach((stat) => {
    const card = document.createElement("article");
    card.className = "panel stat-card";
    card.innerHTML = `
      <span class="section-label">${escapeHtml(stat.label)}</span>
      <strong>${escapeHtml(stat.value)}</strong>
      <p>${escapeHtml(stat.detail)}</p>
    `;
    statsGrid.appendChild(card);
  });

  plan.days.forEach((day, index) => {
    const card = document.createElement("article");
    card.className = "daily-card";
    card.innerHTML = `
      <div class="daily-card-head">
        <div>
          <p class="section-label">${escapeHtml(day.label)}</p>
          <h4>${escapeHtml(day.title)}</h4>
          <p>${escapeHtml(day.description)}</p>
        </div>
        <span class="day-badge">${escapeHtml(day.phaseLabel)}</span>
      </div>
      <p><strong>${day.sessionCount}</strong> study block${day.sessionCount === 1 ? "" : "s"} for about <strong>${day.minutes}</strong> minutes total.</p>
      <ul class="task-list">
        ${day.tasks
          .map(
            (task, taskIndex) => `
              <li>
                <input id="day-${index}-task-${taskIndex}" type="checkbox" class="progress-check">
                <label for="day-${index}-task-${taskIndex}">${escapeHtml(task)}</label>
              </li>
            `
          )
          .join("")}
      </ul>
    `;
    dailyPlan.appendChild(card);
  });

  attachProgressListeners(plan.readiness);
  outputSection.scrollIntoView({ behavior: "smooth", block: "start" });
}

function renderApiStatus() {
  if (appConfig.apiBaseUrl) {
    apiStatus.textContent = `AI mode is configured. This site will request study plans from ${getHostLabel(appConfig.apiBaseUrl)}.`;
    return;
  }

  apiStatus.textContent = "AI mode is not configured yet. Add your backend URL in config.js. Until then, the app will show a local demo plan after a failed AI request.";
}

function setLoadingState(isLoading) {
  submitButton.disabled = isLoading;
  submitButton.textContent = isLoading ? "Generating with AI..." : "Generate AI study plan";
}

function setFormStatus(message, tone) {
  formStatus.textContent = message;
  formStatus.className = `status-message status-${tone}`;
}

function getFriendlyErrorMessage(error) {
  const message = sanitizeText(error?.message || "Unknown error.");

  if (message.includes("not configured")) {
    return "AI backend isn't connected yet. Add the backend URL in config.js. Showing the local demo plan for now.";
  }

  if (message.includes("OPENAI_API_KEY")) {
    return "The AI backend is running, but it is missing its OpenAI API key. Showing the local demo plan for now.";
  }

  if (message.includes("Failed to fetch")) {
    return "The AI backend could not be reached from the browser. Check the backend URL and CORS settings. Showing the local demo plan for now.";
  }

  return `AI request failed: ${message} Showing the local demo plan for now.`;
}

function attachProgressListeners(readiness) {
  const checkboxes = Array.from(document.querySelectorAll(".progress-check"));
  updateProgress(checkboxes, readiness);

  checkboxes.forEach((checkbox) => {
    checkbox.addEventListener("change", () => updateProgress(checkboxes, readiness));
  });
}

function updateProgress(checkboxes, readiness) {
  if (!checkboxes.length) {
    return;
  }

  const completedCount = checkboxes.filter((checkbox) => checkbox.checked).length;
  const completion = Math.round((completedCount / checkboxes.length) * 100);
  progressValue.textContent = `${completion}%`;
  progressFill.style.width = `${completion}%`;

  if (completion === 0) {
    feedbackText.textContent = "Start with the first task. Momentum matters more than perfection.";
  } else if (completion < 40) {
    feedbackText.textContent = "Nice start. Protect your next study block so the plan becomes a routine.";
  } else if (completion < 80) {
    feedbackText.textContent = `You're building consistency. ${readiness.supportiveNudge}`;
  } else {
    feedbackText.textContent = "Strong follow-through. Finish the last tasks and do one quick self-check before the deadline.";
  }
}

function buildFallbackStudyPlan(studentData) {
  const daysUntilDue = getDaysUntil(studentData.dueDate);
  const visibleDays = Math.min(Math.max(daysUntilDue, 1), 7);
  const studyDaysPerWeek = clamp(
    Math.round(studentData.weeklyHours <= 4 ? 4 : studentData.weeklyHours <= 8 ? 5 : 6),
    3,
    6
  );
  const weeklyMinutes = studentData.weeklyHours * 60;
  const minutesPerStudyDay = roundToNearestFive(weeklyMinutes / studyDaysPerWeek);
  const sessionsPerStudyDay = clamp(Math.round(minutesPerStudyDay / studentData.sessionLength), 1, 4);
  const readiness = evaluateReadiness(studentData, daysUntilDue);
  const days = [];

  for (let index = 0; index < visibleDays; index += 1) {
    const date = new Date(today);
    date.setDate(today.getDate() + index);

    const phase = getPhase(index, visibleDays, daysUntilDue);
    const topic = studentData.subjects[index % studentData.subjects.length];
    const isRecoveryDay = visibleDays >= 5 && index === visibleDays - 2;
    const sessionCount = isRecoveryDay ? Math.max(1, sessionsPerStudyDay - 1) : sessionsPerStudyDay;
    const minutes = isRecoveryDay
      ? Math.max(studentData.sessionLength, roundToNearestFive(minutesPerStudyDay * 0.7))
      : minutesPerStudyDay;
    const tasks = buildTasks({
      gradeLevel: studentData.gradeLevel,
      goal: studentData.goal,
      phase,
      topic,
      distraction: studentData.distraction,
      confidence: studentData.confidence,
      isRecoveryDay
    });

    days.push({
      label: formatPlanDate(date),
      title: isRecoveryDay ? `Light review for ${topic}` : `${phase.title} for ${topic}`,
      phaseLabel: isRecoveryDay ? "Recovery block" : phase.badge,
      description: isRecoveryDay
        ? "Keep the habit alive without burning out. Use shorter blocks and leave with one clear win."
        : phase.description,
      sessionCount,
      minutes,
      tasks
    });
  }

  return {
    daysUntilDue,
    visibleDays,
    studyDaysPerWeek,
    weeklyMinutes,
    minutesPerStudyDay,
    sessionsPerStudyDay,
    readiness,
    days,
    focusTip: getFocusTip(studentData.distraction, studentData.sessionLength),
    coachNote: getCoachNote(studentData, readiness),
    planSummary: buildSummary(studentData, daysUntilDue, sessionsPerStudyDay, visibleDays)
  };
}

function buildTasks({ gradeLevel, goal, phase, topic, distraction, confidence, isRecoveryDay }) {
  if (isRecoveryDay) {
    return [
      `Do a 10-minute recall sprint on ${topic} without looking at notes.`,
      "Review mistakes from earlier sessions and circle the one concept that still feels shaky.",
      getDistractionTask(distraction)
    ];
  }

  const tasks = [
    phase.opening.replace("{topic}", topic),
    phase.core.replace("{topic}", topic),
    phase.close.replace("{goal}", goal).replace("{topic}", topic)
  ];

  if (confidence <= 2) {
    tasks.push(`Spend 5 extra minutes rewriting the hardest ${topic} idea in your own words.`);
  }

  if (gradeLevel === "middle-school") {
    tasks.push("End by telling a parent, friend, or empty room the main idea in simple words.");
  } else {
    tasks.push("Finish with a 2-minute self-rating: what feels solid, confusing, or unfinished?");
  }

  tasks.push(getDistractionTask(distraction));
  return tasks;
}

function getPhase(index, totalDays, daysUntilDue) {
  const progress = totalDays === 1 ? 1 : index / (totalDays - 1);

  if (daysUntilDue <= 2 || progress > 0.72) {
    return {
      title: "Review and test yourself",
      badge: "Review phase",
      description: "Shift from rereading to checking what you can do without help.",
      opening: "Spend 5 minutes listing everything you remember about {topic}.",
      core: "Do a timed practice round on {topic} and mark every mistake.",
      close: "Wrap up by writing one short answer about how today's work supports: {goal}"
    };
  }

  if (progress > 0.38) {
    return {
      title: "Practice and apply",
      badge: "Practice phase",
      description: "Use examples, problems, or questions so the material sticks.",
      opening: "Preview yesterday's notes for {topic} and highlight the weakest part.",
      core: "Work through active practice on {topic} instead of just rereading.",
      close: "Write an exit ticket for {topic}: what was easy, what still needs work, and why it matters for {goal}"
    };
  }

  return {
    title: "Learn the basics",
    badge: "Foundation phase",
    description: "Build clear notes, definitions, and examples before moving into speed.",
    opening: "Skim class material for {topic} and pull out the top three ideas.",
    core: "Create a summary, flashcards, or guided notes for {topic}.",
    close: "Check understanding by explaining {topic} out loud and tying it back to {goal}"
  };
}

function evaluateReadiness(studentData, daysUntilDue) {
  const topicLoad = studentData.subjects.length;
  const weeklyCapacity = studentData.weeklyHours * Math.max(daysUntilDue, 1) / 7;
  const pressureScore =
    topicLoad * 1.4 +
    (6 - studentData.confidence) +
    (studentData.distraction === "motivation" ? 1.2 : 0.7);

  if (weeklyCapacity < pressureScore) {
    return {
      label: "Tight",
      detail: "There is enough time to make progress, but the app is recommending short, focused sessions every day.",
      supportiveNudge: "Stay with the plan even if each session is short."
    };
  }

  if (weeklyCapacity < pressureScore + 3) {
    return {
      label: "Balanced",
      detail: "Your time and topic load are fairly matched if you stay consistent.",
      supportiveNudge: "Keep using active recall so your minutes count."
    };
  }

  return {
    label: "Strong",
    detail: "You have enough time to study with review built in before the deadline.",
    supportiveNudge: "Use the extra time to quiz yourself, not just reread."
  };
}

function getFocusTip(distraction, sessionLength) {
  const tips = {
    phone: `Put your phone in another room before each ${sessionLength}-minute block and check it only during the break.`,
    noise: `Use one predictable sound environment for every ${sessionLength}-minute session so your brain starts faster.`,
    motivation: `Shrink the first step. Promise yourself just five minutes, then let the timer carry you into the full ${sessionLength}-minute block.`,
    multitasking: "Keep one tab, one notebook, and one goal visible. Hidden tabs become surprise distractions."
  };

  return tips[distraction];
}

function getCoachNote(studentData, readiness) {
  if (studentData.confidence <= 2) {
    return `Confidence is low right now, so this plan leans on smaller wins. ${readiness.supportiveNudge}`;
  }

  if (studentData.gradeLevel === "middle-school") {
    return "The plan uses shorter explanations and verbal check-ins so studying feels less overwhelming.";
  }

  return "The plan assumes the student can handle independent work, but still needs structure to avoid procrastination.";
}

function buildSummary(studentData, daysUntilDue, sessionsPerStudyDay, visibleDays) {
  const subjectLine = studentData.subjects.join(", ");
  return `Built for ${studentData.studentName} with ${sessionsPerStudyDay} focus block${sessionsPerStudyDay === 1 ? "" : "s"} per study day across the next ${visibleDays} day${visibleDays === 1 ? "" : "s"}. Deadline: ${daysUntilDue} day${daysUntilDue === 1 ? "" : "s"} away. Topics: ${subjectLine}.`;
}

function getDistractionTask(distraction) {
  const prompts = {
    phone: "Place your phone out of reach before starting this block.",
    noise: "Choose your quietest available spot and use headphones if possible.",
    motivation: "Start with the easiest question first so the session has a quick win.",
    multitasking: "Close every unrelated tab before you begin the next task."
  };

  return prompts[distraction];
}

function splitTopics(rawValue) {
  return String(rawValue)
    .split(/[,\n]/)
    .map((item) => sanitizeText(item))
    .filter(Boolean);
}

function sanitizeText(value) {
  return String(value || "").trim().replace(/\s+/g, " ");
}

function sanitizeEndpoint(value) {
  return sanitizeText(value).replace(/\/+$/, "");
}

function getHostLabel(url) {
  try {
    return new URL(url).host;
  } catch (error) {
    return url;
  }
}

function getDaysUntil(dueDate) {
  const msPerDay = 1000 * 60 * 60 * 24;
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const difference = dueDate.getTime() - todayStart.getTime();
  return Math.max(1, Math.ceil(difference / msPerDay));
}

function roundToNearestFive(value) {
  return Math.max(25, Math.round(value / 5) * 5);
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function toDateInputValue(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatPlanDate(date) {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric"
  }).format(date);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
