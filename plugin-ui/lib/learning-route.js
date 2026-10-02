const DEFAULT_FRAGMENTED_BATCH = 3;
const DEFAULT_SET_QUESTIONS = 20;

const EXAM_ROUTE_TEMPLATES = {
  国考: [
    "资料分析",
    "判断推理",
    "言语理解与表达",
    "数量关系",
    "政治理论",
    "常识判断",
  ],
  省考: [
    "资料分析",
    "判断推理",
    "言语理解与表达",
    "数量关系",
    "常识判断",
  ],
  事业单位: [
    "资料分析",
    "判断推理",
    "言语理解与表达",
    "数量关系",
    "常识判断",
    "公共基础知识",
  ],
};

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function examTypeFromGoal(goal = {}) {
  const text = (goal.exam_targets ?? []).join("、");
  if (text.includes("国考")) return "国考";
  if (text.includes("事业")) return "事业单位";
  if (text.includes("省考")) return "省考";
  return "省考";
}

function routeStepId(index) {
  return `route_step_${String(index + 1).padStart(2, "0")}`;
}

export function defaultStudyPreferences() {
  return {
    scene_policy: "guided",
    fragmented_batch_questions: DEFAULT_FRAGMENTED_BATCH,
    deep_set_questions: DEFAULT_SET_QUESTIONS,
    non_work_default: "guided_choice",
    work_time_default: "fragmented",
    auto_time_heuristic: true,
    work_hours: {
      enabled: false,
      start_hour: 9,
      end_hour: 18,
      weekdays: [1, 2, 3, 4, 5],
    },
  };
}

export function createDefaultStudyRoute(goal = {}) {
  const examType = examTypeFromGoal(goal);
  const modules = EXAM_ROUTE_TEMPLATES[examType] ?? EXAM_ROUTE_TEMPLATES["省考"];
  return {
    name: `${examType}自适应学习路线`,
    exam_type: examType,
    mode: "adaptive",
    current_step_id: routeStepId(0),
    steps: modules.map((module, index) => ({
      id: routeStepId(index),
      module,
      subtype: null,
      title: module,
      status: index === 0 ? "active" : "pending",
      completed_sessions: 0,
      target_sessions: null,
    })),
  };
}

function normalizeSteps(steps = []) {
  return steps
    .filter((step) => step?.module || step?.subtype)
    .map((step, index) => ({
      id: step.id || routeStepId(index),
      module: step.module || "综合",
      subtype: step.subtype || null,
      title:
        step.title ||
        (step.subtype ? `${step.module || "综合"} · ${step.subtype}` : step.module || "综合"),
      status: index === 0 ? "active" : "pending",
      completed_sessions: Number(step.completed_sessions ?? 0),
      target_sessions:
        step.target_sessions === null || step.target_sessions === undefined
          ? null
          : Number(step.target_sessions),
    }));
}

export function configureStudyRoute(state, input = {}, now = new Date()) {
  if (!state?.project_state_id) throw new Error("project_state_id is required");

  const next = clone(state);
  const currentPreferences = {
    ...defaultStudyPreferences(),
    ...(next.study_preferences ?? {}),
    work_hours: {
      ...defaultStudyPreferences().work_hours,
      ...(next.study_preferences?.work_hours ?? {}),
    },
  };

  if (input.study_preferences) {
    Object.assign(currentPreferences, input.study_preferences);
    if (input.study_preferences.work_hours) {
      currentPreferences.work_hours = {
        ...defaultStudyPreferences().work_hours,
        ...(next.study_preferences?.work_hours ?? {}),
        ...input.study_preferences.work_hours,
      };
    }
  }

  next.study_preferences = currentPreferences;

  if (Array.isArray(input.steps) && input.steps.length) {
    const steps = normalizeSteps(input.steps);
    next.study_route = {
      name: input.name || next.study_route?.name || "自定义学习路线",
      exam_type: input.exam_type || next.study_route?.exam_type || examTypeFromGoal(next.goal),
      mode: "custom",
      current_step_id: steps[0]?.id ?? null,
      steps,
    };
  } else if (!next.study_route || input.reset_to_default === true) {
    next.study_route = createDefaultStudyRoute(next.goal);
  } else if (input.name) {
    next.study_route.name = input.name;
  }

  if (input.current_step_id && next.study_route?.steps?.some((step) => step.id === input.current_step_id)) {
    next.study_route.current_step_id = input.current_step_id;
    next.study_route.steps = next.study_route.steps.map((step) => ({
      ...step,
      status:
        step.id === input.current_step_id
          ? "active"
          : step.status === "active"
            ? "pending"
            : step.status,
    }));
  }

  next.revision = Number(next.revision ?? 0) + 1;
  next.updated_at = now instanceof Date ? now.toISOString() : new Date(now).toISOString();

  return {
    state: next,
    patch: {
      project_state_id: next.project_state_id,
      to_revision: next.revision,
      study_route: clone(next.study_route),
      study_preferences: clone(next.study_preferences),
    },
  };
}

export function currentRouteStep(state) {
  const route = state?.study_route;
  if (!route?.steps?.length) return null;
  return (
    route.steps.find((step) => step.id === route.current_step_id) ||
    route.steps.find((step) => step.status === "active") ||
    route.steps.find((step) => step.status !== "done") ||
    route.steps[0]
  );
}

export function inferStudyScene(state, input = {}, now = new Date()) {
  if (input.study_context && input.study_context !== "auto") {
    return input.study_context;
  }

  if (Number(input.available_minutes) > 0 && Number(input.available_minutes) <= 10) {
    return "fragmented";
  }

  const prefs = {
    ...defaultStudyPreferences(),
    ...(state?.study_preferences ?? {}),
  };

  const localHour =
    input.local_hour !== undefined && input.local_hour !== null
      ? Number(input.local_hour)
      : now instanceof Date
        ? now.getHours()
        : new Date(now).getHours();
  const day =
    input.local_weekday !== undefined && input.local_weekday !== null
      ? Number(input.local_weekday)
      : now instanceof Date
        ? now.getDay()
        : new Date(now).getDay();

  if (prefs.work_hours?.enabled) {
    const isWorkday = (prefs.work_hours.weekdays ?? []).includes(day);
    const inWorkHours =
      isWorkday &&
      localHour >= Number(prefs.work_hours.start_hour) &&
      localHour < Number(prefs.work_hours.end_hour);
    return inWorkHours ? "fragmented" : "deep";
  }

  if (prefs.auto_time_heuristic) {
    if (day === 0 || day === 6 || localHour < 8 || localHour >= 18) return "deep";
    if (localHour >= 9 && localHour < 18) return "fragmented";
  }

  return "neutral";
}

export function buildStudyLauncher(state, input = {}, bankStatus = null, now = new Date()) {
  const scene = inferStudyScene(state, input, now);
  const routeStep = currentRouteStep(state);
  const hasUnfinished = Boolean(state?.unfinished_session);
  const dueCount = (state?.review_queue ?? []).filter((item) => {
    if (!item?.due_at) return false;
    return new Date(item.due_at).getTime() <= new Date(now).getTime();
  }).length;
  const bankConfigured = bankStatus?.configured !== false;
  const bankReady = bankConfigured && (bankStatus?.stats?.interactive_supported ?? 1) > 0;

  const notices = [];
  if (!bankReady) {
    notices.push({
      type: "question_bank_missing",
      message: "真题库当前没有接入运行时；这不是你的个人学习数据不足。",
    });
  }
  if ((state?.recent_attempts?.length ?? 0) < 20) {
    notices.push({
      type: "profile_building",
      message: "个人能力画像还在建立中，但不影响直接开始训练。",
    });
  }

  if (hasUnfinished) {
    return {
      scene,
      headline: "上次还有训练没完成",
      recommendation: "继续上次",
      primary_action: { id: "resume", label: "继续上次" },
      actions: [
        { id: "resume", label: "继续上次", mode: "resume" },
        { id: "route", label: "回到学习路线", mode: "route" },
        { id: "set", label: "做一套", mode: "set" },
        { id: "quick", label: "碎片刷题", mode: "quick" },
      ],
      notices,
    };
  }

  if (scene === "deep") {
    return {
      scene,
      headline: "现在更适合做一段完整训练",
      recommendation: routeStep
        ? `继续学习路线：${routeStep.title}`
        : "集中学习一个章节",
      primary_action: {
        id: "route",
        label: routeStep ? `继续路线 · ${routeStep.title}` : "集中学一个章节",
        mode: "route",
      },
      actions: [
        {
          id: "route",
          label: routeStep ? `继续路线 · ${routeStep.title}` : "继续学习路线",
          mode: "route",
        },
        { id: "chapter", label: "集中学一个章节", mode: "chapter" },
        { id: "set", label: "做一套 20 题", mode: "set" },
        { id: "paper", label: "做一套真题试卷", mode: "paper", enabled: bankReady },
        { id: "quick", label: "只想随手刷几题", mode: "quick" },
      ],
      due_review_count: dueCount,
      notices,
    };
  }

  if (scene === "fragmented") {
    return {
      scene,
      headline: "现在按碎片时间来，不给你安排长任务",
      recommendation: dueCount ? "先处理几道到期复习" : "先刷 3 题",
      primary_action: {
        id: dueCount ? "review" : "quick",
        label: dueCount ? `到期复习 · ${dueCount}项` : "3题快刷",
        mode: dueCount ? "review" : "quick",
      },
      actions: [
        { id: "quick", label: "3题快刷", mode: "quick" },
        { id: "review", label: "到期错题", mode: "review" },
        {
          id: "route",
          label: routeStep ? `路线继续 · ${routeStep.title}` : "路线继续",
          mode: "route",
        },
      ],
      due_review_count: dueCount,
      notices,
    };
  }

  return {
    scene,
    headline: "今天想怎么练？",
    recommendation: routeStep ? `继续学习路线：${routeStep.title}` : "系统推荐",
    primary_action: { id: "auto", label: "系统推荐", mode: "auto" },
    actions: [
      { id: "auto", label: "系统推荐", mode: "auto" },
      { id: "route", label: "继续学习路线", mode: "route" },
      { id: "chapter", label: "集中学一个章节", mode: "chapter" },
      { id: "set", label: "做一套", mode: "set" },
      { id: "quick", label: "碎片刷题", mode: "quick" },
    ],
    notices,
  };
}
