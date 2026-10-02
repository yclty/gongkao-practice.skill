import { readFileSync, statSync } from "node:fs";

let cache = null;

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
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
        throw new Error(`Invalid JSONL at line ${index + 1}: ${error instanceof Error ? error.message : String(error)}`);
      }
    });

  cache = { path, mtimeMs: stat.mtimeMs, items };
  return items;
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

  return {
    total: items.length,
    interactive_supported: interactive,
    modules: Object.fromEntries([...modules.entries()].sort((a, b) => b[1] - a[1])),
    subtypes: Object.fromEntries([...subtypes.entries()].sort((a, b) => b[1] - a[1])),
    years: Object.fromEntries([...years.entries()].sort((a, b) => b[0].localeCompare(a[0]))),
  };
}

export function loadQuestionBank(path) {
  if (!path) {
    throw new Error("QUESTION_BANK_PATH is not configured");
  }
  return loadRawBank(path);
}

function matchesCommon(item, query) {
  if (!item.interactive_supported) return false;

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

function targetMatches(item, target) {
  if (target.module && item.module !== target.module) return false;
  if (target.subtype && item.subtype !== target.subtype) return false;
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

function randomTieBreaker() {
  return Math.random() - 0.5;
}

function rankCandidates(items) {
  return [...items].sort((a, b) => {
    const sourceDiff = sourceRank(a) - sourceRank(b);
    if (sourceDiff !== 0) return sourceDiff;

    const yearDiff = recencyRank(b) - recencyRank(a);
    if (yearDiff !== 0) return yearDiff;

    return randomTieBreaker();
  });
}

export function toQuizQuestion(item) {
  const answer = normalizeText(item.correct_answer);
  if (!/^[A-D]$/.test(answer)) {
    throw new Error(`Question ${item.question_id} is not compatible with single-choice UI`);
  }

  return {
    question_id: item.question_id,
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
    target_seconds: Number.isFinite(item.target_seconds) ? item.target_seconds : undefined,
    fastest_method: normalizeText(item.fastest_method) || undefined,
    explanation_short: normalizeText(item.explanation_short) || undefined,
    explanation_full: normalizeText(item.analysis) || undefined,
    provenance: {
      source_provider: item.source_provider || null,
      source_exam: item.source_exam || null,
      year: item.year || null,
      province: item.province || null,
      exam_type: item.exam_type || null,
      source_ref: item.source_ref || null,
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
    const count = Math.max(0, Math.min(20, Number(target.count ?? 0)));
    if (!count) continue;

    const exact = rankCandidates(
      common.filter(
        (item) => !selectedIds.has(item.question_id) && targetMatches(item, target)
      )
    );

    for (const item of exact.slice(0, count)) {
      selected.push(item);
      selectedIds.add(item.question_id);
    }

    const missing = count - Math.min(count, exact.length);
    if (missing > 0 && target.subtype && target.module) {
      const fallback = rankCandidates(
        common.filter(
          (item) =>
            !selectedIds.has(item.question_id) &&
            item.module === target.module
        )
      );
      for (const item of fallback.slice(0, missing)) {
        selected.push(item);
        selectedIds.add(item.question_id);
      }
    }
  }

  const requestedCount = query.count
    ? Math.max(1, Math.min(20, Number(query.count)))
    : targets.reduce((sum, target) => sum + Number(target.count ?? 0), 0);

  if (selected.length < requestedCount) {
    const filler = rankCandidates(
      common.filter((item) => !selectedIds.has(item.question_id))
    );
    for (const item of filler.slice(0, requestedCount - selected.length)) {
      selected.push(item);
      selectedIds.add(item.question_id);
    }
  }

  return selected.slice(0, requestedCount).map(toQuizQuestion);
}
