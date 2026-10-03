> 1.0.0 本地运行时以 [local-runtime.md](local-runtime.md) 为准：binding_id 绑定本地目标，作答自动事务保存，session 持久恢复，摘要不再次回写。下文保留为 0.9 历史/纯规则兼容说明。

# Project-scoped Personal State v0.7

## 1. 核心模型

**一个 ChatGPT Project = 一个独立学习状态空间。**

Project 是学习状态的租户边界，不是 ChatGPT 账号，也不是现实身份。

因此：

- 同一个人可以建立多个 Project，例如“国考”“陕西省考”“事业单位”；
- 每个 Project 拥有完全独立的能力画像、错题、复习队列和训练历史；
- 不同人的 Project 之间也完全独立；
- 公共 Skill、QuestionProvider、MCP Server 不建立全局 learner/user 数据库；
- MCP 不按照姓名、邮箱、账号等信息聚合学习数据。

## 2. project_state_id

每个 Project 第一次初始化时生成随机 `project_state_id`：

```json
{
  "schema_version": "0.7",
  "project_state_id": "ps_7f7dfd...",
  "revision": 0
}
```

规则：

1. 随机生成，不由用户名、账号、邮箱、设备号推导；
2. 保存在该 Project 的个人状态中；
3. 用于检测 session 是否属于当前 Project；
4. **不是认证凭证，也不是权限边界**；
5. 不用于跨 Project 自动合并。

如果同一用户主动希望迁移数据，应显式导出/导入状态，而不是因为账号相同自动合并。

## 3. 推荐 Project 内逻辑文件

宿主允许显式 Project 文件时，推荐：

```text
.gongkao/
├── state.json                 # 当前紧凑状态，主入口
├── attempt-log/
│   ├── 2026-10.jsonl          # 可选，月度归档
│   └── ...
├── reports/
│   ├── weekly/
│   └── monthly/
└── imported/
    └── legacy-state.json      # 可选，迁移历史
```

如果宿主不能直接操作 Project 文件，也必须保持等价的“当前 Project 私有状态”，不能退化成 MCP 服务端全局 user 表。

## 4. state.json

最小结构：

```json
{
  "schema_version": "0.7",
  "project_state_id": "ps_xxx",
  "revision": 12,
  "initialized_at": "2026-10-02T10:00:00+08:00",
  "updated_at": "2026-10-05T20:30:00+08:00",
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

### 紧凑状态原则

`state.json` 不是无限增长的日志。

建议：

- `recent_question_ids`：最多 1000 个，用于 QuestionProvider 近期排重；
- `recent_attempts`：最多 300 条，用于近期趋势；
- 每个 subtype 的 `recent_samples`：最多 30 条；
- 完整历史如需保留，按月写入 `attempt-log/YYYY-MM.jsonl`。

## 5. subtype 状态

```json
{
  "module": "资料分析",
  "subtype": "两期比重",
  "sample_count": 18,
  "recent_sample_count": 18,
  "accuracy_30": 0.667,
  "avg_seconds_30": 78.4,
  "mastery": 61,
  "error_counts_30": {
    "M": 3,
    "C": 1
  },
  "last_practiced_at": "2026-10-05T20:30:00+08:00",
  "recent_samples": []
}
```

早期样本不足时：

```json
{
  "sample_count": 3,
  "mastery": null
}
```

不要用少量题目伪造精确能力分数。默认至少 5 个有效样本后才形成 provisional mastery。

## 6. Review Queue

复习项以题目作为锚点，但默认偏好同考点兄弟题：

```json
{
  "anchor_question_id": "saduck_q_19375",
  "module": "资料分析",
  "subtype": "两期比重",
  "stage": 1,
  "due_at": "2026-10-08T20:30:00+08:00",
  "review_mode": "sibling_preferred",
  "last_result": "wrong"
}
```

默认间隔：

`1d → 3d → 7d → 14d → 30d`

## 7. Session 与 Project 绑定

启动训练时，当前 Project 应把自己的 `project_state_id` 传给：

- `start_quiz_from_bank`
- `start_quiz_session`

MCP 只在短期 session 中携带该 ID：

```text
Project A state_id
       ↓
quiz session A
       ↓
summary(state_id=A)
       ↓
只允许回写 Project A
```

若 summary 的 `project_state_id` 与当前 Project 状态不一致：

- 不更新长期状态；
- 提示当前 session 来源于另一个 Project；
- 可以让用户回到原 Project 完成/保存；
- 不自动合并。

这是一致性保护，不是安全认证。

## 8. MCP 状态边界

MCP Server 允许：

- 短期保存 quiz session；
- 纯函数式计算 state update；
- 返回新的 state / patch。

MCP Server 禁止：

- 建立长期 `user_id -> profile` 数据库；
- 通过 ChatGPT 账号猜测用户；
- 跨 Project 查询或合并能力画像；
- 把个人学习状态写回 GitHub；
- 把 Project A 的状态作为 Project B 的默认状态。

## 9. 初始化与更新协议

初始化：

```text
当前 Project
  ↓
initialize_project_learning_state
  ↓
返回 project_state_id + empty state
  ↓
宿主保存到当前 Project
```

训练：

```text
Project state
  ↓
Scheduler
  ↓
start_quiz_from_bank(project_state_id, exclusions, targets)
  ↓
Quiz summary(project_state_id, attempts)
  ↓
apply_project_learning_events(current_state, attempts)
  ↓
新 state
  ↓
宿主覆盖当前 Project state
```

状态更新工具是**纯 reducer**：输入旧 state + 本轮事件，输出新 state；服务端不保留 reducer 结果。

## 10. 多 Project 示例

同一账号可以同时存在：

```text
Project: 2027 国考
project_state_id = ps_A
资料分析 mastery = 72

Project: 2027 陕西省考
project_state_id = ps_B
资料分析 mastery = 58

Project: 事业单位
project_state_id = ps_C
公基法律 mastery = 64
```

三者默认互不影响。

如果以后需要“复制画像作为新 Project 起点”，必须是显式迁移操作，并生成新的 `project_state_id`。
