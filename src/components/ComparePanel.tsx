import React, { useRef, useState } from 'react';
import { FileUp, Loader2, Sparkles, Square, MessageSquarePlus, AlertTriangle, KeyRound, FileDiff, Check, X } from 'lucide-react';
import { MAX_COMPARE_CHARS, MAX_INSTRUCTION_CHARS, type AIRequestBody } from '../shared/aiConfig';
import { describeRequestError, needsSettings, streamAIResponse, type RateLimitInfo } from '../services/aiService';
import { readDocxParagraphs } from '../services/docxText';
import { carryOver, compareVersions, formatChangesForAI, parseCompareResult, type ChangeAssessment, type VersionChange } from '../services/versionCompare';
import { UserFacingError, canResolveRevisions, insertCommentsAtParagraphs, jumpToParagraph, readParagraphs, readRevisions, resolveRevisions } from '../services/wordDocument';
import { SEVERITY_LABELS } from '../services/review';
import { describeStyle, type Settings } from '../services/settings';
import { formatNumber } from '../services/format';
import { Masker, parseExtraTerms, unresolvedPlaceholders } from '../services/masking';
import { playSound, primeSound } from '../services/sound';
import { DiffView, SEVERITY_STYLES } from './Proposal';
import RequestDetails, { type RequestDetailsData } from './RequestDetails';
import { DEFAULT_PRESETS, PLACEHOLDERS } from './modes';

interface Comparison {
  /** file: an uploaded earlier version; tracked: the document's own pending tracked changes */
  source: 'file' | 'tracked';
  fileName: string;
  changes: VersionChange[];
  /** Texts of the current document's paragraphs when the comparison was made, as Word reports them */
  currentTexts: string[];
  /** Tracked changes: who made them, per Word paragraph; null when unknown */
  authors: Map<number, string[]> | null;
}

/**
 * The Word paragraphs a change is about. For tracked changes both versions are the same Word paragraphs, so a
 * removed paragraph is still there (struck through) at its old index.
 */
function paragraphsOf(comparison: Comparison, change: VersionChange): number[] {
  if (comparison.source === 'file') return [change.paragraph];
  const indices = change.type === 'removed' ? [change.oldParagraph] : change.type === 'added' ? [change.paragraph] : [change.paragraph, change.oldParagraph];
  return [...new Set(indices.filter((i): i is number => i !== undefined))];
}

/** Where a change's comment goes and where "Ugrás" jumps */
const anchorOf = (comparison: Comparison, change: VersionChange) => paragraphsOf(comparison, change)[0] ?? change.paragraph;

const authorsOf = (comparison: Comparison, change: VersionChange) =>
  comparison.authors ? [...new Set(paragraphsOf(comparison, change).flatMap(i => comparison.authors!.get(i) ?? []))] : [];

interface Analysis {
  running: boolean;
  overview?: string;
  assessments?: Map<number, ChangeAssessment>;
  /** What was sent before masking (the change list, the instruction), to tell the document's own text from placeholders */
  sources?: string[];
  error?: string;
  authProblem?: boolean;
  details: RequestDetailsData;
}

const TYPE_LABELS: Record<VersionChange['type'], { label: string; className: string }> = {
  modified: { label: 'Módosult', className: 'bg-blue-100 text-blue-800' },
  added: { label: 'Új', className: 'bg-green-100 text-green-800' },
  removed: { label: 'Törölve', className: 'bg-red-100 text-red-800' },
};

const quoteStart = (text: string) => (text.length > 120 ? `${text.slice(0, 120)}…` : text);

/** The comment attached to a changed paragraph */
function commentFor(change: VersionChange, assessment: ChangeAssessment): string {
  const removed = change.type === 'removed' ? `Törölt rész: „${quoteStart(change.oldText)}” – ` : '';
  const recommendation = assessment.recommendation ? ` Javaslat: ${assessment.recommendation}` : '';
  return `[${SEVERITY_LABELS[assessment.risk]} kockázat] ${removed}${assessment.summary}${recommendation}`;
}

/**
 * Összevetés nézet: egy korábbi változat (.docx) és a megnyitott dokumentum különbségei,
 * AI-értékeléssel és megjegyzésekkel a megváltozott bekezdéseknél.
 */
export default function ComparePanel({
  settings,
  party,
  prepareSend,
  onRateLimit,
  onOpenSettings,
  onNeverHide,
}: {
  settings: Settings;
  /** The represented party: the changes are judged from its point of view */
  party: string;
  /** Masks the request, and shows it before sending when the settings ask for it; null: the user cancelled */
  prepareSend: (request: AIRequestBody, masker: Masker | null) => Promise<{ sent: AIRequestBody; masker: Masker | null } | null>;
  /** A masked value the user wants the AI to see from now on */
  onNeverHide?: (value: string) => void;
  onRateLimit: (info: RateLimitInfo) => void;
  onOpenSettings: () => void;
}) {
  const [comparison, setComparison] = useState<Comparison | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [instruction, setInstruction] = useState('');
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  /** Per change: its comment is in the document, or it was skipped because the paragraph changed since */
  const [inserted, setInserted] = useState<Map<number, 'inserted' | 'skipped'>>(new Map());
  const [inserting, setInserting] = useState(false);
  const [insertStatus, setInsertStatus] = useState<string | null>(null);
  /** Tracked changes of these authors are left out of the list and of the analysis */
  const [hiddenAuthors, setHiddenAuthors] = useState<Set<string>>(new Set());
  const [resolving, setResolving] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  // Changes left out because all their authors are hidden (e.g. our own earlier edits)
  const visibleChanges = (comparison?.changes ?? []).filter(c => {
    const authors = comparison ? authorsOf(comparison, c) : [];
    return !authors.length || authors.some(a => !hiddenAuthors.has(a));
  });

  const loadEarlierVersion = async (file: File) => {
    setLoading(true);
    setError(null);
    setAnalysis(null);
    setInserted(new Map());
    setInsertStatus(null);
    try {
      const earlier = await readDocxParagraphs(await file.arrayBuffer());
      const current = (await readParagraphs()).map(p => p.text);
      setComparison({ source: 'file', fileName: file.name, changes: compareVersions(earlier, current), currentTexts: current, authors: null });
    } catch (e) {
      console.error(e);
      setComparison(null);
      setError(e instanceof Error && /docx|Word-dokumentum|tömörítés/.test(e.message) ? e.message : 'Nem sikerült összevetni a két változatot.');
    } finally {
      setLoading(false);
      if (fileInput.current) fileInput.current.value = '';
    }
  };

  /**
   * Reads the document's pending tracked changes. A fresh read of the same document (after accepting or rejecting
   * one) keeps the analysis and the decisions of the changes still there.
   */
  const loadTrackedChanges = async (keep: Comparison | null = null) => {
    setLoading(true);
    setError(null);
    if (!keep) {
      setAnalysis(null);
      setInserted(new Map());
      setInsertStatus(null);
      setHiddenAuthors(new Set());
    }
    try {
      const revisions = await readRevisions();
      const next: Comparison = {
        source: 'tracked',
        fileName: 'A dokumentum korrektúrái',
        changes: compareVersions(revisions.original, revisions.current),
        currentTexts: revisions.raw,
        authors: revisions.authors,
      };
      if (keep) {
        setAnalysis(a => a && (a.assessments ? { ...a, assessments: carryOver(keep.changes, next.changes, a.assessments) } : a));
        setSelected(s => new Set(carryOver(keep.changes, next.changes, new Map([...s].map(id => [id, true]))).keys()));
        setInserted(m => carryOver(keep.changes, next.changes, m));
      }
      setComparison(next);
    } catch (e) {
      console.error(e);
      if (!keep) setComparison(null);
      setError('Nem sikerült beolvasni a dokumentum korrektúráit.');
    } finally {
      setLoading(false);
    }
  };

  /** Accepts or rejects a change's tracked changes in Word, then reads the list again */
  const resolve = async (change: VersionChange, action: 'accept' | 'reject') => {
    if (!comparison || comparison.source !== 'tracked') return;
    setResolving(true);
    setInsertStatus(null);
    try {
      const items = paragraphsOf(comparison, change).map(paragraph => ({ paragraph, expectedText: comparison.currentTexts[paragraph] ?? '' }));
      // Only what the list shows: changes of hidden authors and formatting changes stay as they are
      const { resolved, skipped, leftAlone } = await resolveRevisions(items, action, hiddenAuthors);
      await loadTrackedChanges(comparison);
      setInsertStatus(skipped
        ? 'Ez a bekezdés azóta megváltozott, ezért nem nyúltam hozzá. Frissítettem a listát, próbáld újra.'
        : `✅ ${action === 'accept' ? 'Elfogadtam' : 'Elutasítottam'}: ${resolved} korrektúra (#${change.id}).` +
          (leftAlone ? ` A bekezdésben ${leftAlone} másik korrektúra (elrejtett szerzőé vagy formázás) változatlanul maradt.` : ''));
    } catch (e) {
      console.error(e);
      setInsertStatus('Nem sikerült. Esetleg írásvédett a dokumentum? A Wordben a Véleményezés lapon is megteheted.');
    } finally {
      setResolving(false);
    }
  };

  const analyze = async (text: string) => {
    const userInstruction = text.trim();
    if (!comparison || !userInstruction || analysis?.running) return;
    const { text: changeList, included } = formatChangesForAI(visibleChanges, MAX_COMPARE_CHARS);
    const startedAt = Date.now();
    const details: RequestDetailsData = {
      mode: 'compare',
      instruction: userInstruction,
      selectionText: '',
      contextInfo: {
        documentChars: comparison.currentTexts.join('\n').length,
        sentChars: changeList.length,
        limit: MAX_COMPARE_CHARS,
        strategy: included < visibleChanges.length ? 'truncated' : 'full',
        includedItems: included,
        totalItems: visibleChanges.length,
      },
      historyRounds: 0,
      totalRounds: 0,
      styleSummary: describeStyle(settings.styleProfile),
      thoughts: '',
      startedAt,
      party,
    };
    if (settings.sound) primeSound();
    const request: AIRequestBody = { mode: 'compare', instruction: userInstruction, originalText: '', documentContext: changeList, styleProfile: settings.styleProfile, depth: settings.depth, ...(party ? { party } : {}) };
    const prepared = await prepareSend(request, settings.masking.enabled ? new Masker(parseExtraTerms(settings.masking.extraTerms), parseExtraTerms(settings.masking.neverHide)) : null);
    if (!prepared) return;
    const { sent: sentRequest, masker } = prepared;
    const unmask = (text: string, streaming = false) => (masker ? masker.unmask(text, streaming) : text);
    details.masking = masker ? { summary: masker.summary(), entries: masker.entries() } : null;
    let rawThoughts = '';

    const controller = new AbortController();
    abortRef.current = controller;
    setInsertStatus(null);
    setAnalysis({ running: true, details });

    const updateDetails = (change: (d: RequestDetailsData) => RequestDetailsData) =>
      setAnalysis(a => a && { ...a, details: change(a.details) });

    try {
      const result = await streamAIResponse(
        sentRequest,
        {
          onText: () => {},
          onThought: chunk => {
            rawThoughts += (rawThoughts && !rawThoughts.endsWith('\n') ? '\n\n' : '') + chunk;
            updateDetails(d => ({ ...d, thoughts: unmask(rawThoughts, true) }));
          },
          onMeta: meta => updateDetails(d => ({ ...d, model: meta.model, location: meta.location })),
          onRateLimit,
        },
        { accessKey: settings.accessKey, userId: settings.userId, signal: controller.signal }
      );
      const parsed = parseCompareResult(result, new Set(visibleChanges.map(c => c.id)));
      if (!parsed) throw new Error('Az elemzés eredményét nem tudtam értelmezni.');
      // Parsed with the placeholders in it, then each text is unmasked
      const assessments = new Map([...parsed.assessments].map(([id, a]) => [id, { ...a, summary: unmask(a.summary), recommendation: unmask(a.recommendation) }]));
      const sources = [changeList, userInstruction];
      // A comment with an unresolved placeholder is never ticked (and can't be inserted, see heldPlaceholders)
      setSelected(new Set([...assessments.keys()].filter(id => {
        const change = visibleChanges.find(c => c.id === id);
        return change && !unresolvedPlaceholders(commentFor(change, assessments.get(id)!), sources).length;
      })));
      setInserted(new Map());
      if (settings.sound) playSound('done');
      setAnalysis(a => a && { ...a, running: false, overview: unmask(parsed.overview), assessments, sources, details: { ...a.details, thoughts: unmask(rawThoughts), durationMs: Date.now() - startedAt } });
    } catch (e) {
      const message = controller.signal.aborted
        ? '⏹️ Leállítottad az elemzést.'
        : e instanceof Error && e.message.startsWith('Az elemzés') ? e.message : describeRequestError(e);
      const authProblem = needsSettings(e);
      if (settings.sound && !controller.signal.aborted) playSound('error');
      setAnalysis(a => a && { ...a, running: false, error: message, authProblem, details: { ...a.details, durationMs: Date.now() - startedAt } });
    } finally {
      abortRef.current = null;
    }
  };

  /** Placeholders a change's comment still has after unmasking: such a comment is never inserted */
  const heldPlaceholders = (change: VersionChange): string[] => {
    const assessment = analysis?.assessments?.get(change.id);
    return assessment ? unresolvedPlaceholders(commentFor(change, assessment), analysis?.sources ?? []) : [];
  };

  /** Inserts the comments of the given changes (default: the ticked ones not inserted yet); each only once */
  const insertComments = async (only?: number[]) => {
    if (!comparison || !analysis?.assessments) return;
    const wanted = only ? new Set(only) : selected;
    // Changes hidden by the author filter are left out too, and so is any comment with an unresolved placeholder
    const chosen = visibleChanges.filter(c => wanted.has(c.id) && analysis.assessments!.has(c.id) && !inserted.has(c.id) && !heldPlaceholders(c).length);
    if (!chosen.length) return;
    setInserting(true);
    setInsertStatus(null);
    try {
      const outcome = await insertCommentsAtParagraphs(chosen.map(c => ({
        paragraph: anchorOf(comparison, c),
        expectedText: comparison.currentTexts[anchorOf(comparison, c)] ?? '',
        comment: commentFor(c, analysis.assessments!.get(c.id)!),
      })));
      setInserted(previous => {
        const next = new Map(previous);
        chosen.forEach((c, i) => next.set(c.id, outcome.skipped.includes(i) ? 'skipped' : 'inserted'));
        return next;
      });
      // One by one: show where it went
      if (only?.length === 1 && outcome.inserted === 1) await jumpToParagraph(anchorOf(comparison, chosen[0]), false).catch(() => {});
      setInsertStatus(`✅ ${outcome.inserted} megjegyzést beszúrtam.` +
        (outcome.skipped.length ? ` ${outcome.skipped.length} bekezdés azóta megváltozott, ezeket kihagytam – futtasd újra az összevetést.` : ''));
    } catch (e) {
      console.error(e);
      setInsertStatus('Nem sikerült beszúrni a megjegyzéseket. Esetleg írásvédett a dokumentum?');
    } finally {
      setInserting(false);
    }
  };

  const jump = async (paragraph: number) => {
    try {
      await jumpToParagraph(paragraph, false);
    } catch (e) {
      setError(e instanceof UserFacingError ? e.message : 'Nem sikerült odaugrani.');
    }
  };

  if (typeof Word === 'undefined') {
    return <p className="p-4 text-sm text-neutral-500">Az Összevetés nézet csak Wordben működik.</p>;
  }

  const changes = visibleChanges;
  const counts = { modified: 0, added: 0, removed: 0 };
  changes.forEach(c => counts[c.type]++);
  const fullListChars = comparison ? formatChangesForAI(changes, Number.MAX_SAFE_INTEGER).text.length : 0;
  const fitting = comparison ? formatChangesForAI(changes, MAX_COMPARE_CHARS).included : 0;
  const busy = loading || inserting || resolving || !!analysis?.running;
  const tracked = comparison?.source === 'tracked';
  const allAuthors = comparison?.authors ? [...new Set([...comparison.authors.values()].flat())].sort((a, b) => a.localeCompare(b, 'hu')) : [];
  const hiddenCount = (comparison?.changes.length ?? 0) - changes.length;
  // The batch button only covers ticked changes whose comment is not in the document yet
  const toInsert = changes.filter(c => selected.has(c.id) && analysis?.assessments?.has(c.id) && !inserted.has(c.id) && !heldPlaceholders(c).length).length;
  const heldCount = analysis?.assessments ? changes.filter(c => heldPlaceholders(c).length).length : 0;
  // A saved quick button sends its instruction; the button shows its label
  const presets = [
    ...DEFAULT_PRESETS.compare.map(label => ({ label, instruction: label })),
    ...settings.customPresets.filter(p => p.mode === 'compare').map(p => ({ label: p.label, instruction: p.instruction || p.label })),
  ];

  return (
    <div className="flex-1 min-h-0 overflow-y-auto p-3 space-y-3 text-sm">
      <div className="bg-white border border-neutral-200 rounded-xl p-3 space-y-2">
        <p className="text-xs text-neutral-600">
          Mit módosított a másik fél? Ha <strong>korrektúrával</strong> küldte vissza, a dokumentum korrektúráit vizsgálom.
          Ha korrektúra nélkül, töltsd fel a <strong>korábbi</strong> változatot (amit neki küldtél), és ahhoz hasonlítom.
        </p>
        <input ref={fileInput} type="file" accept=".docx" className="hidden" onChange={e => e.target.files?.[0] && loadEarlierVersion(e.target.files[0])} />
        <button
          onClick={() => loadTrackedChanges()}
          disabled={busy}
          className="w-full flex items-center justify-center py-2 text-xs font-medium bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white rounded-lg"
        >
          {loading ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <FileDiff className="w-4 h-4 mr-1" />}
          {tracked ? 'Korrektúrák újraolvasása' : 'A dokumentum korrektúráinak átvizsgálása'}
        </button>
        <button
          onClick={() => fileInput.current?.click()}
          disabled={busy}
          className="w-full flex items-center justify-center py-2 text-xs font-medium border border-blue-600 text-blue-700 hover:bg-blue-50 disabled:opacity-50 rounded-lg"
        >
          <FileUp className="w-4 h-4 mr-1" />
          {comparison?.source === 'file' ? 'Másik korábbi változat…' : 'Korábbi változat feltöltése (.docx)'}
        </button>
        {comparison && (
          <p className="text-xs text-neutral-700">
            {tracked ? <><strong>El nem fogadott korrektúrák</strong>: </> : <><strong>{comparison.fileName}</strong> → megnyitott dokumentum: </>}
            {changes.length === 0
              ? (tracked
                ? (hiddenCount ? 'a kiválasztott szerzőktől nincs.' : 'nincs (szövegváltozás). Ha a másik fél korrektúra nélkül módosított, töltsd fel a korábbi változatot.')
                : 'nincs tartalmi eltérés.')
              : `${formatNumber(changes.length)} változás (${counts.modified} módosult, ${counts.added} új, ${counts.removed} törölt bekezdés).`}
            {hiddenCount > 0 && ` ${formatNumber(hiddenCount)} elrejtve a szerzője miatt.`}
          </p>
        )}
        {tracked && allAuthors.length > 0 && (
          <div className="text-xs">
            <p className="text-neutral-500">Szerzők{allAuthors.length > 1 ? ' (akiét nem kéred, vedd ki)' : ''}:</p>
            <div className="flex flex-wrap gap-x-3 gap-y-1 mt-0.5">
              {allAuthors.map(author => (
                <label key={author} className="flex items-center space-x-1 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={!hiddenAuthors.has(author)}
                    disabled={busy}
                    onChange={() => setHiddenAuthors(h => {
                      const next = new Set(h);
                      if (next.has(author)) next.delete(author);
                      else next.add(author);
                      return next;
                    })}
                  />
                  <span>{author}</span>
                </label>
              ))}
            </div>
          </div>
        )}
        {tracked && !canResolveRevisions() && changes.length > 0 && (
          <p className="text-[11px] text-neutral-500">Ebben a Word-változatban a korrektúrák szerzőjét nem látom, és innen elfogadni sem tudom őket (Microsoft 365 kell hozzá). Az elemzés és a megjegyzések működnek.</p>
        )}
        {comparison && fitting < changes.length && (
          <p className="flex items-start text-xs text-amber-700">
            <AlertTriangle className="w-3.5 h-3.5 mr-1 mt-px shrink-0" />
            Sok a változás ({formatNumber(fullListChars)} karakter, a korlát {formatNumber(MAX_COMPARE_CHARS)}): az AI-elemzés csak az első {formatNumber(fitting)} változást látja.
          </p>
        )}
        {error && <p className="text-xs text-red-700">{error}</p>}
        {insertStatus && !(analysis && changes.length > 0) && <p className="text-xs font-medium text-green-700">{insertStatus}</p>}
      </div>

      {comparison && changes.length > 0 && (
        <div className="bg-white border border-neutral-200 rounded-xl p-3 space-y-2">
          <h3 className="text-xs font-semibold text-neutral-700 flex items-center"><Sparkles className="w-3.5 h-3.5 mr-1" />AI-elemzés</h3>
          <div className="flex flex-wrap gap-1.5">
            {presets.map(preset => (
              <button key={preset.label} onClick={() => analyze(preset.instruction)} disabled={busy} title={preset.instruction} className="px-2.5 py-1 text-[11px] bg-neutral-100 hover:bg-neutral-200 border border-neutral-200 rounded-full disabled:opacity-50">
                {preset.label}
              </button>
            ))}
          </div>
          <div className="flex space-x-2">
            <input
              value={instruction}
              onChange={e => setInstruction(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') analyze(instruction); }}
              maxLength={MAX_INSTRUCTION_CHARS}
              placeholder={PLACEHOLDERS.compare}
              className="flex-1 min-w-0 p-2 border border-neutral-300 rounded-lg text-xs bg-neutral-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            {analysis?.running ? (
              <button onClick={() => abortRef.current?.abort()} aria-label="Leállítás" className="px-2.5 bg-red-600 hover:bg-red-700 text-white rounded-lg">
                <Square className="w-3.5 h-3.5 fill-current" />
              </button>
            ) : (
              <button onClick={() => analyze(instruction)} disabled={busy || !instruction.trim()} className="px-3 text-xs font-medium bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white rounded-lg">
                Elemzés
              </button>
            )}
          </div>

          {analysis && (
            <div className="text-xs space-y-2">
              {analysis.running && <p className="flex items-center text-neutral-500"><Loader2 className="w-3.5 h-3.5 mr-1 animate-spin text-blue-600" />Elemzem a változásokat…</p>}
              {analysis.error && (
                <div className="text-red-700 whitespace-pre-wrap">
                  {analysis.error}
                  {analysis.authProblem && (
                    <button onClick={onOpenSettings} className="mt-1 flex items-center font-medium underline"><KeyRound className="w-3.5 h-3.5 mr-1" />Beállítások megnyitása</button>
                  )}
                </div>
              )}
              {analysis.overview && <p className="text-neutral-800 whitespace-pre-wrap">{analysis.overview}</p>}
              {analysis.assessments && (
                <div className="flex items-center justify-between">
                  <button
                    onClick={() => insertComments()}
                    disabled={busy || toInsert === 0}
                    className="flex items-center px-3 py-1.5 font-medium bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white rounded-lg"
                  >
                    {inserting ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <MessageSquarePlus className="w-3.5 h-3.5 mr-1" />}
                    {inserted.size ? 'A többi kijelölt beszúrása' : 'Megjegyzések beszúrása'} ({toInsert})
                  </button>
                </div>
              )}
              {heldCount > 0 && (
                <p className="text-red-700">⛔ {heldCount} értékelésben fel nem oldott helyettesítő maradt (mögötte nincs valódi adat), ezeket nem szúrom be a dokumentumba. Futtasd újra az elemzést.</p>
              )}
              {insertStatus && <p className="font-medium text-green-700">{insertStatus}</p>}
              <RequestDetails details={analysis.details} isLoading={analysis.running} onNeverHide={onNeverHide} />
            </div>
          )}
        </div>
      )}

      {changes.map(change => {
        const assessment = analysis?.assessments?.get(change.id);
        return (
          <div key={change.id} className="bg-white border border-neutral-200 rounded-xl p-3 text-xs space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="flex items-center space-x-1.5">
                <span className="text-neutral-400">#{change.id}</span>
                <span className={`px-1.5 py-0.5 rounded font-semibold text-[10px] ${TYPE_LABELS[change.type].className}`}>{TYPE_LABELS[change.type].label}</span>
                {assessment && <span className={`px-1.5 py-0.5 rounded font-semibold text-[10px] ${SEVERITY_STYLES[assessment.risk]}`}>{SEVERITY_LABELS[assessment.risk]} kockázat</span>}
              </span>
              <button onClick={() => comparison && jump(anchorOf(comparison, change))} className="text-[11px] font-medium text-blue-700 hover:text-blue-900">Ugrás →</button>
            </div>
            {tracked && comparison && authorsOf(comparison, change).length > 0 && (
              <p className="text-[11px] text-neutral-500">✎ {authorsOf(comparison, change).join(', ')}</p>
            )}
            <div className="text-sm text-neutral-800">
              {change.type === 'modified' ? <DiffView original={change.oldText} proposal={change.newText} />
                : change.type === 'added' ? <ins className="no-underline bg-green-50 text-green-800 whitespace-pre-wrap">{change.newText}</ins>
                : <del className="bg-red-50 text-red-700 whitespace-pre-wrap">{change.oldText}</del>}
            </div>
            {tracked && canResolveRevisions() && (
              <div className="flex space-x-1.5">
                <button
                  onClick={() => resolve(change, 'accept')}
                  disabled={busy}
                  title="Elfogadja ebben a bekezdésben a látható szerzők szövegkorrektúráit a Wordben (az elrejtett szerzőkéhez és a formázáshoz nem nyúl)"
                  className="flex items-center px-2 py-1 text-[11px] font-medium rounded-md border border-green-600 text-green-800 hover:bg-green-50 disabled:opacity-50"
                >
                  <Check className="w-3 h-3 mr-1" />Elfogadom a korrektúrát
                </button>
                <button
                  onClick={() => resolve(change, 'reject')}
                  disabled={busy}
                  title="Elutasítja ebben a bekezdésben a látható szerzők szövegkorrektúráit a Wordben (az elrejtett szerzőkéhez és a formázáshoz nem nyúl)"
                  className="flex items-center px-2 py-1 text-[11px] font-medium rounded-md border border-red-500 text-red-700 hover:bg-red-50 disabled:opacity-50"
                >
                  <X className="w-3 h-3 mr-1" />Elutasítom
                </button>
              </div>
            )}
            {assessment && (
              <div className="pt-1 border-t border-neutral-100">
                <label className={`flex items-start space-x-2 ${inserted.has(change.id) ? '' : 'cursor-pointer'}`}>
                  <input
                    type="checkbox"
                    checked={selected.has(change.id) || inserted.get(change.id) === 'inserted'}
                    disabled={inserted.has(change.id) || heldPlaceholders(change).length > 0}
                    onChange={() => setSelected(s => {
                      const next = new Set(s);
                      if (next.has(change.id)) next.delete(change.id);
                      else next.add(change.id);
                      return next;
                    })}
                    className="mt-0.5"
                  />
                  <span>
                    <span className="text-neutral-800">{assessment.summary}</span>
                    {assessment.recommendation && <span className="block text-neutral-500">Javaslat: {assessment.recommendation}</span>}
                  </span>
                </label>
                {heldPlaceholders(change).length > 0 ? (
                  <p className="mt-1 text-[11px] text-red-700">⛔ Nem szúrható be: fel nem oldott helyettesítő maradt benne ({heldPlaceholders(change).join(', ')}).</p>
                ) : inserted.get(change.id) === 'inserted' ? (
                  <p className="mt-1 text-[11px] font-semibold text-green-700">✓ Megjegyzés beszúrva</p>
                ) : inserted.get(change.id) === 'skipped' ? (
                  <p className="mt-1 text-[11px] text-amber-700">A bekezdés azóta megváltozott, ezt kihagytam. Futtasd újra az összevetést.</p>
                ) : (
                  <button
                    onClick={() => insertComments([change.id])}
                    disabled={busy}
                    className="mt-1 flex items-center px-2 py-1 text-[11px] font-medium rounded-md border border-blue-600 bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
                    title="Csak ezt a megjegyzést szúrja be, és odaugrik"
                  >
                    <MessageSquarePlus className="w-3 h-3 mr-1" />Beszúrom ezt
                  </button>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
