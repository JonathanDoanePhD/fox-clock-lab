'use strict';

const xmlText = value => String(value ?? '')
  .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/g, '')
  .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;');
const sheetNamespace = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const relationshipNamespace = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const xmlHeader = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const encoder = new TextEncoder();

const crcTable = Uint32Array.from({ length: 256 }, (_, number) => {
  let checksum = number;
  for (let bit = 0; bit < 8; bit++) {
    checksum = (checksum >>> 1) ^ ((checksum & 1) ? 0xedb88320 : 0);
  }
  return checksum;
});

function zipFiles(files) {
  const contents = [];
  const directory = [];
  let offset = 0;
  let directorySize = 0;
  for (const [path, xml] of files) {
    const name = encoder.encode(path);
    const data = encoder.encode(xml);
    let crc = 0xffffffff;
    for (const byte of data) crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 0xff];
    crc = (crc ^ 0xffffffff) >>> 0;
    const entry = new Uint8Array(30 + name.length);
    const local = new DataView(entry.buffer);
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(12, 33, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, data.length, true);
    local.setUint32(22, data.length, true);
    local.setUint16(26, name.length, true);
    entry.set(name, 30);
    contents.push(entry, data);

    const record = new Uint8Array(46 + name.length);
    const central = new DataView(record.buffer);
    central.setUint32(0, 0x02014b50, true);
    central.setUint16(4, 20, true);
    record.set(entry.subarray(4, 30), 6);
    central.setUint32(42, offset, true);
    record.set(name, 46);
    directory.push(record);
    directorySize += record.length;
    offset += entry.length + data.length;
  }
  const footer = new DataView(new ArrayBuffer(22));
  footer.setUint32(0, 0x06054b50, true);
  footer.setUint16(8, files.length, true);
  footer.setUint16(10, files.length, true);
  footer.setUint32(12, directorySize, true);
  footer.setUint32(16, offset, true);
  return new Blob([...contents, ...directory, footer.buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  });
}

function worksheet(rows) {
  const headings = ['Attempt', 'Time (UTC)', 'Initials', 'Clock size', 'Problem', 'Answer box', 'Answer entered', 'Expected modular answer', 'Result'];
  const widths = [11, 27, 12, 13, 21, 20, 18, 28, 17];
  const columns = widths.map((width, i) => '<col min="' + (i + 1) + '" max="' + (i + 1) + '" width="' + width + '" customWidth="1"/>').join('');
  const sheetRows = [headings, ...rows].map((row, i) => {
    const cells = row.map((value, column) => {
      const address = String.fromCharCode(65 + column) + (i + 1);
      return typeof value === 'number' ? '<c r="' + address + '"><v>' + value + '</v></c>' :
        '<c r="' + address + '" t="inlineStr"><is><t xml:space="preserve">' + xmlText(value) + '</t></is></c>';
    });
    return '<row r="' + (i + 1) + '">' + cells.join('') + '</row>';
  });
  return xmlHeader + '<worksheet xmlns="' + sheetNamespace + '"><sheetViews><sheetView workbookViewId="0">' +
    '<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>' +
    '<cols>' + columns + '</cols><sheetData>' + sheetRows.join('') +
    '</sheetData><autoFilter ref="A1:I' + (rows.length + 1) + '"/></worksheet>';
}

function makeAttemptWorkbook(attempts) {
  const sheets = new Map([['All attempts', []]]);
  const studentSheets = new Map();
  attempts.forEach((attempt, index) => {
    const { student, time, size, equation, field, answer, expected, correct } = attempt;
    const row = [index + 1, time, student, size, equation, field === 'raw' ? 'Regular' : 'Modular',
      answer, expected, correct === null ? 'Invalid entry' : correct ? 'Correct' : 'Try again'];
    sheets.get('All attempts').push(row);
    if (!studentSheets.has(student)) {
      const base = !student ? 'Uninitialed' : student.replace(/[\[\]:*?\/\\]/g, '_').replace(/^'+|'+$/g, '').trim() || 'Student';
      const root = base.slice(0, 25);
      let name = root.toLowerCase() === 'history' ? root + ' (2)' : root;
      const used = new Set([...sheets.keys()].map(label => label.toLowerCase()));
      for (let suffix = 2; used.has(name.toLowerCase()); suffix++) name = root + ' (' + suffix + ')';
      studentSheets.set(student, name);
      sheets.set(name, []);
    }
    sheets.get(studentSheets.get(student)).push(row);
  });

  const entries = [...sheets.entries()];
  const references = entries.map(([name], i) => '<sheet name="' + xmlText(name) + '" sheetId="' + (i + 1) + '" r:id="rId' + (i + 1) + '"/>');
  const relationships = entries.map((_, i) => '<Relationship Id="rId' + (i + 1) + '" Type="' + relationshipNamespace + '/worksheet" Target="worksheets/sheet' + (i + 1) + '.xml"/>');
  const overrides = entries.map((_, i) => '<Override PartName="/xl/worksheets/sheet' + (i + 1) + '.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>');
  const packageRelationships = 'http://schemas.openxmlformats.org/package/2006/relationships';

  return zipFiles([
    ['[Content_Types].xml', xmlHeader + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
      overrides.join('') + '</Types>'],
    ['_rels/.rels', xmlHeader + '<Relationships xmlns="' + packageRelationships + '">' +
      '<Relationship Id="rId1" Type="' + relationshipNamespace + '/officeDocument" Target="xl/workbook.xml"/></Relationships>'],
    ['xl/workbook.xml', xmlHeader + '<workbook xmlns="' + sheetNamespace + '" xmlns:r="' + relationshipNamespace + '">' +
      '<bookViews><workbookView activeTab="0"/></bookViews><sheets>' + references.join('') + '</sheets></workbook>'],
    ['xl/_rels/workbook.xml.rels', xmlHeader + '<Relationships xmlns="' + packageRelationships + '">' + relationships.join('') + '</Relationships>'],
    ...entries.map(([, rows], i) => ['xl/worksheets/sheet' + (i + 1) + '.xml', worksheet(rows)])
  ]);
}
