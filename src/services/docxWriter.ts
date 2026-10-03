/**
 * Writes a small .docx in the browser, without a zip library: a stored (uncompressed) zip with the few parts Word
 * needs. Used for the bilingual side-by-side document: a landscape page with a two-column table, one row per
 * paragraph, so the original and its translation always stand next to each other.
 */

const encoder = new TextEncoder();

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of data) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/** A zip archive with every file stored as is (Word reads stored entries fine) */
export function zipStored(files: { name: string; data: Uint8Array }[]): Uint8Array {
  const local: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const file of files) {
    const name = encoder.encode(file.name);
    const crc = crc32(file.data);
    const header = new DataView(new ArrayBuffer(30));
    header.setUint32(0, 0x04034b50, true);
    header.setUint16(4, 20, true);
    header.setUint16(6, 0x0800, true); // UTF-8 names
    header.setUint16(8, 0, true); // stored
    header.setUint32(14, crc, true);
    header.setUint32(18, file.data.length, true);
    header.setUint32(22, file.data.length, true);
    header.setUint16(26, name.length, true);
    local.push(new Uint8Array(header.buffer), name, file.data);

    const entry = new DataView(new ArrayBuffer(46));
    entry.setUint32(0, 0x02014b50, true);
    entry.setUint16(4, 20, true);
    entry.setUint16(6, 20, true);
    entry.setUint16(8, 0x0800, true);
    entry.setUint16(10, 0, true);
    entry.setUint32(16, crc, true);
    entry.setUint32(20, file.data.length, true);
    entry.setUint32(24, file.data.length, true);
    entry.setUint16(28, name.length, true);
    entry.setUint32(42, offset, true);
    central.push(new Uint8Array(entry.buffer), name);
    offset += 30 + name.length + file.data.length;
  }
  const centralSize = central.reduce((n, part) => n + part.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, files.length, true);
  end.setUint16(10, files.length, true);
  end.setUint32(12, centralSize, true);
  end.setUint32(16, offset, true);
  const parts = [...local, ...central, new Uint8Array(end.buffer)];
  const out = new Uint8Array(parts.reduce((n, part) => n + part.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

const escapeXml = (text: string) =>
  text
    // Characters XML 1.0 does not allow (Word's own marks are removed when the text is read)
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

export interface BilingualRow {
  /** Word's automatic number of the paragraph ("5.2."), shown in front of both texts */
  number?: string;
  left: string;
  right: string;
  /** A heading: bold on both sides */
  heading?: boolean;
  /** The right side could not be translated: shown in red, so it is not overlooked */
  warning?: boolean;
  /** Translated anew in an update (the original changed): the right side on a light yellow ground */
  changed?: boolean;
}

export interface BilingualDocument {
  title: string;
  leftLabel: string;
  rightLabel: string;
  rows: BilingualRow[];
}

const run = (text: string, options: { bold?: boolean; color?: string } = {}) =>
  `<w:r>${options.bold || options.color ? `<w:rPr>${options.bold ? '<w:b/>' : ''}${options.color ? `<w:color w:val="${options.color}"/>` : ''}</w:rPr>` : ''}<w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r>`;

/** Landscape A4 with 2 cm margins: the text width is shared by the two columns */
const PAGE = { width: 16838, height: 11906, margin: 1134 };
const COLUMN = Math.floor((PAGE.width - 2 * PAGE.margin) / 2);

function cell(text: string, number: string | undefined, options: { bold?: boolean; color?: string; shade?: boolean; fill?: string }) {
  const content = (number ? run(`${number} `, { bold: options.bold }) : '') + run(text, options);
  const fill = options.shade ? 'EDEDED' : options.fill;
  return `<w:tc><w:tcPr><w:tcW w:w="${COLUMN}" w:type="dxa"/>${fill ? `<w:shd w:val="clear" w:color="auto" w:fill="${fill}"/>` : ''}</w:tcPr><w:p><w:pPr><w:spacing w:after="60"/></w:pPr>${content}</w:p></w:tc>`;
}

/** document.xml of the bilingual table: a header row repeated on every page, rows that never break across pages */
export function bilingualDocumentXml(doc: BilingualDocument): string {
  const header = `<w:tr><w:trPr><w:tblHeader/><w:cantSplit/></w:trPr>${cell(doc.leftLabel, undefined, { bold: true, shade: true })}${cell(doc.rightLabel, undefined, { bold: true, shade: true })}</w:tr>`;
  const rows = doc.rows.map(row =>
    `<w:tr><w:trPr><w:cantSplit/></w:trPr>${cell(row.left, row.number, { bold: row.heading })}${cell(row.right, row.number, { bold: row.heading, color: row.warning ? 'C00000' : undefined, fill: row.changed && !row.warning ? 'FFF2CC' : undefined })}</w:tr>`
  ).join('');
  const border = (side: string) => `<w:${side} w:val="single" w:sz="4" w:space="0" w:color="BFBFBF"/>`;
  const borders = ['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map(border).join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>`
    + `<w:p><w:pPr><w:spacing w:after="200"/></w:pPr>${run(doc.title, { bold: true })}</w:p>`
    + `<w:tbl><w:tblPr><w:tblW w:w="${2 * COLUMN}" w:type="dxa"/><w:tblLayout w:type="fixed"/><w:tblBorders>${borders}</w:tblBorders><w:tblCellMar><w:left w:w="100" w:type="dxa"/><w:right w:w="100" w:type="dxa"/></w:tblCellMar></w:tblPr>`
    + `<w:tblGrid><w:gridCol w:w="${COLUMN}"/><w:gridCol w:w="${COLUMN}"/></w:tblGrid>${header}${rows}</w:tbl>`
    + `<w:p/><w:sectPr><w:pgSz w:w="${PAGE.width}" w:h="${PAGE.height}" w:orient="landscape"/><w:pgMar w:top="${PAGE.margin}" w:right="${PAGE.margin}" w:bottom="${PAGE.margin}" w:left="${PAGE.margin}" w:header="567" w:footer="567" w:gutter="0"/></w:sectPr>`
    + `</w:body></w:document>`;
}

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>`;
const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`;
const DOCUMENT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`;
/** The document's base font: 10 pt, so two columns of contract text stay readable on one page */
const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri" w:eastAsia="Calibri"/><w:sz w:val="20"/><w:szCs w:val="20"/><w:lang w:val="hu-HU"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="60" w:line="259" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style></w:styles>`;

/** The whole .docx file */
export function bilingualDocx(doc: BilingualDocument): Uint8Array {
  return zipStored([
    { name: '[Content_Types].xml', data: encoder.encode(CONTENT_TYPES) },
    { name: '_rels/.rels', data: encoder.encode(ROOT_RELS) },
    { name: 'word/_rels/document.xml.rels', data: encoder.encode(DOCUMENT_RELS) },
    { name: 'word/document.xml', data: encoder.encode(bilingualDocumentXml(doc)) },
    { name: 'word/styles.xml', data: encoder.encode(STYLES) },
  ]);
}

/** Base64 for Word's createDocument / insertFileFromBase64 */
export function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}
