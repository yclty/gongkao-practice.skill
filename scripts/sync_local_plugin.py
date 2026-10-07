#!/usr/bin/env python3
"""Materialize shared reference files in the portable plugin source."""
from pathlib import Path
import shutil
import json

ROOT = Path(__file__).resolve().parents[1]
REFERENCES = ("local-runtime.md", "pedagogy-protocol.md", "generation-rules.md", "module-blueprints.md", "error-taxonomy.md", "exam-map.md", "province-diffs.md", "public-base.md")

def sync():
    plugin = ROOT / "plugins/gongkao-coach"
    for name in REFERENCES:
        target = plugin / "references" / name
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(ROOT / "references" / name, target)
    shutil.copyfile(ROOT / "PRIVACY.md", plugin / "PRIVACY.md")
    template = ROOT / "plugin-package/gongkao-coach"
    for skill in ("gongkao-coach", "gongkao-onboarding"):
        shutil.copyfile(plugin / "skills" / skill / "SKILL.md", template / "skills" / skill / "SKILL.md")
    for name in REFERENCES:
        target=template / "references" / name
        target.parent.mkdir(parents=True,exist_ok=True)
        shutil.copyfile(ROOT / "references" / name,target)
    canonical=json.loads((plugin / "plugin.json").read_text(encoding="utf-8"))
    old=json.loads((template / "plugin.template.json").read_text(encoding="utf-8"))
    old["version"]=canonical["version"]
    old["description"]=canonical["description"]
    for field in ("shortDescription","longDescription","defaultPrompt"):
        old["extensions"]["com.openai"]["interface"][field]=canonical["extensions"]["com.openai"]["interface"][field]
    (template / "plugin.template.json").write_text(json.dumps(old,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
    shutil.copyfile(plugin / "mcp.json",template / "mcp.template.json")

if __name__ == "__main__":
    sync()
    print("Portable plugin references synchronized.")
