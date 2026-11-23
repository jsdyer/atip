const fields = ['owner_org_title','request_number','year','month','disposition','pages','summary_en','summary_fr'];
export function summariesCSV(records, snapshot = '') {
  const cell = value => {
    let text = String(value ?? '');
    if (/^[\s]*[=+@\-]/.test(text)) text = "'" + text;
    return '"' + text.replaceAll('"', '""') + '"';
  };
  const rows = [['Institution','Request number','Completion year','Completion month','Outcome code','Pages','English summary','French summary','Official record','Snapshot UTC'],
    ...records.map(row => [...fields.map(key => row[key]), 'https://search.open.canada.ca/ati/record/' +
      [row.owner_org,row.year,row.month,row.request_number].map(encodeURIComponent).join(','), snapshot])];
  return '\uFEFF' + rows.map(row => row.map(cell).join(',')).join('\r\n') + '\r\n';
}
