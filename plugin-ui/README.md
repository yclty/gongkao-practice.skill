# Gongkao Quiz Plugin UI v0.4

这是 `gongkao-practice.skill` 的可点击答题 UI 最小实现。

## 已实现

- A/B/C/D 点击答题
- 自动计时
- 作答前不向 UI 暴露正确答案
- 正确/错误轻反馈
- 最快思路 + 可展开完整解析
- 错因 K/M/U/R/C/D/T/G/S 一键修正
- 下一题
- 本轮总结
- 服务端内存中的临时 session，默认 2 小时过期
- 无 UI 环境仍可继续使用原有文字协议

## 架构

```text
ChatGPT / MCP Host
      |
      | start_quiz_session
      v
MCP Server --------------------+
      |                        |
      | structuredContent      | ephemeral session
      v                        |
Quiz Widget                    |
      |                        |
      +-- submit answer ------>+
      +-- set error code ----->+
      +-- next question ------>+
```

MCP Server 只维护当前训练的短期临时状态，不作为个人能力画像的长期数据库。长期学习状态仍由 ChatGPT Project / 宿主维护。

## 本地运行

需要 Node.js 20+。

```bash
cd plugin-ui
npm install
npm test
npm start
```

默认 MCP 地址：

```text
http://localhost:8787/mcp
```

健康检查：

```text
http://localhost:8787/
```

## MCP Inspector

```bash
npx @modelcontextprotocol/inspector@latest
```

选择 Streamable HTTP，连接：

```text
http://localhost:8787/mcp
```

## 在 ChatGPT 中开发测试

ChatGPT 连接远程 MCP 需要 HTTPS。开发阶段可使用 ngrok：

```bash
ngrok http 8787
```

得到公网地址后，在 ChatGPT Developer mode 中添加 MCP：

```text
https://<your-domain>/mcp
```

当前 OpenAI 官方插件开发流程建议在 ChatGPT 的 Plugins / Developer mode 中连接 MCP，并使用支持插件的 ChatGPT surface 测试。

## 工具

### start_quiz_session

由教练/调度器在准备好本轮题目后调用。

单次最多 20 题。每题包含：
- question_id
- module / subtype
- source_type
- stem / material
- options
- correct_answer
- target_seconds
- fastest_method
- explanation_short / explanation_full

### submit_quiz_answer

由 UI 点击选项后调用，自动上传 elapsed_seconds 并评分。

### set_quiz_error_code

用户答错后可选。用户修正结果优先于自动归因。

### next_quiz_question

进入下一题；最后一题后返回 summary。

## 重要限制

v0.4 的 session 使用进程内 Map，仅用于开发和小规模测试：

- 服务重启后 session 消失
- 多实例部署不会自动共享 session
- 这不是用户长期学习数据库

生产版可替换为：
1. 签名 evaluation token；或
2. Redis 等短期 session store。

个人长期数据仍不应写入公共 GitHub。

## 与 v0.3 协议的关系

- 调度逻辑：`../references/scheduler-protocol.md`
- 答题事件：`../references/quiz-event-protocol.md`
- UI 原则：`../references/ui-contract.md`
