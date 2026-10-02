import test from "node:test";
import assert from "node:assert/strict";
import { launcherForState, planAdaptiveTraining } from "../lib/adaptive-scheduler.js";

function state(overrides = {}) {
  return {
    project_state_id: "ps_test",
    goal: { exam_targets: ["国考"] },
    ability_profile: { subtypes: {} },
    review_queue: [],
    recent_question_ids: [],
    recent_attempts: [],
    unfinished_session: null,
    ...overrides,
  };
}

test("default start is open-ended and does not require a time budget", () => {
  const plan = planAdaptiveTraining(state(), { intent: "start" }, "2026-10-02T00:00:00Z");
  assert.equal(plan.open_ended, true);
  assert.equal(plan.available_minutes, null);
  assert.equal(plan.atomic_batch_questions, 3);
  assert.equal(plan.strategy, "baseline");
});

test("due review beats weak-area training on normal start", () => {
  const s = state({
    ability_profile: {
      subtypes: {
        "资料分析::两期比重": {
          module: "资料分析",
          subtype: "两期比重",
          sample_count: 15,
          mastery: 30,
          error_counts_30: { M: 4 },
        },
      },
    },
    review_queue: [
      {
        anchor_question_id: "q1",
        module: "判断推理",
        subtype: "加强削弱",
        due_at: "2026-10-01T00:00:00Z",
      },
    ],
  });
  const plan = planAdaptiveTraining(s, { intent: "start" }, "2026-10-02T00:00:00Z");
  assert.equal(plan.strategy, "due_review_first");
  assert.equal(plan.target.module, "判断推理");
});

test("time is an optional explicit mode, not the default", () => {
  const plan = planAdaptiveTraining(
    state(),
    { intent: "start", available_minutes: 10 },
    "2026-10-02T00:00:00Z"
  );
  assert.equal(plan.open_ended, false);
  assert.equal(plan.planned_questions, 5);
  assert.equal(plan.atomic_batch_questions, 3);
});

test("unfinished session is resumed before making a new plan", () => {
  const s = state({
    unfinished_session: {
      project_state_id: "ps_test",
      target: { module: "资料分析", subtype: "增长率" },
      remaining_questions: ["q2", "q3"],
    },
  });
  const plan = planAdaptiveTraining(s, { intent: "start" }, "2026-10-02T00:00:00Z");
  assert.equal(plan.strategy, "resume");
  assert.equal(plan.atomic_batch_questions, 2);
});

test("launcher gives a single obvious primary action", () => {
  const first = launcherForState(state());
  assert.equal(first.primary_action.label, "直接开始");
  assert.equal(first.secondary_actions.length, 3);

  const returning = launcherForState(
    state({
      recent_attempts: [{ question_id: "q1" }],
      unfinished_session: { project_state_id: "ps_test" },
    })
  );
  assert.equal(returning.primary_action.label, "继续上次");
});
