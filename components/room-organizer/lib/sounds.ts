/**
 * Tiny Web Audio synth for UI feedback — no audio assets, no third-party
 * libs. Each sound is a single oscillator with a quick attack/decay
 * envelope so the cues feel snappy rather than musical.
 */

export type SoundCue = 'place' | 'remove' | 'rotate' | 'success';

let audioContext: AudioContext | null = null;

function getContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (audioContext) return audioContext;
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  try {
    audioContext = new Ctor();
    return audioContext;
  } catch {
    return null;
  }
}

interface CueSpec {
  type: OscillatorType;
  startFreq: number;
  endFreq: number;
  duration: number;
  peakGain: number;
}

const CUE_SPECS: Record<SoundCue, CueSpec> = {
  place: { type: 'triangle', startFreq: 320, endFreq: 540, duration: 0.13, peakGain: 0.12 },
  remove: { type: 'sawtooth', startFreq: 380, endFreq: 140, duration: 0.18, peakGain: 0.1 },
  rotate: { type: 'square', startFreq: 220, endFreq: 220, duration: 0.05, peakGain: 0.08 },
  success: { type: 'sine', startFreq: 660, endFreq: 990, duration: 0.32, peakGain: 0.14 },
};

export function playSound(cue: SoundCue): void {
  const ctx = getContext();
  if (!ctx) return;

  // Browsers suspend the context until a user gesture; if it's still
  // suspended, attempt to resume but don't block playback.
  if (ctx.state === 'suspended') {
    void ctx.resume().catch(() => undefined);
  }

  const spec = CUE_SPECS[cue];
  const now = ctx.currentTime;
  const oscillator = ctx.createOscillator();
  const gain = ctx.createGain();

  oscillator.type = spec.type;
  oscillator.frequency.setValueAtTime(spec.startFreq, now);
  oscillator.frequency.exponentialRampToValueAtTime(Math.max(40, spec.endFreq), now + spec.duration);

  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(spec.peakGain, now + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + spec.duration);

  oscillator.connect(gain).connect(ctx.destination);
  oscillator.start(now);
  oscillator.stop(now + spec.duration + 0.02);
}
