const FORMAL_PORTAL = "https://www.canada.ca/en/treasury-board-secretariat/services/access-information-privacy/access-information/request-information/make-request.html";
const COMPLETED_PORTAL = "https://search.open.canada.ca/ati/";
const COORDINATORS = "https://www.tbs-sct.canada.ca/ap/atip-aiprp/coord-eng.asp";

const styles = `
  .draft-dialog {
    width: min(58rem, calc(100% - 1.5rem));
    max-height: calc(100% - 1.5rem);
    padding: 0;
    border: 1px solid var(--line, #d9d4c9);
    border-radius: 14px;
    background: var(--panel, #fffdf7);
    color: var(--ink, #242c31);
    box-shadow: 0 24px 80px #25232045;
    font: inherit;
  }
  .draft-dialog::backdrop { background: #20272dbb; }
  .draft-dialog *, .draft-dialog *::before, .draft-dialog *::after { box-sizing: border-box; }
  .draft-dialog h2, .draft-dialog h3, .draft-dialog p { margin: 0; }
  .draft-dialog h2 { font-size: clamp(1.3rem, 3vw, 1.7rem); }
  .draft-dialog h3 { font-size: 1rem; }
  .draft-head, .draft-body { padding: clamp(1rem, 3vw, 1.6rem); }
  .draft-head { display: flex; align-items: start; justify-content: space-between; gap: 1rem; border-bottom: 1px solid var(--line, #d9d4c9); }
  .draft-head p { margin-top: .25rem; }
  .draft-body, .draft-fields, .draft-preview, .draft-field { display: grid; gap: .85rem; }
  .draft-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 1.4rem; align-items: start; }
  .draft-field { gap: .25rem; }
  .draft-field span, .draft-label { font-size: .84rem; font-weight: 700; }
  .draft-dates { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: .6rem; padding: 0; border: 0; margin: 0; }
  .draft-dates legend { padding: 0; margin-bottom: .25rem; }
  .draft-field input, .draft-field textarea, .draft-copy {
    display: block;
    width: 100%;
    min-width: 0;
    color: inherit;
    background: var(--panel, #fffdf7);
    border: 1px solid var(--line, #d9d4c9);
    border-radius: 6px;
    padding: .56rem .65rem;
    font: inherit;
    line-height: 1.4;
  }
  .draft-field textarea, .draft-copy { resize: vertical; }
  .draft-copy {
    min-height: 13rem;
    background: var(--paper, #f5f2e9);
    white-space: pre-wrap;
  }
  .draft-note, .draft-status { font-size: .84rem; color: var(--muted, #55616a); line-height: 1.5; }
  .draft-reference { padding: .65rem .85rem; border-left: 2px solid var(--accent, #9a392d); background: var(--paper, #f5f2e9); overflow-wrap: anywhere; }
  .draft-dialog button, .draft-dialog .draft-link {
    border: 1px solid var(--line, #d9d4c9);
    background: var(--panel, #fffdf7);
    color: inherit;
    border-radius: 6px;
    padding: .48rem .75rem;
    font: inherit;
    font-size: .86rem;
    line-height: 1.35;
    font-weight: 650;
    cursor: pointer;
    text-decoration: none;
  }
  .draft-dialog button:disabled { opacity: .55; cursor: default; }
  .draft-dialog .draft-primary { background: var(--accent, #9a392d); border-color: var(--accent, #9a392d); color: white; }
  .draft-dialog .draft-close { padding: .3rem .6rem; font-size: 1.15rem; }
  .draft-actions { display: flex; align-items: center; flex-wrap: wrap; gap: .5rem; }
  .draft-dialog :focus-visible { outline: 2px solid var(--accent, #9a392d); outline-offset: 2px; }
  @media (max-width: 680px) { .draft-grid { grid-template-columns: minmax(0, 1fr); } }
`;

let dialog;

function makeDialog() {
  const style = document.createElement("style");
  style.textContent = styles;
  document.head.append(style);
  const element = document.createElement("dialog");
  element.className = "draft-dialog";
  element.setAttribute("aria-labelledby", "draft-heading");
  element.setAttribute("aria-describedby", "draft-description");
  element.innerHTML = `
    <header class="draft-head">
      <div><h2 id="draft-heading"></h2><p id="draft-description" class="draft-note"></p></div>
      <button type="button" class="draft-close" aria-label="Close request dialog">×</button>
    </header>
    <div class="draft-body"></div>
  `;
  element.querySelector(".draft-close").addEventListener("click", () => element.close());
  document.body.append(element);
  return element;
}

function showDialog(title, description, content) {
  dialog ??= makeDialog();
  dialog.querySelector("h2").textContent = title;
  dialog.querySelector("#draft-description").textContent = description;
  const body = dialog.querySelector(".draft-body");
  body.innerHTML = content;
  return body;
}

function openDialog() {
  if (!dialog.open) dialog.showModal();
  dialog.querySelector("[data-focus]")?.focus();
}

function referenceLabel(reference) {
  if (typeof reference === "string") return reference.trim();
  if (!reference) return "";
  const number = reference.number || reference.requestNumber || reference.id;
  const date = reference.year
    ? [reference.year, reference.month ? String(reference.month).padStart(2, "0") : ""].filter(Boolean).join("-")
    : "";
  return [reference.org || reference.organization, number, date].filter(Boolean).join(" · ");
}

function controls(body, filename) {
  const preview = body.querySelector(".draft-copy");
  const status = body.querySelector(".draft-status");
  const copy = body.querySelector("[data-copy]");
  const save = body.querySelector("[data-save]");
  copy.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(preview.value);
      status.textContent = "Draft copied.";
    } catch {
      preview.focus();
      preview.select();
      status.textContent = "Draft selected. Use your device’s copy command.";
    }
  });
  save.addEventListener("click", () => {
    const url = URL.createObjectURL(new Blob([preview.value + "\n"], { type: "text/plain;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  return (text, feedback = "") => {
    preview.value = text;
    copy.disabled = save.disabled = !text;
    status.textContent = feedback;
  };
}

function previewMarkup() {
  return `
    <div class="draft-preview">
      <label class="draft-label" for="draft-copy">Request text</label>
      <textarea class="draft-copy" id="draft-copy" rows="10" readonly></textarea>
      <div class="draft-actions">
        <button type="button" data-copy class="draft-primary">Copy text</button>
        <button type="button" data-save>Download TXT</button>
      </div>
      <p class="draft-status" role="status"></p>
    </div>
  `;
}

export function openDraft({ topic = "", organization = "", reference = "" } = {}) {
  const body = showDialog(
    "Draft a new ATIP request",
    "Describe the records you want. Review and copy the draft into the federal ATIP portal.",
    `
      <p class="draft-reference draft-note" hidden></p>
      <div class="draft-grid">
        <div class="draft-fields">
          <label class="draft-field"><span>Topic</span><input name="topic" maxlength="250" placeholder="e.g. Shag Harbour incident records" data-focus></label>
          <label class="draft-field"><span>Federal institution</span><input name="organization" maxlength="250" placeholder="e.g. Library and Archives Canada"></label>
          <fieldset class="draft-dates">
            <legend class="draft-label">Dates covered by the records</legend>
            <label class="draft-field"><span>From</span><input name="start" type="date"></label>
            <label class="draft-field"><span>To</span><input name="end" type="date"></label>
          </fieldset>
          <label class="draft-field"><span>Record types</span><textarea name="types" rows="2" maxlength="600" placeholder="e.g. incident reports, briefing notes, email and attachments"></textarea></label>
          <label class="draft-field"><span>Context or search terms</span><textarea name="context" rows="2" maxlength="800" placeholder="Other spellings, file numbers, offices or people to help locate records"></textarea></label>
          <label class="draft-field"><span>Exclude from scope (optional)</span><input name="exclusions" maxlength="350" placeholder="e.g. duplicate copies"></label>
        </div>
        ${previewMarkup()}
      </div>
      <div class="draft-actions"><a class="draft-link" href="${FORMAL_PORTAL}" target="_blank" rel="noopener noreferrer">Open federal ATIP instructions ↗</a></div>
      <p class="draft-note">Choose an institution that may hold the records. A formal federal access request normally costs $5.</p>
    `
  );
  const fields = Object.fromEntries(Array.from(body.querySelectorAll("[name]"), (element) => [element.name, element]));
  fields.topic.value = topic;
  fields.organization.value = organization;
  const related = referenceLabel(reference);
  if (related) {
    const context = body.querySelector(".draft-reference");
    context.hidden = false;
    context.textContent = "Related completed request: " + related;
  }
  const update = controls(body, "atip-request-draft.txt");
  function refresh() {
    const values = Object.fromEntries(Object.entries(fields).map(([name, element]) => [name, element.value.trim()]));
    if (!values.topic) {
      update("", "Enter a topic to start your draft.");
      return;
    }
    if (values.start && values.end && values.start > values.end) {
      update("", "The end date must be on or after the start date.");
      return;
    }
    const lead = values.organization
      ? `Under the Access to Information Act, please provide records held by ${values.organization} concerning ${values.topic}.`
      : `Under the Access to Information Act, please provide records concerning ${values.topic}.`;
    const date = values.start && values.end
      ? `Records dated ${values.start} to ${values.end}, inclusive.`
      : values.start ? `Records dated on or after ${values.start}.`
        : values.end ? `Records dated on or before ${values.end}.` : "";
    const paragraphs = [
      lead, date,
      values.types && `Record types requested: ${values.types}`,
      values.context && `Context and search terms: ${values.context}`,
      related && `Related completed request for context: ${related}.`,
      values.exclusions && `Please exclude: ${values.exclusions}`,
      "Please provide responsive records electronically, with attachments where applicable. If any parts are exempt, please release the portions that can be disclosed.",
      "Please contact me if any part of the scope needs clarification.",
    ];
    update(paragraphs.filter(Boolean).join("\n\n"));
  }
  body.querySelector(".draft-fields").addEventListener("input", refresh);
  refresh();
  openDialog();
}

function officialRecordURL(value) {
  try {
    const url = new URL(value);
    return url.origin === "https://search.open.canada.ca" && url.pathname.startsWith("/ati/record/") ? url.href : "";
  } catch {
    return "";
  }
}

export function draftExisting(record) {
  const label = referenceLabel(record);
  const number = record.number || record.requestNumber || record.id || "";
  const url = officialRecordURL(record.url);
  const legacy = record.year && Number(record.year) < 2020;
  const body = showDialog(
    "Request the released records",
    "Ask for the package already released for this file. The informal request is free through the federal portal.",
    `
      <p class="draft-reference draft-note"></p>
      ${previewMarkup()}
      <div class="draft-actions">
        <a class="draft-link" target="_blank" rel="noopener noreferrer" data-portal data-focus></a>
        <a class="draft-link" href="${COORDINATORS}" target="_blank" rel="noopener noreferrer" data-directory>Find the institution’s ATIP office ↗</a>
      </div>
      <p class="draft-note" data-route></p>
    `
  );
  body.querySelector(".draft-reference").textContent = label || "Completed access to information request";
  const link = body.querySelector("[data-portal]");
  link.href = url || `${COMPLETED_PORTAL}?${new URLSearchParams({ search_text: number })}`;
  link.textContent = url ? "Check official record ↗" : "Find file on the federal portal ↗";
  if (legacy) {
    link.hidden = true;
    link.removeAttribute("data-focus");
    body.querySelector("[data-directory]").setAttribute("data-focus", "");
  }
  body.querySelector("[data-route]").textContent = legacy
    ? "The federal search portal primarily lists recent files. Contact the institution’s ATIP office with this file number to ask what remains available."
    : "Use the informal request form if available. For a missing record page or form, contact the institution’s ATIP office with this file number.";
  const lines = [
    "Hello,",
    `Please send me an electronic copy of the records previously released ${number ? `for access to information request ${number}` : "for the completed access to information request below"}.`,
    label && `File reference: ${label}`,
    "Thank you.",
  ];
  controls(body, "released-records-request.txt")(lines.filter(Boolean).join("\n\n"));
  openDialog();
}
