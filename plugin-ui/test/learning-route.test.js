import test from "node:test";
import assert from "node:assert/strict";
import {
  buildStudyLauncher,
  configureStudyRoute,
  createDefaultStudyRoute,
  currentRouteStep,
  inferStudyScene,
} from "../lib/learning-route.js";

function state(overrides = {}) {
  return {
    schema_version: "0.7",
    project_state_id: "ps_test",
    revision: 0,
    goal: { exam_targets: ["国考"] },
    ability_profile: { subtypes: {} },
    review_queue: [],
    recent_question_ids: [],
    recent_attempts: [],
    unfinished_session: null,
    ...overrides,
  };
}

test("default route is created from the Project exam target", () => {
  const route = createDefaultStudyRoute({ exam_targets: ["国考"] });
  assert.equal(route.exam_type, "国考");
  assert.equal(route.steps[0].module, "资料分析");
  assert.equal(route.steps[0].status, "active");
});

test("route can be customized per Project", () => {
  const result = configureStudyRoute(
    state(),
    {
      name: "我的晚间路线",
      steps: [
        { module: "资料分析", subtype: "增长率" },
        { module: "判断推理", subtype: "加强削弱" },
      ],
    },
    "2026-10-02T12:00:00Z"
  );
  assert.equal(result.state.study_route.name, "我的晚间路线");
  assert.equal(result.state.study_route.mode, "custom");
  assert.equal(result.state.study_route.steps[0].subtype, "增长率");
  assert.equal(currentRouteStep(result.state).subtype, "增长率");
});

test("evening heuristic suggests deep study while work hours suggest fragmented", () => {
  const s = state();
  assert.equal(
    inferStudyScene(s, { local_hour: 21, local_weekday: 5 }, "2026-10-02T13:00:00Z"),
    "deep"
  );
  assert.equal(
    inferStudyScene(s, { local_hour: 14, local_weekday: 5 }, "2026-10-02T06:00:00Z"),
    "fragmented"
  );
});

test("deep launcher proactively offers route chapter set paper and quick choices", () => {
  const configured = configureStudyRoute(state(), { reset_to_default: true }).state;
  const launcher = buildStudyLauncher(
    configured,
    { study_context: "deep" },
    { configured: true, stats: { interactive_supported: 1000 } },
    "2026-10-02T13:00:00Z"
  );
  assert.equal(launcher.scene, "deep");
  assert.equal(launcher.primary_action.mode, "route");
  assert.equal(launcher.actions.some((item) => item.mode === "chapter"), true);
  assert.equal(launcher.actions.some((item) => item.mode === "set"), true);
  assert.equal(launcher.actions.some((item) => item.mode === "paper"), true);
});

test("missing question bank is distinguished from missing personal data", () => {
  const launcher = buildStudyLauncher(
    state(),
    { study_context: "deep" },
    { configured: false, stats: null },
    "2026-10-02T13:00:00Z"
  );
  assert.equal(
    launcher.notices.some((item) => item.type === "question_bank_missing"),
    true
  );
  assert.equal(
    launcher.notices.some((item) => item.type === "profile_building"),
    true
  );
});
