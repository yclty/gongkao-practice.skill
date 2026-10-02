# Scheduler Protocol v0.7

## 1. 目标

调度器负责回答一个问题：**用户当前这段时间，最值得练什么？**

输入是当前用户状态和可用时间；输出是本轮训练计划。调度器不负责 UI 渲染，也不直接持久化个人数据。

## 2. 核心原则

- Time-first：优先依据用户可用时间规划训练，而不是先问题量。
- Review-first：到期复习优先于随机新题。
- Weakness-aware：优先处理稳定出现的薄弱子题型和重复错因。
- Exam-weighted：考试高频/高价值模块在同等条件下优先。
- Speed-aware：答对但明显超时也应进入训练。
- Stable-update：单题不应大幅改变长期能力画像。

## 2.1 Project 隔离

Scheduler 的所有个人输入都必须来自**当前 Project**。

输入至少包含：
- `project_state_id`
- 当前 Project 的 goal
- 当前 Project 的 ability_profile
- 当前 Project 的 review_queue
- 当前 Project 的 recent_question_ids

禁止跨 Project 汇总能力画像。

同一账号的不同 Project 应被视为不同训练空间。

## 3. 子题型状态

每个 subtype 至少维护：

```json
{
  "module": "资料分析",
  "subtype": "两期比重",
  "mastery": 42,
  "accuracy_30": 0.58,
  "avg_seconds_30": 91,
  "target_seconds": 55,
  "error_streak": {
    "code": "M",
    "count": 2
  },
  "last_practiced_at": "2026-10-01T09:00:00+08:00",
  "review_due_at": "2026-10-01T10:30:00+08:00",
  "exam_weight": 0.85
}
```

`mastery` 取 0～100：
- 0～39：明显薄弱
- 40～59：不稳定
- 60～74：基本掌握
- 75～89：较稳定
- 90～100：稳定维持

## 4. Priority Score

对候选 subtype 计算：

```text
priority =
  due_urgency      * 0.35 +
  mastery_gap      * 0.25 +
  repeated_error   * 0.15 +
  exam_weight      * 0.10 +
  recency_gap      * 0.10 +
  speed_gap        * 0.05
```

每个分量归一化为 0～100。

### 4.1 due_urgency

- 未到期：0～20
- 今天到期：70
- 已逾期 1～2 天：85
- 已逾期 ≥3 天：100

### 4.2 mastery_gap

`100 - mastery`

### 4.3 repeated_error

- 无重复错因：0
- 同 subtype 同错因连续 2 次：60
- 连续 3 次：80
- 连续 ≥4 次：100

### 4.4 exam_weight

由考试目标和题型频率映射为 0～100。若暂缺可靠权重，默认 50，不虚构精细比例。

### 4.5 recency_gap

越久未训练，分值越高；但若已由 due_urgency 覆盖，不重复过度加权。

### 4.6 speed_gap

仅在有目标耗时且样本足够时使用：

```text
speed_gap = clamp((avg_seconds - target_seconds) / target_seconds * 100, 0, 100)
```

## 5. 时间预算

用户直接说“我现在有 X 分钟”时，不再追问题量。

默认规划：

| 可用时间 | 默认训练结构 |
|---|---|
| ≤5 分钟 | 2～3 题；到期复习优先 |
| 6～10 分钟 | 4～6 题；单一弱项微训练 |
| 11～20 分钟 | 复习 + 1 个薄弱专项 |
| 21～30 分钟 | 一个完整训练单元：复习 + 专项 + 维持 |
| 31～60 分钟 | 复习 + 专项 + 小模考/速度训练 |
| >60 分钟 | 按阶段组合专项、模考和复盘 |

题量是结果，不是输入。

## 6. 训练配额

当状态数据充足时，默认目标配额：

- 到期复习 / 错题变式：30～45%
- 当前高优先级弱项：35～50%
- 已掌握内容维持：10～20%

这不是硬比例。若到期复习很多、临近考试、或用户明确指定专项，应动态调整。

## 7. Session Planner

输出结构：

```json
{
  "session_id": "session_xxx",
  "project_state_id": "ps_xxx",
  "available_minutes": 10,
  "mode": "micro",
  "targets": [
    {
      "module": "资料分析",
      "subtype": "两期比重",
      "reason": "到期复习 + mastery 42 + 连续2次M",
      "priority": 91,
      "planned_questions": 4
    }
  ],
  "maintenance": [
    {
      "module": "判断推理",
      "subtype": "加强削弱",
      "planned_questions": 1
    }
  ],
  "estimated_minutes": 9
}
```

## 8. 题目选择

优先级：

1. 到期的真实错题或同考点真题
2. 未做过的同 subtype 真题
3. 已做过但间隔足够长的真题
4. AI 变式题

来源标签统一使用：

- `official_real`
- `platform_import`
- `practice`
- `ai_variant`

AI 题必须明确标记 `source_type=ai_variant`。

调用 QuestionProvider 时，将当前 Project 的 `recent_question_ids` 作为近期排重输入。

## 9. Mastery 更新

单题只产生小幅增量。建议：

- 真题正确 + 速度达标：+2～4
- 真题正确但超时：0～+1，并可记录 S
- 真题错误：-2～-5
- AI 变式题正确：+1～2
- AI 变式题错误：-1～-3
- 同类连续稳定表现可额外调整，但单轮变化建议不超过 ±10

长期画像优先依据最近 10～30 道同类有效样本。

## 10. 复习调度

默认间隔：

`1d → 3d → 7d → 14d → 30d`

- 复习正确且速度达标：进入下一间隔
- 复习正确但超时：可维持当前间隔
- 复习错误：回退一级或缩短间隔
- 连续稳定：可延长到 60d 维护

## 11. 无数据时

没有足够个人数据时：
- 标记为 baseline 阶段
- 不虚构“最薄弱模块”
- 用覆盖式诊断逐步建立画像
- 用户可以随时中断，下一次继续
