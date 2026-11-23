import { openDraft, draftExisting } from "./draft.js";
import { summariesCSV } from "./export.mjs";

const $ = id => document.getElementById(id);
const query = $("query");
const filterIds = ["institution", "year", "disposition", "language", "fromYear", "toYear", "releasedOnly"];
const pageSize = 15;
const dates = new Intl.DateTimeFormat("en-CA", { month: "short", year: "numeric", timeZone: "UTC" });
const number = new Intl.NumberFormat("en-CA");
const outcomes = {
  DA: "All disclosed", DP: "Disclosed in part", EC: "All excluded",
  EX: "All exempted", NE: "No records exist"
};
const starterSearches = ["Shag Harbour", "real-time rail", "interchange fees", "data breach", "legacy systems"];
const topics = [
  [/shag|uap|ufo|unidentified|ovni|astronom/i, ["Shag Harbour", "unidentified flying object", "unidentified aerial phenomena", "Project Magnet", "OVNI"]],
  [/rail|interchange|payments?|konek/i, ["real-time rail", "Paiements Canada", "instant payments", "interchange fees", "frais d’interchange"]],
  [/cyber|privacy|breach|incident|intrusion/i, ["privacy breach", "security incident", "unauthorized access", "cyber incident", "atteinte à la vie privée"]],
  [/legacy|mainframe|moderniz|technology/i, ["legacy systems", "mainframe", "IT modernization", "technical debt", "systèmes patrimoniaux"]]
];

let saved = readSaved();
let showingSaved = false;
let page = 1;
let latestRequest = 0;
let timer;
let activeRecord;
let worker;
let hasLoaded = false;
let initialFilters = new URLSearchParams(location.hash.slice(1));
let pendingRecord = initialFilters.get("record");
let results = { rows: [], total: 0, suggestions: [] };
let institutionTitles = new Map();
let snapshotDate = '';

function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}

function button(label, action, className = "ghost") {
  const node = element("button", label, className);
  node.type = "button";
  node.addEventListener("click", action);
  return node;
}

function officialLink(label, url) {
  const link = element("a", label);
  link.href = url;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  return link;
}

function dateLabel(year, month) {
  if (!year || !month) return String(year || "");
  return dates.format(new Date(Date.UTC(year, month - 1, 1)));
}

function recordKey(row) {
  return [row.owner_org, row.year, row.month, row.request_number].join(",");
}

function institutionName(row) {
  return (row.owner_org_title || row.owner_org || "").split("|")[0].trim();
}

function rowSummary(row) {
  return ($("language").value === "fr" ? row.summary_fr : row.summary_en) || row.summary_en || row.summary_fr || "";
}

function govUrl(row) {
  return "https://search.open.canada.ca/ati/record/" +
    [row.owner_org, row.year, row.month, row.request_number].map(encodeURIComponent).join(",");
}

function govSearchUrl(value) {
  const url = new URL("https://search.open.canada.ca/ati/");
  url.searchParams.set("search_text", value);
  return url.href;
}

function draftRecord(row) {
  return {
    id: recordKey(row), number: row.request_number, org: institutionName(row),
    year: row.year, month: row.month, en: row.summary_en, fr: row.summary_fr, url: govUrl(row),
    disposition: row.disposition, pages: row.pages, slug: row.owner_org
  };
}

function hasRelease(row) {
  return row.disposition === "DA" || row.disposition === "DP";
}

function metadata(row) {
  const pages = row.pages === "" || row.pages == null ? "" : `${number.format(row.pages)} ${Number(row.pages) === 1 ? "page" : "pages"}`;
  return [dateLabel(row.year, row.month), outcomes[row.disposition] || row.disposition, pages].filter(Boolean).join(" · ");
}

function appendHighlighted(node, text) {
  const terms = (query.value.toLowerCase().match(/[\p{L}\p{N}]+/gu) || []).filter(s => s.length > 1).slice(0, 14);
  if (!terms.length) { node.textContent = text; return; }
  const pattern = new RegExp(`(^|[^\\p{L}\\p{N}])(${terms.join("|")})`, "giu");
  let offset = 0;
  for (const match of text.matchAll(pattern)) {
    const start = match.index + match[1].length;
    node.append(document.createTextNode(text.slice(offset, start)), element("mark", match[2]));
    offset = start + match[2].length;
  }
  node.append(document.createTextNode(text.slice(offset)));
}

function excerpt(row) {
  const text = rowSummary(row).replace(/\s+/g, " ").trim();
  if (text.length <= 430) return text;
  const terms = (query.value.toLowerCase().match(/[\p{L}\p{N}]+/gu) || []).filter(s => s.length > 2);
  const lower = text.toLowerCase();
  const found = terms.map(t => lower.indexOf(t)).filter(i => i >= 0);
  const start = found.length && Math.min(...found) > 340 ? Math.min(...found) - 60 : 0;
  return `${start ? "…" : ""}${text.slice(start, start + 430)}${start + 430 < text.length ? "…" : ""}`;
}

function readSaved() {
  try {
    const stored = JSON.parse(localStorage.getItem("atip-saved-v1") || "[]");
    return Array.isArray(stored) ? stored.filter(x => x && typeof x.request_number === "string") : [];
  } catch { return []; }
}

function updateSavedCount() {
  $("saved-count").textContent = number.format(saved.length);
  $("saved").setAttribute("aria-pressed", String(showingSaved));
}

function toggleSaved(row) {
  const key = recordKey(row);
  const exists = saved.some(item => recordKey(item) === key);
  saved = exists ? saved.filter(item => recordKey(item) !== key) : [...saved, row];
  try { localStorage.setItem("atip-saved-v1", JSON.stringify(saved)); }
  catch { $("count").textContent = "Saved in this tab. Browser storage is unavailable."; }
  updateSavedCount();
  if (showingSaved) renderResults();
  for (const control of document.querySelectorAll("[data-save-key]")) {
    if (control.dataset.saveKey === key) {
      control.textContent = exists ? "Save" : "Saved ✓";
      control.setAttribute("aria-pressed", String(!exists));
    }
  }
  return !exists;
}

function renderSaveButton(row) {
  const isSaved = () => saved.some(item => recordKey(item) === recordKey(row));
  const save = button(isSaved() ? "Saved ✓" : "Save", () => {
    const checked = toggleSaved(row);
    save.textContent = checked ? "Saved ✓" : "Save";
    save.setAttribute("aria-pressed", String(checked));
  });
  save.dataset.saveKey = recordKey(row);
  save.setAttribute("aria-pressed", String(isSaved()));
  save.setAttribute("aria-label", `Save ${row.request_number || "this record"}`);
  return save;
}

function renderRecord(row) {
  const card = element("article", undefined, "result-card");
  const header = element("div", undefined, "card-top");
  const heading = element("div");
  heading.append(element("div", institutionName(row), "org"), element("span", row.request_number || "No request number", "record-id"));
  header.append(heading, renderSaveButton(row));
  const body = element("p", undefined, "card-copy");
  appendHighlighted(body, excerpt(row));
  const footer = element("div", undefined, "card-bottom");
  const actions = element("div", undefined, "card-actions");
  actions.append(button("Open summary", () => openRecord(row), "secondary"));
  if (hasRelease(row)) actions.append(button("Request a copy", () => draftExisting(draftRecord(row))));
  footer.append(element("div", metadata(row), "metadata"), actions);
  card.append(header, body, footer);
  return card;
}

function selectedOrganization() {
  const institution = $("institution");
  return institution.value ? institution.selectedOptions[0]?.textContent || "" : "";
}

function startDraft(row) {
  const search = query.value.trim().replace(/^"|"$/g, "");
  const topic = row && (!search || search === row.request_number)
    ? rowSummary(row).replace(/\s+/g, " ").trim().slice(0, 180)
    : search;
  openDraft({ topic, organization: row ? institutionName(row) : selectedOrganization(), reference: row ? draftRecord(row) : "" });
}

async function copyCitation(row) {
  const citation = `${institutionName(row)}, completed ATI request ${row.request_number}, ${dateLabel(row.year, row.month)} (${metadata(row).split(" · ").slice(1).join(", ")}). Open Government Portal: ${govUrl(row)}`;
  try { await navigator.clipboard.writeText(citation); $("record-status").textContent = "Citation copied."; }
  catch { $("record-status").textContent = citation; }
}

function openRecord(row) {
  activeRecord = row;
  $("record-org").textContent = institutionName(row);
  $("record-heading").textContent = row.request_number || "Request summary";
  $("record-meta").textContent = metadata(row);
  $("record-status").textContent = "";
  const english = element("p");
  appendHighlighted(english, row.summary_en || "No English summary supplied.");
  const french = element("p");
  appendHighlighted(french, row.summary_fr || "No French summary supplied.");
  const blocks = $("language").value === "fr"
    ? [element("h3", "Résumé officiel"), french, element("h3", "Official summary"), english]
    : [element("h3", "Official summary"), english, element("h3", "Résumé officiel"), french];
  const comments = (row.comments_en || row.comments_fr || "").trim();
  if (comments) blocks.push(element("h3", "Dataset comment"), element("p", comments));
  if (row.umd_number) blocks.push(element("p", `Dataset reference: ${row.umd_number}`, "muted"));
  $("record-text").replaceChildren(...blocks);
  const showDraft = action => { $("record-dialog").close(); action(); };
  $("record-actions").replaceChildren(
    button("Draft a follow-up", () => showDraft(() => startDraft(row)), hasRelease(row) ? "secondary" : "primary"),
    renderSaveButton(row),
    button("Copy citation", () => copyCitation(row)),
    button("Copy explorer link", async () => {
      const url = new URL(location.href);
      url.hash = new URLSearchParams({ q: row.request_number, institution: row.owner_org, year: row.year, record: recordKey(row) }).toString();
      try { await navigator.clipboard.writeText(url.href); $("record-status").textContent = "Explorer link copied."; }
      catch { $("record-status").textContent = url.href; }
    })
  );
  if (hasRelease(row)) {
    $("record-actions").prepend(button("Request a copy", () => showDraft(() => draftExisting(draftRecord(row))), "primary"));
  } else {
    $("record-actions").append(officialLink("Check the government listing ↗", govSearchUrl(row.request_number)));
  }
  $("record-dialog").showModal();
}

function renderSuggestions(extra = []) {
  const current = query.value.trim().toLowerCase().replaceAll('"', "");
  const topic = topics.find(([test]) => test.test(current));
  const candidates = current ? [...(topic?.[1] || []), ...extra] : starterSearches;
  const options = [...new Map(candidates.map(item => [item.toLowerCase(), item])).values()]
    .filter(item => item.toLowerCase() !== current).slice(0, 7);
  $("suggestions").replaceChildren();
  if (!options.length) return;
  $("suggestions").append(element("span", current ? "Try also" : "Try a search", "suggest-label"));
  for (const option of options) {
    $("suggestions").append(button(option, () => {
      query.value = option;
      query.focus();
      scheduleSearch();
    }, "chip"));
  }
}

function renderResults() {
  const items = showingSaved ? [...saved].reverse() : results.rows;
  $("export-summaries").disabled = !items.length;
  $("export-summaries").textContent = showingSaved ? "Export saved summaries CSV" : "Export this page CSV";
  $("result-kicker").textContent = showingSaved ? "RESEARCH SHORTLIST" : "COMPLETED REQUESTS";
  $("result-title").textContent = showingSaved ? "Saved records" : (query.value.trim() ? "Search results" : "Browse the archive");
  $("sort-label").hidden = showingSaved;
  const facets = $("institution-facets");
  facets.replaceChildren();
  if (!showingSaved && query.value.trim() && !$("institution").value && results.facets?.institutions?.length) {
    facets.append(element("span", "Matching institutions", "suggest-label"));
    for (const [slug, count] of results.facets.institutions.slice(0, 6)) {
      const title = institutionTitles.get(slug) || slug;
      facets.append(button(`${title} (${number.format(count)})`, () => {
        $("institution").value = slug;
        scheduleSearch();
      }, "chip"));
    }
  }
  if (showingSaved) {
    $("count").textContent = `${number.format(items.length)} saved in this browser`;
  } else {
    const total = number.format(results.total);
    $("count").textContent = `${total} ${results.total === 1 ? "match" : "matches"}${results.ms == null ? "" : ` · ${Math.round(results.ms)} ms search`}`;
  }
  const fragment = document.createDocumentFragment();
  for (const row of items) fragment.append(renderRecord(row));
  if (!items.length) {
    const empty = element("div", undefined, "empty");
    if (showingSaved) {
      empty.append(element("h3", "Start a shortlist"), element("p", "Save a result to keep its summary and request number here."), button("Back to search", () => setSavedView(false), "secondary"));
    } else {
      empty.append(element("h3", "No matches in this snapshot"));
      empty.append(element("p", "Try a shorter phrase, an alternate spelling, a French term, or fewer filters. If you still need the records, use your search as the starting point for a new request."));
      empty.append(button("Draft a request from this search", () => startDraft(), "primary"), " ", officialLink("Check the live portal ↗", govSearchUrl(query.value.trim())));
    }
    fragment.append(empty);
  }
  $("result-list").replaceChildren(fragment);
  const pages = Math.ceil(results.total / pageSize);
  $("pagination").hidden = showingSaved || pages < 2;
  $("page-info").textContent = `Page ${number.format(page)} of ${number.format(pages)}`;
  $("previous").disabled = page <= 1;
  $("next").disabled = page >= pages;
}

function setSavedView(value) {
  showingSaved = value;
  updateSavedCount();
  if (showingSaved || hasLoaded) renderResults();
  if (!showingSaved) scheduleSearch();
}

function serializeSearch() {
  const params = new URLSearchParams();
  if (query.value.trim()) params.set("q", query.value.trim());
  for (const id of [...filterIds, "sort"]) {
    if ($(id).value && $(id).value !== "relevance") params.set(id, $(id).value);
  }
  const hash = params.toString();
  history.replaceState(null, "", hash ? `#${hash}` : location.pathname + location.search);
}

function sendSearch() {
  if (showingSaved || !worker) return;
  const filters = Object.fromEntries(filterIds.map(id => [id, $(id).value]));
  if (filters.fromYear && filters.toYear && Number(filters.fromYear) > Number(filters.toYear)) {
    results = { rows: [], total: 0, suggestions: [] };
    renderResults();
    $("count").textContent = "Choose a start year that is no later than the end year.";
    $("result-list").replaceChildren();
    return;
  }
  $("count").textContent = hasLoaded ? "Searching…" : "Loading the searchable snapshot…";
  worker.postMessage({ type: "search", id: ++latestRequest, query: query.value.trim(), filters, sort: $("sort").value, page, limit: pageSize });
}

function scheduleSearch(keepPage = false) {
  clearTimeout(timer);
  if (!keepPage) page = 1;
  showingSaved = false;
  updateSavedCount();
  $("clear-query").hidden = !query.value;
  $("reset-filters").hidden = filterIds.every(id => !$(id).value);
  ++latestRequest;
  serializeSearch();
  timer = setTimeout(sendSearch, 65);
}

function option(select, value, label) {
  select.append(new Option(label, value));
}

function configure(meta) {
  snapshotDate = meta.generatedAtUtc || '';
  $("dataset-count").textContent = number.format(meta.total);
  const distinct = new Map();
  for (const item of meta.institutions) if (!distinct.has(item[0])) distinct.set(item[0], item);
  $("dataset-orgs").textContent = number.format(distinct.size);
  $("dataset-dates").textContent = `Completion years ${meta.minYear}–${meta.maxYear}`;
  const generated = $("dataset-generated");
  generated.hidden = !meta.generatedAtUtc;
  if (meta.generatedAtUtc) generated.textContent = `Snapshot generated ${meta.generatedAtUtc.slice(0, 10)} UTC`;
  const institutions = [...distinct.values()].sort((a, b) => a[1].localeCompare(b[1], "en-CA"));
  institutionTitles = new Map(institutions.map(([slug, title]) => [slug, title]));
  for (const [slug, title] of institutions) option($("institution"), slug, title);
  for (let year = meta.maxYear; year >= meta.minYear; year--) {
    for (const id of ["year", "fromYear", "toYear"]) option($(id), year, year);
  }
  for (const code of meta.dispositions) option($("disposition"), code, outcomes[code] || code);
  for (const id of [...filterIds, "sort"]) {
    const item = initialFilters.get(id);
    if (item && [...$(id).options].some(o => o.value === item)) $(id).value = item;
  }
  if (filterIds.slice(-3).some(id => $(id).value)) document.querySelector(".advanced-filters").open = true;
  initialFilters = new URLSearchParams();
  $("reset-filters").hidden = filterIds.every(id => !$(id).value);
  sendSearch();
}

function searchError(message) {
  $("count").textContent = "Search index unavailable";
  $("pagination").hidden = true;
  const panel = element("div", undefined, "empty");
  panel.append(element("h3", "Couldn’t load the search"), element("p", message || "The snapshot could not be read."), button("Retry", () => location.reload(), "primary"), " ", officialLink("Open government search ↗", govSearchUrl(query.value.trim())));
  $("result-list").replaceChildren(panel);
}

query.value = (initialFilters.get("q") || "").slice(0, 240);
$("clear-query").hidden = !query.value;
query.addEventListener("input", () => { pendingRecord = null; scheduleSearch(); });
$("search-form").addEventListener("submit", event => { event.preventDefault(); scheduleSearch(); });
$("clear-query").addEventListener("click", () => { query.value = ""; query.focus(); scheduleSearch(); });
for (const id of [...filterIds, "sort"]) $(id).addEventListener("change", () => scheduleSearch());
$("reset-filters").addEventListener("click", () => { for (const id of filterIds) $(id).value = ""; scheduleSearch(); });
$("draft").addEventListener("click", () => startDraft());
$("side-draft").addEventListener("click", () => startDraft());
$("saved").addEventListener("click", () => setSavedView(!showingSaved));
$("previous").addEventListener("click", () => { if (page > 1) { page--; scheduleSearch(true); $("result-title").focus(); } });
$("next").addEventListener("click", () => { if (page * pageSize < results.total) { page++; scheduleSearch(true); $("result-title").focus(); } });
$("record-dialog").addEventListener("close", () => { activeRecord = null; });
$("export-summaries").addEventListener("click", () => {
  const rows = showingSaved ? [...saved].reverse() : results.rows;
  if (!rows.length) return;
  const href = URL.createObjectURL(new Blob([summariesCSV(rows, snapshotDate)], {type:'text/csv;charset=utf-8'}));
  Object.assign(document.createElement('a'), {href,download:showingSaved ? 'atip-saved-summaries.csv' : 'atip-results-page-' + page + '.csv'}).click();
  setTimeout(() => URL.revokeObjectURL(href), 1000);
});
updateSavedCount();
renderSuggestions();

try {
  worker = new Worker(new URL("./search-worker.js", import.meta.url), { type: "module" });
  worker.addEventListener("error", () => searchError("The browser could not start the search worker."));
  worker.addEventListener("message", ({ data }) => {
    if (data.type === "ready") configure(data.meta);
    if (data.type === "progress" && !hasLoaded && !showingSaved) {
      $("count").textContent = `Preparing search · ${number.format(data.loaded)} of ${number.format(data.total)} summaries loaded`;
    }
    if (data.type === "error" && (data.id == null || data.id === latestRequest)) searchError(data.message);
    if (data.type === "results" && data.id === latestRequest) {
      hasLoaded = true;
      results = data;
      renderSuggestions(data.suggestions);
      if (!showingSaved) renderResults();
      if (pendingRecord && !activeRecord) {
        const row = results.rows.find(item => recordKey(item) === pendingRecord);
        pendingRecord = null;
        if (row) openRecord(row);
      }
    }
  });
} catch {
  searchError("This browser could not start the local search index.");
}
