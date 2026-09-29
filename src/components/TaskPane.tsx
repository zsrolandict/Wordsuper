import React, { useState, useRef, useEffect } from 'react';
import { Send, PenTool, AlertCircle, Loader2, House, Settings as SettingsIcon, Square, KeyRound, MessageSquare, ListTree, GitCompare, Zap } from 'lucide-react';
import { ASSISTANT_MODES, MAX_INSTRUCTION_CHARS, splitExplanation, trimHistory, type AIRequestBody, type HistoryTurn, type Mode, type ReviewFinding } from '../shared/aiConfig';
import { AIRequestError, describeRequestError, streamAIResponse, type RateLimitInfo } from '../services/aiService';
import {
  UserFacingError,
  applyDocumentEdit,
  applyEdit,
  applyReviewFindings,
  insertCommentAt,
  insertGenerated,
  placeAtParagraph,
  releaseRange,
  takeSnapshot,
  type DocumentSnapshot,
} from '../services/wordDocument';
import { parseFindings } from '../services/review';
import type { StructureRequest } from '../services/structureSuggestions';
import { Masker, leftoverPlaceholders, maskRequest, parseExtraTerms } from '../services/masking';
import { playSound, primeSound } from '../services/sound';
import { describeStyle, useSettings } from '../services/settings';
import { useDocumentStats } from '../services/useDocumentStats';
import RequestDetails, { type RequestDetailsData } from './RequestDetails';
import Proposal, { type FindingView, type ProposalState } from './Proposal';
import LimitsBar from './LimitsBar';
import SettingsPanel from './SettingsPanel';
import StructurePanel from './StructurePanel';
import ComparePanel from './ComparePanel';
import DictationButton from './DictationButton';
import Logo from './Logo';
import { DEFAULT_PRESETS, MODE_LABELS, PLACEHOLDERS, looksLikeReview, matchPreset, modeLabel, PRESET_INSTRUCTIONS, type PresetMatch } from './modes';

interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  isLoading?: boolean;
  /** Rövid visszajelzés arról, mi történt a dokumentumban */
  status?: { text: string; tone: 'success' | 'neutral' };
  /** Mit kapott az AI és hogyan gondolkodott – a lenyitható Részletek panelhez */
  details?: RequestDetailsData;
  /** Javaslat, amiről a felhasználó dönt (beszúrás / másik változat / elvetés) */
  proposal?: {
    state: ProposalState;
    findings?: FindingView[];
    /** Edit: why the change was needed, and whether it goes into the document as a comment */
    explanation?: string;
    addExplanation?: boolean;
  };
  /** A felhasználó üzenete egy gyorsgomb szövege volt */
  preset?: PresetMatch;
  /** Pl. hibás hozzáférési kulcsnál: gomb a Beállításokhoz */
  showSettingsLink?: boolean;
}

/** A döntésre váró javaslat, mindennel, ami a beszúráshoz vagy a finomításhoz kell */
interface PendingProposal {
  messageId: string;
  mode: Mode;
  snapshot: DocumentSnapshot;
  /** Minden eddigi kör; az utolsó a mostani javaslat */
  rounds: HistoryTurn[];
  result: string;
  /** Edit: why the change was needed */
  explanation: string;
  /** The same placeholders are kept for every refinement; null when masking is off */
  masker: Masker | null;
}

const WELCOME_MESSAGE: Message = {
  id: 'welcome',
  role: 'assistant',
  content: 'Szia! Válassz módot alul, és írd le, mit szeretnél! Ha kijelölsz egy szöveget, azzal dolgozom; ha nem jelölsz ki semmit, az egész dokumentummal. A változtatások korrektúrával kerülnek be, a véleményem Word-megjegyzésként. Mielőtt bármi bekerül a dokumentumba, megmutatom a javaslatot.'
};

const ALTERNATIVE_INSTRUCTION = 'Kérek egy másik változatot.';

type Tab = 'assistant' | 'structure' | 'compare';
const TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
  { id: 'assistant', label: 'Asszisztens', icon: <MessageSquare className="w-3.5 h-3.5 mr-1" /> },
  { id: 'structure', label: 'Szerkezet', icon: <ListTree className="w-3.5 h-3.5 mr-1" /> },
  { id: 'compare', label: 'Összevetés', icon: <GitCompare className="w-3.5 h-3.5 mr-1" /> },
];

const newMessageId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

export default function TaskPane() {
  const [messages, setMessages] = useState<Message[]>([WELCOME_MESSAGE]);
  const [input, setInput] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [isApplying, setIsApplying] = useState(false);
  const [mode, setMode] = useState<Mode>('edit');
  const [view, setView] = useState<'chat' | 'settings'>('chat');
  const [tab, setTab] = useState<Tab>('assistant');
  const [settings, updateSettings] = useSettings();
  const [rateLimit, setRateLimit] = useState<RateLimitInfo | null>(null);
  const [pending, setPendingState] = useState<PendingProposal | null>(null);
  const [dismissedReviewHint, setDismissedReviewHint] = useState<string | null>(null);
  // Minden dokumentum-módosítás után nő, hogy a korlátjelző újra lemérje a méretet
  const [documentVersion, setDocumentVersion] = useState(0);
  const pendingRef = useRef<PendingProposal | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const stats = useDocumentStats(documentVersion);
  // Egyszerre csak egy művelet futhat (küldés, beszúrás, elvetés, Főmenü). A ref szinkron zár, így két gyors
  // kattintásból sem indul két művelet; az isBusy pedig letiltja a gombokat.
  const busyRef = useRef(false);
  const isBusy = isSending || isApplying;
  const tryLock = () => {
    if (busyRef.current) return false;
    busyRef.current = true;
    return true;
  };
  const unlock = () => {
    busyRef.current = false;
  };

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const setPending = (next: PendingProposal | null) => {
    pendingRef.current = next;
    setPendingState(next);
  };

  const addMessage = (message: Omit<Message, 'id'>) => {
    setMessages(prev => [...prev, { id: newMessageId(), ...message }]);
  };

  const updateMessage = (id: string, update: (m: Message) => Message) => {
    setMessages(prev => prev.map(m => (m.id === id ? update(m) : m)));
  };

  /** Lezárja a függő javaslatot a dokumentum módosítása nélkül (a hívó tartja a zárat) */
  const closePending = async (state: 'rejected' | 'superseded', statusText: string) => {
    const current = pendingRef.current;
    if (!current) return;
    setPending(null);
    updateMessage(current.messageId, m => ({
      ...m,
      proposal: m.proposal && { ...m.proposal, state },
      status: { text: statusText, tone: 'neutral' },
    }));
    await releaseRange(current.snapshot.range);
  };

  const handleReject = async () => {
    if (!tryLock()) return;
    try {
      await closePending('rejected', '✖️ Elvetetted, a dokumentum változatlan maradt.');
    } finally {
      unlock();
    }
  };

  // Vissza a kezdőképernyőre, új beszélgetéssel
  const goToMainMenu = async () => {
    if (!tryLock()) return;
    try {
      await closePending('rejected', '✖️ Elvetve.');
      setMessages([WELCOME_MESSAGE]);
      setInput('');
      setMode('edit');
    } finally {
      unlock();
    }
  };

  /** From the structure view: put the cursor in place, then ask the assistant */
  const runStructureRequest = async (request: StructureRequest) => {
    if (busyRef.current) return;
    try {
      await placeAtParagraph(request.paragraph, request.cursor);
    } catch (error) {
      setTab('assistant');
      addMessage({ role: 'system', content: error instanceof UserFacingError ? error.message : 'Nem sikerült odaállni a bekezdéshez.' });
      return;
    }
    setTab('assistant');
    setMode(request.mode);
    await handleSend(request.instruction, request.mode, request.label);
  };

  const handleSend = async (instructionOverride?: string, modeOverride?: Mode, displayText?: string) => {
    const typed = (instructionOverride ?? input).trim();
    if (!typed || !tryLock()) return;
    if (settings.sound) primeSound();
    const chime = (kind: 'done' | 'error') => { if (settings.sound) playSound(kind); };
    // A built-in quick button can stand for a longer instruction; the chat shows the short label
    const preset = displayText ? null : matchPreset(typed, modeOverride ?? mode, settings.customPresets);
    const instruction = (preset && !preset.custom && PRESET_INSTRUCTIONS[preset.label]) || typed;
    setIsSending(true);
    const controller = new AbortController();
    abortRef.current = controller;
    // Új kijelölés, amit még egy javaslat sem vett át: hiba vagy leállítás esetén el kell engedni
    let unclaimedRange: Word.Range | null = null;

    try {
      if (instructionOverride === undefined) setInput('');

      // A begépelt vagy kattintott gyorsgombot felismerjük; egy másik módhoz mentett saját gyorsgomb abban a módban fut
      const requestMode = modeOverride ?? preset?.mode ?? mode;
      if (requestMode !== mode) setMode(requestMode);
      const current = pendingRef.current;
      // Amíg van döntésre váró javaslat ugyanebben a módban, az új utasítás azt finomítja
      // A request from the structure view is always a new one
      const refining = displayText === undefined && current !== null && current.mode === requestMode;
      if (current && !refining) {
        await closePending('rejected', '✖️ Elvetve, mert új kérést indítottál.');
      }

      addMessage({ role: 'user', content: `[${modeLabel(requestMode)}${refining ? ' · finomítás' : ''}] ${displayText ?? typed}`, preset: preset ?? undefined });

      if (typeof Word === 'undefined') {
        addMessage({ role: 'system', content: 'Hiba: A Word API nem érhető el. Kérlek a Wordön belül használd a beépülőt!' });
        return;
      }

      const snapshot = refining ? current!.snapshot : await takeSnapshot(requestMode);
      if (!refining) unclaimedRange = snapshot.range;
      const rounds: HistoryTurn[] = refining ? current!.rounds : [];
      // Hosszú finomításnál az első és a legutóbbi körök mennek el (a szerver is így vág)
      const sentRounds = trimHistory(rounds);

      const request: AIRequestBody = {
        mode: requestMode,
        instruction,
        originalText: requestMode === 'edit' || requestMode === 'comment' ? snapshot.selectionText : '',
        documentContext: snapshot.documentContext,
        history: sentRounds,
        styleProfile: settings.styleProfile,
        wholeDocument: !!snapshot.wholeDocument,
      };
      // Names and identifiers are replaced by placeholders before the request leaves the machine
      const masker = refining
        ? current!.masker
        : settings.masking.enabled ? new Masker(parseExtraTerms(settings.masking.extraTerms)) : null;
      const sentRequest = masker ? maskRequest(request, masker) : request;
      const unmask = (text: string, streaming = false) => (masker ? masker.unmask(text, streaming) : text);

      const loadingId = newMessageId();
      const startedAt = Date.now();
      setMessages(prev => [...prev, {
        id: loadingId,
        role: 'assistant',
        content: '',
        isLoading: true,
        details: {
          mode: requestMode,
          instruction,
          selectionText: snapshot.selectionText,
          contextInfo: snapshot.contextInfo,
          historyRounds: sentRounds.length,
          totalRounds: rounds.length,
          styleSummary: describeStyle(settings.styleProfile),
          thoughts: '',
          startedAt,
          wholeDocument: !!snapshot.wholeDocument,
          masking: masker ? { summary: masker.summary(), entries: masker.entries() } : null,
        },
      }]);

      // What arrived so far, still with placeholders; the screen shows it unmasked
      let rawText = '';
      let rawThoughts = '';

      // A válasz lezárása: a részleteket megtartjuk, hogy utólag is visszanézhető legyen
      const finishLoadingMessage = (changes: Partial<Message>) => {
        updateMessage(loadingId, m => ({
          ...m,
          ...changes,
          isLoading: false,
          details: m.details && { ...m.details, thoughts: unmask(rawThoughts), durationMs: Date.now() - startedAt },
        }));
      };

      let result: string;
      try {
        result = await streamAIResponse(sentRequest, {
          // Frissítsük az UI-t folyamatosan, ahogy jönnek a szavak (az átvizsgálás JSON-ját nem mutatjuk nyersen)
          onText: chunk => {
            rawText += chunk;
            if (requestMode === 'review') return;
            const shown = requestMode === 'edit' ? splitExplanation(rawText, true).text : rawText;
            updateMessage(loadingId, m => ({ ...m, content: unmask(shown, true), isLoading: false }));
          },
          // A gondolkodás csak a Részletek panelbe kerül, a dokumentumba soha
          onThought: chunk => {
            rawThoughts += (rawThoughts && !rawThoughts.endsWith('\n') ? '\n\n' : '') + chunk;
            updateMessage(loadingId, m => (m.details ? { ...m, details: { ...m.details, thoughts: unmask(rawThoughts, true) } } : m));
          },
          onRateLimit: setRateLimit,
          onMeta: meta => updateMessage(loadingId, m => ({ ...m, details: m.details && { ...m.details, model: meta.model, location: meta.location } })),
        }, { accessKey: settings.accessKey, userId: settings.userId, signal: controller.signal });
      } catch (aiError) {
        // Hibás, félbeszakadt vagy leállított válasz esetén a dokumentumhoz nem nyúlunk
        if (controller.signal.aborted) {
          finishLoadingMessage({ status: { text: '⏹️ Leállítottad. A dokumentumot nem módosítottam.', tone: 'neutral' } });
        } else {
          chime('error');
          const authProblem = aiError instanceof AIRequestError && aiError.code === 'UNAUTHORIZED';
          finishLoadingMessage({ role: 'system', content: describeRequestError(aiError), showSettingsLink: authProblem });
        }
        return;
      }

      // The answer is here: a soft chime, so the user can work elsewhere meanwhile
      chime('done');
      let findings: ReviewFinding[] | undefined;
      let explanation = '';
      if (requestMode === 'edit') {
        ({ text: result, explanation } = splitExplanation(result));
        explanation = unmask(explanation);
      }
      if (requestMode === 'review') {
        // The JSON is parsed with the placeholders in it, then each field is unmasked
        const parsed = parseFindings(result)?.map(f => ({ ...f, quote: unmask(f.quote), comment: unmask(f.comment), suggestion: unmask(f.suggestion) }));
        if (!parsed) {
          finishLoadingMessage({ role: 'system', content: 'Az átvizsgálás eredményét nem tudtam értelmezni. Kérlek próbáld újra.' });
          return;
        }
        if (parsed.length === 0) {
          finishLoadingMessage({ content: 'Nem találtam a kérésnek megfelelő észrevételt a dokumentumban.' });
          return;
        }
        findings = parsed;
      } else if (!result.trim()) {
        finishLoadingMessage({ role: 'system', content: 'Az AI üres választ adott, ezért nem módosítottam a dokumentumot. Kérlek próbáld újra.' });
        return;
      } else {
        result = unmask(result);
      }

      // A finomított javaslat felváltja az előzőt, a kijelölés átszáll rá
      if (refining) {
        updateMessage(current!.messageId, m => ({
          ...m,
          proposal: m.proposal && { ...m.proposal, state: 'superseded' },
          status: { text: '↻ Ezt a javaslatot finomítottad, lent az új változat.', tone: 'neutral' },
        }));
      }
      unclaimedRange = null;
      setPending({ messageId: loadingId, mode: requestMode, snapshot, rounds: [...rounds, { instruction, result }], result, explanation, masker });
      const findingViews = findings?.map(f => ({ ...f, selected: true, fix: !!f.suggestion }));
      // Asking for a comment in the instruction ticks the box by default
      const addExplanation = !!explanation && /megjegyz|komment|indokl|magyaráz/i.test(instruction);
      // A placeholder the AI made up has no real value behind it and must not slip into the document unnoticed
      const leftovers = masker
        ? leftoverPlaceholders([result, explanation, ...(findings ?? []).flatMap(f => [f.comment, f.suggestion])].join('\n'))
        : [];
      finishLoadingMessage({
        content: requestMode === 'review' ? '' : result,
        proposal: { state: 'pending', findings: findingViews, explanation, addExplanation },
        status: leftovers.length
          ? { text: `⚠️ A válaszban ismeretlen helyettesítő maradt (${leftovers.join(', ')}), ehhez nincs valódi adat. Beszúrás előtt ellenőrizd, vagy kérj másik változatot.`, tone: 'neutral' }
          : undefined,
      });

      if (settings.autoApply && !leftovers.length) {
        await applyProposal(loadingId, findingViews, addExplanation);
      }
    } catch (error) {
      if (error instanceof UserFacingError) {
        addMessage({ role: 'system', content: error.message });
      } else {
        console.error(error);
        addMessage({ role: 'system', content: 'Hiba történt a művelet során. Kérlek próbáld újra.' });
      }
    } finally {
      await releaseRange(unclaimedRange);
      abortRef.current = null;
      setIsSending(false);
      unlock();
    }
  };

  const handleApply = async (messageId: string, findingViews?: FindingView[], addExplanation = false) => {
    if (!tryLock()) return;
    setIsApplying(true);
    try {
      await applyProposal(messageId, findingViews, addExplanation);
    } finally {
      setIsApplying(false);
      unlock();
    }
  };

  /** Beszúrja a javaslatot (a hívó tartja a zárat: handleApply, vagy automatikus beszúrásnál handleSend) */
  const applyProposal = async (messageId: string, findingViews?: FindingView[], addExplanation = false) => {
    const current = pendingRef.current;
    if (!current || current.messageId !== messageId) return;
    const explanation = addExplanation ? current.explanation : '';
    updateMessage(messageId, m => ({ ...m, proposal: m.proposal && { ...m.proposal, state: 'applying' } }));

    try {
      let status: string;
      let updatedFindings = findingViews;
      const range = current.snapshot.range;

      if (current.mode === 'edit' && current.snapshot.wholeDocument) {
        const outcome = await applyDocumentEdit(current.snapshot.wholeDocument, current.result, explanation);
        const parts = [
          outcome.changed && `${outcome.changed} bekezdést módosítottam`,
          outcome.inserted && `${outcome.inserted} új bekezdést szúrtam be`,
          outcome.deleted && `${outcome.deleted} bekezdést töröltem`,
        ].filter(Boolean);
        status = parts.length
          ? `✅ Az egész dokumentumon: ${parts.join(', ')}, korrektúrával. A többi bekezdéshez nem nyúltam.`
          : '✅ A javaslat megegyezik a dokumentummal, nem kellett semmit módosítani.';
      } else if (current.mode === 'edit') {
        const outcome = await applyEdit(range!, current.result, explanation);
        status = outcome.pendingChanges
          ? '✅ A kijelölést kicseréltem, korrektúrával. Mivel benne még el nem fogadott korábbi korrektúra volt, a teljes kijelölést cseréltem (itt a formázás egyszerűsödhetett).'
          : outcome.strategy === 'words'
          ? `✅ ${outcome.changedPlaces} helyen módosítottam, korrektúrával. A változatlan szöveg formázása érintetlen maradt.`
          : outcome.strategy === 'unchanged'
          ? '✅ A javaslat megegyezik az eredetivel, nem kellett semmit módosítani.'
          : '✅ A kijelölést kicseréltem, korrektúrával. Mivel a bekezdések száma megváltozott (vagy a kijelölés bekezdés közepén kezdődik), itt a formázás egyszerűsödhetett.';
      } else if (current.mode === 'generate') {
        await insertGenerated(range!, current.result);
        status = '✅ A szöveget beszúrtam a dokumentumba!';
      } else if (current.mode === 'comment') {
        await insertCommentAt(range!, current.result);
        status = current.snapshot.wholeDocument
          ? '✅ A véleményezést beszúrtam Megjegyzésként abba a bekezdésbe, ahol a kurzor állt.'
          : '✅ A véleményezést beszúrtam a margóra (Megjegyzésként).';
      } else {
        const chosen = (findingViews ?? []).filter(f => f.selected || f.fix);
        const outcome = await applyReviewFindings(chosen.map(f => ({ finding: f, comment: f.selected, fix: f.fix })));
        updatedFindings = findingViews?.map(f => ({ ...f, notFound: outcome.notFound.includes(f), fixFailed: outcome.fixFailed.includes(f) }));
        const done = [
          outcome.comments && `${outcome.comments} megjegyzést beszúrtam`,
          outcome.fixes && `${outcome.fixes} javítást beírtam korrektúrával`,
        ].filter(Boolean);
        const missed = outcome.notFound.length + outcome.fixFailed.length;
        status = `✅ ${done.length ? done.join(', ') : 'Nem került be semmi'}.` +
          (missed ? ' Amit nem találtam meg szó szerint a dokumentumban, azt fent megjelöltem.' : '');
      }

      if (explanation) status += ' Az indoklást megjegyzésként mellé tettem.';
      setPending(null);
      updateMessage(messageId, m => ({
        ...m,
        proposal: m.proposal && { ...m.proposal, state: 'applied', findings: updatedFindings },
        status: { text: status, tone: 'success' },
      }));
      setDocumentVersion(v => v + 1);
    } catch (writeError) {
      console.error("Write error in Word:", writeError);
      // A javaslat megmarad, újra lehet próbálni vagy el lehet vetni
      updateMessage(messageId, m => ({ ...m, proposal: m.proposal && { ...m.proposal, state: 'pending' } }));
      addMessage({
        role: 'system',
        content: writeError instanceof UserFacingError
          ? writeError.message
          : 'Kész lettem volna a válasszal, de nem tudtam beszúrni a dokumentumba. Esetleg írásvédett a dokumentum, vagy zárolt részre kattintottál? A javaslat megmaradt: újrapróbálhatod vagy elvetheted.',
      });
    }
  };

  const toggleFinding = (messageId: string, index: number, field: 'selected' | 'fix') => {
    updateMessage(messageId, m => ({
      ...m,
      proposal: m.proposal && {
        ...m.proposal,
        findings: m.proposal.findings?.map((f, i) => (i === index ? { ...f, [field]: !f[field] } : f)),
      },
    }));
  };


  const refining = pending !== null && pending.mode === mode;
  // "Nézd át az egész dokumentumot…" typed in Edit or Comment mode: offer the Review mode (never switch by itself)
  const offerReview = !refining && (mode === 'edit' || mode === 'comment') && input !== dismissedReviewHint && looksLikeReview(input);
  const customPresets = settings.customPresets.filter(p => p.mode === mode);

  return (
    <div className="h-screen bg-neutral-50 flex flex-col font-sans text-neutral-900">
      {/* Settings open as a layer above, so the panels below keep their state */}
      {view === 'settings' && (
        <div className="fixed inset-0 z-30">
          <SettingsPanel settings={settings} onChange={updateSettings} onClose={() => setView('chat')} currentMode={mode} onRateLimit={setRateLimit} />
        </div>
      )}

      {/* Header */}
      <div className="bg-white border-b-2 border-[#29abe2] px-4 py-3 shrink-0 shadow-sm z-10 flex items-center justify-between">
        <div className="min-w-0">
          <Logo className="h-5 max-w-full" />
          <h1 className="text-xs font-semibold text-[#0f2350] flex items-center mt-1">
            <PenTool className="w-3.5 h-3.5 mr-1 text-[#29abe2]" />
            Word Writer
            <span className="ml-1.5 font-normal text-neutral-500 truncate">· szerkessz, véleményezz, generálj</span>
          </h1>
        </div>
        <div className="flex items-center space-x-1.5 shrink-0">
          {tab === 'assistant' && messages.length > 1 && (
            <button
              onClick={goToMainMenu}
              disabled={isBusy}
              title={isBusy ? 'Várd meg, amíg befejeződik a művelet' : 'Vissza a kezdőképernyőre, új beszélgetéssel'}
              className="flex items-center px-2.5 py-1.5 text-xs font-medium text-[#0f2350] bg-neutral-100 hover:bg-neutral-200 disabled:opacity-50 disabled:hover:bg-neutral-100 rounded-lg transition-colors"
            >
              <House className="w-4 h-4 mr-1" />
              Főmenü
            </button>
          )}
          <button
            onClick={() => setView('settings')}
            title="Beállítások"
            aria-label="Beállítások"
            className="p-1.5 text-[#0f2350] bg-neutral-100 hover:bg-neutral-200 rounded-lg transition-colors"
          >
            <SettingsIcon className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Tabs: every panel stays mounted, so switching doesn't lose a comparison or a conversation */}
      <div className="flex bg-white border-b border-neutral-200 shrink-0" role="tablist">
        {TABS.map(t => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={`flex-1 flex items-center justify-center py-2 text-xs font-medium border-b-2 transition-colors ${tab === t.id ? 'border-blue-600 text-blue-700' : 'border-transparent text-neutral-500 hover:text-neutral-800'}`}
          >
            {t.icon}{t.label}
          </button>
        ))}
      </div>

      <div className={tab === 'structure' ? 'flex-1 min-h-0 flex flex-col' : 'hidden'}>
        <StructurePanel active={tab === 'structure'} busy={isBusy} onRequest={runStructureRequest} />
      </div>
      <div className={tab === 'compare' ? 'flex-1 min-h-0 flex flex-col' : 'hidden'}>
        <ComparePanel settings={settings} onRateLimit={setRateLimit} onOpenSettings={() => setView('settings')} />
      </div>

      <div className={tab === 'assistant' ? 'contents' : 'hidden'}>
      {/* Chat Area */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.map((msg) => (
          <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div
              className={`${msg.proposal ? 'max-w-[95%]' : 'max-w-[85%]'} rounded-2xl px-4 py-3 text-sm shadow-sm
                ${msg.role === 'user' ? 'bg-blue-600 text-white rounded-br-none' :
                  msg.role === 'system' ? 'bg-red-50 text-red-700 border border-red-200 rounded-bl-none' :
                  'bg-white text-neutral-800 border border-neutral-200 rounded-bl-none'}`}
            >
              {msg.preset && (
                <span className="flex items-center w-fit mb-1 px-1.5 py-0.5 rounded bg-blue-500 text-[10px] font-medium" title="Ezt a szöveget gyorsgombként ismertem fel">
                  <Zap className="w-3 h-3 mr-0.5 fill-current" />
                  {msg.preset.custom ? 'Saját gyorsgomb' : 'Gyorsgomb'}
                </span>
              )}
              {msg.role === 'system' && <AlertCircle className="w-4 h-4 inline-block mr-1.5 -mt-0.5" />}
              {msg.isLoading && <Loader2 className="w-4 h-4 inline-block mr-2 animate-spin text-blue-600" />}
              {msg.isLoading && !msg.content ? (
                <span className="text-neutral-500">{msg.details?.mode === 'review' ? 'Átvizsgálom a dokumentumot…' : 'Gondolkodom…'}</span>
              ) : msg.proposal && msg.details ? (
                <Proposal
                  mode={msg.details.mode}
                  originalText={msg.details.selectionText}
                  text={msg.content}
                  state={msg.proposal.state}
                  findings={msg.proposal.findings}
                  busy={isBusy}
                  wholeDocument={!!msg.details.wholeDocument}
                  explanation={msg.proposal.explanation}
                  addExplanation={!!msg.proposal.addExplanation}
                  onToggleExplanation={() => updateMessage(msg.id, m => ({ ...m, proposal: m.proposal && { ...m.proposal, addExplanation: !m.proposal.addExplanation } }))}
                  onApply={() => handleApply(msg.id, msg.proposal?.findings, !!msg.proposal?.addExplanation)}
                  onReject={handleReject}
                  onAlternative={() => handleSend(ALTERNATIVE_INSTRUCTION, msg.details!.mode)}
                  onToggleFinding={(index, field) => toggleFinding(msg.id, index, field)}
                />
              ) : (
                <span className="whitespace-pre-wrap">{msg.content}</span>
              )}
              {msg.status && (
                <p className={`mt-2 text-xs font-medium ${msg.status.tone === 'success' ? 'text-green-700' : 'text-neutral-500'}`}>{msg.status.text}</p>
              )}
              {msg.showSettingsLink && (
                <button onClick={() => setView('settings')} className="mt-2 flex items-center text-xs font-medium underline">
                  <KeyRound className="w-3.5 h-3.5 mr-1" />
                  Beállítások megnyitása
                </button>
              )}
              {msg.details && <RequestDetails details={msg.details} isLoading={!!msg.isLoading} />}
            </div>
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      {/* Input Area */}
      <div className="p-3 bg-white border-t border-neutral-200 shrink-0">

        {!settings.accessKey && (
          <button
            onClick={() => setView('settings')}
            className="w-full mb-2 flex items-center text-left text-[11px] text-blue-800 bg-blue-50 border border-blue-200 rounded-lg px-2.5 py-1.5"
          >
            <KeyRound className="w-3.5 h-3.5 mr-1 shrink-0" />
            Még nincs megadva hozzáférési kulcs. Kattints ide a beállításához.
          </button>
        )}

        <LimitsBar mode={mode} stats={stats} rateLimit={rateLimit} />

        {/* Mode Toggle */}
        <div className="grid grid-cols-4 gap-1 mb-3 bg-neutral-100 p-1 rounded-lg w-full">
          {ASSISTANT_MODES.map(m => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={`py-1 text-[11px] leading-tight font-medium rounded-md transition-colors ${mode === m ? 'bg-white shadow text-neutral-900' : 'text-neutral-500 hover:text-neutral-700'}`}
            >
              <span className="block text-sm">{MODE_LABELS[m].icon}</span>
              {MODE_LABELS[m].label}
            </button>
          ))}
        </div>

        {/* Presets */}
        <div className="flex flex-wrap gap-2 mb-3">
          {DEFAULT_PRESETS[mode].map((preset) => (
            <button
              key={preset}
              onClick={() => handleSend(preset)}
              disabled={isBusy}
              className="px-3 py-1.5 text-xs bg-neutral-100 hover:bg-neutral-200 text-neutral-700 border border-neutral-200 rounded-full transition-colors whitespace-nowrap disabled:opacity-50"
            >
              {preset}
            </button>
          ))}
          {customPresets.map((preset) => (
            <button
              key={preset.id}
              onClick={() => handleSend(preset.label)}
              disabled={isBusy}
              title="Saját gyorsgomb"
              className="px-3 py-1.5 text-xs bg-blue-50 hover:bg-blue-100 text-blue-800 border border-blue-200 rounded-full transition-colors max-w-full truncate disabled:opacity-50"
            >
              {preset.label}
            </button>
          ))}
        </div>

        {refining && !isBusy && (
          <div className="mb-2 flex items-center justify-between text-[11px] text-blue-800 bg-blue-50 border border-blue-200 rounded-lg px-2.5 py-1.5">
            <span>↻ Finomítás: amit most írsz, a fenti javaslatot módosítja.</span>
            <button
              onClick={handleReject}
              className="underline ml-2 shrink-0"
            >
              Elvetés
            </button>
          </div>
        )}

        {offerReview && !isBusy && (
          <div className="mb-2 flex items-center justify-between text-[11px] text-emerald-900 bg-emerald-50 border border-emerald-200 rounded-lg px-2.5 py-1.5">
            <span>🔍 Ez az egész dokumentum átnézésének tűnik. Futtassam inkább Átvizsgálásként?</span>
            <span className="flex shrink-0 ml-2 space-x-2">
              <button onClick={() => { setMode('review'); handleSend(undefined, 'review'); }} className="font-semibold underline">Igen</button>
              <button onClick={() => setDismissedReviewHint(input)} className="underline">Nem</button>
            </span>
          </div>
        )}

        <div className="flex items-end space-x-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
            maxLength={MAX_INSTRUCTION_CHARS}
            placeholder={refining ? 'Mit változtassak a javaslaton? (pl. legyen rövidebb)' : PLACEHOLDERS[mode]}
            className="flex-1 max-h-32 min-h-[44px] p-2.5 border border-neutral-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm resize-none bg-neutral-50"
            rows={1}
          />
          {!isSending && (
            <DictationButton
              accessKey={settings.accessKey}
              userId={settings.userId}
              engine={settings.dictation.engine}
              localModel={settings.dictation.localModel}
              disabled={isBusy}
              onText={text => setInput(current => (current.trim() ? `${current.trimEnd()} ${text}` : text))}
              onError={message => addMessage({ role: 'system', content: message })}
            />
          )}
          {isSending ? (
            <button
              onClick={() => abortRef.current?.abort()}
              title="Leállítás"
              aria-label="Leállítás"
              className="w-11 h-11 shrink-0 flex items-center justify-center bg-red-600 hover:bg-red-700 text-white rounded-xl transition-colors"
            >
              <Square className="w-4 h-4 fill-current" />
            </button>
          ) : (
            <button
              onClick={() => handleSend()}
              disabled={!input.trim() || isBusy}
              aria-label="Küldés"
              className="w-11 h-11 shrink-0 flex items-center justify-center bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white rounded-xl transition-colors"
            >
              <Send className="w-5 h-5 ml-1" />
            </button>
          )}
        </div>
        <p className="text-[10px] text-center text-neutral-400 mt-2">Nyomj Entert a küldéshez{isSending ? ' · a piros gombbal leállíthatod' : ' · a mikrofonnal diktálhatsz'}</p>
      </div>
      </div>
    </div>
  );
}
