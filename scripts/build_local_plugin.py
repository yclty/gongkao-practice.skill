#!/usr/bin/env python3
"""Build a Windows offline package from explicit public inputs; never copy learner data."""
from __future__ import annotations
import argparse
import hashlib
import json
import re
import shutil
import subprocess
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from sync_local_plugin import sync

ROOT = Path(__file__).resolve().parents[1]

def sha(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()

def copy_tree(source: Path, target: Path):
    if not source.is_dir():
        raise ValueError(f"Missing public input: {source}")
    for path in source.rglob("*"):
        if path.is_symlink():
            raise ValueError(f"Symlinks are not portable: {path}")
        if path.is_file():
            dest = target / path.relative_to(source)
            dest.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(path, dest)

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--node", required=True, type=Path, help="Windows x64 Node 24 executable")
    parser.add_argument("--node-license", type=Path, default=ROOT / "local-data/Node-LICENSE.txt")
    parser.add_argument("--bank", type=Path, default=ROOT / "local-data/gongkao-question-bank.jsonl")
    parser.add_argument("--deps", type=Path, default=ROOT / "plugin-ui/node_modules")
    args = parser.parse_args()
    sync()
    manifest = json.loads((ROOT / "plugins/gongkao-coach/plugin.json").read_text(encoding="utf-8"))
    version = manifest["version"]
    node_version = subprocess.check_output([str(args.node), "--version"], text=True).strip()
    if not node_version.startswith("v24.") or not args.node_license.is_file():
        raise ValueError("A licensed Node 24 distribution is required")
    lock = json.loads((ROOT / "plugin-ui/package-lock.json").read_text(encoding="utf-8"))
    for path, package in lock["packages"].items():
        if not path or not package.get("version"):
            continue
        actual_path = args.deps.parent / path / "package.json"
        if not actual_path.is_file() or json.loads(actual_path.read_text(encoding="utf-8"))["version"] != package["version"]:
            raise ValueError(f"Dependency does not match lockfile: {path}; run npm ci")
    bank = [json.loads(line) for line in args.bank.read_text(encoding="utf-8").split("\n") if line.strip()]
    assets = set(re.findall(r"/bank-assets/([a-f0-9]{64})", args.bank.read_text(encoding="utf-8")))
    subjective_bank = args.bank.parent / "sydw-subjective-bank.jsonl"
    if subjective_bank.is_file():
        assets.update(re.findall(r"/bank-assets/([a-f0-9]{64})", subjective_bank.read_text(encoding="utf-8")))
    for name in assets:
        if not (args.bank.parent / "assets" / name).is_file():
            raise ValueError(f"Offline image missing: {name}")
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    package = ROOT / "dist" / f"gongkao-coach-{version}-windows-x64-{stamp}"
    package.mkdir(parents=True, exist_ok=False)
    plugin = package / "plugins/gongkao-coach"
    copy_tree(ROOT / "plugins/gongkao-coach", plugin)
    server = plugin / "server"
    for name in ("ensure-service.js", "local-service.js", "manage-service.js", "mcp-stdio.js", "package.json", "package-lock.json"):
        (server / name).parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(ROOT / "plugin-ui" / name, server / name)
    copy_tree(ROOT / "plugin-ui/lib", server / "lib")
    for name in ("local-app.html", "local-app.js", "local-app.css"):
        (server / "public").mkdir(parents=True, exist_ok=True)
        shutil.copyfile(ROOT / "plugin-ui/public" / name, server / "public" / name)
    copy_tree(args.deps, server / "node_modules")
    runtime = plugin / "runtime"
    runtime.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(args.node, runtime / "node.exe")
    shutil.copyfile(args.node_license, runtime / "LICENSE.txt")
    (plugin / "bank/assets").mkdir(parents=True, exist_ok=True)
    shutil.copyfile(args.bank, plugin / "bank/questions.jsonl")
    shutil.copyfile(args.bank.with_suffix(".meta.json"), plugin / "bank/metadata.json")
    if subjective_bank.is_file():
        shutil.copyfile(subjective_bank, plugin / "bank/sydw-subjective-bank.jsonl")
        for name in ("综应A类-2024.md", "综应C类-2024.md"):
            material = args.bank.parent / "sydw-materials" / name
            if material.is_file():
                target = plugin / "bank/materials" / name
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(material, target)
    for name in sorted(assets):
        shutil.copyfile(args.bank.parent / "assets" / name, plugin / "bank/assets" / name)
    shutil.copyfile(ROOT / "LICENSE", plugin / "LICENSE")
    for name in ("install.ps1", "install.cmd", "open-learning.cmd", "launch.ps1", "uninstall.ps1", "uninstall.cmd", "README.txt"):
        shutil.copyfile(ROOT / "packaging" / name, package / name)
    market = {"name": "gongkao-local", "interface": {"displayName": "本地考公学习包"}, "plugins": [{
        "name": "gongkao-coach", "source": {"source": "local", "path": "./plugins/gongkao-coach"},
        "policy": {"installation": "AVAILABLE", "authentication": "ON_INSTALL"}, "category": "Education & Research"}]}
    catalog = package / ".agents/plugins/marketplace.json"
    catalog.parent.mkdir(parents=True)
    catalog.write_text(json.dumps(market, ensure_ascii=False, indent=2), encoding="utf-8")
    checksums = {}
    for path in sorted(package.rglob("*")):
        if not path.is_file():
            continue
        rel = path.relative_to(package).as_posix()
        if any(part in {".git", "local-data", ".runtime", "profiles", "backups"} for part in path.relative_to(package).parts) or path.suffix in {".sqlite", ".gkbackup"} or path.name.startswith(".env"):
            raise ValueError(f"Private file forbidden: {rel}")
        checksums[rel] = sha(path)
    report_js = "import {LearningService} from './lib/learning-service.js';import {mkdtempSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';const s=new LearningService({root:mkdtempSync(join(tmpdir(),'gk-build-')),bankPath:'../bank/questions.jsonl'});console.log(JSON.stringify(s.bankStatus().stats));s.close();"
    stats = json.loads(subprocess.check_output([str(runtime / "node.exe"), "--input-type=module", "-e", report_js], cwd=server, text=True, encoding="utf-8"))
    bank_meta=json.loads(args.bank.with_suffix(".meta.json").read_text(encoding="utf-8"))
    release = {"version": version, "schema_version": 1, "api_version": 1, "platform": "windows-x64", "built_at": stamp, "node": node_version, "source_repository": "https://github.com/yclty/gongkao-practice.skill", "bank_source_commit": bank_meta["source_commit"], "bank_version":bank[0]["bank_version"], "question_inventory": stats, "offline_images": len(assets), "files": checksums}
    (package / "release-manifest.json").write_text(json.dumps(release, ensure_ascii=False, indent=2), encoding="utf-8")
    archive = Path(str(package)+".zip")
    with zipfile.ZipFile(archive, "w", zipfile.ZIP_DEFLATED, compresslevel=6) as out:
        for path in sorted(package.rglob("*")):
            if path.is_file():
                out.write(path, Path(package.name) / path.relative_to(package))
    archive.with_suffix(".sha256").write_text(f"{sha(archive)}  {archive.name}\n", encoding="ascii")
    print(json.dumps({"package": str(package), "archive": str(archive), "megabytes": round(archive.stat().st_size / 1048576, 1), "files": len(checksums), "stats": stats, "offline_images": len(assets)}, ensure_ascii=False))

if __name__ == "__main__":
    main()
