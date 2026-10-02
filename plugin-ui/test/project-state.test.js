import test from "node:test";
import assert from "node:assert/strict";
import {
  applyProjectLearningEvents,
  assertSessionProjectMatch,
  createProjectLearningState,
} from "../lib/project-state.js";

test("each project initializes with an independent project_state_id", () => {
  const a = createProjectLearningState({ now: "2026-10-02T00:00:00Z" });
  const b = createProjectLearningState({ now: "2026-10-02T00:00:00Z" });
  assert.notEqual(a.project_state_id, b.project_state_id);
  assert.equal(a.revision, 0);
  assert.equal(b.revision, 0);
});

test("attempts update only the supplied project state", () => {
  const a = createProjectLearningState({ now: "2026-10-02T00:00:00Z" });
  const b = createProjectLearningState({ now: "2026-10-02T00:00:00Z" });

  const result = applyProjectLearningEvents(
    a,
    [
      {
        question_id: "q1",
        module: "资料分析",
        subtype: "两期比重",
        source_type: "platform_import",
        correct: false,
        elapsed_seconds: 80,
        speed_status: "slow",
        error_code: "M",
      },
    ],
    { now: "2026-10-02T01:00:00Z", session_completed: true }
  );

  assert.equal(result.state.revision, 1);
  assert.deepEqual(b.ability_profile.subtypes, {});
  assert.equal(result.state.review_queue.length, 1);
  assert.equal(result.state.review_queue[0].review_mode, "sibling_preferred");
  assert.deepEqual(result.state.recent_question_ids, ["q1"]);
});

test("mastery stays null until at least five subtype samples", () => {
  let state = createProjectLearningState({ now: "2026-10-02T00:00:00Z" });
  for (let i = 0; i < 4; i += 1) {
    state = applyProjectLearningEvents(
      state,
      [{
        question_id: `q${i}`,
        module: "判断推理",
        subtype: "加强削弱",
        correct: true,
        elapsed_seconds: 40,
        speed_status: "ok",
      }],
      { now: `2026-10-0${i + 2}T00:00:00Z` }
    ).state;
  }
  assert.equal(state.ability_profile.subtypes["判断推理::加强削弱"].mastery, null);

  state = applyProjectLearningEvents(
    state,
    [{
      question_id: "q5",
      module: "判断推理",
      subtype: "加强削弱",
      correct: true,
      elapsed_seconds: 42,
      speed_status: "ok",
    }],
    { now: "2026-10-06T00:00:00Z" }
  ).state;
  assert.equal(state.ability_profile.subtypes["判断推理::加强削弱"].mastery, 100);
});

test("session project mismatch is rejected before state write", () => {
  const state = createProjectLearningState({ now: "2026-10-02T00:00:00Z" });
  assert.throws(
    () => assertSessionProjectMatch(state, "ps_other"),
    /Project mismatch/
  );
  assert.equal(assertSessionProjectMatch(state, state.project_state_id), true);
});
