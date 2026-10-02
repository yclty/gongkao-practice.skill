import { randomUUID } from "node:crypto";

const REVIEW_INTERVAL_DAYS = [1, 3, 7, 14, 30];
const MAX_RECENT_QUESTION_IDS = 1000;
const MAX_RECENT_ATTEMPTS = 300;
const MAX_SUBTYPE_SAMPLES = 30;

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function isoNow(now) {
  if (now instanceof Date) return now.toISOString();
  if (typeof now === "string" && now.trim()) return new Date(now).toISOString();
  return new Date().toISOString();
}

function projectId() {
  return `ps_${randomUUID().replaceAll("-", "")}`;
}

function emptyState({ goal = {}, now } = {}) {
  const timestamp = isoNow(now);
  return {
    schema_version: "0.7",
    project_state_id: projectId(),
    revision: 0,
    initialized_at: timestamp,
    updated_at: timestamp,
    goal: clone(goal),
    ability_profile: { subtypes: {} },
    review_queue: [],
    recent_question_ids: [],
    recent_attempts: [],
    unfinished_session: null,
    last_session_summary: null,
  };
}

export function createProjectLearningState(input = {}) {
  return emptyState(input);
}

export function assertProjectState(state) {
  if (!state || state.schema_version !== "0.7") {
    throw new Error("Unsupported or missing project learning state schema");
  }
  if (!String(state.project_state_id || "").startsWith("ps_")) {
    throw new Error("Missing valid project_state_id");
  }
  return state;
}

function subtypeKey(module, subtype) {
  return `${module || "UNKNOWN"}::${subtype || "UNKNOWN"}`;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function average(values) {
  if (!values.length) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function computeSubtype(existing, attempt) {
  const samples = [
    ...(existing?.recent_samples ?? []),
    {
      question_id: attempt.question_id,
      correct: Boolean(attempt.correct),
      elapsed_seconds: Number.isFinite(attempt.elapsed_seconds)
        ? attempt.elapsed_seconds
        : null,
      speed_status: attempt.speed_status ?? "unknown",
      error_code: attempt.error_code ?? null,
      attempted_at: attempt.attempted_at,
    },
  ].slice(-MAX_SUBTYPE_SAMPLES);

  const validTimes = samples
    .map((item) => item.elapsed_seconds)
    .filter((value) => Number.isFinite(value));
  const correctCount = samples.filter((item) => item.correct).length;
  const accuracy = samples.length ? correctCount / samples.length : null;
  const slowRate = samples.length
    ? samples.filter((item) => item.speed_status === "slow").length / samples.length
    : 0;

  const rawScore = accuracy === null
    ? null
    : clamp(Math.round(accuracy * 100 - Math.min(15, slowRate * 20)), 0, 100);

  const totalSampleCount = (existing?.sample_count ?? 0) + 1;
  let mastery = existing?.mastery ?? null;
  if (samples.length >= 5 && rawScore !== null) {
    mastery = mastery === null
      ? rawScore
      : clamp(Math.round(mastery * 0.8 + rawScore * 0.2), 0, 100);
  }

  const errorCounts = {};
  for (const sample of samples) {
    if (!sample.error_code) continue;
    errorCounts[sample.error_code] = (errorCounts[sample.error_code] ?? 0) + 1;
  }

  return {
    module: attempt.module || existing?.module || "UNKNOWN",
    subtype: attempt.subtype || existing?.subtype || "UNKNOWN",
    sample_count: totalSampleCount,
    recent_sample_count: samples.length,
    accuracy_30: accuracy === null ? null : Number(accuracy.toFixed(4)),
    avg_seconds_30: validTimes.length
      ? Number(average(validTimes).toFixed(2))
      : null,
    mastery,
    error_counts_30: errorCounts,
    last_practiced_at: attempt.attempted_at,
    recent_samples: samples,
  };
}

function addDays(iso, days) {
  const date = new Date(iso);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString();
}

function updateReviewQueue(queue, attempt) {
  const next = [...queue];
  const index = next.findIndex(
    (item) => item.anchor_question_id === attempt.question_id
  );
  const existing = index >= 0 ? next[index] : null;

  const shouldReview = !attempt.correct || attempt.speed_status === "slow" || existing;
  if (!shouldReview) return next;

  let stage = existing?.stage ?? 0;
  let lastResult = "correct";

  if (!attempt.correct) {
    stage = Math.max(0, stage - 1);
    lastResult = "wrong";
  } else if (attempt.speed_status === "slow") {
    lastResult = "slow";
  } else {
    stage = Math.min(REVIEW_INTERVAL_DAYS.length - 1, stage + 1);
  }

  const item = {
    anchor_question_id: attempt.question_id,
    module: attempt.module || existing?.module || "UNKNOWN",
    subtype: attempt.subtype || existing?.subtype || "UNKNOWN",
    stage,
    due_at: addDays(attempt.attempted_at, REVIEW_INTERVAL_DAYS[stage]),
    review_mode: "sibling_preferred",
    last_result: lastResult,
    source_type: attempt.source_type ?? existing?.source_type ?? null,
  };

  if (index >= 0) next[index] = item;
  else next.push(item);

  return next.sort((a, b) => a.due_at.localeCompare(b.due_at));
}

function appendUniqueRecent(ids, questionId) {
  return [...ids.filter((id) => id !== questionId), questionId].slice(
    -MAX_RECENT_QUESTION_IDS
  );
}

function normalizeAttempt(attempt, timestamp) {
  if (!attempt?.question_id) throw new Error("attempt.question_id is required");
  if (!attempt?.module) throw new Error("attempt.module is required");

  return {
    question_id: String(attempt.question_id),
    module: String(attempt.module),
    subtype: attempt.subtype ? String(attempt.subtype) : "UNKNOWN",
    source_type: attempt.source_type ?? "practice",
    exam_type: attempt.exam_type ?? null,
    correct: Boolean(attempt.correct),
    elapsed_seconds: Number.isFinite(attempt.elapsed_seconds)
      ? attempt.elapsed_seconds
      : null,
    speed_status: attempt.speed_status ?? "unknown",
    error_code: attempt.error_code ?? null,
    attempted_at: attempt.attempted_at
      ? new Date(attempt.attempted_at).toISOString()
      : timestamp,
  };
}

export function applyProjectLearningEvents(state, attempts, options = {}) {
  assertProjectState(state);
  if (!Array.isArray(attempts)) throw new Error("attempts must be an array");

  const next = clone(state);
  const timestamp = isoNow(options.now);
  const normalized = attempts.map((attempt) => normalizeAttempt(attempt, timestamp));

  for (const attempt of normalized) {
    const key = subtypeKey(attempt.module, attempt.subtype);
    next.ability_profile.subtypes[key] = computeSubtype(
      next.ability_profile.subtypes[key],
      attempt
    );
    next.review_queue = updateReviewQueue(next.review_queue, attempt);
    next.recent_question_ids = appendUniqueRecent(
      next.recent_question_ids,
      attempt.question_id
    );
    next.recent_attempts.push(attempt);
  }

  next.recent_attempts = next.recent_attempts.slice(-MAX_RECENT_ATTEMPTS);
  next.revision += 1;
  next.updated_at = timestamp;

  if (options.session_summary) {
    next.last_session_summary = {
      ...clone(options.session_summary),
      project_state_id: next.project_state_id,
      saved_at: timestamp,
    };
  }
  if (options.session_completed === true) {
    next.unfinished_session = null;
  } else if (options.unfinished_session) {
    next.unfinished_session = {
      ...clone(options.unfinished_session),
      project_state_id: next.project_state_id,
    };
  }

  return {
    state: next,
    patch: {
      project_state_id: next.project_state_id,
      from_revision: state.revision,
      to_revision: next.revision,
      attempts_applied: normalized.length,
      touched_subtypes: [
        ...new Set(normalized.map((item) => subtypeKey(item.module, item.subtype))),
      ],
      review_queue_size: next.review_queue.length,
      recent_question_ids: next.recent_question_ids,
    },
  };
}

export function assertSessionProjectMatch(state, projectStateId) {
  assertProjectState(state);
  if (!projectStateId) return true;
  if (state.project_state_id !== projectStateId) {
    throw new Error(
      `Project mismatch: session belongs to ${projectStateId}, current state is ${state.project_state_id}`
    );
  }
  return true;
}
