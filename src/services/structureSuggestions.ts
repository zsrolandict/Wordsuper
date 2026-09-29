import type { Mode } from '../shared/aiConfig';
import type { DocumentGraph, StructureIssue } from './structure';

/** A request the structure view hands to the assistant: where to put the cursor, and what to ask */
export interface StructureRequest {
  paragraph: number;
  /** select: work on the paragraph; before: insert in front of it */
  cursor: 'select' | 'before';
  mode: Mode;
  instruction: string;
  /** Short label shown in the chat instead of the long instruction */
  label: string;
}

const MAX_LISTED_SECTIONS = 80;

/** "5.2 (Határidők)" lines, so the AI knows which sections really exist */
function sectionList(graph: DocumentGraph): string {
  const sections = graph.sections.filter(s => s.kind === 'section');
  const lines = sections.slice(0, MAX_LISTED_SECTIONS).map(s => `- ${s.label}. pont${s.title ? `: ${s.title.slice(0, 70)}` : ''}`);
  if (sections.length > MAX_LISTED_SECTIONS) lines.push(`- … és még ${sections.length - MAX_LISTED_SECTIONS} pont`);
  return lines.join('\n');
}

/** The fix request for a structure issue; null when there is nothing to fix in the text (a missing annex) */
export function requestForIssue(issue: StructureIssue, graph: DocumentGraph): StructureRequest | null {
  const base = { paragraph: issue.at.paragraph, cursor: 'select' as const, mode: 'edit' as const };
  switch (issue.kind) {
    case 'broken-reference':
      return {
        ...base,
        label: `Hibás hivatkozás javítása: „${issue.subject}”`,
        instruction: `Ebben a bekezdésben a „${issue.subject}” hivatkozás olyan pontra mutat, amely nincs a dokumentumban.
A dokumentum létező pontjai:
${sectionList(graph) || '- (nem találtam számozott pontot)'}
Javítsd a hivatkozást arra a pontra, amelyre tartalmilag mutatnia kell. A bekezdés többi részét ne változtasd meg. Ha nem egyértelmű, melyik a helyes pont, hagyd változatlanul a szöveget, és a magyarázatban írd le a lehetőségeket.`,
      };
    case 'unused':
      return {
        ...base,
        label: `Nem használt fogalom: „${issue.subject}”`,
        instruction: `A „${issue.subject}” fogalom ebben a bekezdésben van definiálva, de a szerződés sehol nem használja.
Ha a szerződés más szóval hivatkozik ugyanarra, igazítsd hozzá a definíciót; ha a definíció felesleges, hagyd el belőle úgy, hogy a bekezdés többi része változatlan és értelmes maradjon. A magyarázatban írd le, melyiket választottad és miért.`,
      };
    case 'duplicate':
      return {
        ...base,
        label: `Kétszer definiált fogalom: „${issue.subject}”`,
        instruction: `A „${issue.subject}” fogalom ebben a bekezdésben másodszor van definiálva. Szüntesd meg itt a kettős definíciót (hagyd el ezt a definíciót, vagy hivatkozz az elsőre); ha a két definíció tartalma eltér, a magyarázatban jelezd az eltérést. A bekezdés többi részét ne változtasd meg.`,
      };
    case 'undefined-quoted':
      return {
        ...base,
        label: `Definíció létrehozása: „${issue.subject}”`,
        instruction: `A „${issue.subject}” kifejezés idézőjelben, fogalomként szerepel ebben a bekezdésben, de a dokumentum nem definiálja.
Egészítsd ki a bekezdést úgy, hogy itt, az első előfordulásnál legyen definiálva, a dokumentum tartalma alapján (pl. „… (a továbbiakban: ${issue.subject})”). A bekezdés többi részét ne változtasd meg.`,
      };
    case 'missing-annex':
      return null;
  }
}

/**
 * A "Fogalommeghatározások" section generated from the terms the contract defines, inserted before the first
 * numbered section (or after the title when there is none).
 */
export function requestForDefinitionsSection(graph: DocumentGraph, paragraphCount: number): StructureRequest {
  const firstSection = graph.sections.find(s => s.kind === 'section');
  const terms = [...graph.terms]
    .sort((a, b) => a.term.localeCompare(b.term, 'hu'))
    .map(t => `- „${t.term}”: ${t.definition.replace(/\s+/g, ' ').slice(0, 300)}`)
    .join('\n');
  return {
    paragraph: firstSection ? firstSection.paragraph : Math.min(1, Math.max(0, paragraphCount - 1)),
    cursor: 'before',
    mode: 'generate',
    label: 'Fogalommeghatározások fejezet készítése',
    instruction: `Készíts „Fogalommeghatározások” című fejezetet a szerződés elejére. Az első sor a fejezet címe legyen, utána minden fogalom külön bekezdésben, betűrendben, ebben a formában: „Fogalom”: jelenti …
A szerződés jelenleg ezeket a fogalmakat definiálja (a definíció szövegével vagy azzal a mondattal, ahol definiálja):
${terms || '- (nincs még definiált fogalom)'}
A definíciók tartalmát a szerződés meglévő szövege alapján fogalmazd meg, ne találj ki új feltételt. Ha a szerződés nagybetűvel, fogalomként használ olyan kifejezést, amely még nincs definiálva, azt is vedd fel, és a meghatározás végén jelöld: [ellenőrizendő].`,
  };
}
