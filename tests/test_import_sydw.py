import hashlib
import json
import re
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data/sydw-20240330"


class SupplementTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.folder = tempfile.TemporaryDirectory()
        cls.base = Path(cls.folder.name) / "original.jsonl"
        cls.output = Path(cls.folder.name) / "prepared/questions.jsonl"
        # Unicode line separators in a stem must not split a JSONL record.
        cls.original = {"question_id": "existing", "stem": "保留\u2028原题", "interactive_supported": True}
        cls.base.write_text(json.dumps(cls.original, ensure_ascii=False) + "\n", encoding="utf-8")
        cls.base.with_suffix(".meta.json").write_text('{"source_commit":"fixture"}', encoding="utf-8")
        subprocess.run([sys.executable, "-X", "utf8", str(ROOT / "scripts/import_sydw_supplement.py"),
                        "--base", str(cls.base), "--output", str(cls.output)],
                       check=True, stdout=subprocess.DEVNULL)
        cls.rows = [json.loads(line) for line in cls.output.read_text(encoding="utf-8").split("\n") if line.strip()]
        cls.added = {r["question_id"]: r for r in cls.rows[1:]}

    @classmethod
    def tearDownClass(cls):
        cls.folder.cleanup()

    def test_public_snapshots_are_pinned(self):
        manifest = json.loads((DATA / "snapshot-manifest.json").read_text(encoding="utf-8"))
        for name, expected in manifest["files"].items():
            self.assertEqual(hashlib.sha256((DATA / name).read_bytes()).hexdigest(), expected, name)

    def test_existing_rows_and_source_directory_are_preserved(self):
        row = dict(self.rows[0])
        row.pop("bank_version")
        self.assertEqual(row, self.original)
        self.assertFalse((DATA / "supplement.jsonl").exists())
        self.assertEqual(self.base.read_text(encoding="utf-8"), json.dumps(self.original, ensure_ascii=False) + "\n")

    def test_reference_conflicts_are_corrected_and_ambiguous_question_quarantined(self):
        report = json.loads(self.output.with_suffix(".supplement-report.json").read_text(encoding="utf-8"))
        self.assertEqual(len(self.added), 200)
        self.assertEqual(report["added_interactive_questions"], 199)
        self.assertEqual(len(report["answer_corrections"]), 30)
        self.assertFalse(self.added["sydw_20240330_C_014"]["interactive_supported"])
        self.assertEqual(self.added["sydw_20240330_C_069"]["correct_answer"], "D")
        verified = json.loads((DATA / "verified-answers.json").read_text(encoding="utf-8"))
        answers = re.findall(r"故正确答案为([A-D])", (DATA / "sources/2024-C-second.html").read_text(encoding="utf-8"))
        self.assertEqual(len(answers), 100)
        self.assertEqual(answers, [verified["C"][str(i)] for i in range(1, 101)])

    def test_cross_page_options_and_shared_material_are_retained(self):
        self.assertIn("先接受红光刺激", self.added["sydw_20240330_C_070"]["options"][3]["text"])
        for key in ("A_081", "A_085", "C_086", "C_090"):
            self.assertTrue(self.added["sydw_20240330_" + key]["material"])
        for row in self.added.values():
            self.assertEqual([o["label"] for o in row["options"]], list("ABCD"))
            self.assertEqual(row["source_type"], "platform_import")
            self.assertIsNone(row["analysis"])

    def test_prepared_package_includes_subjective_material_and_offline_images(self):
        manual = self.output.parent / "sydw-subjective-bank.jsonl"
        rows = [json.loads(line) for line in manual.read_text(encoding="utf-8").split("\n") if line.strip()]
        self.assertEqual(len(rows), 17)
        self.assertTrue(all(row["grading_mode"] == "manual" for row in rows))
        for row in self.rows[1:] + rows:
            for asset in re.findall(r"/bank-assets/([a-f0-9]{64})", json.dumps(row, ensure_ascii=False)):
                self.assertTrue((self.output.parent / "assets" / asset).is_file())
        self.assertTrue((self.output.parent / "sydw-materials/综应A类-2024.md").is_file())
        meta = json.loads(self.output.with_suffix(".meta.json").read_text(encoding="utf-8"))
        self.assertEqual(meta["source_commit"], "fixture")
        self.assertEqual(meta["interactive_supported"], 200)


if __name__ == "__main__":
    unittest.main()
