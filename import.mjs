const columns = {
  reprise: ['noreprise','numeroreprise','reprise'],
  project: ['nodeprojet','noprojet','nodeproje','numerodeprojet','projet'],
  ref: ['ref','reference'],
  mod: ['mod','module'],
  part: ['piece','nopiece','numerodepiece','nodepiece','numeropiece'],
  quantity: ['qte','quantite','qty','quantity'],
  detail: ['details','detail'],
  material: ['materiaux','materiau','matiere','materiel'],
  location: ['emplacementdemande','emplacementdema','emplacement']
};
const positions = {reprise:0,project:2,ref:3,mod:4,part:6,quantity:7,detail:9,material:10,location:11};

const normalize = value => value.toLowerCase().normalize('NFD').replace(/[^a-z0-9]/g,'');
const clean = value => (value ?? '').trim();
export const MAX_LABELS = 3000;

function splitTSV(text) {
  const rows = [];
  let row = [], cell = '', quoted = false, line = 1, rowLine = 1;
  text = text.replace(/^\uFEFF/,'').replace(/\r\n?/g,'\n');
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i+1] === '"') { cell += '"'; i++; }
      else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"' && cell === '' && text[i+1] !== undefined) {
      quoted = true;
    } else if (char === '\t' || char === '\n') {
      row.push(cell);
      cell = '';
      if (char === '\n') {
        rows.push({cells:row,line:rowLine});
        row = [];
        rowLine = line + 1;
      }
    } else {
      cell += char;
    }
    if (char === '\n') line++;
  }
  if (quoted) throw new Error('Check the quotation marks on line ' + rowLine + '.');
  row.push(cell);
  rows.push({cells:row,line:rowLine});
  return rows.filter(({cells}) => cells.some(value => clean(value)));
}

function parseParts(value) {
  const entries = value.split(/[,/;+\n]|\s+ET\s+/i);
  const parts = [];
  let prefix = '';
  for (const entry of entries) {
    const token = entry.trim().toUpperCase();
    const match = token.match(/^([A-Z0-9]+(?:-[A-Z0-9]+?)*?)(?:\s*(?:\(\s*(?:[X×]\s*(\d+)|(\d+)\s*[X×])\s*\)|[X×*]\s*(\d+)|(?:=\s*-?\s*|\s+)(\d+)\s*[X×]))?$/);
    if (!match) return entries.length === 1 ? [] : null;
    const [, code, ...counts] = match;
    const count = counts.find(count => count !== undefined);
    if (entries.length === 1 && count === undefined) return [];
    const quantity = count === undefined ? 1 : Number(count);
    if (!Number.isSafeInteger(quantity)) return null;
    let part = code;
    if (prefix && /^\d+$/.test(code)) {
      part = prefix + code;
    } else if (code.includes('-')) {
      prefix = code.slice(0, code.lastIndexOf('-') + 1);
    }
    parts.push({part, quantity});
  }
  return parts;
}

export function parseExcel(text) {
  const rows = splitTSV(text);
  if (!rows.length) throw new Error('Paste at least one row from Excel.');
  const first = rows[0].cells.map(normalize);
  const mapped = Object.fromEntries(Object.entries(columns).map(([key, aliases]) =>
    [key, first.findIndex(value => aliases.includes(value))]));
  const hasHeader = ['reprise','part','quantity'].filter(key => mapped[key] >= 0).length >= 2;
  if (hasHeader && ['reprise','part','quantity'].some(key => mapped[key] < 0)) {
    throw new Error('Column headers must include No Reprise, # pièce and Qté.');
  }
  const indexes = hasHeader ? mapped : positions;
  const results = [], errors = [], notes = [];
  for (const {cells,line} of rows.slice(hasHeader ? 1 : 0)) {
    if (!hasHeader && cells.length !== 12 && cells.length !== 13) {
      errors.push('Row ' + line + '. Copy the full range from No Reprise through Emplacement demandé or Département.');
      continue;
    }
    const item = Object.fromEntries(Object.entries(indexes).map(([key, index]) => [key, clean(cells[index])]));
    const parts = parseParts(item.part);
    if (!item.reprise || !item.part) {
      errors.push('Row ' + line + '. Fill in No Reprise and # pièce.');
      continue;
    }
    if (!parts) {
      errors.push('Row ' + line + '. Check the part numbers and copy counts in # pièce.');
      continue;
    }
    if (parts.length) {
      results.push(...parts.map(part => ({...item,...part,line})));
      continue;
    }
    const raw = item.quantity.replace(/[ \u00a0\u202f]/g,'');
    const quantity = Number(raw.replace(',','.'));
    if (!/^\d+(?:[.,]0+)?$/.test(raw) || !Number.isSafeInteger(quantity)) {
      errors.push('Row ' + line + '. Enter a whole number in Qté for a single part with no copy count.');
      continue;
    }
    if (!quantity) notes.push('Row ' + line + '. Qté is 0, so this row will produce no labels.');
    results.push({...item,quantity,line});
  }
  if (!results.length && !errors.length) errors.push('Add Excel rows below the column headers.');
  const total = results.reduce((sum, row) => sum + row.quantity, 0);
  if (total > MAX_LABELS) errors.push('Split the data into batches of up to ' + MAX_LABELS.toLocaleString('en-CA') + ' labels.');
  return {results,total,errors,notes};
}
