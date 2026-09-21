export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: corsHeaders()
      });
    }

    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/") {
      return jsonResponse({
        ok: true,
        message: "Lock-In study plan API is running."
      });
    }

    if (request.method !== "POST" || url.pathname !== "/study-plan") {
      return jsonResponse(
        {
          error: "Not found."
        },
        404
      );
    }

    if (!env.OPENAI_API_KEY) {
      return jsonResponse(
        {
          error: "Server missing OPENAI_API_KEY."
        },
        500
      );
    }

    try {
      const body = await request.json();
      const studentData = normalizeStudentData(body?.studentData);
      const daysUntilDue = getDaysUntil(studentData.dueDate);

      const openAIResponse = await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${env.OPENAI_API_KEY}`
        },
        body: JSON.stringify({
          model: env.OPENAI_MODEL || "gpt-5.4-mini",
          reasoning: { effort: "low" },
          input: [
            {
              role: "developer",
              content: buildSystemPrompt()
            },
            {
              role: "user",
              content: JSON.stringify(
                {
                  studentData,
                  daysUntilDue
                },
                null,
                2
              )
            }
          ]
        })
      });

      const openAIData = await openAIResponse.json();

      if (!openAIResponse.ok) {
        return jsonResponse(
          {
            error: openAIData?.error?.message || "OpenAI request failed."
          },
          openAIResponse.status
        );
      }

      const outputText = extractOutputText(openAIData);
      const parsedPlan = parsePlanJson(outputText);
      const normalizedPlan = normalizePlan(parsedPlan, studentData, daysUntilDue);

      return jsonResponse({
        model: env.OPENAI_MODEL || "gpt-5.4-mini",
        plan: normalizedPlan
      });
    } catch (error) {
      return jsonResponse(
        {
          error: error instanceof Error ? error.message : "Unexpected server error."
        },
        500
      );
    }
  }
};

function buildSystemPrompt() {
  return [
    "You generate study plans for middle-school and high-school students.",
    "Return JSON only. Do not wrap the JSON in markdown.",
    "Be practical, encouraging, and anti-procrastination focused.",
    "Use timed focus blocks, active recall, practice questions, and short feedback loops.",
    "Keep wording age-appropriate and concrete.",
    "Never mention being an AI or include disclaimers.",
    "Use this exact JSON shape:",
    "{",
    '  "planSummary": "string",',
    '  "focusTip": "string",',
    '  "coachNote": "string",',
    '  "minutesPerStudyDay": 45,',
    '  "sessionsPerStudyDay": 2,',
    '  "readiness": {',
    '    "label": "Tight or Balanced or Strong",',
    '    "detail": "string",',
    '    "supportiveNudge": "string"',
    "  },",
    '  "days": [',
    "    {",
    '      "label": "Mon, Apr 28",',
    '      "title": "string",',
    '      "phaseLabel": "string",',
    '      "description": "string",',
    '      "sessionCount": 2,',
    '      "minutes": 45,',
    '      "tasks": ["string", "string", "string"]',
    "    }",
    "  ]",
    "}",
    "Rules:",
    "- Return between 1 and 7 day objects.",
    "- Match the deadline urgency and time budget.",
    "- Each day should have 3 to 5 tasks.",
    "- Tasks should be specific enough for a student to act on immediately.",
    "- Make the plan realistic for the student's grade level and confidence."
  ].join("\n");
}

function normalizeStudentData(studentData) {
  const subjects = Array.isArray(studentData?.subjects)
    ? studentData.subjects.map((item) => sanitizeText(item)).filter(Boolean)
    : [];

  if (!subjects.length) {
    throw new Error("Student data is missing subjects.");
  }

  const goal = sanitizeText(studentData?.goal);
  if (!goal) {
    throw new Error("Student data is missing a goal.");
  }

  const dueDate = sanitizeText(studentData?.dueDate);
  if (!dueDate) {
    throw new Error("Student data is missing a due date.");
  }

  return {
    studentName: sanitizeText(studentData?.studentName) || "Student",
    gradeLevel: sanitizeText(studentData?.gradeLevel) || "high-school",
    subjects,
    goal,
    weeklyHours: clampNumber(studentData?.weeklyHours, 1, 30, 6),
    sessionLength: clampNumber(studentData?.sessionLength, 25, 50, 40),
    dueDate,
    confidence: clampNumber(studentData?.confidence, 1, 5, 3),
    distraction: sanitizeText(studentData?.distraction) || "phone"
  };
}

function normalizePlan(plan, studentData, daysUntilDue) {
  const dueDate = new Date(`${studentData.dueDate}T12:00:00`);
  const days = Array.isArray(plan?.days) ? plan.days.slice(0, 7) : [];

  if (!days.length) {
    throw new Error("The model response did not include any study days.");
  }

  const normalizedDays = days.map((day, index) => {
    const date = new Date(dueDate);
    date.setDate(date.getDate() - (days.length - 1 - index));

    const tasks = Array.isArray(day?.tasks)
      ? day.tasks.map((task) => sanitizeText(task)).filter(Boolean).slice(0, 6)
      : [];

    return {
      label: sanitizeText(day?.label) || formatPlanDate(date),
      title: sanitizeText(day?.title) || `Study block for ${studentData.subjects[index % studentData.subjects.length]}`,
      phaseLabel: sanitizeText(day?.phaseLabel) || "AI plan",
      description: sanitizeText(day?.description) || "Follow the tasks in order and finish with a quick self-check.",
      sessionCount: clampNumber(day?.sessionCount, 1, 4, 2),
      minutes: roundToNearestFive(clampNumber(day?.minutes, 25, 240, studentData.sessionLength * 2)),
      tasks: tasks.length ? tasks : ["Review notes.", "Practice questions.", "Write one takeaway."]
    };
  });

  return {
    daysUntilDue,
    minutesPerStudyDay: roundToNearestFive(
      clampNumber(
        plan?.minutesPerStudyDay,
        25,
        240,
        Math.round(normalizedDays.reduce((sum, day) => sum + day.minutes, 0) / normalizedDays.length)
      )
    ),
    sessionsPerStudyDay: clampNumber(
      plan?.sessionsPerStudyDay,
      1,
      4,
      Math.round(normalizedDays.reduce((sum, day) => sum + day.sessionCount, 0) / normalizedDays.length)
    ),
    readiness: {
      label: sanitizeText(plan?.readiness?.label) || "Balanced",
      detail: sanitizeText(plan?.readiness?.detail) || "This plan is paced to be realistic if the student stays consistent.",
      supportiveNudge: sanitizeText(plan?.readiness?.supportiveNudge) || "Keep showing up for the next block."
    },
    focusTip: sanitizeText(plan?.focusTip) || "Protect the first five minutes of each study block and start before motivation catches up.",
    coachNote: sanitizeText(plan?.coachNote) || "This plan is meant to reduce procrastination by making each session easy to start.",
    planSummary:
      sanitizeText(plan?.planSummary) ||
      `AI study plan for ${studentData.studentName} across the next ${normalizedDays.length} day${normalizedDays.length === 1 ? "" : "s"}.`,
    days: normalizedDays
  };
}

function extractOutputText(responseData) {
  if (typeof responseData?.output_text === "string" && responseData.output_text.trim()) {
    return responseData.output_text;
  }

  const outputItems = Array.isArray(responseData?.output) ? responseData.output : [];
  const textParts = [];

  outputItems.forEach((item) => {
    if (item?.type !== "message" || !Array.isArray(item?.content)) {
      return;
    }

    item.content.forEach((contentItem) => {
      if (contentItem?.type === "output_text" && typeof contentItem.text === "string") {
        textParts.push(contentItem.text);
      }
    });
  });

  const outputText = textParts.join("\n").trim();
  if (!outputText) {
    throw new Error("No text output was returned by the model.");
  }

  return outputText;
}

function parsePlanJson(outputText) {
  const cleaned = outputText
    .trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/, "");

  try {
    return JSON.parse(cleaned);
  } catch (error) {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");

    if (start === -1 || end === -1 || end <= start) {
      throw new Error("Model output did not contain valid JSON.");
    }

    return JSON.parse(cleaned.slice(start, end + 1));
  }
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...corsHeaders()
    }
  });
}

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  };
}

function sanitizeText(value) {
  return String(value || "").trim().replace(/\s+/g, " ");
}

function clampNumber(value, min, max, fallback) {
  const parsed = Number(value);
  if (Number.isNaN(parsed)) {
    return fallback;
  }

  return Math.min(Math.max(parsed, min), max);
}

function getDaysUntil(dueDateString) {
  const dueDate = new Date(`${dueDateString}T12:00:00`);
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const difference = dueDate.getTime() - todayStart.getTime();
  const msPerDay = 1000 * 60 * 60 * 24;
  return Math.max(1, Math.ceil(difference / msPerDay));
}

function roundToNearestFive(value) {
  return Math.max(25, Math.round(Number(value) / 5) * 5);
}

function formatPlanDate(date) {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric"
  }).format(date);
}
