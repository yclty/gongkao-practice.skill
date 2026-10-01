export const ERROR_CODES = ["K", "M", "U", "R", "C", "D", "T", "G", "S"];

export function publicQuestion(question, index, total) {
  return {
    question_id: question.question_id,
    module: question.module,
    subtype: question.subtype ?? null,
    source_type: question.source_type ?? "practice",
    stem: question.stem,
    material: question.material ?? null,
    options: question.options,
    target_seconds: question.target_seconds ?? null,
    progress: {
      current: index + 1,
      total,
    },
  };
}

export function speedStatus(question, elapsedSeconds) {
  const target = question.target_seconds;
  if (!Number.isFinite(target) || target <= 0 || !Number.isFinite(elapsedSeconds)) {
    return "unknown";
  }
  return elapsedSeconds <= target ? "ok" : "slow";
}

export function evaluateQuestion(question, answer, elapsedSeconds) {
  const normalized = String(answer ?? "").trim().toUpperCase();
  const correct = normalized === question.correct_answer;
  const speed = speedStatus(question, elapsedSeconds);
  return {
    answer: normalized,
    correct,
    correct_answer: question.correct_answer,
    elapsed_seconds: Number.isFinite(elapsedSeconds) ? elapsedSeconds : null,
    speed_status: speed,
    error_code: correct && speed === "slow" ? "S" : null,
    fastest_method: question.fastest_method ?? "",
    explanation_short: question.explanation_short ?? "",
    explanation_full: question.explanation_full ?? question.explanation_short ?? "",
  };
}

export function summarizeSession(session) {
  const answered = session.attempts.length;
  const correct = session.attempts.filter((item) => item.correct).length;
  const activeSeconds = session.attempts.reduce(
    (sum, item) => sum + (Number.isFinite(item.elapsed_seconds) ? item.elapsed_seconds : 0),
    0
  );
  const errorCounts = {};
  for (const item of session.attempts) {
    if (!item.error_code) continue;
    errorCounts[item.error_code] = (errorCounts[item.error_code] ?? 0) + 1;
  }
  return {
    answered,
    correct,
    accuracy: answered ? correct / answered : 0,
    active_seconds: activeSeconds,
    error_counts: errorCounts,
  };
}
