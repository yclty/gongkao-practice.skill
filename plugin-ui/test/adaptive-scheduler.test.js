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


test("route mode creates a focused deep-study request", () => {
  const s = state({
    study_route: {
      current_step_id: "route_step_01",
      steps: [
        { id: "route_step_01", module: "资料分析", subtype: "增长率", title: "资料分析 · 增长率", status: "active" }
      ]
    }
  });
  const plan = planAdaptiveTraining(
    s,
    { session_mode: "route" },
    "2026-10-02T13:00:00Z"
  );
  assert.equal(plan.session_mode, "route");
  assert.equal(plan.planned_questions, 10);
  assert.equal(plan.target.subtype, "增长率");
  assert.equal(plan.question_request.tool, "start_quiz_from_bank");
});

test("set mode creates a 20-question balanced set", () => {
  const plan = planAdaptiveTraining(
    state({
      study_route: {
        current_step_id: "r1",
        steps: [
          { id: "r1", module: "资料分析", title: "资料分析", status: "active" },
          { id: "r2", module: "判断推理", title: "判断推理", status: "pending" },
          { id: "r3", module: "言语理解与表达", title: "言语", status: "pending" },
          { id: "r4", module: "数量关系", title: "数量", status: "pending" },
          { id: "r5", module: "常识判断", title: "常识", status: "pending" }
        ]
      }
    }),
    { session_mode: "set" },
    "2026-10-02T13:00:00Z"
  );
  assert.equal(plan.session_mode, "set");
  assert.equal(plan.planned_questions, 20);
  assert.equal(plan.question_request.targets.length, 5);
  assert.equal(
    plan.question_request.targets.reduce((sum, item) => sum + item.count, 0),
    20
  );
});

test("paper mode routes to the real-paper tool", () => {
  const plan = planAdaptiveTraining(
    state(),
    { session_mode: "paper", paper_id: "saduck_p_1" },
    "2026-10-02T13:00:00Z"
  );
  assert.equal(plan.session_mode, "paper");
  assert.equal(plan.question_request.tool, "start_paper_from_bank");
  assert.equal(plan.question_request.paper_id, "saduck_p_1");
});

test("quick mode stays intentionally short", () => {
  const plan = planAdaptiveTraining(
    state(),
    { session_mode: "quick" },
    "2026-10-02T13:00:00Z"
  );
  assert.equal(plan.session_mode, "quick");
  assert.equal(plan.planned_questions, 3);
});
