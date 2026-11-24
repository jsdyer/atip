import json
import csv
from pathlib import Path
import sys
import tempfile
import unittest
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from build import dataset_metadata, build, COLUMNS


class DatasetTests(unittest.TestCase):
    def test_built_page_and_manifest_describe_the_same_snapshot(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            source = root / "input.csv"
            with source.open("w", newline="") as output:
                writer = csv.DictWriter(output, fieldnames=sorted(COLUMNS))
                writer.writeheader()
                writer.writerow({"year": "2022", "month": "4", "request_number": "TEST-1",
                                 "owner_org": "test", "owner_org_title": "Test|Essai",
                                 "summary_en": "A test summary", "pages": "5"})
            build(source, root / "site")
            page = (root / "site/index.html").read_text()
            self.assertNotIn("{{DATASET_SUMMARY}}", page)
            self.assertIn('id="dataset"', page)
            self.assertIn("1 completed federal request summaries", page)
            self.assertTrue((root / "site/data/rows-2021-2022.json.gz").is_file())

    def test_snapshot_time_does_not_invent_a_source_modification(self):
        meta = {"total": 24, "minDate": "2021-01", "maxDate": "2022-12",
                "generatedAtUtc": "2026-11-24T10:00:00Z", "shards": [{"file": "rows-2021-2022.json.gz"}]}
        dataset = dataset_metadata(meta)
        self.assertEqual(dataset["dateCreated"], meta["generatedAtUtc"])
        self.assertNotIn("dateModified", dataset)
        self.assertEqual(dataset["temporalCoverage"], "2021-01/2022-12")
        self.assertEqual(dataset["distribution"][0]["contentUrl"], "https://coolcode.ca/atip/data/rows-2021-2022.json.gz")
