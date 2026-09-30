import React, { useEffect, useRef, useState } from 'react';
import { Mic, Square, Loader2, X } from 'lucide-react';
import { describeRequestError, transcribeAudio } from '../services/aiService';
import { transcribeLocally, type LocalModel } from '../services/localSpeech';

/** Longest recording; the server accepts about two minutes of compressed speech */
const MAX_RECORDING_SECONDS = 110;
// Formats the AI accepts, in order of preference; browsers support different ones
const RECORDING_TYPES = ['audio/ogg;codecs=opus', 'audio/mp4', 'audio/webm;codecs=opus', 'audio/webm'];

type State =
  | { kind: 'idle' }
  | { kind: 'recording'; seconds: number }
  /** download: share of the local model downloaded so far (first use only) */
  | { kind: 'transcribing'; download: number | null };

/**
 * Word on the web shows microphone access only after the add-in asked Office for it. The first time the user
 * allows it, the add-in has to be reloaded before the microphone can be used.
 */
async function askOfficeForMicrophone(): Promise<'ready' | 'reload'> {
  const office = typeof Office !== 'undefined' ? Office : undefined;
  const onTheWeb = office?.context?.platform === office?.PlatformType?.OfficeOnline;
  if (!office || !onTheWeb || !office.context.requirements?.isSetSupported('DevicePermission', '1.1')) return 'ready';
  const firstGrant = await office.devicePermission.requestPermissions([office.DevicePermissionType.microphone]);
  return firstGrant ? 'reload' : 'ready';
}

function microphoneError(error: unknown): string {
  const name = error instanceof DOMException ? error.name : '';
  if (name === 'NotAllowedError' || /denied/i.test(String((error as Error)?.message))) {
    return 'Nem kaptam hozzáférést a mikrofonhoz. Engedélyezd a böngészőben vagy a Windows adatvédelmi beállításaiban (Mikrofon), majd próbáld újra.';
  }
  if (name === 'NotFoundError') return 'Nem találtam mikrofont ezen a gépen.';
  return 'Nem sikerült elindítani a hangfelvételt ebben a Word-változatban.';
}

/**
 * Mikrofon gomb: felvesz egy rövid diktálást, szöveggé írja, és az utasítás mezőbe teszi. Alapból helyben
 * (Whisper a gépen, a hang nem megy sehova); felhőben csak akkor, ha a szerver EU-ban dolgoz fel.
 */
export default function DictationButton({ accessKey, userId, engine, localModel, disabled, onText, onError }: {
  accessKey: string;
  userId: string;
  engine: 'local' | 'cloud';
  localModel: LocalModel;
  disabled: boolean;
  onText: (text: string) => void;
  onError: (message: string) => void;
}) {
  const [state, setState] = useState<State>({ kind: 'idle' });
  const recorderRef = useRef<MediaRecorder | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  const abortRef = useRef<AbortController | null>(null);

  // Stop everything if the pane goes away mid-recording
  useEffect(() => () => {
    clearInterval(timerRef.current);
    abortRef.current?.abort();
    if (recorderRef.current?.state === 'recording') recorderRef.current.stop();
  }, []);

  const start = async () => {
    if (typeof MediaRecorder === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      onError('Ez a Word-változat nem támogatja a hangfelvételt. Word Online-ban (Edge vagy Chrome böngészőben) működik.');
      return;
    }
    let stream: MediaStream;
    try {
      if ((await askOfficeForMicrophone()) === 'reload') {
        onError('A mikrofon engedélyezve. A bővítmény most újratöltődik, utána nyomd meg újra a mikrofon gombot.');
        setTimeout(() => window.location.reload(), 1500);
        return;
      }
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (error) {
      onError(microphoneError(error));
      return;
    }

    const mimeType = RECORDING_TYPES.find(type => MediaRecorder.isTypeSupported(type));
    const recorder = new MediaRecorder(stream, mimeType ? { mimeType, audioBitsPerSecond: 24000 } : undefined);
    const chunks: Blob[] = [];
    recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
    recorder.onstop = async () => {
      clearInterval(timerRef.current);
      stream.getTracks().forEach(track => track.stop());
      const recording = new Blob(chunks, { type: (recorder.mimeType || mimeType || 'audio/webm') });
      if (!recording.size) {
        setState({ kind: 'idle' });
        return;
      }
      setState({ kind: 'transcribing', download: null });
      const controller = new AbortController();
      abortRef.current = controller;
      try {
        const text = engine === 'local'
          ? await transcribeLocally(recording, localModel, ({ download }) => setState({ kind: 'transcribing', download }), controller.signal)
          : await transcribeAudio(recording, accessKey, userId, controller.signal);
        if (text) onText(text);
        else onError('Nem értettem beszédet a felvételen. Próbáld újra, közelebb a mikrofonhoz.');
      } catch (error) {
        if (controller.signal.aborted) return;
        onError(engine === 'local'
          ? `A helyi beszédfelismerés nem sikerült: ${error instanceof Error ? error.message : String(error)}. Első használatkor a modellt le kell tölteni (huggingface.co), ehhez internet kell; régebbi gépen vagy Word-változatban előfordulhat, hogy nem fut. Ilyenkor a Beállításokban választhatod a felhős (EU) diktálást.`
          : describeRequestError(error));
      } finally {
        abortRef.current = null;
        setState({ kind: 'idle' });
      }
    };

    recorderRef.current = recorder;
    recorder.start();
    setState({ kind: 'recording', seconds: 0 });
    const startedAt = Date.now();
    timerRef.current = setInterval(() => {
      const seconds = Math.floor((Date.now() - startedAt) / 1000);
      if (seconds >= MAX_RECORDING_SECONDS && recorder.state === 'recording') recorder.stop();
      else setState(s => (s.kind === 'recording' ? { kind: 'recording', seconds } : s));
    }, 250);
  };

  const stop = () => {
    if (recorderRef.current?.state === 'recording') recorderRef.current.stop();
  };

  if (state.kind === 'recording') {
    return (
      <button
        onClick={stop}
        title="Felvétel leállítása és átírás"
        aria-label="Diktálás leállítása"
        className="h-11 px-2 shrink-0 flex items-center justify-center bg-red-50 border border-red-300 text-red-700 rounded-xl text-xs font-medium tabular-nums"
      >
        <span className="w-2 h-2 mr-1.5 rounded-full bg-red-600 animate-pulse" />
        {`${Math.floor(state.seconds / 60)}:${String(state.seconds % 60).padStart(2, '0')}`}
        <Square className="w-3 h-3 ml-1.5 fill-current" />
      </button>
    );
  }
  // Downloading the model or transcribing: can be cancelled (the recording is thrown away)
  if (state.kind === 'transcribing') {
    return (
      <span
        className="h-11 pl-2 pr-1 shrink-0 flex items-center text-[11px] text-neutral-600 border border-neutral-300 rounded-xl"
        title={state.download !== null ? 'Első használat: a beszédfelismerő modell letöltése, utána a gépről töltődik' : 'Átírás folyamatban'}
      >
        <Loader2 className="w-4 h-4 mr-1 animate-spin" />
        {state.download !== null ? `Modell ${Math.round(state.download * 100)}%` : 'Átírás…'}
        <button onClick={() => abortRef.current?.abort()} aria-label="Diktálás megszakítása" title="Mégse" className="ml-1 p-1 rounded-md hover:bg-neutral-100">
          <X className="w-3.5 h-3.5" />
        </button>
      </span>
    );
  }
  return (
    <button
      onClick={start}
      disabled={disabled}
      title={engine === 'local'
        ? 'Diktálás: mondd el, mit szeretnél. Ezen a gépen írom át szöveggé, a hang nem hagyja el a gépet.'
        : 'Diktálás: mondd el, mit szeretnél. A szerver AI-ja (EU) írja át szöveggé; a hangot nem lehet maszkolni.'}
      aria-label="Diktálás"
      className="w-11 h-11 shrink-0 flex items-center justify-center border border-neutral-300 text-neutral-600 hover:bg-neutral-100 disabled:opacity-50 rounded-xl transition-colors"
    >
      <Mic className="w-5 h-5" />
    </button>
  );
}
