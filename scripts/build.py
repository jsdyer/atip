#!/usr/bin/env python3
"""Convert an official ATI CSV snapshot into a static site with compressed data shards."""

import argparse
import csv
import gzip
import hashlib
import json
import shutil
import sys
from collections import Counter, defaultdict
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
COLUMNS = {
    "year", "month", "request_number", "summary_en", "summary_fr", "disposition",
    "pages", "comments_en", "comments_fr", "umd_number", "owner_org", "owner_org_title",
}


def json_bytes(value):
    return json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode("utf-8")


def source_digest(path):
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def title_parts(title):
    english, _, french = title.partition("|")
    return english.strip(), french.strip()


def read_snapshot(path):
    groups = defaultdict(list)
    institutions = []
    institution_ids = {}
    dispositions = Counter()
    counts_by_date = Counter()
    csv.field_size_limit(sys.maxsize)

    with path.open(encoding="utf-8-sig", newline="") as stream:
        reader = csv.DictReader(stream)
        missing = COLUMNS.difference(reader.fieldnames or [])
        if missing:
            raise ValueError(f"Missing CSV columns: {', '.join(sorted(missing))}")

        for record in reader:
            try:
                year = int(record["year"])
                month = int(record["month"])
                if not (1 <= month <= 12 and 1900 <= year <= 2200):
                    raise ValueError("year or month outside supported range")
                org = record["owner_org"]
                title = record["owner_org_title"]
                if org not in institution_ids:
                    institution_ids[org] = len(institutions)
                    institutions.append([org, *title_parts(title), title])
                elif institutions[institution_ids[org]][3] != title:
                    # Preserve the source display title even if one organization changed names.
                    key = (org, title)
                    if key not in institution_ids:
                        institution_ids[key] = len(institutions)
                        institutions.append([org, *title_parts(title), title])
                    org = key

                date = year * 100 + month
                row = [
                    institution_ids[org], date, record["request_number"],
                    record["summary_en"], record["summary_fr"], record["disposition"],
                    int(record["pages"]) if record["pages"].isdigit() else record["pages"],
                    record["umd_number"], record["comments_en"], record["comments_fr"],
                ]
                while len(row) > 8 and not row[-1]:
                    row.pop()
                groups[(year - 1) // 2].append(row)
                dispositions[record["disposition"]] += 1
                counts_by_date[date] += 1
            except (TypeError, ValueError, AttributeError) as error:
                raise ValueError(f"CSV line {reader.line_num}: {error}") from error

    if not counts_by_date:
        raise ValueError("CSV contains no records")
    return groups, institutions, dispositions, counts_by_date


def build(source, output):
    groups, institutions, dispositions, counts_by_date = read_snapshot(source)

    if output == ROOT or output == ROOT / "web" or output in source.parents:
        raise ValueError("Output must be a dedicated build directory outside the source")
    output.mkdir(parents=True, exist_ok=True)
    shutil.copytree(ROOT / "web", output, dirs_exist_ok=True)
    data = output / "data"
    data.mkdir(exist_ok=True)
    for old_asset in data.glob("rows-*.json.gz"):
        old_asset.unlink()

    shards = []
    for group in sorted(groups, reverse=True):
        rows = groups[group]
        # Dates are used for stable pagination. Group organization codes improve compression.
        rows.sort(key=lambda row: (row[0], -row[1], row[2]))
        first_year = group * 2 + 1
        name = f"rows-{first_year}-{first_year + 1}.json.gz"
        # Stream rows to avoid keeping a second large JSON copy in the builder's memory.
        with (data / name).open("wb") as stream:
            with gzip.GzipFile(filename="", mode="wb", fileobj=stream, compresslevel=9, mtime=0) as archive:
                archive.write(b"[")
                for offset, row in enumerate(rows):
                    if offset:
                        archive.write(b",")
                    archive.write(json_bytes(row))
                archive.write(b"]")
        shards.append({"file": name, "records": len(rows), "bytes": (data / name).stat().st_size})

    def iso_date(value):
        year, month = divmod(value, 100)
        return f"{year:04d}-{month:02d}"

    metadata = {
        "schema": 1,
        "total": sum(counts_by_date.values()),
        "minYear": min(counts_by_date) // 100,
        "maxYear": max(counts_by_date) // 100,
        "minDate": iso_date(min(counts_by_date)),
        "maxDate": iso_date(max(counts_by_date)),
        "countsByMonth": {iso_date(date): count for date, count in sorted(counts_by_date.items())},
        "institutions": institutions,
        "dispositions": sorted(dispositions),
        "sourceFile": source.name,
        "sourceSha256": source_digest(source),
        "shards": shards,
    }
    (data / "manifest.json").write_bytes(json_bytes(metadata) + b"\n")
    mb = sum(shard["bytes"] for shard in shards) / 1024**2
    print(f"{metadata['total']:,} records, {len(set(org[0] for org in institutions))} institutions, "
          f"{len(shards)} shards, {mb:.1f} MiB compressed.")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("csv", type=Path, help="Official ati-all.csv snapshot")
    parser.add_argument("--output", type=Path, default=ROOT / "dist", help="Static output directory")
    args = parser.parse_args()
    try:
        build(args.csv.resolve(), args.output.resolve())
    except (ValueError, OSError, csv.Error) as error:
        parser.exit(1, f"Build failed: {error}\n")


if __name__ == "__main__":
    main()
