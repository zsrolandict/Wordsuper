import React, { useEffect, useRef, useState } from 'react';
import { Mic, Square, Loader2 } from 'lucide-react';
import { describeRequestError, transcribeAudio } from '../services/aiService';

/** Longest recording; the server accepts about two minutes of compressed speech */
const MAX_RECORDING_SECONDS = 110;
// Formats the AI accepts, in order of preference; browsers support different ones
const RECORDING_TYPES = ['audio/ogg;codecs=opus', 'audio/mp4', 'audio/webm;codecs=opus', 'audio/webm'];

type State = { kind: 'idle' } | { kind: 'recording'; seconds: number } | { kind: 'transcribing' };

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
 * Mikrofon gomb: felvesz egy rövid diktálást, az AI átírja szöveggé, és az utasítás mezőbe teszi.
 * A hangfelvételt nem lehet maszkolni, ezt a gomb súgója is jelzi.
 */
export default function DictationButton({ accessKey, disabled, onText, onError }: {
  accessKey: string;
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
      setState({ kind: 'transcribing' });
      const controller = new AbortController();
      abortRef.current = controller;
      try {
        const text = await transcribeAudio(recording, accessKey, controller.signal);
        if (text) onText(text);
        else onError('Nem értettem beszédet a felvételen. Próbáld újra, közelebb a mikrofonhoz.');
      } catch (error) {
        if (!controller.signal.aborted) onError(describeRequestError(error));
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
  return (
    <button
      onClick={start}
      disabled={disabled || state.kind === 'transcribing'}
      title="Diktálás: mondd el, mit szeretnél. A felvételt az AI írja át szöveggé (a hangot nem lehet maszkolni)."
      aria-label="Diktálás"
      className="w-11 h-11 shrink-0 flex items-center justify-center border border-neutral-300 text-neutral-600 hover:bg-neutral-100 disabled:opacity-50 rounded-xl transition-colors"
    >
      {state.kind === 'transcribing' ? <Loader2 className="w-5 h-5 animate-spin" /> : <Mic className="w-5 h-5" />}
    </button>
  );
}
