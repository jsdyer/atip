import test from 'node:test';
import assert from 'node:assert/strict';
import {summariesCSV} from '../web/export.mjs';
test('exports bilingual records, completion month, provenance and safe spreadsheet text', () => {
  const csv = summariesCSV([{owner_org:'fin',owner_org_title:'Finance',request_number:'A-2026-1',year:2026,month:11,summary_en:'A "quote", then\na line',summary_fr:'=SUM(A1)',pages:0}], '2026-11-23T00:00:00Z');
  assert.ok(csv.includes('A ""quote"", then\na line'));
  assert.ok(csv.includes('"\'=SUM(A1)"'));
  assert.ok(csv.includes('/fin,2026,11,A-2026-1'));
  assert.ok(csv.includes('"0"'));
  assert.ok(csv.includes('2026-11-23T00:00:00Z'));
});
