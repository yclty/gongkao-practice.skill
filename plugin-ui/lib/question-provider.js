import { readFileSync, statSync } from "node:fs";
import { createHash } from "node:crypto";

let cache = null;

const MODULE_ALIASES = {
  言语: ["言语理解与表达", "言语理解"],
  判断: ["判断推理"],
  数量: ["数量关系"],
  资料: ["资料分析"],
  常识: ["常识判断"],
  政治: ["政治理论"],
  公基: ["公共基础知识"],
  职测: ["职业能力倾向测验"],
};

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizedCandidates(value) {
  const text = normalizeText(value);
  if (!text) return [];
  const aliases = Object.entries(MODULE_ALIASES).find(([key, values]) => key === text || values.includes(text));
  return aliases ? [aliases[0], ...aliases[1]] : [text];
}

function semanticEqual(value, target) {
  if (!target) return true;
  const left = normalizeText(value);
  if (!left) return false;
  const targets = normalizedCandidates(target);
  return targets.some((candidate) => left === candidate);
}

function loadRawBank(path) {
  const stat = statSync(path);
  if (cache && cache.path === path && cache.mtimeMs === stat.mtimeMs) {
    return cache.items;
  }

  const items = readFileSync(path, "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line, index) => {
      try {
        return JSON.parse(line);
      } catch (error) {
        throw new Error(
          `Invalid JSONL at line ${index + 1}: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    });

  cache = { path, mtimeMs: stat.mtimeMs, items };
  return items;
}

function paperGroups(items) {
  const groups = new Map();
  for (const item of items) {
    const memberships = item.paper_memberships ?? (item.paper_id ? [{ paper_id: item.paper_id }] : []);
    for (const membership of memberships) {
      const paperId = membership.paper_id;
      if (!paperId) continue;
      if (!groups.has(paperId)) groups.set(paperId, []);
      groups.get(paperId).push({ ...item, ...membership });
    }
  }
  return groups;
}

function completePaper(questions) {
  const total = Number(questions[0]?.paper_total);
  if (!Number.isInteger(total) || total < 1 || questions.length !== total) return false;
  const positions = new Set(questions.map((q) => Number(q.paper_position)));
  return positions.size === total && new Set(questions.map((q)=>q.question_id)).size===total && questions.every((q) => q.paper_total === total && q.paper_total_verified!==false && q.interactive_supported)
    && [...positions].every((position) => Number.isInteger(position) && position >= 1 && position <= total);
}

export function bankStats(items) {
  const modules = new Map();
  const subtypes = new Map();
  const years = new Map();
  let interactive = 0;

  for (const item of items) {
    if (item.interactive_supported) interactive += 1;
    const module = item.module || "UNKNOWN";
    const subtype = item.subtype || "UNKNOWN";
    modules.set(module, (modules.get(module) ?? 0) + 1);
    subtypes.set(subtype, (subtypes.get(subtype) ?? 0) + 1);
    if (item.year) years.set(String(item.year), (years.get(String(item.year)) ?? 0) + 1);
  }

  const groups = paperGroups(items);
  let completeInteractivePapers = 0;
  for (const questions of groups.values()) {
    if (completePaper(questions)) {
      completeInteractivePapers += 1;
    }
  }

  return {
    total: items.length,
    interactive_supported: interactive,
    papers: groups.size,
    complete_interactive_papers: completeInteractivePapers,
    modules: Object.fromEntries([...modules.entries()].sort((a, b) => b[1] - a[1])),
    subtypes: Object.fromEntries([...subtypes.entries()].sort((a, b) => b[1] - a[1])),
    years: Object.fromEntries([...years.entries()].sort((a, b) => b[0].localeCompare(a[0]))),
  };
}

export function questionBankCatalog(items, options = {}) {
  const limit = Math.max(1, Math.min(200, Number(options.limit ?? 50)));
  const stats = bankStats(items);

  const papers = [];
  for (const [paperId, questions] of paperGroups(items).entries()) {
    const sorted = [...questions].sort(
      (a, b) => Number(a.paper_position ?? 0) - Number(b.paper_position ?? 0)
    );
    const first = sorted[0] ?? {};
    const interactiveCount = sorted.filter((item) => item.interactive_supported).length;
    papers.push({
      paper_id: paperId,
      title: first.paper_title || first.source_exam || paperId,
      year: first.year ?? null,
      province: first.province ?? null,
      exam_type: first.exam_type ?? null,
      total_questions: first.paper_total ?? sorted.length,
      interactive_questions: interactiveCount,
      complete_interactive: completePaper(sorted),
    });
  }

  papers.sort((a, b) => {
    const yearDiff = Number(b.year ?? 0) - Number(a.year ?? 0);
    if (yearDiff !== 0) return yearDiff;
    return b.interactive_questions - a.interactive_questions;
  });

  return {
    stats,
    subtype_inventory: [...items.reduce((map,item)=>{
      if(item.interactive_supported && item.module && item.subtype) { const key=`${item.module}::${item.subtype}`;const entry=map.get(key)??{module:item.module,subtype:item.subtype,count:0};entry.count++;map.set(key,entry); }
      return map;
    },new Map()).values()],
    modules: Object.entries(stats.modules)
      .map(([module, count]) => ({ module, count }))
      .slice(0, limit),
    subtypes: Object.entries(stats.subtypes)
      .map(([subtype, count]) => ({ subtype, count }))
      .slice(0, limit),
    papers: papers.slice(0, limit),
  };
}

export function loadQuestionBank(path) {
  if (!path) {
    throw new Error("QUESTION_BANK_PATH is not configured");
  }
  return loadRawBank(path);
}

function matchesMetadata(item, query) {
  const sourceTypes = query.source_types?.length
    ? new Set(query.source_types)
    : new Set(["official_real", "platform_import", "practice"]);
  if (!sourceTypes.has(item.source_type)) return false;

  if (query.exam_type && item.exam_type !== query.exam_type) return false;
  if (query.province && item.province !== query.province) return false;
  if (query.year_min && (!item.year || item.year < query.year_min)) return false;
  if (query.year_max && (!item.year || item.year > query.year_max)) return false;

  return true;
}

function matchesCommon(item, query) {
  if (!item.interactive_supported) return false;
  return matchesMetadata(item, query);
}

function targetMatches(item, target) {
  if (target.module && !semanticEqual(item.module, target.module)) return false;
  if (target.subtype && !semanticEqual(item.subtype, target.subtype)) return false;
  return true;
}

function sourceRank(item) {
  switch (item.source_type) {
    case "official_real":
      return 0;
    case "platform_import":
      return 1;
    case "practice":
      return 2;
    case "ai_variant":
      return 3;
    default:
      return 9;
  }
}

function recencyRank(item) {
  return Number(item.year || 0);
}

function rankCandidates(items, query = {}) {
  return items
    .map((item) => ({ item, random: Math.random() }))
    .sort((a, b) => {
      const left=query.practice_history?.[a.item.question_id],right=query.practice_history?.[b.item.question_id];
      const unseen=Number(Boolean(left?.seen))-Number(Boolean(right?.seen));if(unseen)return unseen;
      const wrong=Number(Boolean(right?.wrong))-Number(Boolean(left?.wrong));if(wrong)return wrong;
      const last=String(left?.last??"").localeCompare(String(right?.last??""));if(last)return last;
      const sourceDiff = sourceRank(a.item) - sourceRank(b.item);
      if (sourceDiff !== 0) return sourceDiff;

      const yearDiff = recencyRank(b.item) - recencyRank(a.item);
      if (yearDiff !== 0) return yearDiff;

      return a.random - b.random;
    })
    .map(({ item }) => item);
}

export function toQuizQuestion(item) {
  const answer = normalizeText(item.correct_answer);
  const labels = new Set((item.options ?? []).map((option) => option.label));
  const pattern = item.question_type === "MULTIPLE" ? /^[A-F](,[A-F])*$/ : /^[A-F]$/;
  if (!normalizeText(item.question_id) || !pattern.test(answer) || answer.split(",").some((label) => !labels.has(label)) || labels.size!==(item.options??[]).length || [...labels].some((label)=>! /^[A-F]$/.test(label)) || !(item.stem ?? "").trim() || (item.options ?? []).length < 2 || item.options.some((option) => !option.text?.trim())) {
    throw Object.assign(new Error(`题目 ${item.question_id??"未编号"} 的题干、选项或答案不完整`),{code:"INVALID_INPUT"});
  }

  return {
    question_id: item.question_id,
    question_version: createHash("sha256").update(JSON.stringify([item.stem,item.material,item.options,item.correct_answer])).digest("hex"),
    bank_version: item.bank_version ?? "custom",
    question_type: item.question_type ?? "SINGLE",
    module: item.module || "综合",
    subtype: item.subtype || undefined,
    source_type: item.source_type || "practice",
    stem: normalizeText(item.stem),
    material: normalizeText(item.material) || undefined,
    options: Array.isArray(item.options)
      ? item.options.map((option) => ({
          label: String(option.label || "").toUpperCase(),
          text: normalizeText(option.text),
        }))
      : [],
    correct_answer: answer,
    target_seconds: Number.isFinite(item.target_seconds)
      ? item.target_seconds
      : undefined,
    fastest_method: normalizeText(item.fastest_method) || undefined,
    explanation_short: normalizeText(item.explanation_short) || undefined,
    explanation_full: normalizeText(item.explanation_full ?? item.analysis) || undefined,
    provenance: {
      source_provider: item.source_provider || null,
      source_exam: item.source_exam || null,
      year: item.year || null,
      province: item.province || null,
      exam_type: item.exam_type || null,
      source_ref: item.source_ref || null,
      paper_id: item.paper_id || null,
      paper_title: item.paper_title || null,
      paper_position: item.paper_position ?? null,
      paper_total: item.paper_total ?? null,
    },
  };
}

export function selectQuestions(items, query = {}) {
  const excludeIds = new Set(query.exclude_question_ids ?? []);
  const common = items.filter(
    (item) => !excludeIds.has(item.question_id) && matchesCommon(item, query)
  );

  const selected = [];
  const selectedIds = new Set();

  const targets = query.targets?.length
    ? query.targets
    : [{ count: query.count ?? 5 }];

  for (const target of targets) {
    const count = Math.max(0, Math.min(50, Number(target.count ?? 0)));
    if (!count) continue;

    const exact = rankCandidates(
      common.filter(
        (item) =>
          !selectedIds.has(item.question_id) && targetMatches(item, target)
      ), query
    );

    for (const item of exact.slice(0, count)) {
      selected.push(item);
      selectedIds.add(item.question_id);
    }

    const missing = count - Math.min(count, exact.length);
    if (query.allow_relaxation === true && missing > 0 && target.subtype && target.module) {
      const fallback = rankCandidates(
        common.filter(
          (item) =>
            !selectedIds.has(item.question_id) &&
            semanticEqual(item.module, target.module)
        ), query
      );
      for (const item of fallback.slice(0, missing)) {
        selected.push(item);
        selectedIds.add(item.question_id);
      }
    }
  }

  const requestedCount = query.count
    ? Math.max(1, Math.min(50, Number(query.count)))
    : targets.reduce((sum, target) => sum + Number(target.count ?? 0), 0);

  if (query.allow_relaxation === true && selected.length < requestedCount) {
    const filler = rankCandidates(
      common.filter((item) => !selectedIds.has(item.question_id)), query
    );
    for (const item of filler.slice(0, requestedCount - selected.length)) {
      selected.push(item);
      selectedIds.add(item.question_id);
    }
  }

  return selected.slice(0, requestedCount).map(toQuizQuestion);
}

export function selectPaper(items, query = {}) {
  const requireComplete = query.require_complete !== false;
  const requestedPaperId = query.paper_id ?? null;
  const groups = [];

  for (const [paperId, questions] of paperGroups(items).entries()) {
    if (requestedPaperId && paperId !== requestedPaperId) continue;

    const metadataMatched = questions.filter((item) => matchesMetadata(item, query));
    if (!metadataMatched.length) continue;

    const interactive = metadataMatched.filter((item) => item.interactive_supported);
    const complete = completePaper(questions) && metadataMatched.length === questions.length;

    if (requireComplete && !complete) continue;
    if (!interactive.length) continue;

    const first = metadataMatched[0] ?? {};
    groups.push({
      paper: {
        paper_id: paperId,
        title: first.paper_title || first.source_exam || paperId,
        year: first.year ?? null,
        province: first.province ?? null,
        exam_type: first.exam_type ?? null,
        total_questions: first.paper_total ?? metadataMatched.length,
        interactive_questions: interactive.length,
        complete_interactive: complete,
      },
      items: interactive.sort(
        (a, b) => Number(a.paper_position ?? 0) - Number(b.paper_position ?? 0)
      ),
    });
  }

  groups.sort((a, b) => {
    const yearDiff = Number(b.paper.year ?? 0) - Number(a.paper.year ?? 0);
    if (yearDiff !== 0) return yearDiff;
    return b.paper.interactive_questions - a.paper.interactive_questions;
  });

  const selected = groups[0];
  if (!selected) return null;

  return {
    paper: selected.paper,
    questions: selected.items.map(toQuizQuestion),
  };
}
