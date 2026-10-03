import { roleOf, type FormatAudit } from './formatting';

/**
 * Traces that a text was written or pasted from an AI chat, only pointed out (never changed): the wording is the
 * lawyer's decision. Rule-based, on the paragraphs read for the Formázás tab.
 */

export type AiMarkKind = 'phrase' | 'titleCase' | 'bold' | 'invisible' | 'emoji';

export interface AiMark {
  kind: AiMarkKind;
  /** Paragraph index (as read), for "Ugrás" */
  paragraph: number;
  /** What was found ("Fontos megjegyezni", "A Szerződés Tárgya") */
  found: string;
}

export const AI_MARK_LABELS: Record<AiMarkKind, { label: string; hint: string }> = {
  phrase: { label: 'Tipikus AI-fordulat', hint: 'Töltelék vagy túlzó kifejezés; érdemes egyszerűbben, konkrétabban megfogalmazni.' },
  titleCase: { label: 'Angolos nagybetűs cím', hint: 'Magyarul a címben csak az első szó (és a tulajdonnév, definiált fogalom) nagy kezdőbetűs.' },
  bold: { label: 'Hosszú félkövér bekezdés', hint: 'Az AI gyakran egész bekezdéseket emel ki; a jogi szövegben a kiemelés ritka és célzott.' },
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
const LONG_BOLD_CHARS = 200;

/** "A Szerződés Tárgya": two or more longer words, all capitalized, the whole not in capitals */
function isTitleCase(text: string): boolean {
  const words: string[] = text.match(/\p{L}+/gu) ?? [];
  const long = words.filter(w => w.length > 3);
  if (long.length < 2 || text === text.toLocaleUpperCase('hu')) return false;
  return long.every(w => w[0] === w[0].toLocaleUpperCase('hu') && w.slice(1) === w.slice(1).toLocaleLowerCase('hu'));
}

export function findAiMarks(audit: FormatAudit): AiMark[] {
  const marks: AiMark[] = [];
  audit.paragraphs.forEach((p, paragraph) => {
    const text = p.text;
    if (!text.trim()) return;
    for (const match of text.matchAll(PHRASE)) marks.push({ kind: 'phrase', paragraph, found: match[0] });
    const role = roleOf(p).kind;
    if ((role === 'heading' || role === 'fake-heading' || role === 'title') && isTitleCase(text.trim())) marks.push({ kind: 'titleCase', paragraph, found: text.trim() });
    if (role === 'body' && p.bold === true && text.length > LONG_BOLD_CHARS) marks.push({ kind: 'bold', paragraph, found: `${text.slice(0, 60)}…` });
    if (INVISIBLE.test(text)) marks.push({ kind: 'invisible', paragraph, found: text.trim().slice(0, 60) });
    const emoji = EMOJI.exec(text);
    if (emoji) marks.push({ kind: 'emoji', paragraph, found: emoji[0] });
  });
  return marks;
}
