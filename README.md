# gongkao-practice.skill

`gongkao-practice.skill` 是一个面向中国公务员考试、省考、事业单位考试场景的技能型项目，用于生成高质量选择题练习，并把分散的参考题资料整理为统一、可校验、可复用的结构化题库。

项目聚焦两类能力：

- 公考练习生成：覆盖公基、职测及其细分模块，支持按考试类型、地区、省份、题量、难度和题型生成练习题。
- 参考题标准化：支持从 Markdown、CSV、Excel (`.xlsx`) 和 JSONL 中导入题目，完成字段归一化、分类映射、质量校验和样例导出。

这个仓库更适合被用作：

- AI 公考刷题助手的技能仓库
- 公考题库清洗与规范化工具链
- 仿题生成与参考题学习的底层资料库



## 本地 Plugin 目标方案（设计）

目标是 **可导出安装、供多人各自长期使用的本地 AI 考公学习包**，不以上架为前提。网站采用本地网页，与桌面 AI 聊天通过同一个本机学习服务，共用每个学习者的本地记录。

完整架构、多人隔离、保存恢复、题库质量、安装升级与发布验收见 [本地 AI 考公 Plugin 系统设计](docs/local-plugin-design.md)。这是一份目标设计；当前 v0.9 的个人状态仍依赖宿主保存，尚未实现该设计中的 SQLite 持久化和完整本地安装包。下方版本章节记录现有实现。

设计后的使用流程：

1. 接收带运行时、规则和基础题库的公共安装包，在支持的桌面宿主启用 Plugin。
2. 创建自己的本地学习档案，并将网页 / AI 聊天绑定到该档案的备考目标。
3. 说“开始练习”，或打开本地网页做题；作答由本机服务自动保存。
4. 随时暂停，换聊天或重启后从本地数据库恢复。
5. 升级公共包保留个人记录，换机通过独立个人备份恢复。

`plugin-package/` 与 `plugins/` 保留 portable Plugin 资产；实现阶段统一为一个可复现的本地构建来源。

> 大家可以安装同一个公共包，每个人的学习数据分别存在自己的系统用户目录中。同一学习者的多个聊天可以共享同一目标的进度；一个聊天 / session 不能隐式切换数据归属。

## 目标数据边界与 v0.9 兼容

目标设计把公共能力与个人学习状态分开：

- **GitHub**：保存 Skill、题型规则、公共题库、题库处理脚本。
- **本地个人数据库**：保存能力画像、正式作答、错题、复习队列、路线与未完成训练，位于 Plugin 安装源和宿主缓存之外。
- **桌面 AI 聊天 / 本地网页**：调用共同学习服务；聊天记录与浏览器缓存不承担正式进度保存责任。
- Skill 本身保持无个人状态，不把用户学习数据提交到 GitHub。

公共安装包不携带任何人的个人数据或模型密钥。现有 Project 状态契约是 v0.9 兼容接口；本地持久化实现时同步迁移 Skill、协议和文档。

详见：

- [Project 状态契约](references/project-state-contract.md)
- [统一错因分类](references/error-taxonomy.md)


## v0.3：训练调度与答题协议

本 Fork 已将训练大脑与 UI 解耦：

- [Scheduler Protocol](references/scheduler-protocol.md)：基于时间预算、到期复习、掌握度、错因、考试权重和速度动态调度。
- [Quiz Event Protocol](references/quiz-event-protocol.md)：统一选择题事件与计时、错因修正、结果回写。
- [UI Contract](references/ui-contract.md)：定义 inline / fullscreen / summary / 文字兜底的体验原则。

核心目标：

> 用户不需要先估计学习时长；打开后说“开始练习”即可，系统自动安排 3 题小批次，任何时候都能暂停。普通选择题理想情况下只需点击一次。

因此本 Skill 不再绑定某个特定的 `question` 工具或具体前端。


## v0.4：ChatGPT 内嵌答题卡

仓库新增 `plugin-ui/`，提供公开 Plugin 使用的 MCP Server + MCP Apps UI 运行时。

当前交互已覆盖：

- A/B/C/D 点击答题
- 自动计时
- 轻反馈
- 最快思路 / 完整解析
- 错因一键修正
- 下一题
- 训练总结

开发说明见 [plugin-ui/README.md](plugin-ui/README.md)。

> `plugin-ui` 的 session 仅是短期临时状态，不替代每个用户自己的 Project 学习状态。

## v0.5：公开 Plugin 发布包

仓库新增 `plugin-package/gongkao-coach/`，按 OpenAI portable Agent Plugins 格式准备最终发布包：

- Plugin manifest 模板
- MCP manifest 模板
- onboarding skill
- adaptive coach skill
- 正向 / 负向审核用例
- Plugin 图标
- 隐私政策与使用条款
- 发布检查清单
- 一键生成最终提交目录的构建脚本

部署生产 MCP 后，通过：

```bash
MCP_URL="https://你的生产域名/mcp" \
DEVELOPER_NAME="你的已验证发布者名称" \
node plugin-package/build-package.mjs
```

生成最终可打包上传的 `dist/gongkao-coach/`。


## v0.6：接入真实题库 QuestionProvider

已审计 `yclty/gongkao` 的 SaDuck 快照：153 套试卷、18,025 个题目出现次数。

v0.6 新增：

- `scripts/import_gongkao_repository.py`：把另一个仓库的题库快照转换成 canonical JSONL
- `plugin-ui/lib/question-provider.js`：本地文件型题库 Provider
- `start_quiz_from_bank`：Scheduler 只传训练目标，服务端直接选题并启动答题卡
- `platform_import` 来源类型：第三方导入题不再冒充“官方真题”
- SINGLE / JUDGE 进入点击答题卡，MULTIPLE 暂存等待多选 UI

本地生成题库：

```bash
python scripts/import_gongkao_repository.py \
  --source ../gongkao/tools/saduck-scraper/saduck-tiku-json \
  --output local-data/gongkao-question-bank.jsonl \
  --meta local-data/gongkao-question-bank.meta.json
```

启动答题服务：

```bash
cd plugin-ui
QUESTION_BANK_PATH=../local-data/gongkao-question-bank.jsonl npm start
```

生成的大题库文件默认不建议提交到 GitHub。

详见 [题库审计](references/gongkao-question-bank-audit.md)。


## v0.7：Project-scoped Personal State

个人学习状态现在按 **ChatGPT Project** 隔离：

```text
Project A（国考）      → project_state_id = ps_A → 独立画像/错题/SRS
Project B（陕西省考）  → project_state_id = ps_B → 独立画像/错题/SRS
Project C（事业单位）  → project_state_id = ps_C → 独立画像/错题/SRS
```

即使三个 Project 属于同一个 ChatGPT 账号，也不自动合并。

v0.7 新增：

- `references/project-scoped-personal-state.md`
- `plugin-ui/lib/project-state.js`
- `initialize_project_learning_state`
- `apply_project_learning_events`
- Quiz session 的 `project_state_id` 绑定
- session summary 回传完整 attempt metadata
- Project mismatch 检查
- 紧凑状态窗口：1000 个近期题 ID、300 条近期 attempt、每 subtype 30 条样本

MCP 的 reducer 是无状态的：它只计算新 state，不保存长期用户画像。


## v0.8：Start-first 碎片化训练

真实使用不再以“先告诉系统有多少分钟”为默认入口。

默认体验：

```text
开始练习
   ↓
继续上次 / 到期复习 / baseline / 薄弱项
   ↓
3题原子批次
   ↓
答题
   ├─ 继续刷
   ├─ 暂停
   ├─ 换专项
   └─ 结束总结
```

新增：

- `plan_training_session`：无时间参数也能直接调度
- `pause_quiz_session`：随时暂停
- `references/start-experience.md`
- start-first Scheduler
- 3 题 atomic batch
- unfinished session 优先恢复
- 时间模式降级为可选项

新用户只需要先知道“开始练习 / 暂停 / 继续上次 / 专项训练”四件事。


## v0.8.1：本地 Plugin 试用包

不公开发布也可以先做本地验证。

仓库新增：

- `.agents/plugins/marketplace.json`
- `plugins/gongkao-coach/`
- `local-test/install-personal-plugin.cmd`
- `local-test/prepare-local-runtime.cmd`
- `local-test/start-mcp.cmd`
- `local-test/open-mcp-inspector.cmd`
- `LOCAL_TEST_START_HERE.md`

当前推荐分两层测试：

1. **ChatGPT Desktop 本地 Plugin**：验证 Skill、初始化、Project 隔离、Start-first、暂停/继续语义。
2. **MCP Inspector**：验证本地 MCP、QuestionProvider、state reducer 和 UI resource。

本地 marketplace 本身不会自动把 `localhost` MCP 连接进 ChatGPT，因此 v0.8.1 不把“Skill 安装成功”和“点击答题卡已接通”混为一件事。

详见 [LOCAL_TEST_START_HERE.md](LOCAL_TEST_START_HERE.md)。


## v0.9：场景化学习路线与真题整卷

v0.8.1 实测暴露了两个问题：

1. “开始练习”入口太被动，没有根据整块时间 / 碎片时间主动给学习方式。
2. 本地 Plugin 只安装了 Skill；即使仓库里有题库导入代码，ChatGPT 本身也看不到未连接的 localhost QuestionProvider，因此会把“个人画像样本少”和“真题运行时没接入”混在一起。

v0.9 修正为：

- 每个 Project 保存自己的 `study_route` 和场景偏好
- 晚间/周末主动给“路线 / 章节 / 20题套题 / 真题整卷 / 碎片刷题”
- 工作/碎片场景优先“3题快刷 / 到期复习 / 路线继续”
- 新增 `get_question_bank_status`
- 新增 `configure_project_study_route`
- 新增 `start_paper_from_bank`
- canonical 题库保留 paper_id / paper_position，可真正按整卷启动
- 本地准备脚本找不到 `yclty/gongkao` 时自动拉取并生成 canonical 题库
- 新增带题库数据的离线 ZIP 构建脚本

重要：**本地 Skill 安装 ≠ ChatGPT 已连接本地 MCP。**  
Skill-only 模式应该明确提示“真题运行时未接入”，而不是说“缺乏数据”。


## 项目特点

- 覆盖国考、省考、事业单位等常见场景
- 支持公基、职测、言语、判断、数量、资料、公文等模块化出题
- 内置考试类型、科目、模块、难度、省份等标准化映射规则
- 强调答案唯一、解析闭环、干扰项合理和题型边界清晰
- 支持从原始题库文件导入，再转为统一 JSONL 结构
- 提供本地验证脚本，便于检查字段完整性和题目质量
- 内置示例数据和验证提示词，方便快速演示与调试

## 适用场景

- 想快速生成一组公基或职测试题
- 想让 AI 参考既有题目风格生成同结构新题
- 想把散落在 Markdown、Excel、CSV 里的题库整理成统一格式
- 想构建一个可持续维护、可验证、可扩展的公考题库工程

## 核心目录

```text
.
|-- README.md
|-- LICENSE
|-- SKILL.md
|-- references/
|   |-- exam-map.md
|   |-- generation-rules.md
|   |-- module-blueprints.md
|   |-- province-diffs.md
|   `-- public-base.md
|-- scripts/
|   |-- import_references.py
|   |-- normalize_references.py
|   |-- validate_items.py
|   `-- export_examples.py
`-- assets/
    `-- reference-bank/
        |-- raw/
        |-- normalized/
        `-- samples/
```

各目录职责如下：

- `SKILL.md`：技能说明与交互手册，定义了项目的功能边界和使用方式。
- `references/`：规则层文档，包含考试映射、出题规则、模块蓝图、省份差异、公基范围等知识约束。
- `scripts/`：数据处理脚本，负责导入、标准化、校验和导出示例。
- `assets/reference-bank/raw/`：原始参考题中间结果。
- `assets/reference-bank/normalized/`：标准化后的 JSONL 题库。
- `assets/reference-bank/samples/`：示例题、异常样例和本地验证提示词。

## 数据处理流程

推荐的题库处理流程如下：

1. 将 Markdown、CSV、Excel 或 JSONL 参考题导入为统一 JSONL。
2. 对导入结果做考试类型、科目、模块、难度、省份等字段标准化。
3. 对标准化结果执行校验，检查题目字段、答案和结构是否合规。
4. 导出样例提示词或把结果交给上层生成系统进行仿题与出题。

对应脚本如下：

- `scripts/import_references.py`
  读取原始题目文件或目录，输出导入后的 JSONL。
- `scripts/normalize_references.py`
  对导入题目做字段归一化和规则映射，生成标准化题库。
- `scripts/validate_items.py`
  校验标准化 JSONL 是否满足结构和字段约束。
- `scripts/export_examples.py`
  根据本地题库导出验证提示词，用于测试技能输出质量。

## 快速开始

项目脚本基于 Python 3 标准库即可运行，无需额外第三方依赖。

### 1. 导入原始参考题

```bash
python scripts/import_references.py assets/reference-bank/samples --output assets/reference-bank/raw/imported.jsonl
```

### 2. 标准化导入结果

```bash
python scripts/normalize_references.py assets/reference-bank/raw/imported.jsonl --output assets/reference-bank/normalized/normalized.jsonl
```

### 3. 校验标准化题库

```bash
python scripts/validate_items.py assets/reference-bank/normalized/normalized.jsonl
```

### 4. 导出本地验证提示词

```bash
python scripts/export_examples.py
```

## 标准化题目结构

标准化后的题目以 JSONL 存储，每行一题，核心字段包括：

- `id`
- `exam_type`
- `subject`
- `province`
- `module`
- `subtype`
- `difficulty`
- `stem`
- `options`
- `answer`
- `analysis`
- `pattern_tags`
- `reasoning_path`
- `distractor_style`
- `source_path`
- `source_type`

示例记录可见：

- [assets/reference-bank/normalized/sample_references.jsonl](assets/reference-bank/normalized/sample_references.jsonl)

## 规则设计重点

本项目不是简单“随机出题”，而是通过规则层约束题目质量，重点包括：

- 明确区分公基与职测，避免题型边界混乱
- 针对不同模块定义稳定的子题型、解题路径和干扰项套路
- 对省考场景保留省份差异，但默认控制在全国通用风格范围内
- 强调题目必须是单选题、答案唯一、解析闭环
- 对历史文化、科技人文等易出错模块设置额外事实校验提醒

## 仓库现状

当前仓库已经包含：

- 技能说明文档
- 出题规则参考文档
- 示例题与样例题库
- 原始题导入脚本
- 题目标准化脚本
- 题库校验脚本
- 本地验证提示词导出脚本

如果后续继续扩展，可以进一步加入：

- 更多省份差异规则
- 更完整的真实题库导入模板
- 自动化测试
- 题库统计分析脚本
- 面向在线服务的接口封装

