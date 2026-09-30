import type { Mode } from '../shared/aiConfig';
import type { DocumentGraph, StructureIssue } from './structure';
import { MAX_INSTRUCTION_CHARS, type ReviewFinding } from '../shared/aiConfig';

/** A request the structure view hands to the assistant: where to put the cursor, and what to ask */
export interface StructureRequest {
  paragraph: number;
  /** select: work on the paragraph; before / after: insert in front of it or behind it */
  cursor: 'select' | 'before' | 'after';
  mode: Mode;
  instruction: string;
  /** Short label shown in the chat instead of the long instruction */
  label: string;
  /** The paragraph's text when the structure map was built; set by the structure view */
  expectedText?: string;
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
    // Removed without AI, straight from the structure view
    case 'duplicate-inline':
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
    // At the end of the paragraph before the first section (the preamble): inserted in front of a numbered
    // paragraph, the new text would take over its numbering and shift every section number
    ...(firstSection && firstSection.paragraph > 0
      ? { paragraph: firstSection.paragraph - 1, cursor: 'after' as const }
      : firstSection
      ? { paragraph: 0, cursor: 'before' as const }
      : { paragraph: Math.min(1, Math.max(0, paragraphCount - 1)), cursor: paragraphCount > 1 ? 'before' as const : 'after' as const }),
    mode: 'generate',
    label: 'Fogalommeghatározások fejezet készítése',
    instruction: `Készíts „Fogalommeghatározások” című fejezetet a szerződés elejére. Az első sor a fejezet címe legyen, utána minden fogalom külön bekezdésben, betűrendben, ebben a formában: „Fogalom”: jelenti …
A szerződés jelenleg ezeket a fogalmakat definiálja (a definíció szövegével vagy azzal a mondattal, ahol definiálja):
${terms || '- (nincs még definiált fogalom)'}
A definíciók tartalmát a szerződés meglévő szövege alapján fogalmazd meg, ne találj ki új feltételt. Ha a szerződés nagybetűvel, fogalomként használ olyan kifejezést, amely még nincs definiálva, azt is vedd fel, és a meghatározás végén jelöld: [ellenőrizendő].`,
  };
}

/**
 * Structure problems that appeared with a change: counted by kind and subject, because paragraph numbers move
 * when text is inserted.
 */
export function newIssues(before: StructureIssue[], after: StructureIssue[]): StructureIssue[] {
  const key = (issue: StructureIssue) => `${issue.kind}|${issue.subject}`;
  const counts = new Map<string, number>();
  before.forEach(issue => counts.set(key(issue), (counts.get(key(issue)) ?? 0) + 1));
  return after.filter(issue => {
    const left = counts.get(key(issue)) ?? 0;
    if (left > 0) {
      counts.set(key(issue), left - 1);
      return false;
    }
    return true;
  });
}

const short = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

/**
 * After some findings were taken and others left out: ask for a consistency review of the result, telling the AI
 * what was decided (numbering, references, terms and logic can break when only part of a set of fixes is applied).
 */
export function recheckInstruction(applied: ReviewFinding[], dismissed: ReviewFinding[]): string {
  const head = 'Az előző átvizsgálás észrevételei közül';
  const tail = `Nézd át a teljes dokumentumot a döntéseim után: maradt-e vagy keletkezett-e következetlenség a számozásban, a kereszthivatkozásokban, a definiált fogalmak használatában és a logikában (pl. egy elfogadott javítás ellentmond egy elvetett rész szövegének). Az elvetett észrevételeket ne ismételd meg, hacsak egy elfogadott javítás miatt most már valódi hibát okoznak.`;
  const list = (items: ReviewFinding[], max: number) => items.map(f => `- ${short(f.comment, max)}`).join('\n');
  // The instruction has a length limit: shorten the lines until everything fits
  for (const max of [160, 110, 70, 40]) {
    const text = `${head} ezeket fogadtam el (a dokumentumba beírva):\n${list(applied, max) || '- (egyiket sem)'}\nEzeket elvetettem:\n${list(dismissed, max) || '- (egyiket sem)'}\n${tail}`;
    if (text.length <= MAX_INSTRUCTION_CHARS) return text;
  }
  return `${head} ${applied.length}-t elfogadtam, ${dismissed.length}-t elvetettem. ${tail}`.slice(0, MAX_INSTRUCTION_CHARS);
}
