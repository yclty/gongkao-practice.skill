import test from "node:test";
import assert from "node:assert/strict";
import { bankStats, questionBankCatalog, selectPaper, selectQuestions, toQuizQuestion } from "../lib/question-provider.js";

const items = [
  {
    question_id: "q1",
    paper_id: "saduck_p_1",
    paper_title: "2025国考测试卷",
    paper_position: 1,
    paper_total: 2,
    question_type: "SINGLE",
    interactive_supported: true,
    source_type: "platform_import",
    source_provider: "saduck",
    source_exam: "2025国考",
    year: 2025,
    province: "全国",
    exam_type: "国考",
    module: "资料分析",
    subtype: "两期比重",
    stem: "q1",
    options: [
      { label: "A", text: "a" },
      { label: "B", text: "b" },
      { label: "C", text: "c" },
      { label: "D", text: "d" },
    ],
    correct_answer: "B",
    analysis: "analysis",
  },
  {
    question_id: "q2",
    paper_id: "saduck_p_1",
    paper_title: "2025国考测试卷",
    paper_position: 2,
    paper_total: 2,
    question_type: "SINGLE",
    interactive_supported: true,
    source_type: "platform_import",
    year: 2024,
    province: "全国",
    exam_type: "国考",
    module: "资料分析",
    subtype: "增长率",
    stem: "q2",
    options: [
      { label: "A", text: "a" },
      { label: "B", text: "b" },
      { label: "C", text: "c" },
      { label: "D", text: "d" },
    ],
    correct_answer: "C",
  },
  {
    question_id: "q3",
    paper_id: "saduck_p_2",
    paper_title: "2025多选测试卷",
    paper_position: 1,
    paper_total: 1,
    question_type: "MULTIPLE",
    interactive_supported: false,
    source_type: "platform_import",
    year: 2025,
    module: "资料分析",
    subtype: "增长率",
    stem: "q3",
    options: [],
    correct_answer: "A,C",
  },
];

test("bankStats counts only metadata and interactive inventory", () => {
  const stats = bankStats(items);
  assert.equal(stats.total, 3);
  assert.equal(stats.interactive_supported, 2);
  assert.equal(stats.modules["资料分析"], 3);
  assert.equal(stats.papers, 2);
  assert.equal(stats.complete_interactive_papers, 1);
});

test("selectQuestions prefers exact subtype and excludes requested ids", () => {
  const result = selectQuestions(items, {
    count: 1,
    targets: [{ module: "资料分析", subtype: "两期比重", count: 1 }],
  });
  assert.equal(result.length, 1);
  assert.equal(result[0].question_id, "q1");

  const excluded = selectQuestions(items, {
    count: 1,
    targets: [{ module: "资料分析", subtype: "两期比重", count: 1 }],
    exclude_question_ids: ["q1"],
  });
  assert.equal(excluded[0].question_id, "q2");
});

test("toQuizQuestion preserves provenance but only supports one label answer", () => {
  const q = toQuizQuestion(items[0]);
  assert.equal(q.correct_answer, "B");
  assert.equal(q.provenance.source_provider, "saduck");
  assert.throws(() => toQuizQuestion(items[2]));
});


test("questionBankCatalog exposes paper inventory", () => {
  const catalog = questionBankCatalog(items);
  assert.equal(catalog.papers.length, 2);
  assert.equal(catalog.papers[0].paper_id, "saduck_p_1");
  assert.equal(catalog.papers[0].complete_interactive, true);
});

test("selectPaper chooses a complete interactive paper", () => {
  const selected = selectPaper(items, { exam_type: "国考", require_complete: true });
  assert.equal(selected.paper.paper_id, "saduck_p_1");
  assert.equal(selected.questions.length, 2);
  assert.equal(selected.questions[0].provenance.paper_position, 1);
});

test("module aliases can match canonical bank module names", () => {
  const aliasItems = items.map((item) =>
    item.question_id === "q1" ? { ...item, module: "言语理解与表达" } : item
  );
  const result = selectQuestions(aliasItems, {
    count: 1,
    targets: [{ module: "言语", count: 1 }],
  });
  assert.equal(result[0].question_id, "q1");
});
