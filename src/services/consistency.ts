import type { DefinedTerm, ParagraphInfo, StructureIssue } from './structure';

/**
 * Content checks a lawyer would otherwise do by eye, rule-based and instant: an amount in figures against the
 * same amount in words, ownership shares that should add up to one, a party named in the plural where the
 * defined term is singular (or the other way round), and the numbering of the sections.
 */

// ---------- Amounts: figures against words ----------

const UNITS: [string, number][] = [
  ['egy', 1], ['kettő', 2], ['két', 2], ['három', 3], ['négy', 4], ['öt', 5], ['hat', 6], ['hét', 7], ['nyolc', 8], ['kilenc', 9],
];
const TENS: [string, number][] = [
  ['tizen', 10], ['tíz', 10], ['huszon', 20], ['húsz', 20], ['harminc', 30], ['negyven', 40], ['ötven', 50], ['hatvan', 60],
  ['hetven', 70], ['nyolcvan', 80], ['kilencven', 90],
];
const MULTIPLIERS: [string, number][] = [['milliárd', 1e9], ['millió', 1e6], ['ezer', 1000]];

/**
 * A number written out in Hungarian ("huszonhatmillió", "egymillió-kétszázötvenezer", "százötven") as a number;
 * null when the text is not only number words
 */
export function parseHungarianNumber(words: string): number | null {
  let rest = words.toLocaleLowerCase('hu').replace(/[\s-]+/g, '');
  if (!rest) return null;
  if (rest === 'nulla') return 0;
  let total = 0;
  let small = 0;
  let seen = false;
  const take = (list: [string, number][]) => {
    for (const [word, value] of list) {
      if (rest.startsWith(word)) {
        rest = rest.slice(word.length);
        return value;
      }
    }
    return null;
  };
  while (rest) {
    const multiplier = take(MULTIPLIERS);
    if (multiplier !== null) {
      total += (seen && small === 0 ? 0 : small || 1) * multiplier;
      small = 0;
      seen = true;
      continue;
    }
    if (rest.startsWith('száz')) {
      rest = rest.slice(4);
      small = (small || 1) * 100;
      seen = true;
      continue;
    }
    const value = take(TENS) ?? take(UNITS);
    if (value === null) return null;
    small += value;
    seen = true;
  }
  return total + small;
}

const CURRENCY = '(?:Ft|forint|HUF|EUR|euró|euro|USD|CHF)';
const WORDS = '[a-zA-ZáéíóöőúüűÁÉÍÓÖŐÚÜŰ][a-záéíóöőúüű\\s-]*?';
/** "26.000.000,- Ft, azaz huszonhatmillió forint", "1 250 000 Ft (azaz egymillió-kétszázötvenezer forint)", "500 EUR (ötszáz euró)" */
const AMOUNT_WITH_WORDS = new RegExp(
  `(\\d{1,3}(?:[. \\u00A0]\\d{3})+|\\d+)(?:,-|,00)?\\s*${CURRENCY}?\\s*[,(]?\\s*(?:azaz|vagyis|betűvel)?\\s*:?\\s*\\(?\\s*(${WORDS})\\s*${CURRENCY}`,
  'gu'
);

const digitsOf = (figure: string) => Number(figure.replace(/[.  ]/g, ''));
const grouped = (n: number) => n.toLocaleString('hu-HU').replace(/ /g, ' ');

export function amountIssues(paragraphs: ParagraphInfo[]): StructureIssue[] {
  const issues: StructureIssue[] = [];
  paragraphs.forEach(({ text }, paragraph) => {
    for (const match of text.matchAll(AMOUNT_WITH_WORDS)) {
      const inWords = parseHungarianNumber(match[2]);
      // Only real number words count (no word, or a word that is not a number: no check)
      if (inWords === null || !/\d/.test(match[1])) continue;
      const inFigures = digitsOf(match[1]);
      if (inWords === inFigures) continue;
      issues.push({
        kind: 'amount-words',
        message: `Az összeg számmal ${grouped(inFigures)}, betűvel ${grouped(inWords)} („${match[2].trim()}”) – a kettő eltér.`,
        at: { paragraph, start: match.index!, end: match.index! + match[0].length },
        subject: match[0].trim(),
      });
    }
  });
  return issues;
}

// ---------- Ownership shares ----------

const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);
const FRACTION = /(?<![\d/.])(\d{1,4})\s*\/\s*(\d{1,4})(?![\d/])/g;

/**
 * Shares listed together ("7/10 és 3/10 arányban", "1/2-1/2 arányú") must add up to one. Only fractions in a
 * paragraph about shares, next to each other (joined by "és", a comma or a hyphen); a lone "1/1" or a hrsz is no list.
 */
export function shareIssues(paragraphs: ParagraphInfo[]): StructureIssue[] {
  const issues: StructureIssue[] = [];
  paragraphs.forEach(({ text }, paragraph) => {
    if (!/arány|hányad|tulajdon/i.test(text)) return;
    const fractions = [...text.matchAll(FRACTION)]
      .map(m => ({ at: m.index!, end: m.index! + m[0].length, num: Number(m[1]), den: Number(m[2]), raw: m[0] }))
      .filter(f => f.den > 0 && f.den <= 1000 && f.num <= f.den && !/hrsz/i.test(text.slice(f.end, f.end + 8)));
    const groups: (typeof fractions)[] = [];
    for (const f of fractions) {
      const group = groups[groups.length - 1];
      const previous = group?.[group.length - 1];
      const between = previous ? text.slice(previous.end, f.at) : '';
      if (previous && between.length <= 40 && /^[\s\p{L}\d,.–-]*$/u.test(between) && /(\bés\b|,|-|–|valamint)/u.test(between)) group.push(f);
      else groups.push([f]);
    }
    for (const group of groups) {
      if (group.length < 2) continue;
      const den = group.reduce((d, f) => (d * f.den) / gcd(d, f.den), 1);
      const num = group.reduce((n, f) => n + f.num * (den / f.den), 0);
      if (num === den) continue;
      const g = gcd(num, den);
      issues.push({
        kind: 'shares',
        message: `A tulajdoni hányadok összege ${num / g}/${den / g}, nem 1 (${group.map(f => f.raw.replace(/\s/g, '')).join(' + ')}).`,
        at: { paragraph, start: group[0].at, end: group[group.length - 1].end },
        subject: group.map(f => f.raw).join(' + '),
      });
    }
  });
  return issues;
}

// ---------- Party names: singular against plural ----------

const PLURAL_ENDINGS = '(?:k|kat|knak|kkal|któl|kra|kért|ké|kat)\\p{L}*';

/**
 * A defined singular term used in the plural ("Vevő" defined, "Vevők megvásárolják"), or a defined plural used in
 * the singular ("Eladók" defined, "az Eladó vállalja"). One issue per term, at its first odd use, with the count.
 */
export function partyNameIssues(paragraphs: ParagraphInfo[], terms: DefinedTerm[]): StructureIssue[] {
  const issues: StructureIssue[] = [];
  const defined = new Set(terms.map(t => t.term));
  const definitionAt = new Map(terms.map(t => [t.term, t.definedAt]));
  for (const term of terms) {
    const word = term.term;
    if (word.includes(' ') || word.length < 3) continue;
    let pattern: RegExp | null = null;
    let other = '';
    if (/[aeiouóőúűáéí]$/u.test(word) && !defined.has(`${word}k`)) {
      // Singular defined: the plural forms
      pattern = new RegExp(`(?<![\\p{L}])${word}${PLURAL_ENDINGS}`, 'gu');
      other = `${word}k`;
    } else if (word.endsWith('k') && !defined.has(word.slice(0, -1)) && word.length > 3) {
      // Plural defined: the singular, not followed by the plural k
      const singular = word.slice(0, -1);
      pattern = new RegExp(`(?<![\\p{L}])${singular}(?!k)(?:\\p{L}{0,4})(?![\\p{L}])`, 'gu');
      other = singular;
    }
    if (!pattern) continue;
    const found: { paragraph: number; start: number; end: number }[] = [];
    paragraphs.forEach(({ text }, paragraph) => {
      for (const match of text.matchAll(pattern!)) {
        const at = definitionAt.get(word);
        if (at && at.paragraph === paragraph && match.index! >= at.start && match.index! < at.end) continue;
        found.push({ paragraph, start: match.index!, end: match.index! + match[0].length });
      }
    });
    if (!found.length) continue;
    const plural = other.endsWith('k');
    issues.push({
      kind: 'party-name',
      message: `A definiált fogalom „${word}” (${plural ? 'egyes' : 'többes'} szám), de ${found.length} helyen „${other}” alakban szerepel${plural ? ' (többes számban)' : ' (egyes számban)'}.`,
      at: found[0],
      subject: word,
    });
  }
  return issues;
}

// ---------- Numbering ----------

const TYPED_NUMBER = /^\s*(\d+(?:\.\d+)*)\.?\s+\S/u;

/**
 * The numbering of sections: a number typed by hand where the rest is automatic, a number skipped or repeated,
 * a level skipped (5. → 5.1.1). Numbering restarts after an annex heading.
 */
export function numberingIssues(paragraphs: ParagraphInfo[], labels: (string | null)[], isAnnexHeading: (text: string) => boolean): StructureIssue[] {
  const issues: StructureIssue[] = [];
  const automatic = paragraphs.some(p => p.listString && /^\d/.test(p.listString.trim()));
  const at = (paragraph: number) => ({ paragraph, start: 0, end: Math.min(paragraphs[paragraph].text.length, 20) });
  let last = new Map<string, number>();
  let seen = new Set<string>();
  paragraphs.forEach((p, paragraph) => {
    if (isAnnexHeading(p.text)) {
      last = new Map();
      seen = new Set();
      return;
    }
    const label = labels[paragraph];
    // A year at the start ("2026. október 3.") or a large number is not a section number
    if (!label || /^\s*\d{4}\.\s/.test(p.text) || label.split('.').some(n => Number(n) > 200)) return;
    const typed = !p.listString && TYPED_NUMBER.test(p.text);
    if (typed && automatic) {
      issues.push({ kind: 'numbering', message: `A „${label}.” pontszám kézzel van beírva, a többi automatikus számozás: ha a pontok sorrendje változik, ez nem követi.`, at: at(paragraph), subject: `${label}. kézi` });
    }
    const parts = label.split('.');
    const parent = parts.slice(0, -1).join('.');
    const number = Number(parts[parts.length - 1]);
    if (seen.has(label)) {
      issues.push({ kind: 'numbering', message: `A „${label}.” pontszám kétszer szerepel.`, at: at(paragraph), subject: `${label}. kétszer` });
    } else if (parent && !seen.has(parent)) {
      issues.push({ kind: 'numbering', message: `A „${label}.” pont előtt nincs „${parent}.” pont: kimaradt egy szint.`, at: at(paragraph), subject: `${label}. szint` });
    } else {
      const previous = last.get(parent) ?? 0;
      if (number > previous + 1) {
        const missing = parent ? `${parent}.${previous + 1}` : String(previous + 1);
        issues.push({ kind: 'numbering', message: `Kimaradt a „${missing}.” pont (${previous ? `a ${parent ? `${parent}.` : ''}${previous}. után` : 'az elején'} a ${label}. jön).`, at: at(paragraph), subject: `${missing}. hiányzik` });
      }
    }
    seen.add(label);
    last.set(parent, Math.max(last.get(parent) ?? 0, number));
    // A new parent starts its own children's count
    last.delete(label);
  });
  return issues;
}
