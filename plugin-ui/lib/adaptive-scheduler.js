import {
  buildStudyLauncher,
  currentRouteStep,
} from "./learning-route.js";

const DEFAULT_ATOMIC_BATCH = 3;
const DEFAULT_DEEP_QUESTIONS = 10;
const DEFAULT_SET_QUESTIONS = 20;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function dueReviewItems(state, nowIso) {
  const now = new Date(nowIso).getTime();
  return (state.review_queue ?? [])
    .filter((item) => item?.due_at && new Date(item.due_at).getTime() <= now)
    .sort((a, b) => String(a.due_at).localeCompare(String(b.due_at)));
}

function subtypeEntries(state) {
  return Object.entries(state?.ability_profile?.subtypes ?? {}).map(
    ([key, value]) => ({ key, ...value })
  );
}

function weaknessScore(item) {
  if (item.mastery === null || item.mastery === undefined) return 45;
  return clamp(100 - Number(item.mastery), 0, 100);
}

function errorScore(item) {
  const counts = Object.values(item.error_counts_30 ?? {});
  const max = counts.length ? Math.max(...counts.map(Number)) : 0;
  return clamp(max * 20, 0, 100);
}

function recencyScore(item, nowIso) {
  if (!item.last_practiced_at) return 70;
  const days = Math.max(
    0,
    (new Date(nowIso).getTime() - new Date(item.last_practiced_at).getTime()) /
      (24 * 60 * 60 * 1000)
  );
  return clamp(days * 8, 0, 100);
}

function scoreSubtype(item, nowIso) {
  return Math.round(
    weaknessScore(item) * 0.6 +
      errorScore(item) * 0.25 +
      recencyScore(item, nowIso) * 0.15
  );
}

function timeboxedCount(minutes) {
  if (minutes <= 5) return 3;
  if (minutes <= 10) return 5;
  if (minutes <= 20) return 8;
  if (minutes <= 30) return 12;
  return 15;
}

function examTypeFromState(state) {
  const text = (state?.goal?.exam_targets ?? []).join("、");
  if (text.includes("国考")) return "国考";
  if (text.includes("事业")) return "事业单位";
  if (text.includes("省考")) return "省考";
  return undefined;
}

function normalizeMode(input = {}) {
  if (input.session_mode) return input.session_mode;
  if (input.intent === "review") return "review";
  if (input.intent === "focus") return "chapter";
  if (input.available_minutes) return "timeboxed";
  return "auto";
}

function baselineTarget(state) {
  const examType = examTypeFromState(state);
  if (examType === "事业单位") {
    return {
      module: "资料分析",
      subtype: null,
      reason: "当前仍在建立基础画像",
    };
  }
  return {
    module: "资料分析",
    subtype: null,
    reason: "当前仍在建立基础画像",
  };
}

function focusTarget(input) {
  if (!input.focus_module && !input.focus_subtype) return null;
  return {
    module: input.focus_module ?? "综合",
    subtype: input.focus_subtype ?? null,
    reason: "按你指定的章节/专项训练",
  };
}

function reviewTarget(due) {
  const first = due[0];
  if (!first) return null;
  return {
    module: first.module ?? "综合",
    subtype: first.subtype ?? null,
    reason: `今天有 ${due.length} 项到期复习`,
  };
}

function weakTarget(state, nowIso) {
  const ranked = subtypeEntries(state)
    .filter((item) => (item.sample_count ?? 0) >= 3)
    .map((item) => ({ ...item, priority: scoreSubtype(item, nowIso) }))
    .sort((a, b) => b.priority - a.priority);

  if (!ranked.length) return null;
  const top = ranked[0];
  return {
    module: top.module ?? "综合",
    subtype: top.subtype === "UNKNOWN" ? null : top.subtype,
    priority: top.priority,
    reason:
      top.mastery === null || top.mastery === undefined
        ? "这个题型样本还不够，需要继续观察"
        : `当前掌握度较弱（${top.mastery}）`,
  };
}

function resumePlan(state) {
  const unfinished = state?.unfinished_session;
  if (
    !unfinished?.project_state_id ||
    unfinished.project_state_id !== state.project_state_id
  ) {
    return null;
  }
  return {
    project_state_id: state.project_state_id,
    session_mode: "resume",
    strategy: "resume",
    open_ended: true,
    atomic_batch_questions: unfinished.remaining_questions?.length
      ? Math.min(
          DEFAULT_ATOMIC_BATCH,
          unfinished.remaining_questions.length
        )
      : DEFAULT_ATOMIC_BATCH,
    target: unfinished.target ?? null,
    resume_session: unfinished,
    question_request: unfinished.selection_context ?? null,
    user_message: "上次还有训练没完成，继续从那里开始。",
    next_choices: ["继续", "换个章节", "结束并总结"],
  };
}

function routeTarget(state) {
  const step = currentRouteStep(state);
  if (!step) return null;
  return {
    module: step.module,
    subtype: step.subtype ?? null,
    route_step_id: step.id,
    reason: `按学习路线继续：${step.title}`,
  };
}

function setTargets(state, total = DEFAULT_SET_QUESTIONS) {
  const routeModules = (state?.study_route?.steps ?? [])
    .map((step) => step.module)
    .filter(Boolean);
  const modules = [...new Set(routeModules)].slice(0, 5);
  const fallback = [
    "资料分析",
    "判断推理",
    "言语理解与表达",
    "数量关系",
    "常识判断",
  ];
  const selectedModules = modules.length ? modules : fallback;
  const base = Math.floor(total / selectedModules.length);
  let remaining = total % selectedModules.length;

  return selectedModules.map((module) => {
    const count = base + (remaining-- > 0 ? 1 : 0);
    return { module, count };
  });
}

function requestForTarget(state, target, count) {
  return {
    tool: "start_quiz_from_bank",
    count,
    targets: target
      ? [{
          module: target.module,
          subtype: target.subtype ?? undefined,
          count,
        }]
      : undefined,
    exam_type: examTypeFromState(state),
    exclude_question_ids: (state.recent_question_ids ?? []).slice(-1000),
    source_types: ["official_real", "platform_import"],
  };
}

export function planAdaptiveTraining(state, input = {}, now = new Date()) {
  if (!state?.project_state_id) {
    throw new Error("project_state_id is required");
  }

  const nowIso =
    now instanceof Date ? now.toISOString() : new Date(now).toISOString();
  const mode = normalizeMode(input);

  if (
    (mode === "auto" || mode === "resume") &&
    input.ignore_unfinished !== true
  ) {
    const resume = resumePlan(state);
    if (resume) return resume;
  }

  const due = dueReviewItems(state, nowIso);
  const focus = focusTarget(input);
  const review = reviewTarget(due);
  const weak = weakTarget(state, nowIso);
  const route = routeTarget(state);
  const samples = subtypeEntries(state).reduce(
    (sum, item) => sum + Number(item.sample_count ?? 0),
    0
  );

  if (mode === "paper") {
    return {
      project_state_id: state.project_state_id,
      session_mode: "paper",
      strategy: "real_paper",
      open_ended: false,
      available_minutes: input.available_minutes ?? null,
      planned_questions: null,
      atomic_batch_questions: null,
      target: null,
      due_review_count: due.length,
      question_request: {
        tool: "start_paper_from_bank",
        paper_id: input.paper_id ?? undefined,
        exam_type: input.exam_type ?? examTypeFromState(state),
        province: input.province ?? undefined,
        year_min: input.year_min ?? undefined,
        year_max: input.year_max ?? undefined,
        require_complete: true,
        project_state_id: state.project_state_id,
      },
      user_message:
        "进入真题整卷模式。优先使用题库中完整可作答的导入试卷，仍然可以中途暂停。",
      next_choices: ["开始试卷", "换一套", "返回学习路线"],
    };
  }

  if (mode === "set") {
    const count = Math.max(
      5,
      Math.min(50, Number(input.count ?? state?.study_preferences?.deep_set_questions ?? DEFAULT_SET_QUESTIONS))
    );
    const targets = setTargets(state, count);
    return {
      project_state_id: state.project_state_id,
      session_mode: "set",
      strategy: "balanced_set",
      open_ended: false,
      available_minutes: input.available_minutes ?? null,
      planned_questions: count,
      atomic_batch_questions: count,
      target: { module: "综合套题", subtype: null, reason: "跨模块套题训练" },
      due_review_count: due.length,
      question_request: {
        tool: "start_quiz_from_bank",
        count,
        targets,
        exam_type: examTypeFromState(state),
        exclude_question_ids: (state.recent_question_ids ?? []).slice(-1000),
        source_types: ["official_real", "platform_import"],
      },
      user_message: `给你安排一套 ${count} 题的跨模块训练，中途可以暂停。`,
      next_choices: ["开始套题", "换章节", "改成碎片刷题"],
    };
  }

  if (mode === "route") {
    const target = route ?? weak ?? baselineTarget(state);
    const count = Math.max(5, Math.min(30, Number(input.count ?? DEFAULT_DEEP_QUESTIONS)));
    return {
      project_state_id: state.project_state_id,
      session_mode: "route",
      strategy: "study_route",
      open_ended: false,
      available_minutes: input.available_minutes ?? null,
      planned_questions: count,
      atomic_batch_questions: count,
      target,
      due_review_count: due.length,
      question_request: requestForTarget(state, target, count),
      user_message: `按学习路线集中练 ${target.module}${target.subtype ? " · " + target.subtype : ""}，先做 ${count} 题，中途可以暂停。`,
      next_choices: ["开始章节", "换章节", "做一套", "碎片刷题"],
    };
  }

  if (mode === "chapter") {
    const target = focus ?? route ?? weak ?? baselineTarget(state);
    const count = Math.max(5, Math.min(30, Number(input.count ?? DEFAULT_DEEP_QUESTIONS)));
    return {
      project_state_id: state.project_state_id,
      session_mode: "chapter",
      strategy: "chapter_focus",
      open_ended: false,
      available_minutes: input.available_minutes ?? null,
      planned_questions: count,
      atomic_batch_questions: count,
      target,
      due_review_count: due.length,
      question_request: requestForTarget(state, target, count),
      user_message: `集中练 ${target.module}${target.subtype ? " · " + target.subtype : ""}，先做 ${count} 题；随时可以暂停。`,
      next_choices: ["开始章节", "换章节", "做一套", "碎片刷题"],
    };
  }

  if (mode === "quick") {
    const target = due.length
      ? review
      : weak ?? route ?? baselineTarget(state);
    const count = Math.max(
      1,
      Math.min(
        10,
        Number(input.count ?? state?.study_preferences?.fragmented_batch_questions ?? DEFAULT_ATOMIC_BATCH)
      )
    );
    return {
      project_state_id: state.project_state_id,
      session_mode: "quick",
      strategy: due.length ? "due_review_first" : "quick_adaptive",
      open_ended: true,
      available_minutes: input.available_minutes ?? null,
      planned_questions: count,
      atomic_batch_questions: count,
      target,
      due_review_count: due.length,
      question_request: requestForTarget(state, target, count),
      user_message: due.length
        ? `先用碎片时间处理 ${Math.min(count, due.length)} 个到期复习点。`
        : `先刷 ${count} 题，不给你安排长任务。`,
      next_choices: ["继续刷", "暂停", "换章节", "结束"],
    };
  }

  if (mode === "review") {
    const target = review ?? weak ?? route ?? baselineTarget(state);
    const count = Math.max(1, Math.min(10, Number(input.count ?? 5)));
    return {
      project_state_id: state.project_state_id,
      session_mode: "review",
      strategy: "due_review_first",
      open_ended: true,
      planned_questions: count,
      atomic_batch_questions: count,
      target,
      due_review_count: due.length,
      question_request: requestForTarget(state, target, count),
      user_message: due.length
        ? `先做 ${Math.min(count, due.length)} 个到期复习点。`
        : "当前没有明确到期项，先复习最近薄弱点。",
      next_choices: ["继续复习", "暂停", "回到路线"],
    };
  }

  const timeboxed = mode === "timeboxed";
  const totalPlanned = timeboxed
    ? timeboxedCount(Number(input.available_minutes))
    : null;

  let target = null;
  let strategy = mode;

  if (focus) {
    target = focus;
    strategy = "chapter_focus";
  } else if (due.length) {
    target = review;
    strategy = "due_review_first";
  } else if (samples < 20) {
    target = route ?? baselineTarget(state);
    strategy = "baseline";
  } else {
    target = weak ?? route ?? baselineTarget(state);
    strategy = weak ? "adaptive_weakness" : "study_route";
  }

  const count = timeboxed ? totalPlanned : DEFAULT_ATOMIC_BATCH;

  return {
    project_state_id: state.project_state_id,
    session_mode: timeboxed ? "timeboxed" : "auto",
    strategy,
    open_ended: !timeboxed,
    available_minutes: timeboxed ? Number(input.available_minutes) : null,
    planned_questions: totalPlanned,
    atomic_batch_questions: timeboxed
      ? Math.min(DEFAULT_ATOMIC_BATCH, count)
      : count,
    target,
    due_review_count: due.length,
    question_request: requestForTarget(state, target, Math.min(DEFAULT_ATOMIC_BATCH, count)),
    user_message: timeboxed
      ? `按你现在的时间先安排 ${totalPlanned} 题，中途仍然可以随时停。`
      : target?.reason
        ? `先从 ${target.module}${target.subtype ? " · " + target.subtype : ""} 开始：${target.reason}。随时可以暂停。`
        : "直接开始，随时可以暂停。",
    next_choices: ["继续刷", "暂停", "换章节", "做一套", "结束并总结"],
  };
}

export function launcherForState(
  state,
  input = {},
  bankStatus = null,
  now = new Date()
) {
  return buildStudyLauncher(state, input, bankStatus, now);
}
