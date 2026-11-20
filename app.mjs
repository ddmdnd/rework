import {parseExcel} from './import.mjs';

const $ = id => document.getElementById(id);
const source = $('source');
const preview = $('preview');
const printArea = $('print-area');
const settings = ['paper','width','height','gap','margin'].map($);
const sheetSizes = {letter:[215.9,279.4],a4:[210,297]};
const sampleRows = [
  ['No Reprise','Date','No de projet','Réf','Mod','Dessinateur','# pièce','Qté','Raison','Détails','Matériaux','Emplacement demandé','Département'],
  ['10001','','12001','2','1','','ACC0201-0080','2','','PANIER A-13 / PORTER AU MUR','GALV 16 GA','R2 - Murs',''],
  ['10002','','12002','1','1','','WPA1701-0053','1','','REF36-37 / Panier A27','SST 316 16 GA (0.063)','Panier de Job','']
];
const sampleText = sampleRows.map(row => row.join('\t')).join('\n');
const sample = parseExcel(sampleText).results[0];
const number = new Intl.NumberFormat('en-CA');
let current = null;
let printSheets = null;
let logoURL = '';
let logoError = '';

function ticket(item) {
  const label = document.createElement('article');
  label.className = 'ticket';
  const fields = {
    job:[item.project,item.ref,item.mod].filter(Boolean).join(' - '),
    part:item.part.toUpperCase(), material:item.material, location:item.location,
    detail:item.detail, flag:'REPRISE', number:item.reprise
  };
  for (const [className,value] of Object.entries(fields)) {
    const node = document.createElement('div');
    node.className = className;
    node.textContent = value;
    label.append(node);
  }
  {
    const image = document.createElement('img');
    image.className = 'ticket-logo';
    image.alt = '';
    image.src = logoURL || './xnrgy.png';
    label.append(image);
  }
  return label;
}

function fit(label) {
  let fits = true;
  for (const node of label.querySelectorAll('div')) {
    let size = parseFloat(getComputedStyle(node).fontSize);
    const min = Math.min(size, 7.5);
    const overflows = () => node.scrollHeight > node.clientHeight + 1 || node.scrollWidth > node.clientWidth + 1;
    while (size > min && overflows()) {
      size = Math.max(min, size - .5);
      node.style.fontSize = size + 'px';
    }
    if (overflows()) fits = false;
  }
  return fits;
}

function layout() {
  const [paper,w,h,gap,margin] = settings;
  const sheet = sheetSizes[paper.value];
  $('sheet-options').hidden = !sheet;
  if ([w,h,...(sheet ? [gap,margin] : [])].some(input => !input.validity.valid || input.value === '')) {
    return {error:'Check the label size, margins and gap in Print settings.'};
  }
  const width = w.valueAsNumber, height = h.valueAsNumber;
  const spacing = sheet ? gap.valueAsNumber : 0;
  const padding = sheet ? margin.valueAsNumber : 0;
  const [pageWidth,pageHeight] = sheet || [width,height];
  const cols = Math.floor((pageWidth - 2 * padding + spacing + .00001) / (width + spacing));
  const rows = Math.floor((pageHeight - 2 * padding + spacing + .00001) / (height + spacing));
  if (cols < 1 || rows < 1) return {error:'The label does not fit on the selected sheet with these margins.'};
  return {width,height,spacing,padding,pageWidth,pageHeight,cols,rows};
}

function sheetNode(l) {
  const sheet = document.createElement('div');
  sheet.className = 'sheet';
  sheet.style.cssText = 'width:' + l.pageWidth + 'mm;max-height:' + l.pageHeight +
    'mm;padding:' + l.padding + 'mm;gap:' + l.spacing + 'mm;grid-template-columns:repeat(' +
    l.cols + ',' + l.width + 'mm);grid-auto-rows:' + l.height + 'mm';
  return sheet;
}

function showIssues(messages) {
  const box = $('issues');
  box.replaceChildren();
  box.hidden = !messages.length;
  if (!messages.length) return;
  const list = document.createElement('ul');
  for (const message of messages.slice(0,6)) {
    const li = document.createElement('li');
    li.textContent = message;
    list.append(li);
  }
  if (messages.length > 6) {
    const li = document.createElement('li');
    li.textContent = 'Additional messages: ' + (messages.length - 6);
    list.append(li);
  }
  box.append(list);
}

function render() {
  const l = layout();
  const valid = current && !current.errors.length;
  const data = valid ? current.results.filter(row => row.quantity > 0) : [];
  const total = valid ? current.total : 0;
  const messages = [...(current?.errors ?? [])];
  if (l.error) messages.push(l.error);
  if (logoError) messages.push(logoError);
  $('rows').textContent = number.format(new Set(current?.results.map(row => row.line)).size);
  $('total').textContent = number.format(total);
  $('preview-title').textContent = total ? 'PREVIEW' : 'SAMPLE LABEL';
  $('preview-note').textContent = total > 12 ?
    'Showing 12 of ' + number.format(total) + ' labels. All labels will print.' :
    total ? 'Check the label details and copy count before printing.' :
    'For a single part, Qté sets the default copy count. For a list, each part defaults to one copy.';
  preview.replaceChildren();
  printArea.replaceChildren();
  printSheets = null;
  $('print').disabled = true;
  if (l.error) {
    $('paper-note').textContent = l.error;
    $('dimensions').textContent = '—';
    showIssues(messages);
    return;
  }
  $('dimensions').textContent = l.width + ' × ' + l.height + ' mm';
  const perSheet = l.cols * l.rows;
  $('paper-note').textContent = $('paper').value === 'roll' ?
    'The default is 4 × 1 inches. Enter the actual size of your labels.' :
    l.cols + ' × ' + l.rows + ' grid · up to ' + perSheet + ' labels per sheet';
  document.documentElement.style.setProperty('--label-w', l.width + 'mm');
  document.documentElement.style.setProperty('--label-h', l.height + 'mm');
  $('page-style').textContent = '@page{size:' + l.pageWidth + 'mm ' + l.pageHeight + 'mm;margin:0}';

  const templates = data.map(item => {
    const label = ticket(item);
    printArea.append(label);
    return {item,label};
  });
  let hasOverflow = false;
  for (const {item,label} of templates) {
    if (!fit(label)) {
      messages.push('Row ' + item.line + '. The text does not fit. Increase the label size or shorten the text in Excel.');
      hasOverflow = true;
    }
  }
  printArea.replaceChildren();
  let shown = 0;
  for (const {item,label} of templates) {
    for (let i = 0; i < item.quantity && shown < 12; i++, shown++) {
      const copy = label.cloneNode(true);
      preview.append(copy);
      fit(copy);
    }
    if (shown === 12) break;
  }
  if (!total) {
    const label = ticket(sample);
    preview.append(label);
    fit(label);
  }
  if (total && !hasOverflow) {
    printSheets = {templates,l,perSheet};
    $('print').disabled = false;
  }
  messages.push(...(current?.notes ?? []));
  showIssues(messages);
}

function generate() {
  try {
    current = parseExcel(source.value);
  } catch (error) {
    current = {results:[],total:0,errors:[error.message],notes:[]};
  }
  render();
}

source.addEventListener('input', () => {
  $('clear').hidden = !source.value;
  if (current) {
    current = null;
    render();
  }
});
$('generate').addEventListener('click', generate);
$('clear').addEventListener('click', () => {
  source.value = '';
  current = null;
  $('clear').hidden = true;
  render();
  source.focus();
});
for (const setting of settings) setting.addEventListener('input', render);
$('logo').addEventListener('change', () => {
  const file = $('logo').files[0];
  if (!file) return;
  logoError = '';
  if (!['image/png','image/jpeg','image/webp'].includes(file.type)) {
    logoError = 'Choose a PNG, JPG or WebP logo file.';
    render();
    return;
  }
  const url = URL.createObjectURL(file);
  const image = new Image();
  image.src = url;
  image.decode().then(() => {
    if ($('logo').files[0] !== file) {
      URL.revokeObjectURL(url);
      return;
    }
    if (logoURL) URL.revokeObjectURL(logoURL);
    logoURL = url;
    $('remove-logo').hidden = false;
    render();
  }, () => {
    URL.revokeObjectURL(url);
    if ($('logo').files[0] === file) {
      logoError = 'Could not open the logo file.';
      render();
    }
  });
});
$('remove-logo').addEventListener('click', () => {
  URL.revokeObjectURL(logoURL);
  logoURL = logoError = $('logo').value = '';
  $('remove-logo').hidden = true;
  render();
});

$('print').addEventListener('click', () => {
  if (!printSheets) return;
  const {templates,l,perSheet} = printSheets;
  const pages = document.createDocumentFragment();
  let index = 0, sheet;
  for (const {item,label} of templates) {
    for (let i = 0; i < item.quantity; i++,index++) {
      if (index % perSheet === 0) {
        sheet = sheetNode(l);
        pages.append(sheet);
      }
      sheet.append(label.cloneNode(true));
    }
  }
  printArea.replaceChildren(pages);
  window.print();
});
window.addEventListener('afterprint', () => printArea.replaceChildren());
render();
