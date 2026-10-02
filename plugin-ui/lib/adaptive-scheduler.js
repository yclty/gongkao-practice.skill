const DEFAULT_ATOMIC_BATCH = 3;

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
  return Object.entries(state?.ability_profile?.subtypes ?? {}).map(([key, value]) => ({
    key,
    ...value,
  }));
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

function normalizeIntent(input = {}) {
  if (input.available_minutes) return "timeboxed";
  return input.intent ?? "start";
}

function timeboxedCount(minutes) {
  if (minutes <= 5) return 3;
  if (minutes <= 10) return 5;
  if (minutes <= 20) return 8;
  if (minutes <= 30) return 12;
  return 15;
}

function baselineTarget(state) {
  const examTargets = state?.goal?.exam_targets ?? [];
  const targetText = examTargets.join("、");
  if (targetText.includes("事业")) {
    return { module: "职测", subtype: null, reason: "当前仍在建立基础画像" };
  }
  return { module: "资料分析", subtype: null, reason: "当前仍在建立基础画像" };
}

function focusTarget(input) {
  if (!input.focus_module && !input.focus_subtype) return null;
  return {
    module: input.focus_module ?? "综合",
    subtype: input.focus_subtype ?? null,
    reason: "按你指定的专项训练",
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
  if (!unfinished?.project_state_id || unfinished.project_state_id !== state.project_state_id) {
    return null;
  }
  return {
    strategy: "resume",
    open_ended: true,
    atomic_batch_questions: unfinished.remaining_questions?.length
      ? Math.min(DEFAULT_ATOMIC_BATCH, unfinished.remaining_questions.length)
      : DEFAULT_ATOMIC_BATCH,
    target: unfinished.target ?? null,
    resume_session: unfinished,
    user_message: "上次还有训练没完成，继续从那里开始。",
    next_choices: ["继续", "换个专项", "结束并总结"],
  };
}

export function planAdaptiveTraining(state, input = {}, now = new Date()) {
  if (!state?.project_state_id) throw new Error("project_state_id is required");

  const nowIso = now instanceof Date ? now.toISOString() : new Date(now).toISOString();
  const intent = normalizeIntent(input);

  if (intent === "start" && input.ignore_unfinished !== true) {
    const resume = resumePlan(state);
    if (resume) return resume;
  }

  const due = dueReviewItems(state, nowIso);
  const focus = focusTarget(input);
  const review = reviewTarget(due);
  const weak = weakTarget(state, nowIso);
  const samples = subtypeEntries(state).reduce(
    (sum, item) => sum + Number(item.sample_count ?? 0),
    0
  );

  let target = null;
  let strategy = intent;

  if (intent === "focus" && focus) {
    target = focus;
  } else if (intent === "review") {
    target = review ?? weak ?? baselineTarget(state);
  } else if (focus) {
    target = focus;
  } else if (due.length) {
    target = review;
    strategy = "due_review_first";
  } else if (samples < 20) {
    target = baselineTarget(state);
    strategy = "baseline";
  } else {
    target = weak ?? baselineTarget(state);
    strategy = weak ? "adaptive_weakness" : "baseline";
  }

  const timeboxed = Boolean(input.available_minutes);
  const totalPlanned = timeboxed
    ? timeboxedCount(Number(input.available_minutes))
    : null;
  const atomicBatch = timeboxed
    ? Math.min(DEFAULT_ATOMIC_BATCH, totalPlanned)
    : DEFAULT_ATOMIC_BATCH;

  return {
    project_state_id: state.project_state_id,
    strategy,
    open_ended: !timeboxed,
    available_minutes: timeboxed ? Number(input.available_minutes) : null,
    planned_questions: totalPlanned,
    atomic_batch_questions: atomicBatch,
    target,
    due_review_count: due.length,
    exclude_question_ids: (state.recent_question_ids ?? []).slice(-1000),
    user_message: timeboxed
      ? `按你现在的时间先开始，预计安排 ${totalPlanned} 题；中途仍然可以随时停。`
      : target?.reason
        ? `直接开始。先从${target.module}${target.subtype ? " · " + target.subtype : ""}切入：${target.reason}。随时可以暂停。`
        : "直接开始，随时可以暂停。",
    next_choices: ["继续刷", "暂停", "换个专项", "结束并总结"],
  };
}

export function launcherForState(state) {
  const hasHistory = (state?.recent_attempts?.length ?? 0) > 0;
  const hasUnfinished = Boolean(state?.unfinished_session);
  const due = state?.review_queue?.filter((item) => item?.due_at)?.length ?? 0;

  if (!hasHistory) {
    return {
      headline: "准备好了，直接开始就行",
      primary_action: {
        id: "start",
        label: "直接开始",
        hint: "系统会边练边建立你的能力画像",
      },
      secondary_actions: [
        { id: "focus", label: "选一个专项" },
        { id: "import", label: "导入已有错题/记录" },
        { id: "how_it_works", label: "看看怎么用" },
      ],
    };
  }

  return {
    headline: hasUnfinished ? "上次还没做完" : "继续今天的训练",
    primary_action: {
      id: hasUnfinished ? "resume" : "start",
      label: hasUnfinished ? "继续上次" : "直接开始",
      hint: hasUnfinished
        ? "从上次暂停的位置继续"
        : due
          ? `先处理到期复习，再练当前薄弱项`
          : "系统会自动选择当前最值得练的内容",
    },
    secondary_actions: [
      { id: "review", label: "只复习错题" },
      { id: "focus", label: "专项训练" },
      { id: "timeboxed", label: "按时间训练" },
    ],
  };
}
