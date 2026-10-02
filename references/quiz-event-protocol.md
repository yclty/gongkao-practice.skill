# Quiz Event Protocol v0.8

## 1. 目标

支持“打开就刷、随时暂停、回来继续”的碎片化训练。

UI 不是长期个人状态 source of truth；长期状态仍属于当前 Project。

## 2. 核心事件

### QUESTION_SHOWN

记录题目展示。

### ANSWER_SUBMITTED

记录答案和自动采集的有效答题时间。

### ANSWER_EVALUATED

记录正确性、速度状态与 AI 初判错因。

### ERROR_CORRECTED

用户修正错因时，以用户修正为准。

### QUESTION_SKIPPED

主动跳过不默认视为知识错误。

### SESSION_PAUSED

可以在题目尚未提交或解析完成后触发。

要求：

- 停止计时；
- 未提交题不生成错误 attempt；
- 返回已完成 attempts；
- 返回 `unfinished_session`；
- 当前 Project 保存状态。

示例：

```json
{
  "type": "SESSION_PAUSED",
  "project_state_id": "ps_xxx",
  "session_id": "session_xxx",
  "unfinished_session": {
    "target": {
      "module": "资料分析",
      "subtype": "增长率"
    },
    "current_question_id": "q3",
    "remaining_questions": ["q3"],
    "answered_questions": 2
  }
}
```

### SESSION_RESUMED

优先继续 unfinished target。

不要求必须恢复同一个短期 MCP session；session 已过期时，可以按相同 target 重新拉题继续。

### SESSION_COMPLETED

一个原子批次完成后输出 summary。

## 3. 默认交互

普通选择题：

**看题 → 点选项**

同时始终有：

`暂停`

不要求用户输入：
- 时长
- 预计题量
- 单题耗时
- 信心值
- 错因

## 4. Feedback

答对：轻反馈 + 下一题/暂停。

答错：正确答案 + 最快思路 + 可选错因修正 + 下一题/暂停。

完整解析默认折叠。

## 5. Atomic Batch

日常默认 3 题。

进度显示的是当前小批次：

`2 / 3`

而不是让用户看到一个必须完成的 20 题任务。

批次结束后由 Scheduler 决定下一小批。

## 6. Renderer

优先：

1. choice card
2. auto timer
3. material panel / fullscreen
4. text fallback

没有 UI 时，文字模式也必须支持：

- `暂停`
- `继续上次`

## 7. Summary

完成：

```json
{
  "paused": false,
  "project_state_id": "ps_xxx",
  "stats": {},
  "attempts": []
}
```

暂停：

```json
{
  "paused": true,
  "project_state_id": "ps_xxx",
  "stats": {},
  "attempts": [],
  "unfinished_session": {}
}
```

宿主随后调用 Project state reducer 保存结果。
