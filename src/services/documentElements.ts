/**
 * Ready-made parts of a contract, as OOXML for Word's insertOoxml: the header and footer in the firm's look (page
 * "X / Y", document id, "Bizalmas", version, date), a two-column signature block, and a table of contents. Built as
 * text here (no Word call), so they can be tested.
 */

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

const esc = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** A flat OPC package with one document part: what insertOoxml takes */
export function ooxmlPackage(bodyXml: string): string {
  return `<pkg:package xmlns:pkg="http://schemas.microsoft.com/office/2006/xmlPackage">`
    + `<pkg:part pkg:name="/_rels/.rels" pkg:contentType="application/vnd.openxmlformats-package.relationships+xml"><pkg:xmlData>`
    + `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`
    + `</pkg:xmlData></pkg:part>`
    + `<pkg:part pkg:name="/word/document.xml" pkg:contentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"><pkg:xmlData>`
    + `<w:document xmlns:w="${W}"><w:body>${bodyXml}</w:body></w:document>`
    + `</pkg:xmlData></pkg:part></pkg:package>`;
}

export interface RunStyle {
  font?: string;
  /** Points */
  size?: number;
  bold?: boolean;
  smallCaps?: boolean;
  color?: string;
}

const runProps = (s: RunStyle) => {
  const parts = [
    s.font ? `<w:rFonts w:ascii="${esc(s.font)}" w:hAnsi="${esc(s.font)}" w:cs="${esc(s.font)}"/>` : '',
    s.bold ? '<w:b/>' : '',
    s.smallCaps ? '<w:smallCaps/>' : '',
    s.color ? `<w:color w:val="${s.color.replace('#', '')}"/>` : '',
    s.size ? `<w:sz w:val="${Math.round(s.size * 2)}"/><w:szCs w:val="${Math.round(s.size * 2)}"/>` : '',
  ].join('');
  return parts ? `<w:rPr>${parts}</w:rPr>` : '';
};

const run = (text: string, style: RunStyle = {}) => `<w:r>${runProps(style)}<w:t xml:space="preserve">${esc(text)}</w:t></w:r>`;
const tab = (style: RunStyle = {}) => `<w:r>${runProps(style)}<w:tab/></w:r>`;
/** A field (PAGE, NUMPAGES, TOC…) the way Word writes it, with a result shown until it is updated */
const field = (instruction: string, shown: string, style: RunStyle = {}) =>
  `<w:r>${runProps(style)}<w:fldChar w:fldCharType="begin"/></w:r>`
  + `<w:r>${runProps(style)}<w:instrText xml:space="preserve"> ${esc(instruction)} </w:instrText></w:r>`
  + `<w:r>${runProps(style)}<w:fldChar w:fldCharType="separate"/></w:r>`
  + run(shown, style)
  + `<w:r>${runProps(style)}<w:fldChar w:fldCharType="end"/></w:r>`;

export interface HeaderFooterOptions {
  /** Text width in twips (page width minus margins): where the right tab stop goes */
  width: number;
  font: string;
  accent: string;
  /** Header: firm name left, document title right */
  header: boolean;
  firm: string;
  title: string;
  /** Footer parts */
  pageNumbers: boolean;
  confidential: boolean;
  documentId: string;
  version: string;
  date: string;
}

/** The header: firm name in small capitals left, the title right, a thin accent rule under it */
export function headerXml(o: HeaderFooterOptions): string {
  const style: RunStyle = { font: o.font, size: 8.5, color: o.accent };
  return `<w:p><w:pPr><w:pBdr><w:bottom w:val="single" w:sz="6" w:space="4" w:color="${o.accent.replace('#', '')}"/></w:pBdr>`
    + `<w:tabs><w:tab w:val="right" w:pos="${o.width}"/></w:tabs><w:spacing w:after="0"/></w:pPr>`
    + run(o.firm, { ...style, bold: true, smallCaps: true })
    + (o.title ? tab(style) + run(o.title, { ...style, color: '#595959' }) : '')
    + '</w:p>';
}

/** The footer: "Bizalmas · azonosító · verzió · dátum" left, "Oldal X / Y" right, a light rule above */
export function footerXml(o: HeaderFooterOptions): string {
  const style: RunStyle = { font: o.font, size: 8, color: '#595959' };
  const left = [o.confidential ? 'BIZALMAS' : '', o.documentId, o.version, o.date].map(s => s.trim()).filter(Boolean);
  const leftRuns = left.map((part, i) => run(`${i ? ' · ' : ''}${part}`, i === 0 && o.confidential ? { ...style, bold: true, color: o.accent } : style)).join('');
  const page = o.pageNumbers
    ? tab(style) + run('Oldal ', style) + field('PAGE', '1', style) + run(' / ', style) + field('NUMPAGES', '1', style)
    : '';
  return `<w:p><w:pPr><w:pBdr><w:top w:val="single" w:sz="4" w:space="4" w:color="BFBFBF"/></w:pBdr>`
    + `<w:tabs><w:tab w:val="right" w:pos="${o.width}"/></w:tabs><w:spacing w:after="0"/></w:pPr>`
    + leftRuns + page + '</w:p>';
}

export interface SignatureParty {
  role: string;
  name: string;
}

export interface SignatureOptions {
  place: string;
  date: string;
  left: SignatureParty;
  right: SignatureParty;
  /** A "képviseli: …" line under the name (companies) */
  representative: boolean;
  font: string;
  /**
   * For the footer (on every page, e.g. for initialling each page): smaller, little room above the line, no place
   * and date line
   */
  compact?: boolean;
}

const DOTS = '……………………………';

/** Two signature columns side by side, without borders; room left above the signature line */
export function signatureBlockXml(o: SignatureOptions): string {
  const style: RunStyle = o.compact ? { font: o.font, size: 8 } : { font: o.font };
  const p = (inner: string, pPr = '') => `<w:p><w:pPr>${pPr}<w:spacing w:after="0"/></w:pPr>${inner}</w:p>`;
  const column = (party: SignatureParty) =>
    `<w:tc><w:tcPr><w:tcW w:w="2500" w:type="pct"/></w:tcPr>`
    + (o.compact ? '' : p(run(`${o.place || DOTS}, ${o.date || DOTS}`, style)))
    // Room to sign, then the line
    + p(run(o.compact ? '____________________' : '______________________________', style), `<w:spacing w:before="${o.compact ? 360 : 1200}"/>`)
    + p(run(party.name || DOTS, { ...style, bold: true }), '<w:jc w:val="left"/>')
    + p(run(party.role, style))
    + (o.representative ? p(run(`képviseli: ${DOTS}`, style)) : '')
    + '</w:tc>';
  const none = ['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map(side => `<w:${side} w:val="nil"/>`).join('');
  return `<w:tbl><w:tblPr><w:tblW w:w="5000" w:type="pct"/><w:tblBorders>${none}</w:tblBorders><w:tblLayout w:type="fixed"/></w:tblPr>`
    + `<w:tblGrid><w:gridCol w:w="4536"/><w:gridCol w:w="4536"/></w:tblGrid>`
    + `<w:tr><w:trPr><w:cantSplit/></w:trPr>${column(o.left)}${column(o.right)}</w:tr></w:tbl>`
    // In the footer a small gap before the page line; in the text an empty paragraph after the table
    + (o.compact ? '<w:p><w:pPr><w:spacing w:after="60"/></w:pPr></w:p>' : '<w:p/>');
}

/** Our own chapter style is listed too (headings without a heading style get it in the Formázás tab) */
export const TOC_INSTRUCTION = 'TOC \\o "1-3" \\h \\z \\u \\t "ICT Fejezetcím,1"';

/** A table of contents: a title, then the field; Word fills it in when it is updated */
export function tableOfContentsXml(font: string, accent: string): string {
  return `<w:p><w:pPr><w:spacing w:after="120"/></w:pPr>${run('Tartalomjegyzék', { font, bold: true, smallCaps: true, color: accent, size: 13 })}</w:p>`
    + `<w:p>${field(TOC_INSTRUCTION, 'A tartalomjegyzék frissítéséhez: jobb gomb → Mező frissítése (vagy a Formázás fül „Frissítés” gombja).', { font })}</w:p>`;
}

/** The two parties of the contract by their defined role names, in order of definition; a guess for the signature block */
const PARTY_ROLES = ['Eladó', 'Vevő', 'Megbízó', 'Megbízott', 'Bérbeadó', 'Bérlő', 'Kölcsönadó', 'Kölcsönvevő', 'Szállító', 'Megrendelő',
  'Vállalkozó', 'Munkáltató', 'Munkavállaló', 'Engedményező', 'Engedményes', 'Kezes', 'Hitelező', 'Adós', 'Licencadó', 'Licencvevő'];

export function guessParties(terms: string[]): [string, string] {
  const roles = terms.filter(t => PARTY_ROLES.includes(t));
  return [roles[0] ?? 'Eladó', roles[1] ?? (roles[0] === 'Vevő' ? 'Eladó' : 'Vevő')];
}

/** "2026. október 3." */
export const hungarianDate = (date: Date) => `${date.getFullYear()}. ${date.toLocaleDateString('hu-HU', { month: 'long' })} ${date.getDate()}.`;
