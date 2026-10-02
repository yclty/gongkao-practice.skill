#!/usr/bin/env python3
"""Convert yclty/gongkao SaDuck snapshot into the canonical QuestionProvider JSONL."""

from __future__ import annotations

import argparse
import html
import json
import re
from collections import Counter
from pathlib import Path
from typing import Any

PROVINCES = [
    "北京", "天津", "上海", "重庆", "河北", "山西", "辽宁", "吉林", "黑龙江",
    "江苏", "浙江", "安徽", "福建", "江西", "山东", "河南", "湖北", "湖南",
    "广东", "海南", "四川", "贵州", "云南", "陕西", "甘肃", "青海", "台湾",
    "内蒙古", "广西", "西藏", "宁夏", "新疆", "香港", "澳门",
]


def strip_html(value: str | None) -> str | None:
    if not value:
        return None
    value = re.sub(r"<br\s*/?>", "\n", value, flags=re.I)
    value = re.sub(r"<[^>]+>", "", value)
    value = html.unescape(value)
    value = re.sub(r"\n{3,}", "\n\n", value)
    return value.strip() or None


def parse_year(text: str) -> int | None:
    match = re.search(r"(20\d{2})年?", text)
    return int(match.group(1)) if match else None


def parse_province(text: str) -> str | None:
    if "国家公务员" in text or "国考" in text:
        return "全国"
    for province in PROVINCES:
        if province in text:
            return province
    return None


def parse_exam_type(text: str) -> str | None:
    if "国家公务员" in text or "国考" in text:
        return "国考"
    if "公务员" in text or "省考" in text:
        return "省考"
    if "事业单位" in text or "事业编" in text:
        return "事业单位"
    return None


def parse_subject(text: str) -> str | None:
    if "行测" in text or "行政职业能力" in text:
        return "行测"
    if "职测" in text or "职业能力倾向" in text:
        return "职测"
    if "公基" in text or "公共基础" in text:
        return "公基"
    return None


def parse_sections(model: Any) -> list[dict[str, Any]]:
    if not model:
        return []
    if isinstance(model, str):
        try:
            model = json.loads(model)
        except json.JSONDecodeError:
            return []
    if not isinstance(model, list):
        return []
    result = []
    for item in model:
        if not isinstance(item, dict):
            continue
        try:
            result.append({
                "name": str(item.get("name") or "").strip(),
                "snum": int(item.get("snum")),
                "enum": int(item.get("enum")),
            })
        except (TypeError, ValueError):
            continue
    return result


def module_for_position(sections: list[dict[str, Any]], position: int) -> str | None:
    for section in sections:
        if section["snum"] <= position <= section["enum"]:
            return section["name"] or None
    return None


def map_type(raw: str | None) -> str:
    raw = (raw or "single").lower()
    if raw == "multiple":
        return "MULTIPLE"
    if raw == "judge":
        return "JUDGE"
    return "SINGLE"


def map_answer(raw_answer: Any, options: list[dict[str, Any]]) -> str:
    if raw_answer is None:
        return ""
    parts = [part.strip() for part in str(raw_answer).split(",") if part.strip()]
    value_to_label = {
        str(option.get("value", "")).strip(): str(option.get("label", "")).strip().upper()
        for option in options
        if str(option.get("label", "")).strip()
    }
    labels = {str(option.get("label", "")).strip().upper() for option in options}
    mapped = []
    for part in parts:
        upper = part.upper()
        label = value_to_label.get(part)
        if label:
            mapped.append(label)
        elif upper in labels:
            mapped.append(upper)
        else:
            raise ValueError(f"Cannot map answer {part!r} to an option label")
    return ",".join(sorted(dict.fromkeys(mapped)))


def difficulty_from_accuracy(value: Any) -> str:
    try:
        accuracy = float(value)
    except (TypeError, ValueError):
        return "UNKNOWN"
    if accuracy >= 75:
        return "EASY"
    if accuracy >= 45:
        return "MEDIUM"
    return "HARD"


def stable_question_id(raw_id: Any, paper_sid: Any, position: int, seen: dict[str, str], stem: str) -> str:
    base = f"saduck_q_{str(raw_id).strip()}"
    fingerprint = stem.strip()
    if base not in seen:
        seen[base] = fingerprint
        return base
    if seen[base] == fingerprint:
        return base
    return f"{base}_{paper_sid}_{position}"


def convert_question(
    paper: dict[str, Any],
    question: dict[str, Any],
    position: int,
    sections: list[dict[str, Any]],
    seen: dict[str, str],
) -> dict[str, Any]:
    source_exam = str(question.get("source") or paper.get("source") or f"SaDuck 试卷 {paper.get('sid')}").strip()
    options = [
        {
            "label": str(option.get("label") or "").strip().upper(),
            "text": strip_html(str(option.get("text") or "")) or "",
        }
        for option in (question.get("options") or [])
        if isinstance(option, dict) and str(option.get("label") or "").strip()
    ]
    stem = strip_html(question.get("titleHtml")) or ""
    question_id = stable_question_id(question.get("id"), paper.get("sid"), position, seen, stem)
    question_type = map_type(question.get("type"))
    answer = map_answer(question.get("correctAnswer"), question.get("options") or [])

    return {
        "question_id": question_id,
        "question_type": question_type,
        "interactive_supported": question_type in {"SINGLE", "JUDGE"} and "," not in answer,
        "source_type": "platform_import",
        "source_provider": "saduck",
        "source_exam": source_exam,
        "year": parse_year(source_exam),
        "province": parse_province(source_exam),
        "exam_type": parse_exam_type(source_exam),
        "subject": parse_subject(source_exam),
        "module": module_for_position(sections, position),
        "subtype": str(question.get("tag") or "").strip() or None,
        "difficulty": difficulty_from_accuracy(question.get("globalAccuracy")),
        "global_accuracy": question.get("globalAccuracy"),
        "stem": stem,
        "material": strip_html(question.get("materialHtml")),
        "options": options,
        "correct_answer": answer,
        "analysis": strip_html(question.get("analysisHtml")),
        "source_ref": f"papers/{paper.get('sid')}.json#{position}",
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--source",
        required=True,
        help="Path to gongkao/tools/saduck-scraper/saduck-tiku-json",
    )
    parser.add_argument("--output", required=True, help="Canonical JSONL output")
    parser.add_argument("--meta", help="Optional metadata JSON output")
    args = parser.parse_args()

    source = Path(args.source).resolve()
    papers_dir = source / "papers"
    if not papers_dir.is_dir():
        raise SystemExit(f"Missing papers directory: {papers_dir}")

    output = Path(args.output).resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    meta_path = Path(args.meta).resolve() if args.meta else output.with_suffix(".meta.json")

    seen: dict[str, str] = {}
    written_ids: set[str] = set()
    counts = Counter()
    conflicts = 0
    errors: list[dict[str, Any]] = []

    with output.open("w", encoding="utf-8") as target:
        for paper_path in sorted(papers_dir.glob("*.json")):
            try:
                paper = json.loads(paper_path.read_text(encoding="utf-8"))
            except Exception as exc:  # noqa: BLE001
                errors.append({"file": paper_path.name, "error": str(exc)})
                continue

            sections = parse_sections(paper.get("model"))
            for position, question in enumerate(paper.get("questions") or [], start=1):
                if not isinstance(question, dict):
                    continue
                try:
                    item = convert_question(paper, question, position, sections, seen)
                except Exception as exc:  # noqa: BLE001
                    errors.append({"file": paper_path.name, "position": position, "error": str(exc)})
                    continue

                if item["question_id"] in written_ids:
                    counts["duplicate_occurrence"] += 1
                    continue
                if "_" + str(paper.get("sid")) + "_" + str(position) in item["question_id"]:
                    conflicts += 1

                written_ids.add(item["question_id"])
                target.write(json.dumps(item, ensure_ascii=False, separators=(",", ":")) + "\n")
                counts["questions"] += 1
                counts[f"type:{item['question_type']}"] += 1
                counts[f"source_type:{item['source_type']}"] += 1
                counts[f"module:{item['module'] or 'UNKNOWN'}"] += 1
                if item["interactive_supported"]:
                    counts["interactive_supported"] += 1

    manifest_path = source / "manifest.json"
    source_manifest = None
    if manifest_path.exists():
        source_manifest = json.loads(manifest_path.read_text(encoding="utf-8"))

    metadata = {
        "schema_version": "0.6",
        "source": str(source),
        "source_manifest": source_manifest,
        "canonical_unique_questions": counts["questions"],
        "interactive_supported": counts["interactive_supported"],
        "duplicate_occurrences_skipped": counts["duplicate_occurrence"],
        "id_conflicts_resolved": conflicts,
        "counts": dict(sorted(counts.items())),
        "errors": errors[:200],
        "error_count": len(errors),
    }
    meta_path.write_text(json.dumps(metadata, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(metadata, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
