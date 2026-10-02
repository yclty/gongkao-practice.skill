# Gongkao Quiz MCP + UI Runtime v0.9

这是 `gongkao-practice.skill` 的可点击答题 UI 最小实现。

## v0.9 学习路线与真题整卷

新增：
- `get_question_bank_status`
- `configure_project_study_route`
- `start_paper_from_bank`
- route / chapter / set / paper / quick / review session modes
- canonical paper metadata
- 题库状态与个人画像状态分离

`plan_training_session(include_launcher=true)` 会根据当前场景返回推荐入口。

## v0.8 随开随练

普通使用不再要求先填写 available_minutes。

新增：
- `plan_training_session`：start-first 调度
- 3 题原子批次
- `pause_quiz_session`
- 题目页 / 解析页均可暂停
- 暂停返回 `unfinished_session`
- 下次“继续上次”优先恢复
- timeboxed 仅在用户主动指定时间时启用

默认体验：

```text
开始练习 → 做题 → 有事就暂停 → 回来继续上次
```

## v0.7 Project 状态隔离

长期学习状态不按 ChatGPT 账号存到 MCP，而按当前 Project 隔离。

新增两个无状态工具：

- `initialize_project_learning_state`：生成当前 Project 的独立 state 与 `project_state_id`
- `apply_project_learning_events`：输入旧 state + attempt events，返回新 state

Quiz 启动工具可接收 `project_state_id`。session summary 会原样带回，用于防止把 Project A 的训练结果写入 Project B。

MCP 只短期保存 quiz session；长期 state 必须由当前 Project / host 保存。

## v0.6 本地题库

先在仓库根目录生成 canonical JSONL：

```bash
python scripts/import_gongkao_repository.py \
  --source ../gongkao/tools/saduck-scraper/saduck-tiku-json \
  --output local-data/gongkao-question-bank.jsonl
```

启动时配置：

```bash
cd plugin-ui
QUESTION_BANK_PATH=../local-data/gongkao-question-bank.jsonl npm start
```

新增 `start_quiz_from_bank` 工具，支持按 module / subtype / exam_type / province / year 和 source_type 选题，并支持传入 `exclude_question_ids` 避免近期重复。

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

## 生产部署

公开 Plugin 使用时，MCP Server 必须部署在公网 HTTPS 地址，例如：

```text
https://your-production-domain.example/mcp
```

生产部署需要：

- 设置 `OPENAI_APPS_CHALLENGE`，用于域名验证；
- 保证 `/.well-known/openai-apps-challenge` 返回该 token；
- 保持 `/mcp` 为 Streamable HTTP MCP 入口；
- 使用稳定域名，不使用临时测试隧道作为公开发布地址；
- UI CSP 与实际访问域名保持一致。

公开发布流程与构建说明见 `../plugin-package/gongkao-coach/README.md`。

## 工具

### start_quiz_from_bank

推荐入口。Scheduler 只提供训练目标与过滤条件，服务端从 `QUESTION_BANK_PATH` 选择题目并直接创建答题 session。

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

当前 session 使用进程内 Map，适合作为短期答题状态：

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
