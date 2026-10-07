# 本地考公运行时 1.0.0

新入口为 mcp-stdio.js（AI 聊天）与 ensure-service.js --open（本地网页）。它们自动连接单个 127.0.0.1 学习服务，复用 lib/learning-service.js 和每人独立的 SQLite。

开发运行需要 Node 24.14+，发布包自带经验证的 Node 24.19.0：

```powershell
npm ci --ignore-scripts
npm test
node ensure-service.js --open
node mcp-stdio.js
```

默认个人目录为系统用户的本地 GongkaoCoach/data。测试使用 GONGKAO_DATA_DIR 的独立临时目录，不访问真实档案。QUESTION_BANK_PATH 可指定 JSONL；发布包自动使用 bank/questions.jsonl。

普通作答自动保存与永久去重；复习和画像在同一事务更新。会话保存题目快照、草稿和截止时间。没有响应时重试同键，不能换键改写已提交答案。旧 apply_project_learning_events 摘要回写已禁用。

本地网页包含档案选择、训练、章节与基础过关、完整卷、严格模拟、报告、个人备份和旧状态导入。当前不接入独立网页 AI API；新运行时使用网页和文字入口，旧嵌入答题卡不作为本版发布能力。

server.js 和 quiz-widget.html 保留为 0.9 HTTP/内嵌界面历史实现。旧 Project 保存方式不再是 1.0 的正式状态来源。运行时契约见 ../references/local-runtime.md，端到端包验证脚本见 ../scripts/verify_local_package.mjs。
