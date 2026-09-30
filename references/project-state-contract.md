# Project 状态契约

## 目标

本文件定义 Skill 与个人学习状态宿主之间的边界。Skill 负责训练决策和诊断；宿主负责长期保存用户个人数据。

## Skill 可读取的宿主状态摘要

宿主可按需提供以下字段，不要求每轮全部存在：

```json
{
  "goal": {
    "exam_targets": ["国考", "省考", "事业单位"],
    "phase": "foundation",
    "daily_minutes": 30
  },
  "ability_profile": {
    "module": {
      "name": "资料分析",
      "accuracy": 0.72,
      "avg_seconds": 86,
      "weak_subtypes": ["两期比重"]
    }
  },
  "due_reviews": [],
  "recent_errors": [],
  "unfinished_session": null
}
```

## Skill 应输出的状态增量

每轮训练结束后，Skill 输出供宿主保存的“增量”，而不是直接写文件：

```json
{
  "session_summary": {
    "questions": 8,
    "correct": 6,
    "duration_seconds": 620
  },
  "attempt_events": [],
  "review_updates": [],
  "ability_updates": [],
  "next_training_hint": {
    "priority_module": "资料分析",
    "reason": "两期比重连续错误"
  }
}
```

## attempt_event 最小字段

- `question_id`
- `source_type`: `real` / `ai_variant`
- `exam_type`
- `module`
- `subtype`
- `correct`
- `elapsed_seconds`
- `error_code`（答对可为空）
- `confidence`（可选）

## 数据边界

以下内容不得提交到本 GitHub 仓库：

- 用户姓名、账号信息
- 个人能力画像
- 个人作答历史
- 错题队列
- 复习日期
- 学习计划和阶段报告
- 任何由聊天记录推断出的个人信息

仓库内仅允许公共、可复用、非个体化的数据与规则。
