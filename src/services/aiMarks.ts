import type { FormatAudit } from './formatting';

/**
 * Traces that a text was written or pasted from an AI chat, only pointed out (never changed): the wording is the
 * lawyer's decision. Rule-based, on the paragraphs read for the Formázás tab.
 */

export type AiMarkKind = 'phrase' | 'invisible' | 'emoji';
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
/** Capitals in titles are not pointed out (a house style as often as a slip); terms kept for callers */
export function findAiMarks(audit: FormatAudit, _terms: string[] = []): AiMark[] {
  const marks: AiMark[] = [];
  audit.paragraphs.forEach((p, paragraph) => {
    const text = p.text;
    if (!text.trim()) return;
    for (const match of text.matchAll(PHRASE)) marks.push({ kind: 'phrase', paragraph, found: match[0] });
    if (INVISIBLE.test(text)) marks.push({ kind: 'invisible', paragraph, found: text.trim().slice(0, 60) });
    const emoji = EMOJI.exec(text);
    if (emoji) marks.push({ kind: 'emoji', paragraph, found: emoji[0] });
  });
  return marks;
}
