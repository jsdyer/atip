"use strict";

// All data stays inside this worker. The page receives the current result page only.
const dataRoot = new URL("data/", self.location.href);
let metadata;
let records;
let institutions;
let latestRequest;
let initializationError;
let lastSearch;
let wordPrefixes;
let prefixCursor = 0;
const prefixWords = 16;

const stopWords = new Set(
  "about access according across after agency also any applicable associated based before between briefing canada canadian copy copies correspondence documents during following from government include including information material minister month notes office other period please provide records related regarding report reports request requested requests response since subject submitted that their them these through were which with within would years une des les pour dans sur tous toutes toute dossier dossiers demande documents ainsi canada concernant relatif relatives depuis entre".split(" ")
);
const topics = [
  ["Shag Harbour", "Shag Harbor", "Shag Harbour incident", "unidentified flying object", "UAP", "OVNI", "aircraft crash"],
  ["Real-Time Rail", "RTR", "Payments Canada", "ISO 20022", "settlement", "payment modernization"],
  ["interchange fees", "card acceptance", "Visa Mastercard", "credit card fees", "merchant fees", "frais d'interchange"],
  ["boomerang routing", "internet routing", "internet exchange", "data sovereignty", "network infrastructure"],
  ["data breach", "privacy incident", "cyber incident", "ransomware", "breach notification", "atteinte à la vie privée"],
  ["abandoned railway", "rail corridor", "railway abandonment", "rail trail", "railway right of way"],
  ["ghost town", "abandoned mine", "mine remediation", "contaminated site", "decommissioning"],
  ["briefing note", "decision memo", "memorandum", "meeting minutes", "note d'information"],
  ["web archive", "website retention", "digital preservation", "archival transfer", "Library and Archives Canada"],
];

function normalize(value) {
  return String(value ?? "").normalize("NFD").replace(/\p{M}/gu, "").toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

function searchable(value) {
  const text = normalize(value);
  return text ? ` ${text} ` : "";
}

function parseQuery(query) {
  const terms = [];
  const chunks = [...query.matchAll(/(-?)"([^"]*)"?(?=\s|$)|(-?)([^\s"]+)/g)];
  for (const [offset, chunk] of chunks.entries()) {
    const quoted = chunk[1] !== undefined;
    const excluded = Boolean(quoted ? chunk[1] : chunk[3]);
    const text = normalize(quoted ? chunk[2] : chunk[4]);
    if (!text) continue;

    const parts = quoted ? [text] : text.split(" ");
    parts.forEach((term, index) => {
      const prefix = !excluded && !quoted && offset === chunks.length - 1 &&
        index === parts.length - 1 && !/\s$/.test(query);
      terms.push({ text: term, exact: ` ${term} `, start: ` ${term}`, excluded, prefix });
    });
  }
  return terms;
}

function termIn(text, term) {
  return Boolean(text && text.includes(term.prefix ? term.start : term.exact));
}

// A 512-bit prefilter per row screens out most rows before the exact text check.
// Bits are assigned by the first three characters of each word. Collisions only
// make the subsequent text check necessary, so the filter cannot invent matches.
function prefixHash(text, offset) {
  return (text.charCodeAt(offset) * 163 + text.charCodeAt(offset + 1) * 43 +
    text.charCodeAt(offset + 2)) & (prefixWords * 32 - 1);
}

function markPrefixes(text, array, base) {
  for (let word = 1; word + 2 < text.length; ) {
    const bit = prefixHash(text, word);
    array[base + (bit >> 5)] |= 1 << (bit & 31);
    word = text.indexOf(" ", word) + 1;
    if (!word) break;
  }
}

function searchableRecord(row) {
  const institution = institutions[row[0]];
  const prefixBase = prefixCursor;
  prefixCursor += prefixWords;
  wordPrefixes.set(institution.prefixes, prefixBase);
  const record = {
    row,
    institution,
    prefixBase,
    year: Math.trunc(row[1] / 100),
    english: searchable(row[3]),
    french: searchable(row[4]),
    extraEn: searchable(row[8]),
    extraFr: searchable(row[9]),
    number: searchable(row[2]),
  };
  for (const text of [record.english, record.french, record.extraEn, record.extraFr, record.number]) {
    markPrefixes(text, wordPrefixes, prefixBase);
  }
  return record;
}

async function loadShard(shard) {
  const response = await fetch(new URL(shard.file, dataRoot));
  if (!response.ok) throw new Error(`Data asset ${shard.file} returned HTTP ${response.status}.`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  const isGzip = bytes[0] === 31 && bytes[1] === 139;
  let rows;
  if (isGzip) {
    if (typeof DecompressionStream !== "function") {
      throw new Error("Use a current version of Chrome, Edge, Firefox or Safari to load the compressed data.");
    }
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
    rows = await new Response(stream).json();
  } else {
    rows = JSON.parse(new TextDecoder().decode(bytes));
  }
  if (!Array.isArray(rows) || rows.length !== shard.records) {
    throw new Error(`Data asset ${shard.file} did not match the manifest.`);
  }
  return rows.map(searchableRecord);
}

function resultRow(record) {
  const [institution, date, requestNumber, summaryEn, summaryFr, disposition, pages, umd, commentsEn, commentsFr] = record.row;
  const org = metadata.institutions[institution];
  return {
    year: record.year,
    month: date % 100,
    request_number: requestNumber,
    summary_en: summaryEn,
    summary_fr: summaryFr,
    disposition,
    pages,
    comments_en: commentsEn || "",
    comments_fr: commentsFr || "",
    umd_number: umd,
    owner_org: org[0],
    owner_org_title: org[3],
  };
}

function compareNewest(a, b) {
  return b.row[1] - a.row[1] || Number(a.row[2] > b.row[2]) - Number(a.row[2] < b.row[2]);
}

function validFilter(value) {
  return value !== undefined && value !== null && value !== "" && value !== "all";
}

function search(message) {
  const { id, filters = {}, sort = "relevance" } = message;
  const query = String(message.query || "").slice(0, 500).trimStart();
  const limit = Math.min(100, Math.max(1, Math.trunc(Number(message.limit) || 24)));
  const page = Math.max(1, Math.trunc(Number(message.page) || 1));
  const started = performance.now();
  const key = JSON.stringify([query, filters, sort]);
  if (lastSearch?.key !== key) {
    lastSearch = findMatches(query, filters, sort, key);
  }
  const { matches, suggestions, facets } = lastSearch;
  const current = matches.slice((page - 1) * limit, page * limit);
  self.postMessage({
    type: "results", id, total: matches.length, page, limit,
    rows: current.map(match => resultRow(match.record)), suggestions, facets,
    ms: Math.round(performance.now() - started),
  });
}

function findMatches(query, filters, sort, key) {
  const terms = parseQuery(query);
  const positive = terms.filter(term => !term.excluded);
  const requiredPrefixes = positive.filter(term => term.text.length >= 3).map(term => {
    const bit = prefixHash(term.text, 0);
    return [bit >> 5, 1 << (bit & 31)];
  });
  const phrase = positive.map(term => term.text).join(" ");
  const exactPhrase = ` ${phrase} `;
  const prefixPhrase = ` ${phrase}`;
  const fromYear = validFilter(filters.fromYear) ? Number(filters.fromYear) : metadata.minYear;
  const toYear = validFilter(filters.toYear) ? Number(filters.toYear) : metadata.maxYear;
  const year = validFilter(filters.year) ? Number(filters.year) : null;
  const institution = validFilter(filters.institution) ? String(filters.institution) : null;
  const disposition = validFilter(filters.disposition) ? String(filters.disposition) : null;
  const language = filters.language;
  const useEn = language !== "fr";
  const useFr = language !== "en";
  const matches = [];
  const institutionCounts = new Map();

  documents: for (const record of records) {
    const row = record.row;
    if (record.year < fromYear || record.year > toYear || (year !== null && record.year !== year)) continue;
    if (institution && record.institution.slug !== institution) continue;
    if (disposition && row[5] !== disposition) continue;
    if (filters.releasedOnly && row[5] !== "DA" && row[5] !== "DP") continue;
    for (const [word, mask] of requiredPrefixes) {
      if (!(wordPrefixes[record.prefixBase + word] & mask)) continue documents;
    }

    const english = useEn ? record.english : "";
    const french = useFr ? record.french : "";
    const institutionName = language === "fr" ? record.institution.french :
      language === "en" ? record.institution.english : record.institution.both;
    let included = true;
    let score = 0;

    for (const term of terms) {
      const inEnglish = termIn(english, term);
      const inFrench = termIn(french, term);
      const inSummary = inEnglish || inFrench;
      const matched = inSummary || termIn(record.number, term) || termIn(institutionName, term) ||
        (useEn && termIn(record.extraEn, term)) || (useFr && termIn(record.extraFr, term));
      if (matched === term.excluded) {
        included = false;
        break;
      }
      if (!term.excluded && inSummary) score += 3;
    }
    if (!included) continue;

    if (phrase && sort === "relevance") {
      if (record.number === exactPhrase) score += 200;
      if (english.includes(exactPhrase) || french.includes(exactPhrase)) score += 40;
      else if (english.includes(prefixPhrase) || french.includes(prefixPhrase)) score += 18;
      if (row[5] === "DA" || row[5] === "DP") score += 2;
      if (Number(row[6]) > 0) score++;
    }

    matches.push({ record, score });
    const slug = record.institution.slug;
    institutionCounts.set(slug, (institutionCounts.get(slug) || 0) + 1);
  }

  if (sort === "pages") {
    matches.sort((a, b) => (Number(b.record.row[6]) || 0) - (Number(a.record.row[6]) || 0) ||
      compareNewest(a.record, b.record));
  } else if (sort === "relevance" && positive.length) {
    // The underlying collection is already date sorted for equal relevance.
    matches.sort((a, b) => b.score - a.score);
  }

  return {
    key, matches, suggestions: relatedSearches(query, positive, matches, language),
    facets: { institutions: [...institutionCounts.entries()].sort((a, b) => b[1] - a[1]) },
  };
}

function relatedSearches(query, positive, matches, language) {
  const base = normalize(positive.map(term => term.text).join(" "));
  if (!base) return ["Shag Harbour", "Real-Time Rail", "interchange fees", "data breach", "abandoned railway"];

  const suggestions = [];
  const seen = new Set([normalize(query), base]);
  const add = option => {
    const key = normalize(option);
    if (key && !seen.has(key)) {
      seen.add(key);
      suggestions.push(option);
    }
  };

  for (const group of topics) {
    const isRelated = group.some(option => {
      const keyword = normalize(option);
      return base === keyword || (base.length >= 3 && keyword.startsWith(base)) ||
        (keyword.length > 2 && ` ${base} `.includes(` ${keyword} `));
    });
    if (isRelated) group.forEach(add);
  }

  if (!matches.length) {
    if (positive.length > 1) add(positive.slice(0, -1).map(term => term.text).join(" "));
    if (positive.length === 1 && positive[0].text.includes(" ")) {
      positive[0].text.split(" ").filter(term => term.length > 3).forEach(add);
    }
    return suggestions.slice(0, 8);
  }

  const frequencies = new Map();
  const existing = base.split(" ");
  for (const { record } of matches.slice(0, 20)) {
    const text = language === "fr" ? record.french : record.english;
    const words = new Set(text.trim().split(" "));
    for (const word of words) {
      if (word.length < 5 || !/^\p{L}+$/u.test(word) || stopWords.has(word) ||
          existing.some(term => word.startsWith(term) || term.startsWith(word))) continue;
      frequencies.set(word, (frequencies.get(word) || 0) + 1);
    }
  }
  for (const [word, count] of [...frequencies.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4)) {
    if (count > 1) add(`${base} ${word}`);
  }
  return suggestions.slice(0, 8);
}

async function initialize() {
  const manifest = await fetch(new URL("manifest.json", dataRoot));
  if (!manifest.ok) throw new Error(`Data manifest returned HTTP ${manifest.status}.`);
  metadata = await manifest.json();
  if (metadata.schema !== 1 || !Array.isArray(metadata.shards)) throw new Error("Unsupported data manifest.");

  wordPrefixes = new Uint32Array(metadata.total * prefixWords);
  institutions = metadata.institutions.map(([slug, english, french]) => {
    const prefixMatches = new Uint32Array(prefixWords);
    const both = searchable(`${slug} ${english} ${french}`);
    markPrefixes(both, prefixMatches, 0);
    const frenchText = searchable(`${slug} ${french}`);
    markPrefixes(frenchText, prefixMatches, 0);
    const englishText = searchable(`${slug} ${english}`);
    markPrefixes(englishText, prefixMatches, 0);
    return { slug, english: englishText, french: frenchText, both, prefixes: prefixMatches };
  });
  self.postMessage({ type: "ready", meta: metadata });

  const chunks = new Array(metadata.shards.length);
  let nextShard = 0;
  let loaded = 0;
  const load = async () => {
    while (nextShard < chunks.length) {
      const index = nextShard++;
      chunks[index] = await loadShard(metadata.shards[index]);
      loaded += chunks[index].length;
      self.postMessage({ type: "progress", loaded, total: metadata.total });
    }
  };
  await Promise.all(Array.from({ length: Math.min(4, chunks.length) }, load));
  if (loaded !== metadata.total) throw new Error("The loaded record count did not match the manifest.");
  records = chunks.flat().sort(compareNewest);
  if (latestRequest) {
    const pending = latestRequest;
    latestRequest = undefined;
    reply(pending);
  }
}

function reply(message) {
  try {
    search(message);
  } catch (error) {
    self.postMessage({ type: "error", id: message.id, message: error.message });
  }
}

self.onmessage = ({ data }) => {
  if (data?.type !== "search") return;
  if (initializationError) {
    self.postMessage({ type: "error", id: data.id, message: initializationError });
  } else if (!records) {
    latestRequest = data;
  } else {
    reply(data);
  }
};

initialize().catch(error => {
  initializationError = error.message;
  self.postMessage({ type: "error", message: error.message });
});
