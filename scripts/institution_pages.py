"""Summarize published ATI records by the same institution codes used by the explorer."""
from collections import Counter, defaultdict
from html import escape
from pathlib import Path
import shutil
from tempfile import TemporaryDirectory
from urllib.parse import urlencode

from result_pages import link, publish, slug, table

OUTCOMES = {"DA": "All disclosed", "DP": "Disclosed in part", "EC": "All excluded",
            "EX": "All exempted", "NE": "No records exist"}


def publish_institutions(output, tool, metadata, groups):
    years = defaultdict(Counter)
    outcomes = defaultdict(Counter)
    months = defaultdict(set)
    names = {}
    for rows in groups.values():
        for row in rows:
            code, english, french, _ = metadata["institutions"][row[0]]
            month = row[1]
            years[code][month // 100] += 1
            months[code].add(month)
            outcomes[code][row[5]] += 1
            # Use the most recent title associated with this institution code.
            if code not in names or month > names[code][0]:
                names[code] = (month, english, french)
    records = []
    for code, counts in years.items():
        if len(months[code]) < 2 or not code:
            continue
        last, english, french = names[code]
        name = english or french or code
        total = sum(counts.values())
        first = min(months[code])
        first_label = f"{first // 100}-{first % 100:02d}"
        last_label = f"{last // 100}-{last % 100:02d}"
        title = f"{name} access to information request summaries"
        intro = (f"The federal catalogue contains {total:,} completed request summaries for {name}, "
                 f"with reported completion months from {first_label} through {last_label}.")
        query = urlencode({"institution": code})
        body = '<p>' + link(tool["url"] + "#" + query, "Search these summaries and find a released record") + '</p>'
        if english and french and english != french:
            body += '<p lang="fr">' + escape(french) + '</p>'
        rows = [(year, f"{n:,}") for year, n in sorted(counts.items(), reverse=True)]
        body += table("Published summaries by completion year", ["Calendar year", "Summaries"], rows)
        rows = [(OUTCOMES.get(key, key or "Unreported"), f"{n:,}") for key, n in outcomes[code].most_common()]
        body += table("Disclosure outcomes in the published summaries", ["Recorded disposition", "Summaries"], rows)
        body += (f'<h2>Reading the figures</h2><p>These counts cover entries in the public file. '
                 'The federal catalogue omits certain personal and third-party requests and some institutions publish separately. '
                 f'The latest year includes only the completion months present in this edition. Snapshot prepared {escape(metadata["generatedAtUtc"][:10])}.</p><p>'
                 + link("https://open.canada.ca/data/dataset/0797e893-751e-4695-8229-a5066e4fe43c", "Official federal dataset and data dictionary")
                 + ' · ' + link("https://open.canada.ca/en/open-government-licence-canada/", "Open Government Licence – Canada") + '</p>'
                 + '<p>' + link('/atipmetrics/', 'Compare published summaries with annual institutional access statistics')
                 + ' · ' + link('/field-notes/finding-released-atip-records/', 'How to request a copy of previously released records') + '</p>')
        records.append((slug(code), name, title, intro, body))
    # The existing builder supports rebuilding over an older output directory.
    # Construct the whole collection before retiring its previous edition.
    with TemporaryDirectory(dir=output) as temp:
        stage = Path(temp)
        if records:
            publish(stage, tool, "institutions", "Federal access to information summaries by institution",
                    "Choose a federal institution to see published summaries by completion year and disclosure outcome. "
                    "Each profile covers at least two reported months and opens the explorer with the institution selected.", records)
        previous = output / "institutions"
        if previous.exists():
            shutil.rmtree(previous)
        if records:
            (stage / "institutions").replace(previous)
            (stage / "sitemap.xml").replace(output / "sitemap.xml")
        else:
            (output / "sitemap.xml").unlink(missing_ok=True)
    return bool(records)
