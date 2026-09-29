import React, { useRef, useState } from 'react';
import { FileUp, Loader2, Sparkles, Square, MessageSquarePlus, AlertTriangle, KeyRound } from 'lucide-react';
import { MAX_COMPARE_CHARS, MAX_INSTRUCTION_CHARS } from '../shared/aiConfig';
import { AIRequestError, describeRequestError, streamAIResponse, type RateLimitInfo } from '../services/aiService';
import { readDocxParagraphs } from '../services/docxText';
import { compareVersions, formatChangesForAI, parseCompareResult, type ChangeAssessment, type VersionChange } from '../services/versionCompare';
import { UserFacingError, insertCommentsAtParagraphs, jumpToParagraph, readParagraphs } from '../services/wordDocument';
import { SEVERITY_LABELS } from '../services/review';
import { describeStyle, type Settings } from '../services/settings';
import { formatNumber } from '../services/format';
import { DiffView, SEVERITY_STYLES } from './Proposal';
import RequestDetails, { type RequestDetailsData } from './RequestDetails';
import { DEFAULT_PRESETS, PLACEHOLDERS } from './modes';

interface Comparison {
  fileName: string;
  changes: VersionChange[];
  /** Texts of the current document's paragraphs when the comparison was made */
  currentTexts: string[];
}

interface Analysis {
  running: boolean;
  overview?: string;
  assessments?: Map<number, ChangeAssessment>;
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
  onRateLimit,
  onOpenSettings,
}: {
  settings: Settings;
  onRateLimit: (info: RateLimitInfo) => void;
  onOpenSettings: () => void;
}) {
  const [comparison, setComparison] = useState<Comparison | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [instruction, setInstruction] = useState('');
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [inserting, setInserting] = useState(false);
  const [insertStatus, setInsertStatus] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const loadEarlierVersion = async (file: File) => {
    setLoading(true);
    setError(null);
    setAnalysis(null);
    setInsertStatus(null);
    try {
      const earlier = await readDocxParagraphs(await file.arrayBuffer());
      const current = (await readParagraphs()).map(p => p.text);
      setComparison({ fileName: file.name, changes: compareVersions(earlier, current), currentTexts: current });
    } catch (e) {
      console.error(e);
      setComparison(null);
      setError(e instanceof Error && /docx|Word-dokumentum|tömörítés/.test(e.message) ? e.message : 'Nem sikerült összevetni a két változatot.');
    } finally {
      setLoading(false);
      if (fileInput.current) fileInput.current.value = '';
    }
  };

  const analyze = async (text: string) => {
    const userInstruction = text.trim();
    if (!comparison || !userInstruction || analysis?.running) return;
    const { text: changeList, included } = formatChangesForAI(comparison.changes, MAX_COMPARE_CHARS);
    const startedAt = Date.now();
    const details: RequestDetailsData = {
      mode: 'compare',
      instruction: userInstruction,
      selectionText: '',
      contextInfo: {
        documentChars: comparison.currentTexts.join('\n').length,
        sentChars: changeList.length,
        limit: MAX_COMPARE_CHARS,
        strategy: included < comparison.changes.length ? 'truncated' : 'full',
        includedItems: included,
        totalItems: comparison.changes.length,
      },
      historyRounds: 0,
      totalRounds: 0,
      styleSummary: describeStyle(settings.styleProfile),
      thoughts: '',
      startedAt,
    };
    const controller = new AbortController();
    abortRef.current = controller;
    setInsertStatus(null);
    setAnalysis({ running: true, details });

    const updateDetails = (change: (d: RequestDetailsData) => RequestDetailsData) =>
      setAnalysis(a => a && { ...a, details: change(a.details) });

    try {
      const result = await streamAIResponse(
        { mode: 'compare', instruction: userInstruction, originalText: '', documentContext: changeList, styleProfile: settings.styleProfile },
        {
          onText: () => {},
          onThought: chunk => updateDetails(d => ({ ...d, thoughts: d.thoughts + (d.thoughts && !d.thoughts.endsWith('\n') ? '\n\n' : '') + chunk })),
          onMeta: meta => updateDetails(d => ({ ...d, model: meta.model, location: meta.location })),
          onRateLimit,
        },
        { accessKey: settings.accessKey, signal: controller.signal }
      );
      const parsed = parseCompareResult(result, new Set(comparison.changes.map(c => c.id)));
      if (!parsed) throw new Error('Az elemzés eredményét nem tudtam értelmezni.');
      setSelected(new Set(parsed.assessments.keys()));
      setAnalysis(a => a && { ...a, running: false, overview: parsed.overview, assessments: parsed.assessments, details: { ...a.details, durationMs: Date.now() - startedAt } });
    } catch (e) {
      const message = controller.signal.aborted
        ? '⏹️ Leállítottad az elemzést.'
        : e instanceof Error && e.message.startsWith('Az elemzés') ? e.message : describeRequestError(e);
      const authProblem = e instanceof AIRequestError && e.code === 'UNAUTHORIZED';
      setAnalysis(a => a && { ...a, running: false, error: message, authProblem, details: { ...a.details, durationMs: Date.now() - startedAt } });
    } finally {
      abortRef.current = null;
    }
  };

  const insertComments = async () => {
    if (!comparison || !analysis?.assessments) return;
    const chosen = comparison.changes.filter(c => selected.has(c.id) && analysis.assessments!.has(c.id));
    setInserting(true);
    setInsertStatus(null);
    try {
      const outcome = await insertCommentsAtParagraphs(chosen.map(c => ({
        paragraph: c.paragraph,
        expectedText: comparison.currentTexts[c.paragraph] ?? '',
        comment: commentFor(c, analysis.assessments!.get(c.id)!),
      })));
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

  const changes = comparison?.changes ?? [];
  const counts = { modified: 0, added: 0, removed: 0 };
  changes.forEach(c => counts[c.type]++);
  const fullListChars = comparison ? formatChangesForAI(changes, Number.MAX_SAFE_INTEGER).text.length : 0;
  const fitting = comparison ? formatChangesForAI(changes, MAX_COMPARE_CHARS).included : 0;
  const busy = loading || inserting || !!analysis?.running;
  const presets = [...DEFAULT_PRESETS.compare, ...settings.customPresets.filter(p => p.mode === 'compare').map(p => p.label)];

  return (
    <div className="flex-1 min-h-0 overflow-y-auto p-3 space-y-3 text-sm">
      <div className="bg-white border border-neutral-200 rounded-xl p-3 space-y-2">
        <p className="text-xs text-neutral-600">
          Töltsd fel a <strong>korábbi</strong> változatot (pl. amit a partnernek küldtél). A megnyitott dokumentumot hasonlítom hozzá, így látszik, mit módosítottak.
        </p>
        <input ref={fileInput} type="file" accept=".docx" className="hidden" onChange={e => e.target.files?.[0] && loadEarlierVersion(e.target.files[0])} />
        <button
          onClick={() => fileInput.current?.click()}
          disabled={busy}
          className="w-full flex items-center justify-center py-2 text-xs font-medium bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white rounded-lg"
        >
          {loading ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <FileUp className="w-4 h-4 mr-1" />}
          {comparison ? 'Másik korábbi változat…' : 'Korábbi változat feltöltése (.docx)'}
        </button>
        {comparison && (
          <p className="text-xs text-neutral-700">
            <strong>{comparison.fileName}</strong> → megnyitott dokumentum: {changes.length === 0
              ? 'nincs tartalmi eltérés.'
              : `${formatNumber(changes.length)} változás (${counts.modified} módosult, ${counts.added} új, ${counts.removed} törölt bekezdés).`}
          </p>
        )}
        {comparison && fitting < changes.length && (
          <p className="flex items-start text-xs text-amber-700">
            <AlertTriangle className="w-3.5 h-3.5 mr-1 mt-px shrink-0" />
            Sok a változás ({formatNumber(fullListChars)} karakter, a korlát {formatNumber(MAX_COMPARE_CHARS)}): az AI-elemzés csak az első {formatNumber(fitting)} változást látja.
          </p>
        )}
        {error && <p className="text-xs text-red-700">{error}</p>}
      </div>

      {comparison && changes.length > 0 && (
        <div className="bg-white border border-neutral-200 rounded-xl p-3 space-y-2">
          <h3 className="text-xs font-semibold text-neutral-700 flex items-center"><Sparkles className="w-3.5 h-3.5 mr-1" />AI-elemzés</h3>
          <div className="flex flex-wrap gap-1.5">
            {presets.map(preset => (
              <button key={preset} onClick={() => analyze(preset)} disabled={busy} className="px-2.5 py-1 text-[11px] bg-neutral-100 hover:bg-neutral-200 border border-neutral-200 rounded-full disabled:opacity-50">
                {preset}
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
                    onClick={insertComments}
                    disabled={busy || selected.size === 0}
                    className="flex items-center px-3 py-1.5 font-medium bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white rounded-lg"
                  >
                    {inserting ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <MessageSquarePlus className="w-3.5 h-3.5 mr-1" />}
                    Megjegyzések beszúrása ({selected.size})
                  </button>
                </div>
              )}
              {insertStatus && <p className="font-medium text-green-700">{insertStatus}</p>}
              <RequestDetails details={analysis.details} isLoading={analysis.running} />
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
              <button onClick={() => jump(change.paragraph)} className="text-[11px] font-medium text-blue-700 hover:text-blue-900">Ugrás →</button>
            </div>
            <div className="text-sm text-neutral-800">
              {change.type === 'modified' ? <DiffView original={change.oldText} proposal={change.newText} />
                : change.type === 'added' ? <ins className="no-underline bg-green-50 text-green-800 whitespace-pre-wrap">{change.newText}</ins>
                : <del className="bg-red-50 text-red-700 whitespace-pre-wrap">{change.oldText}</del>}
            </div>
            {assessment && (
              <label className="flex items-start space-x-2 pt-1 border-t border-neutral-100 cursor-pointer">
                <input
                  type="checkbox"
                  checked={selected.has(change.id)}
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
            )}
          </div>
        );
      })}
    </div>
  );
}
