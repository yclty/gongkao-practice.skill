"""Import the public 2024 A/C recall papers, retaining source and answer provenance.

Input snapshots and transcribed answer keys live in data/sydw-20240330.
No guessed answers, generated explanations, learner data, or network calls here.
"""
from pathlib import Path
import argparse
import hashlib
import json
import re
import shutil
from collections import Counter
from import_gongkao_repository import strip_html

ROOT = Path(__file__).resolve().parents[1]
VERSION = "saduck-71e9dd7-sydw-20261003-v3"
SOURCE_IDS = {"A": "246717", "C": "246719"}
Q_START = re.compile(r"^(\d{1,3})、", re.M)
OPTION = re.compile(r"^([A-D])[.．、]", re.M)
BOUNDARY = re.compile(r"^(?:【材料】|[一二三四五六七八九十]+、[^\n]+)", re.M)
# These combined diagrams were inspected: their original images contain A-D.
DIAGRAM_OPTIONS = {"A": {53, 54, 55}, "C": {62, 63, 64, 65}}

def article(path):
    html = path.read_text(encoding="utf-8")
    match = re.search(r'<div class="article-bd"[^>]*>(.*?)(?:<div class="home_paging|<!--附件下载|<div class="att)', html, re.S)
    if not match:
        raise ValueError(f"Article missing: {path}")
    return (strip_html(match.group(1)) or "").split("注：试题来源于考生回忆及网络", 1)[0].strip()

def module_subtype(category, pos):
    if pos <= 20: return "常识判断", "UNKNOWN", "常识判断"
    if pos <= 45:
        subtype = "逻辑填空" if pos <= 35 else "语句排序" if pos >= 44 and category == "A" or pos == 45 else "片段阅读"
        return "言语理解与表达", subtype, "言语理解与表达"
    if category == "A":
        if pos <= 50: return "数量关系", "UNKNOWN", "数量关系"
        if pos <= 80:
            subtype = "图形推理" if pos <= 55 else "定义判断" if pos <= 60 else "类比推理" if pos <= 70 else "逻辑判断"
            return "判断推理", subtype, "判断推理"
        return "资料分析", "UNKNOWN", "资料分析"
    if pos <= 50: return "数量关系", "UNKNOWN", "数量分析"
    if pos <= 60: return "资料分析", "UNKNOWN", "数量分析"
    if pos <= 90:
        subtype = "图形推理" if pos <= 65 else "定义判断" if pos <= 70 else "类比推理" if pos <= 80 else "逻辑判断"
        return "判断推理", subtype, "判断推理"
    return "综合分析", "策略制定" if pos <= 95 else "实验设计", "综合分析"

def import_paper(source_dir, category, answers):
    rows, material = [], ""
    title = f"2024年3月30日全国事业单位联考《职业能力倾向测验（{category}类）》回忆版"
    paper_id = f"sydw_20240330_zc_{category}"
    chunks, offsets = [], []
    offset = 0
    for page in range(1, 11):
        part = article(source_dir / f"2024-{category}-{page}.html") + "\n\n"
        offsets.append((offset, page))
        chunks.append(part)
        offset += len(part)
    text = "".join(chunks)
    starts = list(Q_START.finditer(text))
    cursor = 0
    for i, start in enumerate(starts):
        page = max(page for offset, page in offsets if offset <= start.start())
        prefix = text[cursor:start.start()].strip()
        if "【材料】" in prefix:
            material = prefix.split("【材料】", 1)[1].strip()
        elif BOUNDARY.search(prefix):
            material = ""
        end = starts[i+1].start() if i+1 < len(starts) else len(text)
        chunk = text[start.end():end].strip()
        boundary = BOUNDARY.search(chunk)
        if boundary:
            end = start.end() + boundary.start()
            chunk = chunk[:boundary.start()].strip()
        pos = int(start.group(1))
        options = list(OPTION.finditer(chunk))
        notes = []
        if options:
            stem = chunk[:options[0].start()].strip()
            opts = [{"label": m.group(1), "text": chunk[m.end():options[j+1].start() if j+1 < len(options) else len(chunk)].strip()} for j,m in enumerate(options)]
        else:
            if pos not in DIAGRAM_OPTIONS[category] or "/bank-assets/" not in chunk:
                raise ValueError(f"Unverified option layout: {category}/{pos}")
            stem = chunk
            opts = [{"label": label, "text": f"题图中标注的 {label} 项"} for label in "ABCD"]
            notes.append("选项图与题干图合并；A-D选择项引用原图标记，未改画图形。")
        if [x["label"] for x in opts] != list("ABCD") or any(not x["text"] for x in opts):
            raise ValueError(f"Invalid options: {category}/{pos}")
        module, subtype, section = module_subtype(category, pos)
        row = dict(question_id=f"sydw_20240330_{category}_{pos:03}",paper_id=paper_id,
            paper_title=title,paper_position=pos,paper_total=100,paper_total_verified=True,
            question_type="SINGLE",interactive_supported=True,source_type="platform_import",
            source_provider="gwysydw（金标尺题库公开页）",source_exam=title,source_status="网络及考生回忆，非官方发布",
            year=2024,province="全国",exam_type="事业单位",exam_category=category,subject="职测",
            module=module,subtype=subtype,original_section=section,difficulty="UNKNOWN",
            stem=stem,material=material or None,options=opts,correct_answer=answers[pos-1],
            analysis=None,answer_status="第三方参考答案；已核对原答案图转录，未逐题独立校准",
            answer_source_ref=f"https://gwysydw.com/bs/sydw/news_{SOURCE_IDS[category]}.html?page=9",
            source_ref=f"https://gwysydw.com/bs/sydw/news_{SOURCE_IDS[category]}.html"+(f"?page={page-1}" if page>1 else "")+f"#question-{pos}",
            import_notes=notes,bank_version=VERSION)
        rows.append(row)
        cursor=end
    if [r["paper_position"] for r in rows] != list(range(1,101)):
        raise ValueError(f"Incomplete or duplicate question positions: {category}")
    return rows

def main():
    p=argparse.ArgumentParser()
    p.add_argument("--base",type=Path,required=True)
    p.add_argument("--output",type=Path,required=True)
    p.add_argument("--supplement",type=Path,default=ROOT/"data/sydw-20240330")
    args=p.parse_args()
    keys=json.loads((args.supplement/"answer-keys.json").read_text(encoding="utf-8"))
    all_new=[]
    for category in "AC":
        answers="".join(keys[category]["rows"])
        if len(answers)!=100 or set(answers)-set("ABCD"):
            raise ValueError("Invalid answer key")
        all_new.extend(import_paper(args.supplement/"sources",category,answers))
    verified=json.loads((args.supplement/"verified-answers.json").read_text(encoding="utf-8"))
    corrections=[]
    for row in all_new:
        category,pos=row["exam_category"],row["paper_position"]
        second=verified.get(category,{}).get(str(pos))
        if second:
            row["original_reference_answer"]=row["correct_answer"]
            row["answer_crosscheck_source"]=verified["source"]
            if second!=row["correct_answer"]:
                corrections.append({"category":category,"position":pos,"original":row["correct_answer"],"corrected":second})
                row["import_notes"].append("原答案表与第二来源解析冲突；按逐题解析复核修正，保留原值及校对来源。")
            row["correct_answer"]=second
            row["answer_status"]="已逐题对照第二来源解析的答案；第三方回忆版，非官方答案"
        if pos in verified.get("quarantined",{}).get(category,[]):
            row["interactive_supported"]=False
            row["answer_status"]="争议题隔离，不进入自动计分"
            row["import_notes"].append(verified["note"])
    for row in all_new:
        asset_ids=sorted(set(re.findall(r"/bank-assets/([a-f0-9]{64})",json.dumps(row,ensure_ascii=False))))
        for asset_id in asset_ids:
            data=(args.supplement/"assets"/asset_id).read_bytes()
            if not(data.startswith(b"\x89PNG\r\n\x1a\n") or data.startswith(b"\xff\xd8\xff") or data.startswith((b"GIF87a",b"GIF89a")) or data.startswith(b"RIFF") and data[8:12]==b"WEBP"):
                raise ValueError(f"Invalid or missing image: {asset_id}")
        row["asset_ids"]=asset_ids
    base=[json.loads(l) for l in args.base.read_text(encoding="utf-8").split("\n") if l.strip()]
    if set(r["question_id"] for r in base) & set(r["question_id"] for r in all_new):
        raise ValueError("Supplement already imported")
    for row in base: row["bank_version"]=VERSION
    combined=base+all_new
    args.output.parent.mkdir(parents=True,exist_ok=True)
    args.output.write_text("".join(json.dumps(r,ensure_ascii=False)+"\n" for r in combined),encoding="utf-8")
    args.output.with_suffix(".supplement.jsonl").write_text("".join(json.dumps(r,ensure_ascii=False)+"\n" for r in all_new),encoding="utf-8")
    report=dict(base_questions=len(base),added_questions=len(all_new),total=len(combined),
        category_positions=dict(Counter(r["exam_category"] for r in all_new)),
        modules=dict(Counter(r["module"] for r in all_new)),
        objective_images=len(set(a for r in all_new for a in r["asset_ids"])),
        added_complete_papers=1,added_interactive_questions=sum(r["interactive_supported"] for r in all_new),
        quarantined=[r["question_id"] for r in all_new if not r["interactive_supported"]],
        answer_corrections=corrections,bank_version=VERSION,
        source_warning="回忆版及第三方参考答案；不标记为官方题，不伪造缺失解析。",
        source_snapshots={p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in (args.supplement/"sources").glob("*.html")})
    args.output.with_suffix(".supplement-report.json").write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding="utf-8")
    # Keep the source directory immutable; all prepared package inputs go beside output.
    subjective = args.supplement/"subjective-bank.jsonl"
    shutil.copyfile(subjective, args.output.parent/"sydw-subjective-bank.jsonl")
    materials = args.output.parent/"sydw-materials"
    materials.mkdir(exist_ok=True)
    for name in ("综应A类-2024.md", "综应C类-2024.md"):
        shutil.copyfile(args.supplement/name, materials/name)
    required_assets = {a for row in all_new for a in row["asset_ids"]}
    required_assets.update(re.findall(r"/bank-assets/([a-f0-9]{64})", subjective.read_text(encoding="utf-8")))
    assets = args.output.parent/"assets"
    assets.mkdir(exist_ok=True)
    if args.base.parent.resolve() != args.output.parent.resolve():
        for asset_id in set(re.findall(r"/bank-assets/([a-f0-9]{64})", args.base.read_text(encoding="utf-8"))):
            original = args.base.parent/"assets"/asset_id
            if original.is_file():
                shutil.copyfile(original, assets/asset_id)
    for asset_id in required_assets:
        shutil.copyfile(args.supplement/"assets"/asset_id, assets/asset_id)
    base_meta = args.base.with_suffix(".meta.json")
    if base_meta.is_file():
        previous = json.loads(base_meta.read_text(encoding="utf-8"))
        metadata = dict(previous, previous_bank_metadata=previous, bank_version=VERSION,
            supplement=report, canonical_unique_questions=len(combined),
            interactive_supported=sum(r.get("interactive_supported",False) for r in combined),
            offline_assets=len(list(assets.iterdir())))
        args.output.with_suffix(".meta.json").write_text(json.dumps(metadata,ensure_ascii=False,indent=2),encoding="utf-8")
    print(json.dumps(report,ensure_ascii=False))

if __name__=="__main__": main()
