# ATIP Records Explorer

Search the Government of Canada's completed access to information request summaries. This is an independent research tool for checking what was already requested, getting a released package, and drafting a follow-up or a new request.

- Search as you type across both official languages, request numbers, and dataset comments. Use quotes for a phrase and a minus sign to exclude a term, for example `"shag harbour" -aircraft`. The last unquoted word matches prefixes as you type.
- Filter by institution, completion year, disclosure outcome, and search language. Sort by relevance, date, or page count.
- Save records in your browser, copy a citation or explorer link, or see related search terms.
- Use **Request a copy** to get to the official record lookup or copy a request for the institution's ATIP coordinator. A completed summary may have no releasable pages, and an entry in the CSV can be missing from the live portal.
- Use **Draft a new request** to specify the institution, records, and date range. Copy or download the draft and submit it through the federal process. Formal ATI requests usually have a $5 application fee.

The initial deployment was built from the supplied November 2026 snapshot. It contains **206,127 summaries across 190 federal institutions**, with reported completion years **2011–2026**. The source file SHA-256 is `0213ac2d6264280917b19a269ddedb9b86b435f168a89ce9471f4e0ca52e9fdb`.

## Use online with GitHub Pages

Open [Settings → Pages](https://github.com/jsdyer/atip/settings/pages), select **GitHub Actions** as the source, then go to [Actions](https://github.com/jsdyer/atip/actions/workflows/pages.yml) and run **Publish ATIP Explorer to GitHub Pages** on `main`.

The workflow downloads the current official CSV, builds the static app, and publishes the generated site and dataset to GitHub Pages. Visitors only need a browser.

### Automatic daily data refresh

- **Scheduled refresh:** Every day at **10:23 UTC** (2:23 a.m. PST / 3:23 a.m. PDT in Vancouver) via the GitHub Actions `schedule` trigger. GitHub runs scheduled workflows on a best-effort basis; the exact start time may vary.
- **Manual refresh:** Open [Publish ATIP Explorer to GitHub Pages](https://github.com/jsdyer/atip/actions/workflows/pages.yml) and select **Run workflow** on `main`.
- **Code-triggered refresh:** Pushes affecting `web/**`, `scripts/build.py`, or `.github/workflows/pages.yml` also rebuild and redeploy the site.
- **If a refresh fails:** The deployment job will not run, so the last successful published snapshot remains available.

### Where the data is stored

The raw `ati-all.csv` is downloaded temporarily during the GitHub Actions build; it is **not committed to this source repository**. The build converts it into compressed JSON shards under `dist/data/`, and publishes those files as part of the **GitHub Pages deployment artifact**. They are publicly served from `https://coolcode.ca/atip/data/` and downloaded by each visitor's browser for local, instant searching.

The coverage panel shows the completion years and the UTC date when this search snapshot was generated. The [published manifest](https://coolcode.ca/atip/data/manifest.json) gives the full timestamp, record count, coverage, source CSV SHA-256 and shard filenames.

## Build or refresh

Use Python 3 and a recent browser with Web Workers and `DecompressionStream`. The runtime is static HTML, CSS, and JavaScript. The build converts the CSV to compressed data files and copies the app into `dist/`.

```sh
curl -fL 'https://open.canada.ca/data/dataset/0797e893-751e-4695-8229-a5066e4fe43c/resource/19383ca2-b01a-487d-88f7-e1ffbc7d39c2/download/ati-all.csv' -o ati-all.csv
python3 scripts/build.py ati-all.csv
python3 -m http.server 8080 --bind 127.0.0.1 --directory dist
```

Open http://127.0.0.1:8080. To reproduce a specific snapshot, pass its local CSV to the build command. The government download can change as institutions post more summaries. The raw CSV and generated directory are ignored by Git. To self-host, publish the contents of `dist/` to a static web host, including every file in `dist/data/`.

On first load the browser downloads the compressed bilingual snapshot (about 25 MiB for this edition). The search worker processes the snapshot locally. Typing, saved items, and draft text stay in the browser. Copies and new requests are submitted separately using the official forms or institutional contacts.

The dataset excludes certain requests involving personal or third-party proprietary information, and some federal institutions publish summaries separately. A zero-result search only covers this snapshot. Provincial and municipal systems have their own sources.

- [Government of Canada dataset and data dictionary](https://open.canada.ca/data/dataset/0797e893-751e-4695-8229-a5066e4fe43c)
- [Official completed request search and copy form](https://search.open.canada.ca/ati/)
- [Federal ATIP coordinators](https://www.tbs-sct.canada.ca/ap/atip-aiprp/coord-eng.asp)
- [Make a new federal request](https://www.canada.ca/en/treasury-board-secretariat/services/access-information-privacy/access-information/request-information/make-request.html)

Source data published by the Treasury Board of Canada Secretariat. Contains information licensed under the [Open Government Licence – Canada](https://open.canada.ca/en/open-government-licence-canada/).


<!-- coolcode:guide -->
Search completed federal ATIP summaries by keyword and institution, save useful records, then export the current result page or your saved shortlist as CSV. The export includes both languages, official record links and the snapshot date; it is not the full result set unless you have saved every match.
<!-- /coolcode:guide -->


## Added browser workflow

Search completed federal ATIP summaries by keyword and institution, save useful records, then export the current result page or your saved shortlist as CSV. The export includes both languages, official record links and the snapshot date; it is not the full result set unless you have saved every match.

## Saved preference compatibility

Saved requests now use coolcode:atip:saved-v1. The first successful storage write copies the previous atip-saved-v1 value before removing its old key; a failed write leaves the saved requests available under the original key.

<!-- schedule-reliability -->
## Schedule reliability

Public GitHub repositories can have scheduled workflows disabled after 60 days of inactivity. A separate weekly [schedule guard](.github/workflows/schedule-guard.yml) calls GitHub's enable-workflow API for an explicit list of refresh workflows and itself. It can restore workflows disabled for inactivity, preserves manually disabled workflows, and runs independently of collection failures.

This is an interim mitigation, not a scheduling guarantee: GitHub does not document active-workflow renewal as a permanent exemption, and scheduled runs can be delayed or dropped. A scheduler on our own Linux server is the planned independent trigger. The guard does not collect data, create dummy commits, or change source/check timestamps; successful collection and published data freshness still need monitoring.
<!-- /schedule-reliability -->
