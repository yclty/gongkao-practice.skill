# v0.6 题库审计：yclty/gongkao

审计对象：`yclty/gongkao` main 分支。

## 结论

该仓库可以直接作为第一版 Question Provider 的上游题库，不需要重新设计数据库或重新抓取一套题。

当前 SaDuck 快照的 `manifest.json` 显示：

- 32 个试卷分组
- 153 套试卷
- 18,025 个题目出现次数
- 6 个一级题型标签

注意：18,025 是导出快照中的题目出现次数，不等同于去重后的唯一题目数。v0.6 导入器会按稳定 question_id 去重，并记录冲突。

## 可复用的数据模型

`gongkao` 已包含：

- `Question`
- `QuestionOption`
- `Material`
- `QuestionTag`
- `Paper`
- `PaperQuestion`
- `PracticeSession`
- `PracticeAnswer`
- `WrongQuestion`

题目字段已经覆盖：

- 题干 HTML / plain text
- 材料
- 选项
- 正确答案
- 解析
- 难度
- 全局正确率
- 来源
- 题型标签
- 试卷年份 / 地区 / examType

## 已有选题逻辑

`foundation-training.ts` 已实现值得复用的基本策略：

1. 未做过的题优先
2. 历史错题其次
3. 已做对题按最久未练优先
4. 尽量避免和上一轮重复

v0.6 不直接复制其用户数据库逻辑，而是在 QuestionProvider 中保留“题库检索”职责，把用户历史、SRS 和 mastery 继续留给 Scheduler / Project。

## 数据来源与 source_type

SaDuck 导入数据来自第三方题库快照。为了避免把“第三方导入”误标成“官方已核验真题”，统一映射：

```text
source_type = platform_import
source_provider = saduck
```

只有经过明确来源核验的数据才能标记：

```text
source_type = official_real
```

AI 生成内容必须标记：

```text
source_type = ai_variant
```

## Canonical Question Schema

QuestionProvider 使用以下最小结构：

```json
{
  "question_id": "saduck_q_19375",
  "question_type": "SINGLE",
  "source_type": "platform_import",
  "source_provider": "saduck",
  "source_exam": "2025年国家公务员录用考试《行测》（行政执法卷）",
  "year": 2025,
  "province": "全国",
  "exam_type": "国考",
  "subject": "行测",
  "module": "政治理论",
  "subtype": "理论政策",
  "difficulty": "UNKNOWN",
  "global_accuracy": 85,
  "stem": "...",
  "material": null,
  "options": [
    {"label": "A", "text": "..."}
  ],
  "correct_answer": "B",
  "analysis": "...",
  "source_ref": "papers/19375.json#1"
}
```

## Correct Answer 映射

SaDuck 原始数据的 `correctAnswer` 往往保存 option value，而不是 A/B/C/D。

例如：

```json
{
  "correctAnswer": "1",
  "options": [
    {"label": "A", "value": "0"},
    {"label": "B", "value": "1"}
  ]
}
```

Canonical schema 必须映射为：

```json
{"correct_answer": "B"}
```

多选答案保存为逗号分隔 label，例如 `A,C,D`。

当前 ChatGPT Quiz Widget v0.6 只自动启动 SINGLE / JUDGE；MULTIPLE 会保留在题库中，但不进入单选 UI，等后续多选组件支持。

## 分层职责

```text
yclty/gongkao raw snapshot / DB
          ↓
import_gongkao_repository.py
          ↓
canonical JSONL
          ↓
QuestionProvider
          ↓
Scheduler targets + excludes
          ↓
start_quiz_from_bank
          ↓
Quiz UI
```

其中：

- QuestionProvider：只负责找“符合条件的题”
- Scheduler：负责决定“为什么现在练这个”
- Project：保存“这个用户之前做得怎么样”
- Quiz UI：负责“怎么答题”

## 不做的事情

v0.6 不把 18k 题直接提交到 `gongkao-practice.skill`。

原因：

- 避免仓库体积快速膨胀
- 避免公共代码与第三方题目版权混在一个发布仓库
- 方便以后替换 / 增加多个题库 Provider
- 线下导出时可以按需要生成和携带题库文件
