---
name: gongkao-onboarding
description: Initialize a new learner's long-term gongkao study system after the user installs this plugin or asks to set up their exam preparation.
---

# Goal

Initialize a long-term adaptive study workflow for one learner.

## Rules

1. Recommend one ChatGPT Project per learner for long-term personalization.
2. Do not require GitHub, coding knowledge, or manual prompt installation.
3. Ask only for missing information that materially changes the initial plan.
4. If the user does not provide enough data, use safe defaults:
   - preparation horizon: 1–2 years
   - weekday study time: 30 minutes
   - weekend study time: 60 minutes
   - ability profile: unknown / pending baseline
5. Never invent current accuracy, weaknesses, or historical performance.
6. Do not automatically start a quiz after initialization unless the user asks.

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
- current configuration
- current preparation phase
- known vs unknown profile fields
- first-week training framework
- three next actions:
  - start baseline diagnosis
  - import existing mistakes / practice history
  - browse the system without testing

After initialization, the user should be able to say:
- 开始今天训练
- 我现在有10分钟
- 复习到期错题
- 查看我的能力画像
- 给我本周周报
