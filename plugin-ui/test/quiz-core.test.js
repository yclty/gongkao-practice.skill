import test from "node:test";
import assert from "node:assert/strict";
import {
  evaluateQuestion,
  publicQuestion,
  speedStatus,
  summarizeSession,
} from "../lib/quiz-core.js";

const question = {
  question_id: "q1",
  module: "资料分析",
  subtype: "增长率",
  source_type: "real",
  stem: "test",
  options: [
    { label: "A", text: "1" },
    { label: "B", text: "2" },
    { label: "C", text: "3" },
    { label: "D", text: "4" },
  ],
  correct_answer: "C",
  target_seconds: 50,
  fastest_method: "fast",
  explanation_short: "short",
  explanation_full: "full",
};

test("publicQuestion never exposes the correct answer", () => {
  const payload = publicQuestion(question, 0, 3);
  assert.equal(payload.question_id, "q1");
  assert.equal(payload.progress.current, 1);
  assert.equal(payload.progress.total, 3);
  assert.equal("correct_answer" in payload, false);
});

test("evaluateQuestion grades answers and speed", () => {
  const correct = evaluateQuestion(question, "c", 35);
  assert.equal(correct.correct, true);
  assert.equal(correct.speed_status, "ok");
  assert.equal(correct.error_code, null);

  const slow = evaluateQuestion(question, "C", 70);
  assert.equal(slow.correct, true);
  assert.equal(slow.speed_status, "slow");
  assert.equal(slow.error_code, "S");

  const wrong = evaluateQuestion(question, "B", 40);
  assert.equal(wrong.correct, false);
  assert.equal(wrong.correct_answer, "C");
});

test("speedStatus is unknown without a valid target", () => {
  assert.equal(speedStatus({ ...question, target_seconds: undefined }, 30), "unknown");
});

test("summarizeSession aggregates accuracy, time and error codes", () => {
  const summary = summarizeSession({
    attempts: [
      { correct: true, elapsed_seconds: 20, error_code: null },
      { correct: false, elapsed_seconds: 30, error_code: "M" },
      { correct: true, elapsed_seconds: 70, error_code: "S" },
    ],
  });
  assert.equal(summary.answered, 3);
  assert.equal(summary.correct, 2);
  assert.equal(summary.active_seconds, 120);
  assert.deepEqual(summary.error_counts, { M: 1, S: 1 });
});
