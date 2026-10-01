# gongkao-practice.skill

`gongkao-practice.skill` 是一个面向中国公务员考试、省考、事业单位考试场景的技能型项目，用于生成高质量选择题练习，并把分散的参考题资料整理为统一、可校验、可复用的结构化题库。

项目聚焦两类能力：

- 公考练习生成：覆盖公基、职测及其细分模块，支持按考试类型、地区、省份、题量、难度和题型生成练习题。
- 参考题标准化：支持从 Markdown、CSV、Excel (`.xlsx`) 和 JSONL 中导入题目，完成字段归一化、分类映射、质量校验和样例导出。

这个仓库更适合被用作：

- AI 公考刷题助手的技能仓库
- 公考题库清洗与规范化工具链
- 仿题生成与参考题学习的底层资料库



## 开箱即用

如果你的目标不是开发题库，而是直接作为个人备考系统使用：

1. 每个学习者新建一个独立 ChatGPT Project。
2. 将 [PROJECT_INSTRUCTIONS.md](PROJECT_INSTRUCTIONS.md) 复制到 Project 指令。
3. 将 [BOOTSTRAP_PROMPT.md](BOOTSTRAP_PROMPT.md) 作为第一次初始化消息发送。
4. 初始化完成后，日常直接说“开始今天训练”。

完整说明见 [QUICKSTART.md](QUICKSTART.md)。

> 不要让多个学习者长期共用同一个 Project；公共 Skill 可以共享，个人学习状态必须隔离。

## 本 Fork 的运行架构

本 Fork 将“可复用能力”和“个人学习状态”彻底分离：

- **GitHub**：保存 Skill、题型规则、公共题库、题库处理脚本。
- **ChatGPT Project / 其他宿主**：保存个人能力画像、作答历史、错题、复习队列和学习计划。
- Skill 本身保持无个人状态，不把用户学习数据提交到 GitHub。

这样可以持续同步上游题库与规则，同时避免个人数据和公共代码耦合。

详见：

- [Project 状态契约](references/project-state-contract.md)
- [统一错因分类](references/error-taxonomy.md)


## v0.3：训练调度与答题协议

本 Fork 已将训练大脑与 UI 解耦：

- [Scheduler Protocol](references/scheduler-protocol.md)：基于时间预算、到期复习、掌握度、错因、考试权重和速度动态调度。
- [Quiz Event Protocol](references/quiz-event-protocol.md)：统一选择题事件与计时、错因修正、结果回写。
- [UI Contract](references/ui-contract.md)：定义 inline / fullscreen / summary / 文字兜底的体验原则。

核心目标：

> 用户只需要告诉系统现在有多少时间，剩余训练决策由调度器完成；普通选择题理想情况下只需点击一次。

因此本 Skill 不再绑定某个特定的 `question` 工具或具体前端。

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

