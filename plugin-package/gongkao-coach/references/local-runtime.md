# 本地运行时契约（1.0.0）

正式学习数据由本机服务保存。网站和 stdio MCP 调用同一 API，不通过总结重复回写。旧 server.js 与 0.9 的 Project JSON 合约仅供历史兼容。

## 身份与写入

learner_id 表示本地学习者，goal_id 表示该学习者的考试目标。binding_id 从初始化或明确选择档案取得；MCP 工具不会默认绑定第一个人。session_id、session_item_id、attempt_id 必须与目标一致。

普通正式作答在同一 SQLite 事务中保存 attempt、能力画像、复习任务与 session。每题位最多一个正式 attempt。写操作带 idempotency_key；重试同键同参数返回原结果，换内容则拒绝。只有 save_status=saved 表示已保存。revision 用于发现并发修改；不要用聊天缓存覆盖数据库。

## API

读取：get_learning_context、get_question_bank_status、plan_training_session、get_quiz_session、get_progress_report。

创建：initialize_project_learning_state（新学习者，或传 learner_id 创建新目标）、start_quiz_from_bank、start_paper_from_bank、start_quiz_session（练习/AI 变式）。

训练：submit_quiz_answer、next_quiz_question、pause_quiz_session、resume_quiz_session、save_quiz_draft、submit_paper_session。

调整：set_quiz_error_code、configure_project_study_route。AI 错因用 ai_suggested；用户确认用 user_confirmed。前者保存建议和置信度，后者才更新正式统计。

open_learning_ui 返回一次性本地网页入口。网页管理独立备份导出/恢复与旧 Project 状态导入。普通答题前不公开正确答案、解析或叶子考点；严格模拟草稿不计入能力，期限在关闭和重启后保持。

## 存储与备份

默认 Windows 数据目录：%LOCALAPPDATA%/GongkaoCoach/data。registry.sqlite 保存档案绑定；profiles/<learner_id>/learning.sqlite 保存目标、全程作答、会话、笔记与持久状态；attachments 保存已使用题图快照。

SQLite 使用 WAL、FULL synchronous 和事务。首次正式操作前每天自动快照，保留 7 个日备份、4 个周备份。网页随时导出最新个人 .gkbackup；恢复检查版本与 SHA-256，建立新档案。题目快照和已使用图片在卸载题库后仍可恢复。升级公共包与卸载 Plugin 都保留个人数据；新版数据拒绝被旧版程序打开。

普通题记录有效用时，网页约每 15 秒保存一次草稿与计时，暂停不增加耗时，服务重启不把关机时间算作答题。严格模拟用固定截止时间，整卷提交一次判分。选择尚未正式提交的题不会被当作错题。

## 题库与长期学习

打包只使用公开题库、规则、运行时与依赖。题图离线打包。缺题、缺图、重复题位、无效答案的卷不能出现在完整整卷入口。相同题可有多个 paper_memberships，唯一题记录不会丢掉各卷关系。

基础轮次为单叶子考点 15 题至少 9 对；普通练习不推进基础过关。复习绑定 review_task_id，可用同考点兄弟题，按 1/3/7/14/30 天推进。选题基于全程历史，优先未做题和历史错误，不只看最近 30 题。报告保留全程数据并列明 7/30 天样本与限制。

## 支持范围

当前交付为 Windows x64 本地安装包 + Codex 桌面 AI 聊天 + 本地网页。网页不包含独立 AI API 聊天；模型与联网由 AI 宿主提供。新运行时优先本地网页与文字答题，旧内嵌卡片仍为历史实现。网页与桌面入口已验证共用 API；本地 stdio 不能直接供 ChatGPT 网页/手机端运行。

同一操作系统用户的多档案是逻辑隔离，非账户权限隔离。共享电脑需要保密时请使用不同系统用户。软件不保证录用；申论自动评分、跨机器同步与后台主动通知未作为本版完成能力。
