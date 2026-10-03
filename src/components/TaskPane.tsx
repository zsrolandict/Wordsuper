import React, { useState, useRef, useEffect } from 'react';
import { Send, PenTool, AlertCircle, Loader2, House, Settings as SettingsIcon, Square, KeyRound, MessageSquare, ListTree, GitCompare, Languages, Paintbrush, Zap, Undo2 } from 'lucide-react';
import { ASSISTANT_MODES, MAX_INSTRUCTION_CHARS, parseClarification, splitExplanation, trimHistory, type Depth, type AIRequestBody, type HistoryTurn, type Mode, type ReviewFinding } from '../shared/aiConfig';
import { AIRequestError, describeRequestError, fetchServerInfo, streamAIResponse, type RateLimitInfo } from '../services/aiService';
import {
  UserFacingError,
  PartialWriteError,
  applyDocumentEdit,
  applyEdit,
  applyReviewFindings,
  insertCommentAt,
  insertGenerated,
  placeAtParagraph,
  readParagraphs,
  readDocumentLength,
  readSelectionLength,
  releaseRange,
  selectionMovedFrom,
  showFinding,
  canUndo,
  newUndoRecord,
  releaseUndo,
  undoChanges,
  type UndoRecord,
  showRange,
  jumpToParagraph,
  takeSnapshot,
  setSkipTrackedChanges,
  type DocumentSnapshot,
  type WriteMode,
} from '../services/wordDocument';
import { parseFindings } from '../services/review';
import { applyChosenHunks, composeDocument, planDocumentEdits } from '../services/documentEdit';
import { alternativeReviewInstruction, newIssues, recheckInstruction, type StructureRequest } from '../services/structureSuggestions';
import { buildDocumentGraph, type StructureIssue } from '../services/structure';
import { Masker, maskRequest, parseExtraTerms, unresolvedMessage, unresolvedPlaceholders } from '../services/masking';
import { playSound, primeSound } from '../services/sound';
import { describeStyle, useSettings } from '../services/settings';
import { formatNumber } from '../services/format';
import { useDocumentStats } from '../services/useDocumentStats';
import RequestDetails, { type RequestDetailsData } from './RequestDetails';
import Proposal, { type FindingView, type ProposalState } from './Proposal';
import LimitsBar from './LimitsBar';
import SettingsPanel, { isOtherVersion } from './SettingsPanel';
import StructurePanel from './StructurePanel';
import ComparePanel from './ComparePanel';
import TranslatePanel from './TranslatePanel';
import FormatPanel from './FormatPanel';
import DictationButton from './DictationButton';
import Logo from './Logo';
import PartyBar from './PartyBar';
import SendPreview, { type PreviewDecision } from './SendPreview';
import { loadParty, saveParty } from '../services/parties';
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
    /** Edit: changes the user left out (word-level places, or paragraphs of a whole-document edit) */
    excluded?: number[];
    /** Edit: why the change was needed, and whether it goes into the document as a comment */
    explanation?: string;
    addExplanation?: boolean;
    /** Placeholders the answer still has after unmasking: then it can't go into the document */
    blocked?: string[];
  };
  /** The AI asked back instead of guessing: one-click answers, and which one was picked */
  clarification?: { options: string[]; mode: Mode; picked?: number };
  /** What this proposal inserted, so it can be taken back (tracked changes and comments) */
  undo?: UndoRecord[];
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
  /**
   * What was sent before masking (document, instruction): placeholder-like text found there is the document's own,
   * anything else left in the answer is an unresolved placeholder
   */
  sources: string[];
}

const WELCOME_MESSAGE: Message = {
  id: 'welcome',
  role: 'assistant',
  content: 'Szia! Válassz módot alul, és írd le, mit szeretnél! Ha kijelölsz egy szöveget, azzal dolgozom; ha nem jelölsz ki semmit, az egész dokumentummal. A változtatások korrektúrával kerülnek be, a véleményem Word-megjegyzésként. Mielőtt bármi bekerül a dokumentumba, megmutatom a javaslatot.'
};

const ALTERNATIVE_INSTRUCTION = 'Kérek egy másik változatot.';

type Tab = 'assistant' | 'structure' | 'compare' | 'translate' | 'format';
// The icons give way first when the pane is narrow, so every label stays readable
const TAB_ICON = 'w-3.5 h-3.5 mr-1 shrink-0 hidden min-[440px]:block';
const TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
  { id: 'assistant', label: 'Asszisztens', icon: <MessageSquare className={TAB_ICON} /> },
  { id: 'structure', label: 'Szerkezet', icon: <ListTree className={TAB_ICON} /> },
  { id: 'compare', label: 'Összevetés', icon: <GitCompare className={TAB_ICON} /> },
  { id: 'translate', label: 'Kétnyelvű', icon: <Languages className={TAB_ICON} /> },
  { id: 'format', label: 'Formázás', icon: <Paintbrush className={TAB_ICON} /> },
];

/**
 * Desktop Word shows new documents in "Simple Markup": a tracked change then looks as if it was accepted.
 * Said once per session, after the first change.
 */
let markupHintShown = false;
function markupHint(): string {
  const platform = typeof Office !== 'undefined' ? Office.context?.platform : undefined;
  const desktop = platform === Office?.PlatformType?.PC || platform === Office?.PlatformType?.Mac;
  if (!desktop || markupHintShown) return '';
  markupHintShown = true;
  return ' Ha nem látod az áthúzásokat: Véleményezés → Követés → „Minden korrektúra”.';
}

interface SendOptions {
  /** The user already answered a question about this request */
  confirmed?: boolean;
  /** The instruction came from the input field, which is cleared when the request starts */
  clearInput?: boolean;
  /** A new request even if a proposal of the same mode is pending */
  forceNew?: boolean;
  /** Surely meant for the pending proposal (Másik változat, a clarification answer): no selection check */
  explicitRefine?: boolean;
}

interface Confirmation {
  text: string;
  choices: { label: string; primary?: boolean; run: () => void }[];
}

/** How many insertions keep their "Visszavonom" button */
const MAX_UNDOABLE = 10;

/** Above this, an edit of the whole document (nothing selected) is confirmed before it starts */
const WHOLE_DOCUMENT_CONFIRM_CHARS = 3000;

const DEPTH_LABELS: Record<Depth, { label: string; title: string }> = {
  auto: { label: 'Automatikus', title: 'A modell maga dönti el, mennyit gondolkodjon' },
  fast: { label: '⚡ Gyors', title: 'Szinte gondolkodás nélkül: gyors és olcsó, egyszerű javításokhoz' },
  deep: { label: '🧠 Alapos', title: 'Mélyebb gondolkodás (lassabb, drágább): bonyolult átírásokhoz, átvizsgáláshoz' },
};

/** "korrektúrával" or not, as the change really went in */
const how = (write?: WriteMode) => (write && !write.tracked ? 'korrektúra nélkül' : 'korrektúrával');

/** Said when the "without Track Changes" setting had to give way, and when there is no Visszavonom */
function writeNote(writes: (WriteMode | undefined)[]): string {
  if (writes.some(w => w?.forced)) {
    return ' A dokumentumban el nem fogadott korrektúrák vannak (pl. a másik fél módosításai), ezért a beállításod ellenére korrektúrával írtam be.';
  }
  if (writes.some(w => w && !w.tracked)) return ' Visszavonás: Ctrl+Z a Wordben.';
  return '';
}

/** The open document's path: the represented party is remembered for it ('' for a new, unsaved document) */
const documentUrl = () => (typeof Office !== 'undefined' ? Office.context?.document?.url ?? '' : '');

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
  // Whose side we are on in this document; remembered on this machine, never written into the file
  const [party, setPartyState] = useState(() => loadParty(documentUrl()));
  const setParty = (value: string) => {
    setPartyState(value);
    saveParty(documentUrl(), value);
  };
  const [rateLimit, setRateLimit] = useState<RateLimitInfo | null>(null);
  const [pending, setPendingState] = useState<PendingProposal | null>(null);
  const [dismissedReviewHint, setDismissedReviewHint] = useState<string | null>(null);
  // A question before something that would lose work (Office add-ins can't use window.confirm)
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  // Minden dokumentum-módosítás után nő, hogy a korlátjelző újra lemérje a méretet
  const [documentVersion, setDocumentVersion] = useState(0);
  const pendingRef = useRef<PendingProposal | null>(null);
  // The latest messages for checks made outside of render (how many findings are still undecided)
  const messagesRef = useRef<Message[]>([]);
  messagesRef.current = messages;
  const abortRef = useRef<AbortController | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const stats = useDocumentStats(documentVersion);
  // Every writer in the Word layer follows the "without Track Changes" setting
  setSkipTrackedChanges(settings.skipTrackedChanges);
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

  // Follow new messages and streaming answers only while the user is at the bottom of the chat: whoever scrolled
  // up to read or tick something stays exactly there, also while the AI is thinking
  const chatRef = useRef<HTMLDivElement>(null);
  const followRef = useRef(true);
  const onChatScroll = () => {
    const el = chatRef.current;
    if (el) followRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
  };
  const lastMessage = messages[messages.length - 1];
  useEffect(() => {
    const el = chatRef.current;
    // Instant, not smooth: a smooth scroll fires scroll events on its way and would stop following
    if (el && followRef.current) el.scrollTop = el.scrollHeight;
  }, [messages.length, lastMessage?.content, lastMessage?.isLoading]);

  // The request waiting for the user's look before it is sent (Settings → Adatvédelem)
  const [sendPreview, setSendPreview] = useState<{ request: AIRequestBody; masker: Masker | null; resolve: (decision: PreviewDecision) => void } | null>(null);

  /**
   * Masks a request and, when the settings ask for it, shows what the AI will get before it is sent. The user may
   * name one more thing to hide: it joins the "always hide" list and the request is masked again. null: cancelled.
   */
  const prepareSend = async (request: AIRequestBody, masker: Masker | null, reserve: string[] = []): Promise<{ sent: AIRequestBody; masker: Masker | null } | null> => {
    let current = masker;
    let extraTerms = parseExtraTerms(settings.masking.extraTerms);
    for (;;) {
      const sent = current ? maskRequest(request, current) : request;
      if (!settings.masking.previewBeforeSend) return { sent, masker: current };
      const decision = await new Promise<PreviewDecision>(resolve => setSendPreview({ request: sent, masker: current, resolve }));
      setSendPreview(null);
      if (decision.kind === 'send') return { sent, masker: current };
      if (decision.kind === 'cancel') return null;
      extraTerms = [...extraTerms, decision.term];
      updateSettings(s => ({ ...s, masking: { ...s.masking, extraTerms: [s.masking.extraTerms.trim(), decision.term].filter(Boolean).join('\n') } }));
      current = new Masker(extraTerms, parseExtraTerms(settings.masking.neverHide));
      // Text that will go out later in the same run (the other parts of a translation) is reserved again
      current.reserve(reserve);
    }
  };

  // A newer version on the server (after an update): offer a reload instead of running old code
  const [newVersion, setNewVersion] = useState(false);
  useEffect(() => {
    let stopped = false;
    let lastCheck = 0;
    // On focus too, but at most once a minute: the pane gets focus with every click
    const check = () => {
      if (Date.now() - lastCheck < 60_000) return;
      lastCheck = Date.now();
      fetchServerInfo(settings.accessKey).then(info => {
        if (!stopped && info && isOtherVersion(info.version)) setNewVersion(true);
      });
    };
    check();
    const timer = setInterval(check, 5 * 60_000);
    window.addEventListener('focus', check);
    return () => {
      stopped = true;
      clearInterval(timer);
      window.removeEventListener('focus', check);
    };
  }, []);

  /** Loads the add-in again: the conversation is lost, the document is not touched */
  const reloadPane = (confirmed = false) => {
    if (!confirmed && (messagesRef.current.length > 1 || pendingRef.current)) {
      setConfirmation({
        text: 'Újratöltéskor a beszélgetés, a döntésre váró javaslat és a Visszavonom gombok elvesznek. A dokumentum nem változik.',
        choices: [{ label: 'Újratöltés', primary: true, run: () => reloadPane(true) }],
      });
      return;
    }
    window.location.reload();
  };

  const setPending = (next: PendingProposal | null) => {
    pendingRef.current = next;
    setPendingState(next);
  };

  const addMessage = (message: Omit<Message, 'id'>) => {
    const id = newMessageId();
    setMessages(prev => [...prev, { id, ...message }]);
    return id;
  };

  const updateMessage = (id: string, update: (m: Message) => Message) => {
    setMessages(prev => prev.map(m => (m.id === id ? update(m) : m)));
  };

  /**
   * "Visszavonom" stays on the last few insertions only: every kept range is tracked by Word, and many of them
   * slow Word down. Older ones are released.
   */
  useEffect(() => {
    const withUndo = messages.filter(m => m.undo?.length);
    if (withUndo.length <= MAX_UNDOABLE) return;
    const old = withUndo.slice(0, withUndo.length - MAX_UNDOABLE);
    old.forEach(m => updateMessage(m.id, x => ({ ...x, undo: undefined })));
    releaseUndo(old.flatMap(m => m.undo!));
  }, [messages]);

  /** Findings of the pending review nobody decided about yet (0 when no review is pending) */
  const undecidedFindings = () => {
    const current = pendingRef.current;
    if (!current || current.mode !== 'review') return 0;
    return messagesRef.current.find(m => m.id === current.messageId)?.proposal?.findings?.filter(f => !f.done).length ?? 0;
  };
  const undecidedWarning = (count: number) =>
    `Az átvizsgálásban még ${count} észrevételről nem döntöttél. Ha folytatod, ezek elvesznek (amit már beszúrtál, az a dokumentumban marad).`;

  /** Lezárja a függő javaslatot a dokumentum módosítása nélkül (a hívó tartja a zárat) */
  const closePending = async (state: 'rejected' | 'superseded', statusText: string) => {
    const current = pendingRef.current;
    if (!current) return;
    setPending(null);
    updateMessage(current.messageId, m => {
      // A review decided in part: what was inserted stays, only the undecided findings are dropped
      const findings = m.proposal?.findings;
      const applied = findings?.filter(f => f.done === 'applied').length ?? 0;
      const open = findings?.filter(f => !f.done).length ?? 0;
      return {
        ...m,
        proposal: m.proposal && {
          ...m.proposal,
          state,
          findings: findings?.map(f => (f.done ? f : { ...f, done: 'dismissed' as const })),
        },
        status: {
          text: applied ? `✖️ A hátralévő ${open} észrevételt elvetettem. A már beszúrt ${applied} a dokumentumban marad.` : statusText,
          tone: 'neutral',
        },
      };
    });
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
  const goToMainMenu = async (confirmed = false) => {
    if (!confirmed && pendingRef.current) {
      const open = undecidedFindings();
      setConfirmation({
        text: open ? undecidedWarning(open) : 'Van egy döntésre váró javaslat. Új beszélgetésnél ez elvész (a dokumentumhoz nem nyúlok).',
        choices: [{ label: 'Új beszélgetés', primary: true, run: () => goToMainMenu(true) }],
      });
      return;
    }
    if (!tryLock()) return;
    try {
      await closePending('rejected', '✖️ Elvetve.');
      // A new conversation has no undo buttons: let Word forget the kept ranges
      await releaseUndo(messagesRef.current.flatMap(m => m.undo ?? []));
      setMessages([WELCOME_MESSAGE]);
      setInput('');
      setMode('edit');
    } finally {
      unlock();
    }
  };

  /** From the structure view: put the cursor in place, then ask the assistant */
  const runStructureRequest = async (request: StructureRequest, confirmed = false) => {
    if (busyRef.current) return;
    const open = undecidedFindings();
    if (!confirmed && open) {
      setTab('assistant');
      setConfirmation({ text: undecidedWarning(open), choices: [{ label: 'Folytatom a javaslattal', primary: true, run: () => runStructureRequest(request, true) }] });
      return;
    }
    try {
      await placeAtParagraph(request.paragraph, request.cursor, request.expectedText);
    } catch (error) {
      setTab('assistant');
      addMessage({ role: 'system', content: error instanceof UserFacingError ? error.message : 'Nem sikerült odaállni a bekezdéshez.' });
      return;
    }
    setTab('assistant');
    setMode(request.mode);
    await handleSend(request.instruction, request.mode, request.label, { confirmed: true, forceNew: true });
  };

  const handleSend = async (instructionOverride?: string, modeOverride?: Mode, displayText?: string, options: SendOptions = {}) => {
    const typed = (instructionOverride ?? input).trim();
    if (!typed || busyRef.current) return;
    const fromInput = instructionOverride === undefined || !!options.clearInput;
    const again = (extra: SendOptions) => handleSend(typed, modeOverride, displayText, { ...options, ...extra, clearInput: fromInput });
    {
      const preset = displayText ? null : matchPreset(typed, modeOverride ?? mode, settings.customPresets);
      const requestMode = modeOverride ?? preset?.mode ?? mode;
      const current = pendingRef.current;
      const refining = !options.forceNew && current !== null && current.mode === requestMode;
      // A half-decided review is not closed without asking
      const open = !refining ? undecidedFindings() : 0;
      if (!options.confirmed && open) {
        setConfirmation({ text: undecidedWarning(open), choices: [{ label: 'Új kérés indítása', primary: true, run: () => again({ confirmed: true }) }] });
        return;
      }
      // Nothing selected in Edit mode: the whole document gets rewritten. For a longer one, ask first
      // (read from Word now: the limits bar's numbers are refreshed only every few seconds)
      if (!refining && !options.confirmed && requestMode === 'edit' && typeof Word !== 'undefined') {
        const documentChars = (await readSelectionLength().catch(() => 1)) === 0 ? await readDocumentLength().catch(() => 0) : 0;
        if (documentChars > WHOLE_DOCUMENT_CONFIRM_CHARS) {
          setConfirmation({
            text: `Nem jelöltél ki semmit, ezért az egész dokumentumot (${formatNumber(documentChars)} karakter) átírnám. Ez hosszabb ideig tart. Biztosan az egészre gondoltál?`,
            choices: [{ label: 'Igen, az egész dokumentumon', primary: true, run: () => again({ confirmed: true }) }],
          });
          return;
        }
      }
      // Typed or quick-button instruction while something else is selected: new request or refinement?
      if (refining && !options.explicitRefine && !options.confirmed && typeof Word !== 'undefined') {
        const moved = await selectionMovedFrom(current!.snapshot).catch(() => false);
        if (moved) {
          setConfirmation({
            text: 'Amióta a javaslat elkészült, mást jelöltél ki a dokumentumban. Mire vonatkozzon az új utasítás?',
            choices: [
              { label: 'Új kérés az új kijelölésre', primary: true, run: () => again({ confirmed: true, forceNew: true }) },
              { label: 'A fenti javaslat finomítása', run: () => again({ confirmed: true }) },
            ],
          });
          return;
        }
      }
    }
    if (!tryLock()) return;
    if (settings.sound) primeSound();
    const chime = (kind: 'done' | 'error') => { if (settings.sound) playSound(kind); };
    // A built-in quick button can stand for a longer instruction; the chat shows the short label
    const preset = displayText ? null : matchPreset(typed, modeOverride ?? mode, settings.customPresets);
    // A quick button's text stands for its instruction: a built-in long one, or the one the user saved with it
    const instruction = (preset && (preset.custom ? preset.instruction : PRESET_INSTRUCTIONS[preset.label])) || typed;
    setIsSending(true);
    const controller = new AbortController();
    abortRef.current = controller;
    // Új kijelölés, amit még egy javaslat sem vett át: hiba vagy leállítás esetén el kell engedni
    let unclaimedRange: Word.Range | null = null;

    try {
      if (fromInput) setInput('');

      // A begépelt vagy kattintott gyorsgombot felismerjük; egy másik módhoz mentett saját gyorsgomb abban a módban fut
      const requestMode = modeOverride ?? preset?.mode ?? mode;
      if (requestMode !== mode) setMode(requestMode);
      const current = pendingRef.current;
      // Amíg van döntésre váró javaslat ugyanebben a módban, az új utasítás azt finomítja
      // A request from the structure view, a re-check or "new request" is always a new one
      const refining = !options.forceNew && current !== null && current.mode === requestMode;
      if (current && !refining) {
        await closePending('rejected', '✖️ Elvetve, mert új kérést indítottál.');
      }

      // Sending is a fresh start: follow the conversation to the bottom again
      followRef.current = true;
      const userMessageId = addMessage({ role: 'user', content: `[${modeLabel(requestMode)}${refining ? ' · finomítás' : ''}] ${displayText ?? typed}`, preset: preset ?? undefined });

      if (typeof Word === 'undefined') {
        addMessage({ role: 'system', content: 'Hiba: A Word API nem érhető el. Kérlek a Wordön belül használd a beépülőt!' });
        return;
      }

      const snapshot = refining ? current!.snapshot : await takeSnapshot(requestMode);
      // Say it in the chat too: without a selection the request covers the whole document
      if (!refining && snapshot.wholeDocument) {
        updateMessage(userMessageId, m => ({ ...m, content: m.content.replace(/^\[([^\]]+)\]/, '[$1 · egész dokumentum]') }));
      }
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
        depth: settings.depth,
        ...(party ? { party } : {}),
      };
      // Names and identifiers are replaced by placeholders before the request leaves the machine
      const prepared = await prepareSend(request, refining
        ? current!.masker
        : settings.masking.enabled ? new Masker(parseExtraTerms(settings.masking.extraTerms), parseExtraTerms(settings.masking.neverHide)) : null);
      if (!prepared) {
        updateMessage(userMessageId, m => ({ ...m, status: { text: 'Nem küldtem el.', tone: 'neutral' } }));
        return;
      }
      const { sent: sentRequest, masker } = prepared;
      const sources = [request.instruction, request.originalText, request.documentContext];
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
          depth: settings.depth,
          party,
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
            // A clarifying question arrives as JSON after a marker line: show nothing until it is parsed
            if (rawText.trimStart().startsWith('=')) return;
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
          const authProblem = aiError instanceof AIRequestError && (aiError.code === 'UNAUTHORIZED' || aiError.code === 'MASKING_REQUIRED');
          finishLoadingMessage({ role: 'system', content: describeRequestError(aiError), showSettingsLink: authProblem });
        }
        return;
      }

      // The answer is here: a soft chime, so the user can work elsewhere meanwhile
      chime('done');
      // The AI asked back instead of guessing: offer its readings as one-click answers
      const clarification = requestMode !== 'review' ? parseClarification(result) : null;
      if (clarification) {
        finishLoadingMessage({
          content: unmask(clarification.question),
          clarification: { options: clarification.options.map(o => unmask(o)), mode: requestMode },
        });
        return;
      }

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
      setPending({ messageId: loadingId, mode: requestMode, snapshot, rounds: [...rounds, { instruction, result }], result, explanation, masker, sources });
      // A placeholder left after unmasking (made up or mangled beyond recognition) has no real value behind it:
      // such an answer, or such a finding, can't be written into the document
      const blocked = requestMode === 'review' ? [] : unresolvedPlaceholders([result, explanation], sources);
      const findingViews: FindingView[] | undefined = findings?.map(f => {
        const held = unresolvedPlaceholders([f.quote, f.comment, f.suggestion], sources);
        return held.length ? { ...f, selected: false, fix: false, blocked: held } : { ...f, selected: true, fix: !!f.suggestion };
      });
      const heldFindings = findingViews?.filter(f => f.blocked).length ?? 0;
      // Asking for a comment in the instruction ticks the box by default
      const addExplanation = !!explanation && /megjegyz|komment|indokl|magyaráz/i.test(instruction);
      finishLoadingMessage({
        content: requestMode === 'review' ? '' : result,
        proposal: { state: 'pending', findings: findingViews, explanation, addExplanation, blocked: blocked.length ? blocked : undefined },
        status: heldFindings
          ? { text: `⛔ ${heldFindings} észrevételben fel nem oldott helyettesítő maradt, ezeket nem lehet beszúrni (lásd fent). A többi rendben van.`, tone: 'neutral' }
          : undefined,
      });

      if (settings.autoApply && !blocked.length && !heldFindings) {
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

    // Remembers what gets inserted, so "Visszavonom" can take it back
    const undo = canUndo() ? newUndoRecord() : undefined;
    try {
      let status: string;
      let structureNote = '';
      let updatedFindings = findingViews;
      let write: WriteMode | undefined;
      const range = current.snapshot.range;

      // Last line of defence: nothing with an unresolved placeholder is written, whatever the buttons allowed
      const held = current.mode === 'review' ? [] : unresolvedPlaceholders([current.result, explanation], current.sources);
      if (held.length) throw new UserFacingError(unresolvedMessage(held));

      const editBefore = current.mode === 'edit' || current.mode === 'generate' ? await structureIssues() : null;
      // Changes the user left out keep the original text
      const excluded = new Set<number>(messagesRef.current.find(m => m.id === messageId)?.proposal?.excluded ?? []);
      if (current.mode === 'edit' && current.snapshot.wholeDocument) {
        const whole = current.snapshot.wholeDocument;
        const text = excluded.size ? composeDocument(whole.reviewed, planDocumentEdits(whole.reviewed, current.result), excluded) : current.result;
        const outcome = await applyDocumentEdit(whole, text, explanation, undo);
        write = outcome.write;
        const parts = [
          outcome.changed && `${outcome.changed} bekezdést módosítottam`,
          outcome.inserted && `${outcome.inserted} új bekezdést szúrtam be`,
          outcome.deleted && `${outcome.deleted} bekezdést töröltem`,
        ].filter(Boolean);
        status = parts.length
          ? `✅ Az egész dokumentumon: ${parts.join(', ')}, ${how(write)}. A többi bekezdéshez nem nyúltam.`
          : '✅ A javaslat megegyezik a dokumentummal, nem kellett semmit módosítani.';
      } else if (current.mode === 'edit') {
        const outcome = await applyEdit(range!, applyChosenHunks(current.snapshot.selectionText, current.result, excluded), explanation, undo, current.snapshot.selectionText);
        write = outcome.strategy === 'unchanged' ? undefined : outcome.write;
        status = outcome.pendingChanges
          ? `✅ A kijelölést kicseréltem, ${how(write)}. Mivel benne még el nem fogadott korábbi korrektúra volt, a teljes kijelölést cseréltem (itt a formázás egyszerűsödhetett).`
          : outcome.strategy === 'words'
          ? `✅ ${outcome.changedPlaces} helyen módosítottam, ${how(write)}. A változatlan szöveg formázása érintetlen maradt.`
          : outcome.strategy === 'unchanged'
          ? '✅ A javaslat megegyezik az eredetivel, nem kellett semmit módosítani.'
          : `✅ A kijelölést kicseréltem, ${how(write)}. Mivel a bekezdések száma megváltozott (vagy a kijelölés bekezdés közepén kezdődik), itt a formázás egyszerűsödhetett.`;
      } else if (current.mode === 'generate') {
        write = await insertGenerated(range!, current.result, undo, current.snapshot.selectionText);
        status = `✅ A szöveget beszúrtam a dokumentumba, ${how(write)}.`;
      } else if (current.mode === 'comment') {
        await insertCommentAt(range!, current.result, undo);
        status = current.snapshot.wholeDocument
          ? '✅ A véleményezést beszúrtam Megjegyzésként abba a bekezdésbe, ahol a kurzor állt.'
          : '✅ A véleményezést beszúrtam a margóra (Megjegyzésként).';
      } else {
        const chosen = (findingViews ?? []).filter(f => !f.done && (f.selected || f.fix) && !unresolvedPlaceholders([f.quote, f.comment, f.suggestion], current.sources).length);
        const before = await structureIssues();
        const outcome = await applyReviewFindings(chosen.map(f => ({ finding: f, comment: f.selected, fix: f.fix })), { undo });
        write = outcome.write;
        structureNote = newIssuesNote(before, await structureIssues());
        updatedFindings = findingViews?.map(f => (f.done ? f : {
          ...f,
          done: chosen.includes(f) ? 'applied' as const : 'dismissed' as const,
          notFound: outcome.notFound.includes(f),
          fixFailed: outcome.fixFailed.includes(f),
          fixProtected: outcome.fixProtected.includes(f),
        }));
        const done = [
          outcome.comments && `${outcome.comments} megjegyzést beszúrtam`,
          outcome.fixes && `${outcome.fixes} javítást beírtam ${how(write)}`,
        ].filter(Boolean);
        const missed = outcome.notFound.length + outcome.fixFailed.length + outcome.fixProtected.length;
        status = `✅ ${done.length ? done.join(', ') : 'Nem került be semmi'}.` +
          (missed ? ' Amit nem találtam meg szó szerint a dokumentumban, azt fent megjelöltem.' : '') + structureNote;
      }

      if (explanation) status += ' Az indoklást megjegyzésként mellé tettem.';
      if (editBefore) status += newIssuesNote(editBefore, await structureIssues());
      status += writeNote([write]);
      if (!write || write.tracked) status += markupHint();
      // Without Track Changes there is nothing to reject: "Visszavonom" would only take back the comments
      const keepUndo = undo && undo.ranges.length && (!write || write.tracked);
      if (undo && !keepUndo) releaseUndo([undo]);
      setPending(null);
      updateMessage(messageId, m => ({
        ...m,
        proposal: m.proposal && { ...m.proposal, state: 'applied', findings: updatedFindings },
        status: { text: status, tone: 'success' },
        undo: keepUndo ? [...(m.undo ?? []), undo] : m.undo,
      }));
      setDocumentVersion(v => v + 1);
    } catch (writeError) {
      console.error("Write error in Word:", writeError);
      // Part of it is in already: offering it again would insert it twice
      if (writeError instanceof PartialWriteError) {
        setPending(null);
        updateMessage(messageId, m => ({
          ...m,
          proposal: m.proposal && { ...m.proposal, state: 'applied' },
          status: { text: `⚠️ ${writeError.message}`, tone: 'neutral' },
          undo: undo?.ranges.length ? [...(m.undo ?? []), undo] : m.undo,
        }));
        setDocumentVersion(v => v + 1);
        return;
      }
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

  /** The structure problems right now (no AI); null when the document can't be read */
  const structureIssues = async (): Promise<StructureIssue[] | null> => {
    try {
      return buildDocumentGraph(await readParagraphs()).issues;
    } catch {
      return null;
    }
  };

  /** A warning when a change broke a reference or a definition that was fine before */
  const newIssuesNote = (before: StructureIssue[] | null, after: StructureIssue[] | null) => {
    if (!before || !after) return '';
    const added = newIssues(before, after);
    if (!added.length) return '';
    // Typical after a definitions section: the old "(a továbbiakban: …)" definitions became redundant
    if (added.every(issue => issue.kind === 'duplicate-inline')) {
      return ` ℹ️ ${added.length} fogalom zárójeles definíciója a szövegben most már felesleges. A Szerkezet fülön egy kattintással törölheted őket (korrektúrával).`;
    }
    return ` ⚠️ Ezzel ${added.length} új szerkezeti probléma keletkezett: ${added[0].message}${added.length > 1 ? ' …' : ''} Nézd meg a Szerkezet fülön.`;
  };

  /** After a partial acceptance: a review of the result, told what was taken and what was left out */
  const runRecheck = (findings: FindingView[]) => {
    const applied = findings.filter(f => f.done === 'applied');
    const dismissed = findings.filter(f => f.done === 'dismissed');
    setMode('review');
    handleSend(recheckInstruction(applied, dismissed), 'review', 'Ellenőrző átvizsgálás a döntéseim után (számozás, hivatkozások, fogalmak, logika)', { forceNew: true });
  };

  const setFinding = (messageId: string, index: number, change: Partial<FindingView>) => {
    updateMessage(messageId, m => ({
      ...m,
      proposal: m.proposal && { ...m.proposal, findings: m.proposal.findings?.map((f, i) => (i === index ? { ...f, ...change } : f)) },
    }));
  };

  /** Every finding decided one by one: the proposal is done */
  const finishIfAllDecided = (messageId: string, findings: FindingView[]) => {
    if (!findings.every(f => f.done)) return;
    if (pendingRef.current?.messageId === messageId) setPending(null);
    updateMessage(messageId, m => ({ ...m, proposal: m.proposal && { ...m.proposal, state: 'applied' } }));
  };

  /** Selects what the pending proposal is about: its selection, or where generated text will go */
  const showPendingPlace = async () => {
    const range = pendingRef.current?.snapshot.range;
    if (!range || busyRef.current) return;
    try {
      await showRange(range);
    } catch {
      addMessage({ role: 'system', content: 'Ezt a helyet már nem találom a dokumentumban.' });
    }
  };

  const showFindingInDocument = async (messageId: string, finding: FindingView, index: number) => {
    if (busyRef.current || typeof Word === 'undefined') return;
    try {
      const found = await showFinding(finding, finding.done === 'applied' && finding.fix);
      setFinding(messageId, index, { notShown: !found });
    } catch {
      setFinding(messageId, index, { notShown: true });
    }
  };

  /** Inserts one finding (comment and/or fix, as ticked) and selects it in the document */
  const applyOneFinding = async (messageId: string, findings: FindingView[], index: number) => {
    const current = pendingRef.current;
    const finding = findings[index];
    if (!current || current.messageId !== messageId || !finding || finding.done) return;
    // Never written with an unresolved placeholder, even if the button was reachable
    const held = unresolvedPlaceholders([finding.quote, finding.comment, finding.suggestion], current.sources);
    if (held.length) {
      setFinding(messageId, index, { blocked: held, selected: false, fix: false });
      return;
    }
    if (!tryLock()) return;
    setIsApplying(true);
    try {
      const before = await structureIssues();
      const undo = canUndo() ? newUndoRecord() : undefined;
      const outcome = await applyReviewFindings([{ finding, comment: finding.selected, fix: finding.fix }], { select: true, undo });
      const note = newIssuesNote(before, await structureIssues());
      const updated: FindingView = { ...finding, done: 'applied', notFound: outcome.notFound.length > 0, fixFailed: outcome.fixFailed.length > 0, fixProtected: outcome.fixProtected.length > 0 };
      const next = findings.map((f, i) => (i === index ? updated : f));
      const done = [outcome.comments && 'megjegyzés', outcome.fixes && `javítás ${how(outcome.write)}`].filter(Boolean).join(' és ');
      const tracked = !outcome.write || outcome.write.tracked;
      const keepUndo = undo && undo.ranges.length && tracked;
      if (undo && !keepUndo) releaseUndo([undo]);
      updateMessage(messageId, m => ({
        ...m,
        proposal: m.proposal && { ...m.proposal, findings: next },
        status: { text: done ? `✅ Beszúrva: ${done}.${note}${writeNote([outcome.write])}${tracked ? markupHint() : ''}` : '⚠️ Ezt nem tudtam beszúrni, lásd fent.', tone: done && !note ? 'success' : 'neutral' },
        undo: keepUndo ? [...(m.undo ?? []), undo] : m.undo,
      }));
      setDocumentVersion(v => v + 1);
      finishIfAllDecided(messageId, next);
    } catch (error) {
      console.error(error);
      addMessage({ role: 'system', content: 'Nem sikerült beszúrni ezt az észrevételt. Esetleg írásvédett a dokumentum?' });
    } finally {
      setIsApplying(false);
      unlock();
    }
  };

  const dismissFinding = (messageId: string, findings: FindingView[], index: number) => {
    const next = findings.map((f, i) => (i === index ? { ...f, done: 'dismissed' as const } : f));
    setFinding(messageId, index, { done: 'dismissed' });
    finishIfAllDecided(messageId, next);
  };

  /** Takes back everything this proposal inserted: its tracked changes are rejected, its comments deleted */
  const undoMessage = async (messageId: string) => {
    const records = messagesRef.current.find(m => m.id === messageId)?.undo;
    if (!records?.length || !tryLock()) return;
    setIsApplying(true);
    try {
      const { changes, comments } = await undoChanges(records);
      const stillPending = pendingRef.current?.messageId === messageId;
      updateMessage(messageId, m => ({
        ...m,
        undo: undefined,
        proposal: m.proposal && {
          ...m.proposal,
          // A review still open: the taken-back findings can be decided again
          state: stillPending ? m.proposal.state : 'rejected',
          findings: m.proposal.findings?.map(f => (f.done === 'applied' ? { ...f, done: stillPending ? undefined : 'dismissed', notFound: false, fixFailed: false, fixProtected: false } : f)),
        },
        status: {
          text: changes || comments
            ? `↩️ Visszavontam: ${[changes && `${changes} korrektúra`, comments && `${comments} megjegyzés`].filter(Boolean).join(', ')}.`
            : '↩️ Nem találtam visszavonnivalót (lehet, hogy már elfogadtad vagy elutasítottad a korrektúrákat a Wordben).',
          tone: 'neutral',
        },
      }));
      setDocumentVersion(v => v + 1);
    } catch (error) {
      console.error(error);
      addMessage({ role: 'system', content: 'Nem sikerült visszavonni. A Wordben a Véleményezés lapon a korrektúrákat egyenként is elutasíthatod.' });
    } finally {
      setIsApplying(false);
      unlock();
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
          <SettingsPanel settings={settings} onChange={updateSettings} onClose={() => setView('chat')} currentMode={mode} onRateLimit={setRateLimit} onReload={() => reloadPane()} />
        </div>
      )}

      {sendPreview && (
        <SendPreview
          request={sendPreview.request}
          masked={!!sendPreview.masker}
          summary={sendPreview.masker?.summary() ?? ''}
          onDecide={sendPreview.resolve}
        />
      )}

      {confirmation && (
        <div className="fixed inset-0 z-40 bg-black/30 flex items-center justify-center p-4" role="dialog" aria-modal="true">
          <div className="bg-white rounded-xl shadow-lg p-4 max-w-sm w-full space-y-3">
            <p className="text-sm text-neutral-800">{confirmation.text}</p>
            <div className="flex flex-col space-y-1.5">
              {confirmation.choices.map(choice => (
                <button
                  key={choice.label}
                  onClick={() => { setConfirmation(null); choice.run(); }}
                  className={`px-3 py-2 text-xs font-medium rounded-lg ${choice.primary ? 'bg-blue-600 hover:bg-blue-700 text-white' : 'border border-neutral-300 text-neutral-700 hover:bg-neutral-100'}`}
                >
                  {choice.label}
                </button>
              ))}
              <button onClick={() => setConfirmation(null)} className="px-3 py-2 text-xs text-neutral-500 hover:text-neutral-800">Mégse</button>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="bg-white border-b-2 border-[#29abe2] px-4 py-3 shrink-0 shadow-sm z-10 flex items-center justify-between">
        <div className="min-w-0">
          <Logo className="h-5 max-w-full" />
          <h1 className="text-xs font-semibold text-[#0f2350] flex items-center mt-1 min-w-0">
            <PenTool className="w-3.5 h-3.5 mr-1 text-[#29abe2] shrink-0" />
            <span className="whitespace-nowrap">Word Writer</span>
            <span className="ml-1.5 font-normal text-neutral-500 truncate">· szerkessz, véleményezz, generálj</span>
          </h1>
        </div>
        <div className="flex items-center space-x-1.5 shrink-0">
          {tab === 'assistant' && messages.length > 1 && (
            <button
              onClick={() => goToMainMenu()}
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
            className={`flex-1 min-w-0 flex items-center justify-center px-0.5 py-2 text-xs font-medium whitespace-nowrap border-b-2 transition-colors ${tab === t.id ? 'border-blue-600 text-blue-700' : 'border-transparent text-neutral-500 hover:text-neutral-800'}`}
          >
            {t.icon}{t.label}
          </button>
        ))}
      </div>

      {newVersion && (
        <div className="flex items-center justify-between bg-amber-50 border-b border-amber-200 px-3 py-1.5 text-[11px] text-amber-900 shrink-0">
          <span>Új verzió fut a szerveren. Töltsd újra a bővítményt, hogy azt használd.</span>
          <button onClick={() => reloadPane()} className="ml-2 font-semibold underline shrink-0">Újratöltés</button>
        </div>
      )}

      {(tab === 'assistant' || tab === 'compare') && <PartyBar party={party} onChange={setParty} />}

      <div className={tab === 'structure' ? 'flex-1 min-h-0 flex flex-col' : 'hidden'}>
        <StructurePanel active={tab === 'structure'} busy={isBusy} documentVersion={documentVersion} onRequest={runStructureRequest} />
      </div>
      <div className={tab === 'compare' ? 'flex-1 min-h-0 flex flex-col' : 'hidden'}>
        <ComparePanel
          settings={settings}
          party={party}
          prepareSend={prepareSend}
          onRateLimit={setRateLimit}
          onOpenSettings={() => setView('settings')}
          onNeverHide={value => updateSettings(s => ({ ...s, masking: { ...s.masking, neverHide: [s.masking.neverHide.trim(), value].filter(Boolean).join('\n') } }))}
        />
      </div>

      <div className={tab === 'translate' ? 'flex-1 min-h-0 flex flex-col' : 'hidden'}>
        <TranslatePanel
          active={tab === 'translate'}
          settings={settings}
          prepareSend={prepareSend}
          onRateLimit={setRateLimit}
          onOpenSettings={() => setView('settings')}
        />
      </div>

      <div className={tab === 'format' ? 'flex-1 min-h-0 flex flex-col' : 'hidden'}>
        <FormatPanel active={tab === 'format'} onDocumentChanged={() => setDocumentVersion(v => v + 1)} />
      </div>

      <div className={tab === 'assistant' ? 'contents' : 'hidden'}>
      {/* Chat Area */}
      <div ref={chatRef} onScroll={onChatScroll} className="flex-1 overflow-y-auto p-4 space-y-4">
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
                  excluded={msg.proposal.excluded}
                  onToggleChange={id => updateMessage(msg.id, m => ({
                    ...m,
                    proposal: m.proposal && {
                      ...m.proposal,
                      excluded: m.proposal.excluded?.includes(id) ? m.proposal.excluded.filter(x => x !== id) : [...(m.proposal.excluded ?? []), id],
                    },
                  }))}
                  blocked={msg.proposal.blocked}
                  explanation={msg.proposal.explanation}
                  addExplanation={!!msg.proposal.addExplanation}
                  onToggleExplanation={() => updateMessage(msg.id, m => ({ ...m, proposal: m.proposal && { ...m.proposal, addExplanation: !m.proposal.addExplanation } }))}
                  onApply={() => handleApply(msg.id, msg.proposal?.findings, !!msg.proposal?.addExplanation)}
                  onReject={handleReject}
                  onAlternative={() => {
                    const findings = msg.proposal?.findings ?? [];
                    const applied = findings.filter(f => f.done === 'applied');
                    const dismissed = findings.filter(f => f.done === 'dismissed');
                    // A partly decided review: the new version must not offer again what is in or was refused
                    if (msg.details!.mode === 'review' && (applied.length || dismissed.length)) {
                      handleSend(alternativeReviewInstruction(applied, dismissed), 'review', ALTERNATIVE_INSTRUCTION, { explicitRefine: true });
                    } else {
                      handleSend(ALTERNATIVE_INSTRUCTION, msg.details!.mode, undefined, { explicitRefine: true });
                    }
                  }}
                  onRecheck={msg.proposal.findings ? () => runRecheck(msg.proposal!.findings!) : undefined}
                  onShow={pending?.messageId === msg.id && pending.snapshot.range ? () => showPendingPlace() : undefined}
                  onShowParagraph={pending?.messageId === msg.id && pending.snapshot.wholeDocument ? index => { jumpToParagraph(index, false).catch(() => {}); } : undefined}
                  findingActions={{
                    onToggle: (index, field) => toggleFinding(msg.id, index, field),
                    onShow: index => msg.proposal?.findings && showFindingInDocument(msg.id, msg.proposal.findings[index], index),
                    onApplyOne: index => msg.proposal?.findings && applyOneFinding(msg.id, msg.proposal.findings, index),
                    onDismiss: index => msg.proposal?.findings && dismissFinding(msg.id, msg.proposal.findings, index),
                    onRestore: index => setFinding(msg.id, index, { done: undefined }),
                  }}
                />
              ) : (
                <span className="whitespace-pre-wrap">{msg.content}</span>
              )}
              {msg.status && (
                <p className={`mt-2 text-xs font-medium ${msg.status.tone === 'success' ? 'text-green-700' : 'text-neutral-500'}`}>{msg.status.text}</p>
              )}
              {msg.clarification && (
                <div className="mt-2 space-y-1.5">
                  {msg.clarification.options.map((option, i) => (
                    <button
                      key={i}
                      onClick={() => {
                        updateMessage(msg.id, m => ({ ...m, clarification: m.clarification && { ...m.clarification, picked: i } }));
                        handleSend(option, msg.clarification!.mode, undefined, { explicitRefine: true });
                      }}
                      disabled={isBusy || msg.clarification!.picked !== undefined}
                      className={`w-full text-left px-3 py-2 text-xs rounded-lg border transition-colors ${msg.clarification!.picked === i ? 'bg-blue-600 border-blue-600 text-white' : 'bg-white border-blue-200 text-blue-900 hover:bg-blue-50 disabled:opacity-50'}`}
                    >
                      <span className="font-semibold mr-1">{i + 1}.</span>{option}
                    </button>
                  ))}
                  {msg.clarification.picked === undefined && (
                    <p className="text-[11px] text-neutral-500">Egyik sem? Írd be alul, mire gondoltál.</p>
                  )}
                </div>
              )}
              {msg.undo && msg.undo.length > 0 && (
                <button
                  onClick={() => undoMessage(msg.id)}
                  disabled={isBusy}
                  title="Elutasítja a javaslat által beírt korrektúrákat és törli a megjegyzéseit"
                  className="mt-1.5 flex items-center text-xs font-medium text-neutral-600 hover:text-neutral-900 disabled:opacity-50"
                >
                  <Undo2 className="w-3.5 h-3.5 mr-1" />Visszavonom
                </button>
              )}
              {msg.showSettingsLink && (
                <button onClick={() => setView('settings')} className="mt-2 flex items-center text-xs font-medium underline">
                  <KeyRound className="w-3.5 h-3.5 mr-1" />
                  Beállítások megnyitása
                </button>
              )}
              {msg.details && <RequestDetails details={msg.details} isLoading={!!msg.isLoading} onNeverHide={value => updateSettings(s => ({ ...s, masking: { ...s.masking, neverHide: [s.masking.neverHide.trim(), value].filter(Boolean).join('\n') } }))} />}
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

        {settings.skipTrackedChanges && (
          <div className="mb-2 flex items-center justify-between text-[11px] text-amber-900 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5">
            <span>✎ Korrektúra nélküli beírás bekapcsolva (ahol nincs el nem fogadott korrektúra).</span>
            <button onClick={() => updateSettings(s => ({ ...s, skipTrackedChanges: false }))} className="underline ml-2 shrink-0">Kikapcsolom</button>
          </div>
        )}

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
              title={preset.instruction ? `Saját gyorsgomb: ${preset.instruction}` : 'Saját gyorsgomb'}
              className="px-3 py-1.5 text-xs bg-blue-50 hover:bg-blue-100 text-blue-800 border border-blue-200 rounded-full transition-colors max-w-full truncate disabled:opacity-50"
            >
              {preset.label}
            </button>
          ))}
        </div>

        {/* How hard the AI thinks; remembered in the settings */}
        <div className="mb-2 flex items-center text-[11px] text-neutral-500" role="radiogroup" aria-label="Gondolkodás">
          <span className="mr-1.5">Gondolkodás:</span>
          {(Object.entries(DEPTH_LABELS) as [Depth, { label: string; title: string }][]).map(([depth, { label, title }]) => (
            <button
              key={depth}
              role="radio"
              aria-checked={settings.depth === depth}
              title={title}
              onClick={() => updateSettings(s => ({ ...s, depth }))}
              className={`px-2 py-0.5 mr-1 rounded-full border ${settings.depth === depth ? 'bg-neutral-800 text-white border-neutral-800' : 'border-neutral-300 hover:bg-neutral-100'}`}
            >
              {label}
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
              riskAccepted={settings.dictation.riskAccepted}
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
