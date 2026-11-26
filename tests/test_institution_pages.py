from pathlib import Path
import sys
from tempfile import TemporaryDirectory
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from institution_pages import publish_institutions


class InstitutionPagesTests(unittest.TestCase):
    def test_changed_names_share_one_history_and_single_month_has_no_profile(self):
        metadata = {"institutions": [["abc", "Old title", "", ""], ["abc", "New title", "", ""],
                                     ["single", "One month", "", ""]], "generatedAtUtc": "2026-11-24T00:00:00Z"}
        groups = {0: [[0, 202401, "", "", "", "DA"], [1, 202511, "", "", "", "DP"],
                      [2, 202511, "", "", "", "DA"]]}
        tool = {"url": "/atip/", "title": "ATIP Explorer"}
        with TemporaryDirectory() as temp:
            stage = Path(temp)
            self.assertTrue(publish_institutions(stage, tool, metadata, groups))
            page = (stage / "institutions/abc/index.html").read_text()
            self.assertIn("2 completed request summaries for New title", page)
            self.assertIn('href="/atip/#institution=abc"', page)
            self.assertIn("Disclosed in part", page)
            self.assertFalse((stage / "institutions/single").exists())
            self.assertFalse(publish_institutions(stage, tool, metadata, {0: groups[0][:1]}))
            self.assertFalse((stage / "institutions").exists())
            self.assertFalse((stage / "sitemap.xml").exists())
