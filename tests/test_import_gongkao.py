import importlib.util
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("gongkao_import", ROOT / "scripts/import_gongkao_repository.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

class ImportTests(unittest.TestCase):
    def test_declared_total_is_not_replaced_with_a_partial_array_length(self):
        paper={"sid":1,"source":"2026省考","questions":[1,2]}
        q={"id":1,"titleHtml":"题干","options":[{"label":"A","text":"1"},{"label":"B","text":"2"}],"correctAnswer":"A"}
        item=module.convert_question(paper,q,1,[{"name":"资料分析","snum":1,"enum":130}],{})
        self.assertEqual(item["paper_total"],130)
        self.assertTrue(item["paper_total_verified"])

    def test_safe_html_keeps_tables_and_images(self):
        value = module.strip_html('<script>bad()</script><table><tr><td>年份</td><td>10%</td></tr></table><img src="https://example.com/q.png">')
        self.assertNotIn("bad()", value)
        self.assertIn("年份 | 10%", value)
        self.assertRegex(value, r"/bank-assets/[a-f0-9]{64}")
        self.assertIn("[缺失图片]", module.strip_html('<img src="javascript:bad()">'))

    def test_content_conflict_does_not_merge_answers_or_material(self):
        seen = {}
        paper = {"sid": 1, "source": "2026省考", "questions": [1, 2]}
        q = {"id": 10, "titleHtml": "同一题干", "type": "single", "options": [{"label": "A", "text": "1"}, {"label": "B", "text": "2"}], "correctAnswer": "A"}
        a = module.convert_question(paper, q, 1, [], seen)
        b = module.convert_question(paper, dict(q, correctAnswer="B"), 2, [], seen)
        self.assertNotEqual(a["question_id"], b["question_id"])
        self.assertEqual(a["question_id"], module.convert_question(paper, q, 1, [], seen)["question_id"])

    def test_real_fixture_supports_multi_and_preserves_paper_memberships(self):
        with tempfile.TemporaryDirectory() as folder:
            out = Path(folder) / "bank.jsonl"
            subprocess.run([sys.executable, "-X", "utf8", str(ROOT / "scripts/import_gongkao_repository.py"), "--source", str(ROOT / "tests/fixtures/gongkao-snapshot"), "--output", str(out), "--source-commit", "fixture"], check=True, stdout=subprocess.DEVNULL)
            rows = [json.loads(line) for line in out.read_text(encoding="utf-8").split("\n") if line.strip()]
            self.assertEqual(len(rows), 2)
            self.assertEqual(rows[0]["correct_answer"], "B")
            self.assertEqual(rows[0]["module"], "政治理论")
            self.assertEqual(rows[1]["correct_answer"], "A,C")
            self.assertTrue(rows[1]["interactive_supported"])
            self.assertEqual(rows[0]["paper_memberships"][0]["paper_total"], 2)

if __name__ == "__main__":
    unittest.main()
