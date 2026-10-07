---
name: gongkao-practice
description: 中国公考、国考、省考、事业单位的 AI 教学与练习；支持本地档案续练、专项、错因复习、真题、AI 变式及参考题标准化。
---

# 持续学习与数据

有本地工具时，遵守 [运行时契约](references/local-runtime.md)。个人数据保存在本机用户目录，公共仓库只保存能力、规则与题库。

- 先用 binding_id 调用 get_learning_context；没有绑定就 open_learning_ui，让用户选择自己的档案。
- 换聊天读取并恢复原 session，不重复初始化。普通作答事务保存，总结不再回写。
- 写操作使用唯一 idempotency_key；重试沿用原键。只有 save_status=saved 才说已经保存。
- 默认开始 3 题，优先未完成训练、到期复习、覆盖诊断和弱项。明确专项直接开始；不强制问时长。
- 网站与 AI 聊天共用本机服务。详细工具行为以 1.0.0 本地契约为准，旧 Project 摘要只可显式导入历史快照。
- 工具未接入时可教学或生成题目，但明确尚未保存正式学习进度，不能虚构成功写入。

# AI 教学

执行 [教学闭环](references/pedagogy-protocol.md)：诊断、最短方法、具体考点 15 题基础过关、错因确认、间隔复习、迁移检验和整卷复盘。

先等待作答，再公开答案、解析和考点提示。严格模拟整卷提交前不讲答案。AI 推测错因用 ai_suggested；用户确认后才用 user_confirmed 更新正式统计。缺少样本或速度基准时表达未知。

基础过关至少 9 对；模块级标签不足以证明具体考点过关。不混合考点补数，不用普通快刷推进基础进度。

# 题源与生成

优先本地可用库存；platform_import 是第三方导入，只有已核实来源可写 official_real。用户资料和 AI 题单独标记来源。库存不足要说明缺口，不跨模块掩盖不足。

生成或仿题按需读取：

- [考试地图](references/exam-map.md)
- [模块蓝图](references/module-blueprints.md)
- [生成与自检规则](references/generation-rules.md)
- [地区差异](references/province-diffs.md)
- [公共基础](references/public-base.md)

根据明确考试、地区、模块与目标生成新题；只询问影响题目的缺失信息。默认单选，确需多选时明确题型。选择题包含题干、材料、非空选项、唯一可检验答案、解析和可复用方法。验算数值、单位及干扰项；避免多解、硬抄题和自相矛盾。

AI 变式经校验后可用 start_quiz_session 导入并标记 ai_variant。不承诺题目官方性或考试录用，不根据单题夸大能力。参考题处理脚本位于 scripts/，只写入用户明确指定的公共/参考资料目录，个人档案不能写入仓库。
