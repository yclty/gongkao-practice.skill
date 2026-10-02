---
name: gongkao-onboarding
description: Initialize a new learner's long-term gongkao study system after the user installs this plugin or asks to set up their exam preparation.
---

# Goal

Initialize a long-term adaptive study workflow for one learner.

## Rules

1. Treat the current ChatGPT Project as one independent long-term learning state. The same person may intentionally use multiple Projects for different exam goals; never merge them automatically.
2. Do not require GitHub, coding knowledge, or manual prompt installation.
3. Ask only for missing information that materially changes the initial plan.
4. If the user does not provide enough data, use safe defaults:
   - preparation horizon: 1–2 years
   - weekday study time: 30 minutes
   - weekend study time: 60 minutes
   - ability profile: unknown / pending baseline
5. Never invent current accuracy, weaknesses, or historical performance.
6. Initialize a random `project_state_id` for this Project. Do not derive it from the user's name, account, email, or device.
7. If `initialize_project_learning_state` is available, use it and persist the returned state in the current Project/host context.
8. Do not automatically start a quiz after initialization unless the user asks.

## Initialize

Capture when available:
- target exams
- province / jurisdiction
- preparation horizon
- weekday and weekend study time
- whether the learner already practices
- current question sources or materials
- whether essay / 申论 preparation is included
- meaningful constraints

Return:
- project_state_id / Project state initialized
- a compact configuration summary
- the default Project study route
- current preparation phase
- known vs unknown profile fields
- question-bank status when the tool exists
- a short first-week direction
- a context-aware launcher:
  - deep/non-work: continue route / chapter / set / real paper / quick
  - fragmented: 3-question quick / due review / route continuation
  - unknown context: system recommendation / route / chapter / set / quick

After initialization, teach only the minimum:
- 开始练习
- 暂停
- 继续上次
- 专项训练

Do not make the learner understand Scheduler, SRS, Mastery, or Priority Score before they can start.


# Project isolation

Never use another Project's:
- ability profile
- recent question IDs
- error history
- due reviews
- unfinished session
- reports

When importing a state from another Project, treat it as an explicit migration and create a new project_state_id unless the user specifically requests continuation of the same exported state.


# Route customization

Initialization should create a default route, but do not force the learner to accept it forever.

Tell the learner they can later say:
- 制定我的学习路线
- 先资料分析，再判断推理
- 把数量关系放后面
- 晚上按路线集中学，工作时间碎片刷

Do not require work-hour configuration during first-run onboarding; allow it to be added later.

If question-bank tools are unavailable, do not describe the situation as personal-data scarcity. Say the real-question runtime is not connected.
