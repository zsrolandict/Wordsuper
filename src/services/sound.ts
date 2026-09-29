/**
 * Soft notification sounds, generated with the Web Audio API (no sound files). Browsers only let a page play
 * sound after a user gesture, so primeSound() is called from the click that starts a request.
 */
let audio: AudioContext | null = null;

export function primeSound() {
  try {
    audio ??= new AudioContext();
    if (audio.state === 'suspended') void audio.resume();
  } catch {
    // No audio in this host; the add-in works silently
  }
}

function tone(context: AudioContext, frequency: number, start: number, duration: number, volume: number) {
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  oscillator.type = 'sine';
  oscillator.frequency.value = frequency;
  // Quick fade in, long soft fade out: a chime, not a beep
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(volume, start + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  oscillator.connect(gain).connect(context.destination);
  oscillator.start(start);
  oscillator.stop(start + duration + 0.05);
}

/** done: two rising notes; error: one low, short note */
export function playSound(kind: 'done' | 'error') {
  try {
    primeSound();
    if (!audio || audio.state !== 'running') return;
    const now = audio.currentTime;
    if (kind === 'done') {
      tone(audio, 659.25, now, 0.35, 0.05);
      tone(audio, 880, now + 0.12, 0.5, 0.045);
    } else {
      tone(audio, 311.13, now, 0.4, 0.05);
    }
  } catch {
    // Sound is a nicety; never let it break anything
  }
}
