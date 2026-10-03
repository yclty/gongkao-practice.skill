#!/usr/bin/env python3
"""Convert yclty/gongkao SaDuck snapshot into the canonical QuestionProvider JSONL."""

from __future__ import annotations

import argparse
import html
import json
import re
import hashlib
import gzip
import zlib
import subprocess
import shutil
from html.parser import HTMLParser
from concurrent.futures import ThreadPoolExecutor, as_completed
from urllib.request import Request, urlopen
from collections import Counter
from pathlib import Path
from typing import Any

PROVINCES = [
    "北京", "天津", "上海", "重庆", "河北", "山西", "辽宁", "吉林", "黑龙江",
    "江苏", "浙江", "安徽", "福建", "江西", "山东", "河南", "湖北", "湖南",
    "广东", "海南", "四川", "贵州", "云南", "陕西", "甘肃", "青海", "台湾",
    "内蒙古", "广西", "西藏", "宁夏", "新疆", "香港", "澳门",
]


ASSETS: dict[str, str] = {}


class ContentParser(HTMLParser):
    """Preserve readable tables and images without accepting executable HTML."""
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.parts: list[str] = []
        self.hidden = 0

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag in {"script", "style"}:
            self.hidden += 1
        if self.hidden:
            return
        if tag == "img":
            source = dict(attrs).get("src") or ""
            if source.startswith("//"):
                source = "https:" + source
            if source.startswith("https://"):
                asset_id = hashlib.sha256(source.encode()).hexdigest()
                ASSETS[asset_id] = source
                self.parts.append(f"\n![题图](/bank-assets/{asset_id})\n")
            else:
                self.parts.append("[缺失图片]")
        elif tag in {"br", "p", "div", "tr"}:
            self.parts.append("\n")
        elif tag in {"td", "th"}:
            self.parts.append(" | ")

    def handle_endtag(self, tag: str) -> None:
        if tag in {"script", "style"}:
            self.hidden = max(0, self.hidden - 1)
        elif not self.hidden and tag in {"p", "div", "tr"}:
            self.parts.append("\n")

    def handle_data(self, data: str) -> None:
        if not self.hidden:
            self.parts.append(data)


def strip_html(value: str | None) -> str | None:
    if not value:
        return None
    parser = ContentParser()
    parser.feed(str(value))
    return re.sub(r"\n{3,}", "\n\n", "".join(parser.parts)).strip() or None


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
    question_type = map_type(question.get("type"))
    answer = map_answer(question.get("correctAnswer"), question.get("options") or [])
    material = strip_html(question.get("materialHtml"))
    fingerprint = json.dumps([stem, material, question_type, options, answer], ensure_ascii=False, sort_keys=True)
    question_id = stable_question_id(question.get("id"), paper.get("sid"), position, seen, fingerprint)
    declared_total = max((section["enum"] for section in sections), default=0)

    return {
        "question_id": question_id,
        "paper_id": f"saduck_p_{paper.get('sid')}",
        "paper_title": str(paper.get("source") or source_exam).strip(),
        "paper_position": position,
        "paper_total": declared_total or len(paper.get("questions") or []),
        "paper_total_verified": bool(declared_total),
        "question_type": question_type,
        "interactive_supported": bool(stem) and len(options) >= 2 and all(option["text"] for option in options) and bool(answer) and all(label in {option["label"] for option in options} for label in answer.split(",")),
        "source_type": "platform_import",
        "source_provider": "saduck",
        "source_exam": source_exam,
        "year": parse_year(source_exam),
        "province": parse_province(source_exam),
        "exam_type": parse_exam_type(source_exam),
        "subject": parse_subject(source_exam),
        "module": {"言语理解": "言语理解与表达"}.get(module_for_position(sections, position), module_for_position(sections, position)),
        "subtype": str(question.get("tag") or "").strip() or None,
        "difficulty": difficulty_from_accuracy(question.get("globalAccuracy")),
        "global_accuracy": question.get("globalAccuracy"),
        "stem": stem,
        "material": material,
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
    parser.add_argument("--download-assets", action="store_true", help="Download required image resources for offline use")
    parser.add_argument("--asset-dir", help="Offline image directory (default: alongside JSONL/assets)")
    parser.add_argument("--node", help="Node runtime used to decode Brotli CDN image responses")
    parser.add_argument("--source-commit", default="71e9dd7e7bd2689014c7a8af18fdb62556a860c3", help="Exact source snapshot commit")
    args = parser.parse_args()

    source = Path(args.source).resolve()
    papers_dir = source / "papers"
    if not papers_dir.is_dir():
        raise SystemExit(f"Missing papers directory: {papers_dir}")

    output = Path(args.output).resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    meta_path = Path(args.meta).resolve() if args.meta else output.with_suffix(".meta.json")

    seen: dict[str, str] = {}
    records: dict[str, dict[str, Any]] = {}
    counts = Counter()
    conflicts = 0
    errors: list[dict[str, Any]] = []

    for paper_path in sorted(papers_dir.glob("*.json")):
            try:
                paper = json.loads(paper_path.read_text(encoding="utf-8"))
            except Exception as exc:  # noqa: BLE001
                errors.append({"file": paper_path.name, "error": str(exc)})
                continue

            if not isinstance(paper, dict) or not isinstance(paper.get("questions"), list):
                counts["index_files_skipped"] += 1
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

                membership = {key: item[key] for key in ("paper_id", "paper_title", "paper_position", "paper_total", "paper_total_verified", "source_exam", "year", "province", "exam_type")}
                item["asset_ids"] = sorted(set(re.findall(r"/bank-assets/([a-f0-9]{64})", json.dumps(item, ensure_ascii=False))))
                if item["question_id"] in records:
                    counts["duplicate_occurrence"] += 1
                    records[item["question_id"]]["paper_memberships"].append(membership)
                    continue
                if "_" + str(paper.get("sid")) + "_" + str(position) in item["question_id"]:
                    conflicts += 1

                item["paper_memberships"] = [membership]
                records[item["question_id"]] = item
                counts["questions"] += 1
                counts[f"type:{item['question_type']}"] += 1
                counts[f"source_type:{item['source_type']}"] += 1
                counts[f"module:{item['module'] or 'UNKNOWN'}"] += 1
    asset_dir = Path(args.asset_dir).resolve() if args.asset_dir else output.parent / "assets"
    asset_dir.mkdir(parents=True, exist_ok=True)

    def valid_image(data: bytes) -> bool:
        return data.startswith(b"\x89PNG\r\n\x1a\n") or data.startswith(b"\xff\xd8\xff") or data.startswith((b"GIF87a", b"GIF89a")) or (data.startswith(b"RIFF") and data[8:12] == b"WEBP")

    def fetch_asset(entry: tuple[str, str]) -> tuple[str, bool]:
        asset_id, url = entry
        path = asset_dir / asset_id
        if path.exists() and valid_image(path.read_bytes()):
            return asset_id, True
        if not args.download_assets:
            return asset_id, False
        try:
            with urlopen(Request(url, headers={"User-Agent": "GongkaoCoach/1.0 offline-bank-builder", "Accept-Encoding": "identity"}), timeout=15) as response:
                data = response.read(8 * 1024 * 1024 + 1)
                encoding = response.headers.get("Content-Encoding", "").lower()
            if encoding == "gzip":
                data = gzip.decompress(data)
            elif encoding == "deflate":
                data = zlib.decompress(data)
            elif encoding == "br":
                node = args.node or shutil.which("node")
                if not node:
                    return asset_id, False
                decoder = "const z=require('node:zlib');const b=[];process.stdin.on('data',c=>b.push(c)).on('end',()=>process.stdout.write(z.brotliDecompressSync(Buffer.concat(b),{maxOutputLength:8388608})));"
                data = subprocess.run([node, "-e", decoder], input=data, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, check=True, timeout=15).stdout
            if len(data) > 8 * 1024 * 1024 or not valid_image(data):
                return asset_id, False
            path.write_bytes(data)
            return asset_id, True
        except Exception:
            return asset_id, False

    available: set[str] = set()
    with ThreadPoolExecutor(max_workers=12) as pool:
        futures = [pool.submit(fetch_asset, entry) for entry in ASSETS.items()]
        for index, future in enumerate(as_completed(futures), start=1):
            asset_id, ok = future.result()
            if ok:
                available.add(asset_id)
            if index % 200 == 0:
                print(f"assets {index}/{len(futures)} ready={len(available)}", flush=True)
    for item in records.values():
        item["missing_assets"] = [asset_id for asset_id in item["asset_ids"] if asset_id not in available]
        if item["missing_assets"] or "[缺失图片]" in json.dumps(item, ensure_ascii=False):
            item["interactive_supported"] = False
        if item["interactive_supported"]:
            counts["interactive_supported"] += 1
        item["bank_version"] = f"saduck-{args.source_commit[:7]}-local-v1"
    temporary = output.with_suffix(".tmp")
    with temporary.open("w", encoding="utf-8") as target:
        for item in records.values():
            target.write(json.dumps(item, ensure_ascii=False, separators=(",", ":")) + "\n")
    temporary.replace(output)

    manifest_path = source / "manifest.json"
    source_manifest = None
    if manifest_path.exists():
        source_manifest = json.loads(manifest_path.read_text(encoding="utf-8"))

    metadata = {
        "schema_version": "1.0",
        "source_repository": "https://github.com/yclty/gongkao",
        "source_commit": args.source_commit,
        "offline_assets": len(available),
        "missing_assets": len(ASSETS) - len(available),
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
