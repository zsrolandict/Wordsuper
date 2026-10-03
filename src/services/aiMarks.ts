import { roleOf, type FormatAudit } from './formatting';

/**
 * Traces that a text was written or pasted from an AI chat, only pointed out (never changed): the wording is the
 * lawyer's decision. Rule-based, on the paragraphs read for the Formázás tab.
 */

export type AiMarkKind = 'phrase' | 'titleCase' | 'invisible' | 'emoji';
/** Real traces of AI text; the title-case hint is a spelling matter, shown apart from them */
export const AI_TRACE_KINDS: AiMarkKind[] = ['phrase', 'invisible', 'emoji'];

export interface AiMark {
  kind: AiMarkKind;
  /** Paragraph index (as read), for "Ugrás" */
  paragraph: number;
  /** What was found ("Fontos megjegyezni", "A Szerződés Tárgya") */
  found: string;
}

export const AI_MARK_LABELS: Record<AiMarkKind, { label: string; hint: string }> = {
  phrase: { label: 'Tipikus AI-fordulat', hint: 'Töltelék vagy túlzó kifejezés; érdemes egyszerűbben, konkrétabban megfogalmazni.' },
  titleCase: { label: 'Nagybetűs szavak a címben', hint: 'A magyar helyesírás szerint a címben csak az első szó és a tulajdonnév nagy kezdőbetűs (pl. „Szavatossági nyilatkozatok”). A definiált fogalmakat, a neveket és a cégneveket nem jelzem. Ez helyesírási jelzés, nem feltétlenül AI-nyom.' },
  invisible: { label: 'Láthatatlan karakter', hint: 'Nulla szélességű szóköz vagy feltételes elválasztó: bemásolt (AI-, web-) szöveg nyoma, a keresést is megzavarja.' },
  emoji: { label: 'Emoji vagy díszjel', hint: 'Szerződésbe nem illik; törölni vagy rendes felsorolásra cserélni.' },
};

/** Filler and inflated phrases typical of AI text, Hungarian and English. Plain legal words (továbbá) are not here. */
const PHRASES = [
  'fontos megjegyezni', 'fontos kiemelni', 'érdemes megjegyezni', 'érdemes kiemelni', 'fontos hangsúlyozni', 'összességében',
  'összefoglalva elmondható', 'kulcsfontosságú', 'átfogó', 'zökkenőmentes', 'holisztikus', 'robusztus', 'kiemelkedően fontos',
  'nem csupán', 'egyértelműen', 'mindenképpen érdemes', 'ebben a kontextusban', 'a mai gyorsan változó',
  'it is important to note', 'it is worth noting', 'in conclusion', 'seamless', 'robust', 'comprehensive', 'delve', 'leverage',
  'in today’s', "in today's", 'navigate the complexities',
];
const PHRASE = new RegExp(`(?<![\\p{L}])(${PHRASES.map(p => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})(?![\\p{L}])`, 'giu');
const INVISIBLE = /[​-‍⁠﻿­]/;
const EMOJI = /\p{Extended_Pictographic}|[✅❌➡⭐]/u;
/** A name or an institution: its capitals are right (Dr. Kiss Anna Ügyvédi Iroda, Pest Megyei Kormányhivatal) */
const PROPER_NAME = /(?<![\p{L}])(dr|ifj|id|özv|prof)\.|(?<![\p{L}])(Kft|Zrt|Nyrt|Bt|Kkt|Iroda|Társaság|Alapítvány|Egyesület|Hivatal|Kormányhivatal|Bíróság|Törvényszék|Önkormányzat|Minisztérium|Kamara|Bank)(?![\p{L}])/iu;

/**
 * "A Szerződés Tárgya": after the first word, every longer word capitalized, the whole not in capitals. Names,
 * institutions, defined terms (they are capitalized on purpose) and labels with numbers ("Vevő1 Vevő2") are fine.
 */
function isTitleCase(text: string, terms: string[]): boolean {
  if (text === text.toLocaleUpperCase('hu') || /\d/.test(text) || PROPER_NAME.test(text)) return false;
  const words: string[] = text.match(/\p{L}+/gu) ?? [];
  const isTerm = (w: string) => terms.some(t => !t.includes(' ') && w.startsWith(t));
  const rest = words.slice(1).filter(w => w.length > 3 && !isTerm(w));
  if (!rest.length) return false;
  return rest.every(w => w[0] === w[0].toLocaleUpperCase('hu') && w.slice(1) === w.slice(1).toLocaleLowerCase('hu'));
}

/** terms: the document's defined terms, capitalized on purpose */
export function findAiMarks(audit: FormatAudit, terms: string[] = []): AiMark[] {
  const marks: AiMark[] = [];
  audit.paragraphs.forEach((p, paragraph) => {
    const text = p.text;
    if (!text.trim()) return;
    for (const match of text.matchAll(PHRASE)) marks.push({ kind: 'phrase', paragraph, found: match[0] });
    const role = roleOf(p).kind;
    if ((role === 'heading' || role === 'fake-heading' || role === 'title') && isTitleCase(text.trim(), terms)) marks.push({ kind: 'titleCase', paragraph, found: text.trim() });
    if (INVISIBLE.test(text)) marks.push({ kind: 'invisible', paragraph, found: text.trim().slice(0, 60) });
    const emoji = EMOJI.exec(text);
    if (emoji) marks.push({ kind: 'emoji', paragraph, found: emoji[0] });
  });
  return marks;
}
