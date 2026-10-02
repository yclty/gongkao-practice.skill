# Scheduler Protocol v0.8

## 1. 目标

调度器回答：

**“用户现在打开系统，下一小段最值得练什么？”**

默认不要求用户先声明时间。

## 2. 核心原则

- **Start-first**：用户说“开始练习”就直接开始。
- **Interruptible**：任何一题前后都可以安全暂停。
- **Atomic batch**：默认以 3 题为一个小调度单元。
- **Resume-first**：有未完成训练时优先续接。
- **Review-first**：无未完成训练时，到期复习优先。
- **Weakness-aware**：再处理当前薄弱子题型。
- **Baseline-aware**：样本不足时优先建立画像。
- **Time-optional**：时间预算只在用户主动提供时启用。
- **Stable-update**：单题不大幅改变长期画像。

## 3. Project 隔离

所有输入只来自当前 Project：

- `project_state_id`
- goal
- ability_profile
- review_queue
- recent_question_ids
- unfinished_session

禁止跨 Project 汇总能力画像。

## 4. 默认启动决策

用户只说“开始练习”时：

```text
unfinished_session?
  yes → resume
  no
   ↓
due reviews?
  yes → due_review_first
  no
   ↓
有效样本 < 20?
  yes → baseline
  no
   ↓
adaptive_weakness
```

无需确认时间、题量或难度。

## 5. 原子批次

默认：

```text
atomic_batch_questions = 3
open_ended = true
```

3 题完成后重新读取最新状态，再决定：

- 继续当前目标；
- 切到新的到期复习；
- 切到更高优先级弱项；
- 用户主动结束。

用户可以连续刷很多批，但不需要预先声明总题量。

## 6. 时间模式

仅当用户主动提供 `available_minutes` 时进入 timeboxed。

默认映射：

| 可用时间 | 计划题量上限 |
|---|---:|
| ≤5 分钟 | 3 |
| 6～10 分钟 | 5 |
| 11～20 分钟 | 8 |
| 21～30 分钟 | 12 |
| >30 分钟 | 15 |

仍以 3 题原子批次执行，且可以提前暂停。

时间是上限提示，不是必须做满的承诺。

## 7. 专项模式

用户明确 module/subtype 时直接 focus：

```json
{
  "intent": "focus",
  "focus_module": "资料分析",
  "focus_subtype": "两期比重"
}
```

不追问时间。

## 8. Priority

当需要在多个 subtype 中选择时，可使用：

```text
priority =
  due_urgency      * 0.35 +
  mastery_gap      * 0.25 +
  repeated_error   * 0.15 +
  exam_weight      * 0.10 +
  recency_gap      * 0.10 +
  speed_gap        * 0.05
```

无可靠 exam_weight 时使用中性默认值，不伪造精确频率。

## 9. 计划输出

普通启动：

```json
{
  "project_state_id": "ps_xxx",
  "strategy": "due_review_first",
  "open_ended": true,
  "available_minutes": null,
  "planned_questions": null,
  "atomic_batch_questions": 3,
  "target": {
    "module": "判断推理",
    "subtype": "加强削弱",
    "reason": "今天有2项到期复习"
  },
  "next_choices": ["继续刷", "暂停", "换个专项", "结束并总结"]
}
```

时间模式才填写 `available_minutes` 和 `planned_questions`。

## 10. 题目选择

优先：

1. 到期复习对应同考点题；
2. 当前 target 下未做题；
3. 足够久以前做过的题；
4. AI 变式题。

当前 Project 的 `recent_question_ids` 作为排重输入。

## 11. 暂停与恢复

暂停时：

- 未提交题不计错；
- 已提交题正常进入 attempt events；
- 保存 `unfinished_session`；
- 下次默认 `resume`。

若短期 MCP session 仍存在，可继续原 session。
若已过期，则根据 unfinished target 重新拉一个小批次，不要求用户重新配置。

## 12. Mastery 与复习

Mastery 更新与 SRS 仍遵循 v0.7 Project state reducer。

少于 5 个 subtype 有效样本时，不输出精确 mastery。

默认复习间隔：

`1d → 3d → 7d → 14d → 30d`

## 13. 模考例外

模考/套卷/速度测试可以使用固定题量和时限。

日常训练默认 start-first，不继承模考的固定时长逻辑。
