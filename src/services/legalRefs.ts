import type { StructureIssue } from './structure';

/**
 * Law and case references in a contract, rule-based (no API, no key): acts ("2013. évi V. törvény"), code
 * abbreviations with their sections ("Ptk. 6:98. § (2) bekezdés"), government decrees, Constitutional Court
 * decisions, court decisions (BH, EBH, Kúria case numbers) and EU acts. Each gets a link to open it, and a few
 * checks that need no database: an act that is no longer in force, a Ptk. section in the old numbering, a Ptk.
 * book that does not exist.
 */

export type LegalRefKind = 'act' | 'decree' | 'court' | 'eu';

export interface LegalRef {
  paragraph: number;
  start: number;
  end: number;
  /** As written in the document */
  text: string;
  kind: LegalRefKind;
  /** The act it belongs to, for grouping: "2013. évi V. törvény (Ptk.)", "BH 2019.123" */
  group: string;
  /** Where it opens: the act on njt.hu, an EU act on EUR-Lex, otherwise a web search for the exact reference */
  url: string;
}

const ROMAN: Record<string, number> = { I: 1, V: 5, X: 10, L: 50, C: 100, D: 500, M: 1000 };
export function romanToNumber(roman: string): number {
  let total = 0;
  for (let i = 0; i < roman.length; i++) {
    const value = ROMAN[roman[i]] ?? 0;
    total += value < (ROMAN[roman[i + 1]] ?? 0) ? -value : value;
  }
  return total;
}

/** The common abbreviations and the act behind them */
const CODES: Record<string, { year: number; number: string; name: string }> = {
  'Ptk': { year: 2013, number: 'V', name: 'Ptk.' },
  'Pp': { year: 2016, number: 'CXXX', name: 'Pp.' },
  'Btk': { year: 2012, number: 'C', name: 'Btk.' },
  'Mt': { year: 2012, number: 'I', name: 'Mt.' },
  'Ctv': { year: 2006, number: 'V', name: 'Ctv.' },
  'Inytv': { year: 1997, number: 'CXLI', name: 'Inytv.' },
  'Ákr': { year: 2016, number: 'CL', name: 'Ákr.' },
  'Infotv': { year: 2011, number: 'CXII', name: 'Infotv.' },
  'Ütv': { year: 2017, number: 'LXXVIII', name: 'Ütv.' },
  'Vht': { year: 1994, number: 'LIII', name: 'Vht.' },
  'Cstv': { year: 1991, number: 'XLIX', name: 'Cstv.' },
  'Tpvt': { year: 1996, number: 'LVII', name: 'Tpvt.' },
  'Áfa tv': { year: 2007, number: 'CXXVII', name: 'Áfa tv.' },
  'Szja tv': { year: 1995, number: 'CXVII', name: 'Szja tv.' },
  // The old company act, repealed by the new Ptk.
  'Gt': { year: 2006, number: 'IV', name: 'Gt.' },
};

/** Acts no longer in force, with the date and what replaced them (checked against the Nemzeti Jogszabálytár) */
const REPEALED: Record<string, { name: string; since: string; instead: string }> = {
  '1959-IV': { name: 'a régi Ptk.', since: '2014. március 15.', instead: 'a 2013. évi V. törvény (Ptk.)' },
  '2006-IV': { name: 'a régi Gt.', since: '2014. március 15.', instead: 'a 2013. évi V. törvény (Ptk.) harmadik könyve' },
  '1952-III': { name: 'a régi Pp.', since: '2018. január 1.', instead: 'a 2016. évi CXXX. törvény (Pp.)' },
  '1978-IV': { name: 'a régi Btk.', since: '2013. július 1.', instead: 'a 2012. évi C. törvény (Btk.)' },
  '1992-XXII': { name: 'a régi Mt.', since: '2012. július 1.', instead: 'a 2012. évi I. törvény (Mt.)' },
  '2004-CXL': { name: 'a Ket.', since: '2018. január 1.', instead: 'a 2016. évi CL. törvény (Ákr.)' },
  '1998-XIX': { name: 'a régi Be.', since: '2018. július 1.', instead: 'a 2017. évi XC. törvény (Be.)' },
  '1992-LXIII': { name: 'a régi adatvédelmi törvény', since: '2012. január 1.', instead: 'a 2011. évi CXII. törvény (Infotv.)' },
  '1998-XI': { name: 'a régi ügyvédi törvény', since: '2018. január 1.', instead: 'a 2017. évi LXXVIII. törvény (Ütv.)' },
};

const njtAct = (year: number, roman: string) => `https://njt.hu/jogszabaly/${year}-${romanToNumber(roman)}-00-00`;
const search = (text: string, site = '') => `https://www.google.com/search?q=${encodeURIComponent(`"${text}"${site ? ` site:${site}` : ''}`)}`;
const actGroup = (year: number, roman: string) => {
  const code = Object.values(CODES).find(c => c.year === year && c.number === roman);
  return `${year}. évi ${roman}. törvény${code ? ` (${code.name})` : ''}`;
};

// A section after an act or an abbreviation: "6:98. §", "318. §", "(2) bekezdés", "b) pont"
const SECTION = String.raw`(?:\s*(\d+(?::\d+)?\/?[A-Z]?\.\s*§(?:\s*\(\d+\)(?:\s*bekezdés(?:é|ében|e)?)?)?(?:\s*[a-z]\)(?:\s*pont(?:ja|jában)?)?)?))?`;
const ACT = new RegExp(String.raw`(\d{4})\.\s*évi\s+([IVXLCDM]+)\.\s*(?:törvény(?:ről|ben|nek|t|e)?|tv\.)` + String.raw`(?:\s*\([^)]{0,30}\))?` + SECTION, 'gu');
const CODE = new RegExp(String.raw`(?<![\p{L}])(${Object.keys(CODES).map(k => k.replace(' ', '\\s')).join('|')})\.` + SECTION, 'gu');
const DECREE = /(\d{1,4})\/(\d{4})\.\s*\(([IVX]{1,4})\.\s*(\d{1,2})\.\)\s*((?:Korm\.|[A-ZÁÉÍÓÖŐÚÜŰ]{1,6}M|MNB|NGM|IM|PM|BM)\s*)?rendelet/gu;
const AB = /(\d{1,4})\/(\d{4})\.\s*\(([IVX]{1,4})\.\s*(\d{1,2})\.\)\s*AB\s+(?:határozat|végzés)/gu;
const COURT_DIGEST = /(?<![\p{L}])(EBH|EBD|BH|BDT|KGD)\s*(\d{4})\.\s*(\d{1,4})\.?/gu;
// Kúria and court case numbers: "Pfv.I.20.123/2020/5.", "Gf.III.30.045/2019"
const CASE_NUMBER = /(?<![\p{L}])(Pfv|Gfv|Mfv|Kfv|Bfv|Pf|Gf|Mf|Kf|Bf|Pkf|Gpkf)\.\s*([IVX]{1,4})\.\s*(\d{1,3}(?:\.\d{1,3})?)\/(\d{4})(?:\/(\d{1,3}))?\.?/gu;
const UNIFORMITY = /(?<![\d/])(\d{1,2})\/(\d{4})\.\s*(PJE|BJE|KJE|MJE|JEH)(?:\s*határozat)?/gu;
const EU = /(?:\(EU\)|EU)\s*(\d{4})\/(\d{1,4})\s*(?:európai parlamenti és tanácsi\s*)?(rendelet|irányelv)|(?<![\p{L}])(GDPR)(?![\p{L}])/giu;

export function findLegalRefs(paragraphs: { text: string }[]): LegalRef[] {
  const refs: LegalRef[] = [];
  const taken: [number, number, number][] = [];
  const add = (paragraph: number, match: RegExpMatchArray, ref: Omit<LegalRef, 'paragraph' | 'start' | 'end' | 'text'>) => {
    const start = match.index!;
    const text = match[0].trim();
    const end = start + text.length;
    // A place already taken by a longer reference (an abbreviation inside a decree's name) is not counted twice
    if (taken.some(([p, s, e]) => p === paragraph && start < e && end > s)) return;
    taken.push([paragraph, start, end]);
    refs.push({ paragraph, start, end, text, ...ref });
  };
  paragraphs.forEach(({ text }, paragraph) => {
    for (const m of text.matchAll(ACT)) add(paragraph, m, { kind: 'act', group: actGroup(Number(m[1]), m[2]), url: njtAct(Number(m[1]), m[2]) });
    for (const m of text.matchAll(DECREE)) add(paragraph, m, { kind: 'decree', group: m[0].replace(/\s+/g, ' ').trim(), url: search(m[0].replace(/\s+/g, ' ').trim(), 'njt.hu') });
    for (const m of text.matchAll(AB)) add(paragraph, m, { kind: 'court', group: `${m[1]}/${m[2]}. AB határozat`, url: search(m[0].replace(/\s+/g, ' ').trim()) });
    for (const m of text.matchAll(UNIFORMITY)) add(paragraph, m, { kind: 'court', group: `${m[1]}/${m[2]}. ${m[3]}`, url: search(`${m[1]}/${m[2]}. ${m[3]}`) });
    for (const m of text.matchAll(COURT_DIGEST)) add(paragraph, m, { kind: 'court', group: `${m[1]} ${m[2]}.${m[3]}.`, url: search(`${m[1]} ${m[2]}.${m[3]}`) });
    for (const m of text.matchAll(CASE_NUMBER)) add(paragraph, m, { kind: 'court', group: m[0].replace(/\s+/g, ''), url: search(m[0].replace(/\s+/g, '')) });
    for (const m of text.matchAll(EU)) {
      if (m[4]) add(paragraph, m, { kind: 'eu', group: '(EU) 2016/679 rendelet (GDPR)', url: 'https://eur-lex.europa.eu/eli/reg/2016/679/oj' });
      else add(paragraph, m, { kind: 'eu', group: `(EU) ${m[1]}/${m[2]} ${m[3].toLowerCase()}`, url: `https://eur-lex.europa.eu/eli/${m[3].toLowerCase() === 'rendelet' ? 'reg' : 'dir'}/${m[1]}/${m[2]}/oj` });
    }
    for (const m of text.matchAll(CODE)) {
      const code = CODES[m[1].replace(/\s+/g, ' ')];
      if (code) add(paragraph, m, { kind: 'act', group: `${code.year}. évi ${code.number}. törvény (${code.name})`, url: njtAct(code.year, code.number) });
    }
  });
  return refs.sort((a, b) => a.paragraph - b.paragraph || a.start - b.start);
}

/** What can be said without a law database: repealed acts, the old Ptk. numbering, a Ptk. book that does not exist */
export function legalRefIssues(refs: LegalRef[]): StructureIssue[] {
  const issues: StructureIssue[] = [];
  const said = new Set<string>();
  const once = (key: string, issue: StructureIssue) => {
    if (said.has(key)) return;
    said.add(key);
    issues.push(issue);
  };
  for (const ref of refs) {
    const at = { paragraph: ref.paragraph, start: ref.start, end: ref.end };
    const act = /^(\d{4})\. évi ([IVXLCDM]+)\. törvény/.exec(ref.group);
    const repealed = act && REPEALED[`${act[1]}-${act[2]}`];
    if (repealed) {
      once(`repealed:${act![1]}-${act![2]}`, {
        kind: 'legal-ref',
        message: `„${ref.text}”: ${repealed.name} ${repealed.since} óta nem hatályos, helyette ${repealed.instead}. Régi jogviszonynál az átmeneti szabályok miatt ez lehet helyes; új szerződésben ellenőrizd.`,
        at,
        subject: ref.text,
      });
    }
    if (ref.group.endsWith('(Ptk.)')) {
      const section = /(\d+)(?::(\d+))?\/?[A-Z]?\.\s*§/.exec(ref.text);
      if (section && section[2] === undefined) {
        once(`oldptk:${ref.text}`, {
          kind: 'legal-ref',
          message: `„${ref.text}”: ez a régi Ptk. számozása. Az új Ptk.-ban a hely „könyv:szakasz” alakú (pl. 6:98. §); ellenőrizd, melyik törvényre gondolt a szerződés.`,
          at,
          subject: ref.text,
        });
      } else if (section && (Number(section[1]) < 1 || Number(section[1]) > 8)) {
        once(`ptkbook:${ref.text}`, {
          kind: 'legal-ref',
          message: `„${ref.text}”: a Ptk.-nak nincs ${section[1]}. könyve (1–8 van), ez elírás lehet.`,
          at,
          subject: ref.text,
        });
      }
    }
  }
  return issues;
}

/** The references grouped by act or decision, in order of first appearance */
export function groupLegalRefs(refs: LegalRef[]): { group: string; kind: LegalRefKind; url: string; refs: LegalRef[] }[] {
  const groups = new Map<string, { group: string; kind: LegalRefKind; url: string; refs: LegalRef[] }>();
  for (const ref of refs) {
    const entry = groups.get(ref.group) ?? { group: ref.group, kind: ref.kind, url: ref.url, refs: [] };
    entry.refs.push(ref);
    groups.set(ref.group, entry);
  }
  return [...groups.values()];
}
