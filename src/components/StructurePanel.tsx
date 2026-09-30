import React, { useCallback, useEffect, useRef, useState } from 'react';
import { RefreshCw, BookOpen, Link2, AlertTriangle, CornerUpLeft, Loader2, ArrowRight, Unlink, Copy, CircleSlash, Quote, Info, Wand2, ListPlus, Eraser } from 'lucide-react';
import { requestForDefinitionsSection, requestForIssue, type StructureRequest } from '../services/structureSuggestions';
import { buildDocumentGraph, findAt, sectionPreview, type DocumentGraph, type FoundAt, type IssueKind, type ParagraphInfo, type StructureIssue } from '../services/structure';
import { UserFacingError, deleteTextsInParagraphs, jumpBack, jumpToParagraph, onSelectionChanged, readCursor, readParagraphs, releaseRange } from '../services/wordDocument';
import { formatNumber } from '../services/format';

interface Loaded {
  paragraphs: ParagraphInfo[];
  graph: DocumentGraph;
}

const ISSUE_ICONS: Record<IssueKind, React.ReactNode> = {
  'broken-reference': <Unlink className="w-3.5 h-3.5 text-red-600" />,
  'missing-annex': <Info className="w-3.5 h-3.5 text-neutral-500" />,
  duplicate: <Copy className="w-3.5 h-3.5 text-amber-600" />,
  'duplicate-inline': <Copy className="w-3.5 h-3.5 text-amber-600" />,
  unused: <CircleSlash className="w-3.5 h-3.5 text-amber-600" />,
  'undefined-quoted': <Quote className="w-3.5 h-3.5 text-amber-600" />,
};

function JumpButton({ onClick, label = 'Ugrás' }: { onClick: () => void; label?: string }) {
  return (
    <button onClick={onClick} className="flex items-center shrink-0 text-[11px] font-medium text-blue-700 hover:text-blue-900">
      {label}
      <ArrowRight className="w-3 h-3 ml-0.5" />
    </button>
  );
}

/**
 * Szerkezet nézet: definiált fogalmak, kereszthivatkozások és a hibáik – AI nélkül, azonnal.
 * A kurzor alatti fogalom definíciója vagy a hivatkozott pont szövege görgetés nélkül látszik.
 */
export default function StructurePanel({ active, busy, documentVersion, onRequest }: {
  active: boolean;
  /** Goes up whenever the assistant changed the document: the map is read again when the tab is open */
  documentVersion: number;
  /** An AI request is running; the suggestion buttons wait for it */
  busy: boolean;
  /** Hands a fix or a new section over to the assistant */
  onRequest: (request: StructureRequest) => void;
}) {
  const [data, setData] = useState<Loaded | null>(null);
  const [loading, setLoading] = useState(false);
  // The document version the map was built for; an older map is rebuilt as soon as the tab is shown
  const [builtFor, setBuiltFor] = useState(-1);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [atCursor, setAtCursor] = useState<FoundAt | null>(null);
  const [cursorOutdated, setCursorOutdated] = useState(false);
  const [list, setList] = useState<'issues' | 'terms'>('issues');
  // Where the user was before the first jump; "Vissza" returns there
  const [back, setBack] = useState<Word.Range | null>(null);
  const backRef = useRef<Word.Range | null>(null);
  backRef.current = back;

  const rebuild = useCallback(async () => {
    if (typeof Word === 'undefined') return;
    setBuiltFor(documentVersion);
    setLoading(true);
    setError(null);
    try {
      const paragraphs = await readParagraphs();
      setData({ paragraphs, graph: buildDocumentGraph(paragraphs) });
    } catch (e) {
      console.error(e);
      setError('Nem sikerült beolvasni a dokumentumot. Próbáld újra a Frissítés gombbal.');
    } finally {
      setLoading(false);
    }
  }, [documentVersion]);

  // First build when the tab is opened, and again after the assistant changed the document
  useEffect(() => {
    if (active && !loading && (!data || builtFor !== documentVersion)) rebuild();
  }, [active, data, loading, rebuild, builtFor, documentVersion]);

  // Release a remembered position when the pane goes away
  useEffect(() => () => { releaseRange(backRef.current); }, []);

  // What is under the cursor
  useEffect(() => {
    if (!active || !data) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const update = () => {
      clearTimeout(timer);
      timer = setTimeout(async () => {
        try {
          const { paragraphText, offset } = await readCursor();
          const index = data.paragraphs.findIndex(p => p.text === paragraphText);
          if (cancelled) return;
          // The paragraph isn't in the map: the document changed since it was built
          setCursorOutdated(index === -1 && paragraphText.trim() !== '');
          setAtCursor(index === -1 ? null : findAt(data.graph, index, offset));
        } catch {
          // The document is busy; the next selection change retries
        }
      }, 300);
    };
    update();
    const unsubscribe = onSelectionChanged(update);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      unsubscribe();
    };
  }, [active, data]);

  // Remembers the paragraph's text, so a stale map can't point the assistant at the wrong paragraph
  const requestFix = (r: StructureRequest) => onRequest({ ...r, expectedText: data?.paragraphs[r.paragraph]?.text });

  /** Deletes redundant inline definitions with Track Changes (no AI), then reads the document again */
  const removeInline = async (issues: StructureIssue[]) => {
    if (!data) return;
    const items = issues.filter(i => i.removal).map(i => ({ paragraph: i.at.paragraph, expectedText: data.paragraphs[i.at.paragraph]?.text ?? '', text: i.removal! }));
    setError(null);
    setNotice(null);
    try {
      const { deleted, skipped } = await deleteTextsInParagraphs(items);
      setNotice(`✅ ${deleted} zárójeles definíciót töröltem korrektúrával.` + (skipped ? ` ${skipped} bekezdés azóta megváltozott, azokat kihagytam.` : ''));
      await rebuild();
    } catch {
      setError('Nem sikerült törölni. Esetleg írásvédett a dokumentum?');
    }
  };

  const jump = async (paragraph: number) => {
    setError(null);
    try {
      const previous = await jumpToParagraph(paragraph, backRef.current === null);
      if (previous) setBack(previous);
    } catch (e) {
      setError(e instanceof UserFacingError ? e.message : 'Nem sikerült odaugrani.');
    }
  };

  const goBack = async () => {
    const range = backRef.current;
    if (!range) return;
    setBack(null);
    try {
      await jumpBack(range);
    } catch {
      setError('A korábbi hely már nem érhető el.');
    }
  };

  if (typeof Word === 'undefined') {
    return <p className="p-4 text-sm text-neutral-500">A Szerkezet nézet csak Wordben működik.</p>;
  }

  const graph = data?.graph;
  const referenceCount = graph?.references.length ?? 0;

  return (
    <div className="flex-1 min-h-0 flex flex-col text-sm">
      {/* A kurzornál */}
      <div className="p-3 border-b border-neutral-200 bg-white space-y-2">
        <div className="rounded-xl border border-blue-200 bg-blue-50 p-3 min-h-[76px]">
          {!data ? (
            <p className="text-xs text-neutral-500 flex items-center"><Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" />Beolvasom a dokumentumot…</p>
          ) : atCursor?.type === 'term' ? (
            <>
              <div className="flex items-center justify-between mb-1">
                <span className="flex items-center font-semibold text-blue-900"><BookOpen className="w-4 h-4 mr-1" />{atCursor.term.term}</span>
                <JumpButton onClick={() => jump(atCursor.term.definedAt.paragraph)} label="A definícióhoz" />
              </div>
              <p className="text-xs text-neutral-700 whitespace-pre-wrap max-h-32 overflow-y-auto">{atCursor.term.definition}</p>
              <p className="text-[11px] text-neutral-500 mt-1">{formatNumber(atCursor.term.usages.length)} helyen használja a szerződés.</p>
            </>
          ) : atCursor?.type === 'reference' ? (
            <>
              <div className="flex items-center justify-between mb-1">
                <span className="flex items-center font-semibold text-blue-900"><Link2 className="w-4 h-4 mr-1" />{atCursor.reference.raw}</span>
                {atCursor.reference.target !== null && <JumpButton onClick={() => jump(atCursor.reference.target!)} label="A ponthoz" />}
              </div>
              {atCursor.reference.target !== null ? (
                <p className="text-xs text-neutral-700 whitespace-pre-wrap max-h-40 overflow-y-auto">{sectionPreview(data.paragraphs, data.graph, atCursor.reference.target)}</p>
              ) : (
                <p className="text-xs text-red-700 flex items-start"><Unlink className="w-3.5 h-3.5 mr-1 mt-px shrink-0" />Ez a pont nem található ebben a dokumentumban.</p>
              )}
            </>
          ) : (
            <p className="text-xs text-neutral-600">
              Kattints a szövegben egy definiált fogalomra (pl. <em>Megbízó</em>) vagy egy hivatkozásra (pl. <em>5.2. pont</em>), és itt megjelenik a jelentése – görgetés nélkül.
              {cursorOutdated && <span className="block mt-1 text-amber-700">A dokumentum változott a beolvasás óta – nyomd meg a Frissítést.</span>}
            </p>
          )}
        </div>
        {back && (
          <button onClick={goBack} className="flex items-center text-xs font-medium text-blue-700 hover:text-blue-900">
            <CornerUpLeft className="w-3.5 h-3.5 mr-1" />Vissza oda, ahol voltál
          </button>
        )}
        {error && <p className="text-xs text-red-700">{error}</p>}
      </div>

      {/* Összesítő és listák */}
      <div className="px-3 pt-3 flex items-center justify-between text-xs text-neutral-600">
        <span>
          {graph
            ? `${formatNumber(graph.terms.length)} fogalom · ${formatNumber(referenceCount)} hivatkozás · ${formatNumber(graph.issues.length)} probléma`
            : '…'}
        </span>
        <button onClick={rebuild} disabled={loading} className="flex items-center text-blue-700 hover:text-blue-900 disabled:opacity-50">
          <RefreshCw className={`w-3.5 h-3.5 mr-1 ${loading ? 'animate-spin' : ''}`} />Frissítés
        </button>
      </div>
      <div className="px-3 pt-2 flex space-x-1 text-xs">
        {(['issues', 'terms'] as const).map(key => (
          <button
            key={key}
            onClick={() => setList(key)}
            className={`px-2.5 py-1 rounded-full border ${list === key ? 'bg-neutral-800 text-white border-neutral-800' : 'border-neutral-300 text-neutral-600 hover:bg-neutral-100'}`}
          >
            {key === 'issues' ? `Problémák (${graph?.issues.length ?? 0})` : `Fogalmak (${graph?.terms.length ?? 0})`}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {notice && <p className="text-xs text-green-700">{notice}</p>}
        {graph && list === 'issues' && graph.issues.filter(i => i.removal).length > 1 && (
          <button
            onClick={() => removeInline(graph.issues.filter(i => i.removal))}
            disabled={busy}
            className="w-full flex items-center justify-center py-1.5 text-xs font-medium border border-amber-300 bg-amber-50 text-amber-900 hover:bg-amber-100 disabled:opacity-50 rounded-lg"
          >
            <Eraser className="w-3.5 h-3.5 mr-1" />
            Mind a {graph.issues.filter(i => i.removal).length} felesleges zárójeles definíció törlése (korrektúrával)
          </button>
        )}
        {graph && list === 'issues' && (graph.issues.length === 0 ? (
          <p className="text-xs text-green-700">✅ Nem találtam hibát a definíciókban és a hivatkozásokban.</p>
        ) : graph.issues.map((issue, i) => (
          <div key={i} className="flex items-start justify-between bg-white border border-neutral-200 rounded-lg p-2">
            <span className="flex items-start text-xs text-neutral-700 min-w-0">
              <span className="mr-1.5 mt-px shrink-0">{ISSUE_ICONS[issue.kind]}</span>
              <span className="break-words">{issue.message}</span>
            </span>
            <span className="ml-2 flex flex-col items-end space-y-1">
              <JumpButton onClick={() => jump(issue.at.paragraph)} />
              {issue.removal && (
                <button
                  onClick={() => removeInline([issue])}
                  disabled={busy}
                  title={`Törli korrektúrával: „${issue.removal.trim()}”`}
                  className="flex items-center shrink-0 text-[11px] font-medium text-emerald-700 hover:text-emerald-900 disabled:opacity-50"
                >
                  <Eraser className="w-3 h-3 mr-0.5" />Törlés
                </button>
              )}
              {(() => {
                const request = requestForIssue(issue, graph);
                return request && (
                  <button
                    onClick={() => request && requestFix(request)}
                    disabled={busy}
                    title="Az AI korrektúrás javítást javasol erre a bekezdésre (előbb megmutatja)"
                    className="flex items-center shrink-0 text-[11px] font-medium text-emerald-700 hover:text-emerald-900 disabled:opacity-50"
                  >
                    <Wand2 className="w-3 h-3 mr-0.5" />
                    {issue.kind === 'undefined-quoted' ? 'Definiálás' : 'Javaslat'}
                  </button>
                );
              })()}
            </span>
          </div>
        )))}

        {graph && data && list === 'terms' && (
          <button
            onClick={() => requestFix(requestForDefinitionsSection(graph, data.paragraphs.length))}
            disabled={busy}
            title="Az AI megírja a fejezetet a szerződés meglévő definíciói alapján; beszúrás előtt megmutatja"
            className="w-full flex items-center justify-center py-1.5 text-xs font-medium border border-emerald-300 bg-emerald-50 text-emerald-800 hover:bg-emerald-100 disabled:opacity-50 rounded-lg"
          >
            <ListPlus className="w-3.5 h-3.5 mr-1" />
            Fogalommeghatározások fejezet készítése
          </button>
        )}
        {graph && list === 'terms' && (graph.terms.length === 0 ? (
          <p className="text-xs text-neutral-500">Nem találtam definiált fogalmat (pl. „(a továbbiakban: Megbízó)” vagy „„Szerződés”: jelenti…”).</p>
        ) : [...graph.terms].sort((a, b) => a.term.localeCompare(b.term, 'hu')).map(term => (
          <div key={term.term} className="bg-white border border-neutral-200 rounded-lg p-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-neutral-800">{term.term}</span>
              <JumpButton onClick={() => jump(term.definedAt.paragraph)} label="Definíció" />
            </div>
            <p className={`text-[11px] ${term.usages.length === 0 ? 'text-amber-700' : 'text-neutral-500'}`}>
              {term.usages.length === 0
                ? <span className="flex items-center"><AlertTriangle className="w-3 h-3 mr-1" />Sehol nincs használva</span>
                : `${formatNumber(term.usages.length)} használat`}
            </p>
          </div>
        )))}
      </div>
    </div>
  );
}
