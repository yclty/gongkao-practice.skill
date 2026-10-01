# Quiz Event Protocol v0.3

## 1. 目标

将“训练大脑”与“答题界面”解耦。

同一套训练逻辑应支持：
- 纯文字聊天
- 可点击选择题卡片
- ChatGPT Plugin / MCP UI
- 全屏长材料答题
- 独立 Web / App

UI 不是个人学习数据的 source of truth。

## 2. Question Payload

```json
{
  "question_id": "GK2025-001",
  "source_type": "real",
  "exam_type": "国考",
  "module": "资料分析",
  "subtype": "两期比重",
  "difficulty": "medium",
  "stem": "...",
  "material_id": "MAT-001",
  "options": [
    {"label": "A", "text": "..."},
    {"label": "B", "text": "..."},
    {"label": "C", "text": "..."},
    {"label": "D", "text": "..."}
  ],
  "correct_answer": "C",
  "target_seconds": 55
}
```

正确答案可以在服务端/宿主侧隐藏，不应在作答前暴露给 UI。

## 3. Quiz Events

### QUESTION_SHOWN

```json
{
  "type": "QUESTION_SHOWN",
  "session_id": "session_xxx",
  "question_id": "GK2025-001",
  "shown_at": "..."
}
```

### ANSWER_SUBMITTED

```json
{
  "type": "ANSWER_SUBMITTED",
  "session_id": "session_xxx",
  "question_id": "GK2025-001",
  "answer": "B",
  "submitted_at": "...",
  "elapsed_seconds": 46,
  "input_mode": "tap"
}
```

`elapsed_seconds`：
- UI 能自动计时时自动采集
- 纯文字模式无法可靠计时时可为空
- 不应强迫用户每题手输耗时

### ANSWER_EVALUATED

```json
{
  "type": "ANSWER_EVALUATED",
  "question_id": "GK2025-001",
  "correct": false,
  "correct_answer": "C",
  "diagnosed_error": {
    "primary": "M",
    "secondary": null,
    "confidence": 0.72
  },
  "speed_status": "ok"
}
```

### ERROR_CORRECTED

用户可修正 AI 的错因：

```json
{
  "type": "ERROR_CORRECTED",
  "question_id": "GK2025-001",
  "from": "C",
  "to": "M"
}
```

用户确认后的错因优先级高于 AI 初判。

### QUESTION_SKIPPED

记录主动跳过，不默认当成知识错误。

### SESSION_PAUSED / SESSION_RESUMED

暂停时间不计入单题有效作答时长。

### SESSION_COMPLETED

输出本轮聚合结果和状态增量。

## 4. 默认答题交互

正常选择题的目标是：

**看题 → 点击一个选项**

一次正常作答不要求用户额外输入：
- 耗时
- 信心值
- 错因
- 题型

这些应由 UI、题库和 AI 自动生成；只有需要纠正时才让用户介入。

## 5. Feedback Contract

### 答对

默认只显示轻反馈：

```text
正确
用时：46秒（目标≤55秒）
最快思路：……
```

提供：
- 下一题
- 看完整解析

### 答错

默认显示：

```text
选择 B
正确答案 C
初判错因：M 方法不会
关键一步：……
```

提供：
- 修改错因
- 看最快解法
- 看完整解析
- 下一题

不要默认输出长篇解析。

## 6. Renderer Capability

宿主应声明可用渲染能力：

```json
{
  "renderer": {
    "choice_card": true,
    "timer": true,
    "fullscreen": false,
    "material_panel": true
  }
}
```

Skill 根据能力选择最佳表现层：

1. 有 choice_card → 点击式选项
2. 长材料且支持 fullscreen → 全屏
3. 否则 → 简洁文字兜底

不得因为某个特定 UI 工具不存在而中断训练。

## 7. 文字兜底格式

当没有交互 UI 时：

```text
资料分析 · 两期比重   3/8

[题干]

A. ...
B. ...
C. ...
D. ...

直接回复 A/B/C/D。
```

用户只需回复选项。若无法自动计时，不强制要求附带秒数。

## 8. 长材料

资料分析、阅读理解、图表类题目：
- 材料与题目分离
- 多题可复用同一 material_id
- UI 支持时固定材料面板或 fullscreen
- 文字模式避免重复粘贴完整材料，可引用“沿用上题材料”

## 9. Session Summary Payload

```json
{
  "session_id": "session_xxx",
  "questions": 8,
  "correct": 6,
  "accuracy": 0.75,
  "active_seconds": 756,
  "top_error_codes": ["M"],
  "mastery_changes": [],
  "review_updates": [],
  "next_target": {
    "module": "资料分析",
    "subtype": "两期比重"
  }
}
```
