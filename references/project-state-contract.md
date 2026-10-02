# Project 状态契约 v0.7

## 目标

定义公共 Skill / MCP 与个人学习状态宿主之间的边界。

**一个 ChatGPT Project = 一个独立学习者状态空间。**

公共能力负责训练决策、选题、评分和状态计算；当前 Project 负责长期保存自己的个人状态。

详细隔离模型见：`references/project-scoped-personal-state.md`。

## Project 身份

每个 Project 初始化一个随机 `project_state_id`：

```json
{
  "schema_version": "0.7",
  "project_state_id": "ps_xxx",
  "revision": 0
}
```

`project_state_id`：

- 不由姓名、邮箱、ChatGPT 账号等个人信息生成；
- 只用于 session / state 一致性检查；
- 不是认证凭证；
- 不用于跨 Project 自动合并数据。

同一 ChatGPT 账号可以拥有多个互相独立的备考 Project。

## Skill 可读取的当前 Project 状态

```json
{
  "schema_version": "0.7",
  "project_state_id": "ps_xxx",
  "revision": 12,
  "goal": {
    "exam_targets": ["陕西省考"],
    "phase": "baseline",
    "weekday_minutes": 30,
    "weekend_minutes": 60
  },
  "ability_profile": {
    "subtypes": {}
  },
  "review_queue": [],
  "recent_question_ids": [],
  "recent_attempts": [],
  "unfinished_session": null,
  "last_session_summary": null
}
```

状态只代表**当前 Project**。

## Quiz session 绑定

启动 `start_quiz_from_bank` 或 `start_quiz_session` 时，应传当前 Project 的：

```text
project_state_id
```

session summary 必须带回同一个 ID。

回写前必须满足：

```text
summary.project_state_id == current_project.state.project_state_id
```

不一致时停止更新，避免把 Project A 的训练结果写进 Project B。

## attempt_event

最小字段：

- `question_id`
- `module`
- `subtype`
- `source_type`: `official_real | platform_import | practice | ai_variant`
- `exam_type`（可选）
- `correct`
- `elapsed_seconds`
- `speed_status`: `ok | slow | unknown`
- `error_code`（答对可为空）
- `attempted_at`

## 状态 reducer

推荐由 `apply_project_learning_events` 做确定性更新：

```text
old Project state
      +
quiz attempt events
      ↓
stateless reducer
      ↓
new Project state + patch
      ↓
宿主保存回当前 Project
```

Reducer 本身不保存用户数据。

## 紧凑状态

主状态不要无限增长：

- `recent_question_ids` 最多 1000
- `recent_attempts` 最多 300
- 每个 subtype 最近样本最多 30
- 完整历史需要时按月归档

## Skill / MCP 不得做的事情

不得：

- 建立全局 `user_id -> profile` 学习数据库
- 根据 ChatGPT 账号自动合并多个 Project
- 把个人能力画像写入 GitHub
- 在 Project 之间自动复制错题/复习队列
- 用姓名或账号作为学习状态 key

## 迁移

用户主动要求复制/迁移学习状态时：

1. 显式导出旧 Project state；
2. 导入到目标 Project；
3. 默认生成新的 `project_state_id`；
4. 保留 `imported_from` 元数据；
5. 不建立后续双向同步。

这样目标 Project 从迁入状态开始继续独立演化。
