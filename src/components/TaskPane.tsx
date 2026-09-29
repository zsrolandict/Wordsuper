import React, { useState, useRef, useEffect } from 'react';
import { Send, PenTool, AlertCircle, Loader2, House, Settings as SettingsIcon, Square, KeyRound } from 'lucide-react';
import { MAX_INSTRUCTION_CHARS, MODES, type AIRequestBody, type HistoryTurn, type Mode, type ReviewFinding } from '../shared/aiConfig';
import { AIRequestError, describeRequestError, streamAIResponse, type RateLimitInfo } from '../services/aiService';
import {
  UserFacingError,
  applyEdit,
  insertCommentAt,
  insertGenerated,
  insertReviewComments,
  releaseRange,
  takeSnapshot,
  type DocumentSnapshot,
} from '../services/wordDocument';
import { parseFindings } from '../services/review';
import { describeStyle, useSettings } from '../services/settings';
import { useDocumentStats } from '../services/useDocumentStats';
import RequestDetails, { type RequestDetailsData } from './RequestDetails';
import Proposal, { type FindingView, type ProposalState } from './Proposal';
import LimitsBar from './LimitsBar';
import SettingsPanel from './SettingsPanel';
import { DEFAULT_PRESETS, MODE_LABELS, PLACEHOLDERS, modeLabel } from './modes';

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
  proposal?: { state: ProposalState; findings?: FindingView[] };
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
}

const WELCOME_MESSAGE: Message = {
  id: 'welcome',
  role: 'assistant',
  content: 'Szia! Jelölj ki egy szöveget a dokumentumban, és válassz módot alul! Választhatsz, hogy kicseréljem a szöveget korrektúrával, vagy egy széljegyzetben (Word Megjegyzés) elemezzem a kijelölt részt. Az Átvizsgálás a teljes dokumentumot nézi át. Mielőtt bármi bekerül a dokumentumba, megmutatom a javaslatot.'
};

const ALTERNATIVE_INSTRUCTION = 'Kérek egy másik változatot.';

const newMessageId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

export default function TaskPane() {
  const [messages, setMessages] = useState<Message[]>([WELCOME_MESSAGE]);
  const [input, setInput] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [mode, setMode] = useState<Mode>('edit');
  const [view, setView] = useState<'chat' | 'settings'>('chat');
  const [settings, updateSettings] = useSettings();
  const [rateLimit, setRateLimit] = useState<RateLimitInfo | null>(null);
  const [pending, setPendingState] = useState<PendingProposal | null>(null);
  // Minden dokumentum-módosítás után nő, hogy a korlátjelző újra lemérje a méretet
  const [documentVersion, setDocumentVersion] = useState(0);
  const pendingRef = useRef<PendingProposal | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const stats = useDocumentStats(documentVersion);

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

  /** Lezárja a függő javaslatot a dokumentum módosítása nélkül */
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

  // Vissza a kezdőképernyőre, új beszélgetéssel
  const goToMainMenu = async () => {
    await closePending('rejected', '✖️ Elvetve.');
    setMessages([WELCOME_MESSAGE]);
    setInput('');
    setMode('edit');
  };

  const handleSend = async (instructionOverride?: string, modeOverride?: Mode) => {
    const instruction = (instructionOverride ?? input).trim();
    if (!instruction || isSending) return;
    if (instructionOverride === undefined) setInput('');

    const requestMode = modeOverride ?? mode;
    const current = pendingRef.current;
    // Amíg van döntésre váró javaslat ugyanebben a módban, az új utasítás azt finomítja
    const refining = current !== null && current.mode === requestMode;
    if (current && !refining) {
      await closePending('rejected', '✖️ Elvetve, mert új kérést indítottál.');
    }

    addMessage({ role: 'user', content: `[${modeLabel(requestMode)}${refining ? ' · finomítás' : ''}] ${instruction}` });

    if (typeof Word === 'undefined') {
      addMessage({ role: 'system', content: 'Hiba: A Word API nem érhető el. Kérlek a Wordön belül használd a beépülőt!' });
      return;
    }

    setIsSending(true);
    const controller = new AbortController();
    abortRef.current = controller;
    // Új kijelölés, amit még egy javaslat sem vett át: hiba vagy leállítás esetén el kell engedni
    let unclaimedRange: Word.Range | null = null;

    try {
      const snapshot = refining ? current!.snapshot : await takeSnapshot(requestMode);
      if (!refining) unclaimedRange = snapshot.range;
      const rounds = refining ? current!.rounds : [];

      const request: AIRequestBody = {
        mode: requestMode,
        instruction,
        originalText: requestMode === 'edit' || requestMode === 'comment' ? snapshot.selectionText : '',
        documentContext: snapshot.documentContext,
        history: rounds,
        styleProfile: settings.styleProfile,
      };

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
          historyRounds: rounds.length,
          styleSummary: describeStyle(settings.styleProfile),
          thoughts: '',
          startedAt,
        },
      }]);

      // A válasz lezárása: a részleteket megtartjuk, hogy utólag is visszanézhető legyen
      const finishLoadingMessage = (changes: Partial<Message>) => {
        updateMessage(loadingId, m => ({
          ...m,
          ...changes,
          isLoading: false,
          details: m.details && { ...m.details, durationMs: Date.now() - startedAt },
        }));
      };

      let result: string;
      try {
        result = await streamAIResponse(request, {
          // Frissítsük az UI-t folyamatosan, ahogy jönnek a szavak (az átvizsgálás JSON-ját nem mutatjuk nyersen)
          onText: chunk => {
            if (requestMode !== 'review') updateMessage(loadingId, m => ({ ...m, content: m.content + chunk, isLoading: false }));
          },
          // A gondolkodás csak a Részletek panelbe kerül, a dokumentumba soha
          onThought: chunk => updateMessage(loadingId, m => {
            if (!m.details) return m;
            const previous = m.details.thoughts;
            const separator = previous && !previous.endsWith('\n') ? '\n\n' : '';
            return { ...m, details: { ...m.details, thoughts: previous + separator + chunk } };
          }),
          onRateLimit: setRateLimit,
        }, { accessKey: settings.accessKey, signal: controller.signal });
      } catch (aiError) {
        // Hibás, félbeszakadt vagy leállított válasz esetén a dokumentumhoz nem nyúlunk
        if (controller.signal.aborted) {
          finishLoadingMessage({ status: { text: '⏹️ Leállítottad. A dokumentumot nem módosítottam.', tone: 'neutral' } });
        } else {
          const authProblem = aiError instanceof AIRequestError && aiError.code === 'UNAUTHORIZED';
          finishLoadingMessage({ role: 'system', content: describeRequestError(aiError), showSettingsLink: authProblem });
        }
        return;
      }

      let findings: ReviewFinding[] | undefined;
      if (requestMode === 'review') {
        const parsed = parseFindings(result);
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
      setPending({ messageId: loadingId, mode: requestMode, snapshot, rounds: [...rounds, { instruction, result }], result });
      const findingViews = findings?.map(f => ({ ...f, selected: true }));
      finishLoadingMessage({ content: requestMode === 'review' ? '' : result, proposal: { state: 'pending', findings: findingViews } });

      if (settings.autoApply) {
        await applyProposal(loadingId, findingViews);
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
    }
  };

  const applyProposal = async (messageId: string, findingViews?: FindingView[]) => {
    const current = pendingRef.current;
    if (!current || current.messageId !== messageId) return;
    updateMessage(messageId, m => ({ ...m, proposal: m.proposal && { ...m.proposal, state: 'applying' } }));

    try {
      let status: string;
      let updatedFindings = findingViews;
      const range = current.snapshot.range;

      if (current.mode === 'edit') {
        const outcome = await applyEdit(range!, current.result);
        status = outcome.strategy === 'words'
          ? `✅ ${outcome.changedPlaces} helyen módosítottam, korrektúrával. A változatlan szöveg formázása érintetlen maradt.`
          : outcome.strategy === 'unchanged'
          ? '✅ A javaslat megegyezik az eredetivel, nem kellett semmit módosítani.'
          : '✅ A kijelölést kicseréltem, korrektúrával. Mivel a bekezdések száma megváltozott (vagy a kijelölés bekezdés közepén kezdődik), itt a formázás egyszerűsödhetett.';
      } else if (current.mode === 'generate') {
        await insertGenerated(range!, current.result);
        status = '✅ A szöveget beszúrtam a dokumentumba!';
      } else if (current.mode === 'comment') {
        await insertCommentAt(range!, current.result);
        status = '✅ A véleményezést beszúrtam a margóra (Megjegyzésként).';
      } else {
        const selected = (findingViews ?? []).filter(f => f.selected);
        const outcome = await insertReviewComments(selected);
        updatedFindings = findingViews?.map(f => ({ ...f, notFound: outcome.notFound.includes(f) }));
        status = `✅ ${outcome.inserted} megjegyzést beszúrtam.` +
          (outcome.notFound.length ? ` ${outcome.notFound.length} idézetet nem találtam meg szó szerint a dokumentumban, ezeket fent megjelöltem.` : '');
      }

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
      addMessage({ role: 'system', content: 'Kész lettem volna a válasszal, de nem tudtam beszúrni a dokumentumba. Esetleg írásvédett a dokumentum, vagy zárolt részre kattintottál? A javaslat megmaradt: újrapróbálhatod vagy elvetheted.' });
    }
  };

  const toggleFinding = (messageId: string, index: number) => {
    updateMessage(messageId, m => ({
      ...m,
      proposal: m.proposal && {
        ...m.proposal,
        findings: m.proposal.findings?.map((f, i) => (i === index ? { ...f, selected: !f.selected } : f)),
      },
    }));
  };

  if (view === 'settings') {
    return <SettingsPanel settings={settings} onChange={updateSettings} onClose={() => setView('chat')} currentMode={mode} />;
  }

  const refining = pending !== null && pending.mode === mode;
  const customPresets = settings.customPresets.filter(p => p.mode === mode);

  return (
    <div className="h-screen bg-neutral-50 flex flex-col font-sans text-neutral-900">
      {/* Header */}
      <div className="bg-blue-600 px-4 py-4 text-white shrink-0 shadow-md z-10 flex items-start justify-between">
        <div>
          <h1 className="text-lg font-bold flex items-center">
            <PenTool className="w-5 h-5 mr-2" />
            Word Writer
          </h1>
          <p className="text-blue-100 text-xs mt-1">Szerkessz, véleményezz, vagy generálj!</p>
        </div>
        <div className="flex items-center space-x-1.5 shrink-0">
          {messages.length > 1 && (
            <button
              onClick={goToMainMenu}
              disabled={isSending}
              title={isSending ? 'Várd meg, amíg elkészül a válasz' : 'Vissza a kezdőképernyőre, új beszélgetéssel'}
              className="flex items-center px-2.5 py-1.5 text-xs font-medium bg-blue-500 hover:bg-blue-400 disabled:opacity-50 disabled:hover:bg-blue-500 rounded-lg transition-colors"
            >
              <House className="w-4 h-4 mr-1" />
              Főmenü
            </button>
          )}
          <button
            onClick={() => setView('settings')}
            title="Beállítások"
            aria-label="Beállítások"
            className="p-1.5 bg-blue-500 hover:bg-blue-400 rounded-lg transition-colors"
          >
            <SettingsIcon className="w-4 h-4" />
          </button>
        </div>
      </div>

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
                  busy={isSending}
                  onApply={() => applyProposal(msg.id, msg.proposal?.findings)}
                  onReject={() => closePending('rejected', '✖️ Elvetetted, a dokumentum változatlan maradt.')}
                  onAlternative={() => handleSend(ALTERNATIVE_INSTRUCTION, msg.details!.mode)}
                  onToggleFinding={index => toggleFinding(msg.id, index)}
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
          {MODES.map(m => (
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
              disabled={isSending}
              className="px-3 py-1.5 text-xs bg-neutral-100 hover:bg-neutral-200 text-neutral-700 border border-neutral-200 rounded-full transition-colors whitespace-nowrap disabled:opacity-50"
            >
              {preset}
            </button>
          ))}
          {customPresets.map((preset) => (
            <button
              key={preset.id}
              onClick={() => handleSend(preset.label)}
              disabled={isSending}
              title="Saját gyorsgomb"
              className="px-3 py-1.5 text-xs bg-blue-50 hover:bg-blue-100 text-blue-800 border border-blue-200 rounded-full transition-colors max-w-full truncate disabled:opacity-50"
            >
              {preset.label}
            </button>
          ))}
        </div>

        {refining && !isSending && (
          <div className="mb-2 flex items-center justify-between text-[11px] text-blue-800 bg-blue-50 border border-blue-200 rounded-lg px-2.5 py-1.5">
            <span>↻ Finomítás: amit most írsz, a fenti javaslatot módosítja.</span>
            <button
              onClick={() => closePending('rejected', '✖️ Elvetetted, a dokumentum változatlan maradt.')}
              className="underline ml-2 shrink-0"
            >
              Elvetés
            </button>
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
              disabled={!input.trim()}
              aria-label="Küldés"
              className="w-11 h-11 shrink-0 flex items-center justify-center bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white rounded-xl transition-colors"
            >
              <Send className="w-5 h-5 ml-1" />
            </button>
          )}
        </div>
        <p className="text-[10px] text-center text-neutral-400 mt-2">Nyomj Entert a küldéshez{isSending ? ' · a piros gombbal leállíthatod' : ''}</p>
      </div>
    </div>
  );
}
