/**
 * Before a document goes to the other side: what must not go with it. Rule-based; the Word layer collects the
 * raw facts (tracked changes, comments, the document's OOXML, its properties), these functions find the problems.
 */

export interface Placeholder {
  paragraph: number;
  /** What was found: "[●]", "XX", "……", "TBD" */
  found: string;
  /** The text around it, to recognise the place */
  context: string;
}

/**
 * Unfilled places: [●], [•], [...], [név], XX, ….., ______ inside a sentence, TBD, TODO, ??. A line that is only
 * underscores or dots is a signature line, not a gap.
 */
const PLACEHOLDER = /\[[^\]\n]{0,40}\]|(?<![\p{L}\d])X{2,}(?![\p{L}\d.])|…{2,}|\.{4,}|_{3,}|(?<![\p{L}])(?:TBD|TODO|TBC|tbd)(?![\p{L}])|\?{2,}/gu;
const SIGNATURE_ONLY = /^[\s_.…\-–:]*$/;
/* XX. is a Roman numeral (2026. évi XX. törvény), not a gap */
/** A bracket that is part of the law or a citation, not a gap: [1], [Ptk.], [sic] */
const LEGIT_BRACKET = /^\[(\d{1,3}|sic|Ptk\.?|Pp\.?)\]$/i;

export function findPlaceholders(texts: string[]): Placeholder[] {
  const found: Placeholder[] = [];
  texts.forEach((text, paragraph) => {
    // A signature line ("________________", "Kelt: ……………") is meant to stay empty
    if (SIGNATURE_ONLY.test(text) || /^\s*(Kelt|Dátum|Aláírás|Név)\s*:?[\s_.…]*$/iu.test(text)) return;
    for (const match of text.matchAll(PLACEHOLDER)) {
      if (LEGIT_BRACKET.test(match[0])) continue;
      const start = Math.max(0, match.index! - 30);
      const end = Math.min(text.length, match.index! + match[0].length + 30);
      found.push({ paragraph, found: match[0], context: `${start > 0 ? '…' : ''}${text.slice(start, end).trim()}${end < text.length ? '…' : ''}` });
    }
  });
  return found;
}

export interface MarkedText {
  text: string;
  /** Highlight colour ("yellow"); for hidden text "hidden" */
  mark: string;
}

const decode = (text: string) => text.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');

/**
 * Highlighted and hidden text in a document's OOXML (body.getOoxml()): runs next to each other with the same mark
 * are joined, so "fizet 26 000 000 Ft-ot" comes back as one piece, not word by word.
 */
export function findMarkedRuns(ooxml: string): { highlights: MarkedText[]; hidden: MarkedText[] } {
  const highlights: MarkedText[] = [];
  const hidden: MarkedText[] = [];
  // Only the document body (a flat OPC package also holds styles, where <w:vanish/> may define a hidden style)
  const body = /<w:body>([\s\S]*)<\/w:body>/.exec(ooxml)?.[1] ?? ooxml;
  for (const paragraph of body.split(/<\/w:p>/)) {
    let current: MarkedText | null = null;
    let currentHidden: MarkedText | null = null;
    for (const run of paragraph.matchAll(/<w:r[ >][\s\S]*?<\/w:r>/g)) {
      const xml = run[0];
      const text = decode([...xml.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g)].map(m => m[1]).join(''));
      if (!text) continue;
      const props = /<w:rPr>([\s\S]*?)<\/w:rPr>/.exec(xml)?.[1] ?? '';
      const color = /<w:highlight w:val="([^"]+)"/.exec(props)?.[1];
      const isHidden = /<w:vanish\s*\/>|<w:vanish w:val="(?:1|true|on)"\s*\/>/.test(props);
      if (color && color !== 'none') {
        if (current && current.mark === color) current.text += text;
        else highlights.push((current = { text, mark: color }));
      } else {
        current = null;
      }
      if (isHidden) {
        if (currentHidden) currentHidden.text += text;
        else hidden.push((currentHidden = { text, mark: 'hidden' }));
      } else {
        currentHidden = null;
      }
    }
  }
  const tidy = (list: MarkedText[]) => list.map(m => ({ ...m, text: m.text.replace(/\s+/g, ' ').trim() })).filter(m => m.text);
  return { highlights: tidy(highlights), hidden: tidy(hidden) };
}

export const HIGHLIGHT_NAMES: Record<string, string> = {
  yellow: 'sárga', green: 'zöld', cyan: 'türkiz', magenta: 'rózsaszín', blue: 'kék', red: 'piros', darkBlue: 'sötétkék',
  darkCyan: 'sötét türkiz', darkGreen: 'sötétzöld', darkMagenta: 'lila', darkRed: 'bordó', darkYellow: 'mustár', darkGray: 'sötétszürke',
  lightGray: 'világosszürke', black: 'fekete',
};

/** Document properties that tell who worked on it and how: shown, and those Word lets change can be cleared */
export interface DocumentPropertiesInfo {
  author: string;
  lastAuthor: string;
  company: string;
  manager: string;
  title: string;
  subject: string;
  keywords: string;
  comments: string;
  category: string;
  template: string;
}

export const PROPERTY_LABELS: Record<keyof DocumentPropertiesInfo, string> = {
  author: 'Szerző', lastAuthor: 'Utoljára mentette', company: 'Cég', manager: 'Vezető', title: 'Cím', subject: 'Tárgy',
  keywords: 'Kulcsszavak', comments: 'Megjegyzés (tulajdonság)', category: 'Kategória', template: 'Sablon',
};

/** The properties that can be cleared from here (Word sets the last author and the template itself) */
export const CLEARABLE_PROPERTIES: (keyof DocumentPropertiesInfo)[] = ['author', 'company', 'manager', 'keywords', 'comments', 'category', 'subject'];
