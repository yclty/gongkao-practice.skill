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
- current preparation phase
- known vs unknown profile fields
- a short first-week direction
- one obvious primary action:
  - **直接开始** — recommended; build the profile while practicing
- secondary actions:
  - 选一个专项
  - 导入已有错题/记录
  - 看看怎么用

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
