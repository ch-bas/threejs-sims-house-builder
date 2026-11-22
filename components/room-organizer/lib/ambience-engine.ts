/**
 * The ambience's Web Audio engine (#911), on the AudioContext the UI cues
 * use (`sharedAudioContext`, lib/sounds.ts): a looped noise buffer through a
 * low-pass filter for the rain, a short filtered noise burst per step, and
 * one-shot oscillators for the calls and the doors, each freeing itself when
 * it ends. The gains come from the pure mappings in `lib/ambience.ts`. Its
 * own module, loaded on demand: most sessions never walk with the ambience on.
 */

import { RAIN_OUTDOORS, type DoorSound, type RainSound, type WildlifeSound } from './ambience';

/** Rain fades in and out over this long (s), never clicks. */
const RAIN_FADE_SECONDS = 0.8;
/** Switched off or left: the whole ambience fades out over this long (s). */
const OUT_FADE_SECONDS = 0.2;
const FOOTSTEP_SECONDS = 0.09;
const FOOTSTEP_GAIN = 0.22;
/** Indoors a step lands on a floor; outdoors on grass, softer and duller. */
const FOOTSTEP_INDOORS = { hz: 420, q: 1.2, gain: 1 };
const FOOTSTEP_OUTDOORS = { hz: 260, q: 0.8, gain: 0.6 };

export interface Ambience {
  setRain(sound: RainSound): void;
  footstep(indoors: boolean): void;
  /** One bird's call, or one cricket's trill, at `gain` (`wildlifeSound`). */
  call(kind: keyof WildlifeSound, gain: number): void;
  /** A door starting to swing (a creak) or coming shut (a soft knock), at `gain` (`doorSoundGain`). */
  door(sound: DoorSound, gain: number): void;
  /**
   * Silence it all (a hidden page), or bring it back. The shared context is
   * left running: the UI cues are on it too.
   */
  setMuted(muted: boolean): void;
  /** Fades out, then stops and frees the graph. */
  dispose(): void;
}

/** Made once per context: every walk reuses it. */
const noiseBuffers = new WeakMap<BaseAudioContext, AudioBuffer>();

/** Two seconds of white noise, looped: long enough that the repeat isn't heard. */
function noiseBuffer(ctx: BaseAudioContext, seconds: number): AudioBuffer {
  const cached = noiseBuffers.get(ctx);
  if (cached) return cached;
  const length = Math.max(1, Math.floor(ctx.sampleRate * seconds));
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
  noiseBuffers.set(ctx, buffer);
  return buffer;
}

/** Ramp `param` from where it is now to `value` over `seconds`. */
function rampTo(ctx: BaseAudioContext, param: AudioParam, value: number, seconds: number): void {
  const now = ctx.currentTime;
  param.cancelScheduledValues(now);
  param.setValueAtTime(param.value, now);
  param.linearRampToValueAtTime(value, now + seconds);
}

/**
 * The ambience graph on `ctx`. The rain loop starts silent and runs until
 * `dispose`; footsteps are one-shot sources that free themselves.
 */
export function createAmbience(ctx: AudioContext): Ambience {
  const out = ctx.createGain();
  out.gain.value = 1;
  out.connect(ctx.destination);

  const noise = noiseBuffer(ctx, 2);
  const rain = ctx.createBufferSource();
  rain.buffer = noise;
  rain.loop = true;
  const rainFilter = ctx.createBiquadFilter();
  rainFilter.type = 'lowpass';
  rainFilter.frequency.value = RAIN_OUTDOORS.cutoffHz;
  const rainGain = ctx.createGain();
  rainGain.gain.value = 0;
  rain.connect(rainFilter).connect(rainGain).connect(out);
  rain.start();

  let disposed = false;
  // A suspended context's clock stands still: one-shots scheduled now would
  // all start at the same instant and play as one loud burst on resume
  // (iOS interruptions, or EXPLORE entered without a gesture). Only the
  // running context gets them; the rain and the fades are ramps, not stacks.
  const live = (): boolean => !disposed && ctx.state === 'running';
  return {
    setRain(sound) {
      if (disposed) return;
      rampTo(ctx, rainGain.gain, sound.gain, RAIN_FADE_SECONDS);
      rampTo(ctx, rainFilter.frequency, sound.cutoffHz, RAIN_FADE_SECONDS);
    },
    setMuted(muted) {
      if (disposed) return;
      rampTo(ctx, out.gain, muted ? 0 : 1, OUT_FADE_SECONDS);
    },
    footstep(indoors) {
      if (!live()) return;
      const spec = indoors ? FOOTSTEP_INDOORS : FOOTSTEP_OUTDOORS;
      const now = ctx.currentTime;
      const source = ctx.createBufferSource();
      source.buffer = noise;
      const filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      // A little variety, so a walk isn't a metronome.
      filter.frequency.value = spec.hz * (0.85 + Math.random() * 0.3);
      filter.Q.value = spec.q;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(FOOTSTEP_GAIN * spec.gain, now + 0.008);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + FOOTSTEP_SECONDS);
      source.connect(filter).connect(gain).connect(out);
      // A random point in the loop: each step sounds a little different.
      source.start(now, Math.random() * (noise.duration - FOOTSTEP_SECONDS), FOOTSTEP_SECONDS + 0.02);
      source.onended = () => gain.disconnect();
    },
    call(kind, gain) {
      if (!live() || !(gain > 0)) return;
      if (kind === 'birds') playBird(ctx, out, gain);
      else playCricket(ctx, out, gain);
    },
    door(sound, gain) {
      if (!live() || !(gain > 0)) return;
      if (sound === 'open') playCreak(ctx, out, gain);
      else playKnock(ctx, out, noise, gain);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      rampTo(ctx, out.gain, 0, OUT_FADE_SECONDS);
      rain.onended = () => {
        rain.disconnect();
        out.disconnect();
      };
      try {
        rain.stop(ctx.currentTime + OUT_FADE_SECONDS + 0.02);
      } catch {
        rain.disconnect();
        out.disconnect();
      }
    },
  };
}

/** A one-shot oscillator into `gain`, both freed when it ends. */
function oneShot(ctx: BaseAudioContext, out: AudioNode, type: OscillatorType, start: number, end: number): { osc: OscillatorNode; gain: GainNode } {
  const osc = ctx.createOscillator();
  osc.type = type;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0, start);
  osc.connect(gain).connect(out);
  osc.start(start);
  osc.stop(end);
  osc.onended = () => gain.disconnect();
  return { osc, gain };
}

/** Two to four quick, rising or falling whistles: a small garden bird. */
function playBird(ctx: BaseAudioContext, out: AudioNode, level: number): void {
  const notes = 2 + Math.floor(Math.random() * 3);
  const base = 2400 + Math.random() * 1400;
  const rising = Math.random() < 0.6;
  const start = ctx.currentTime + 0.01;
  let t = start;
  const plan: Array<{ at: number; length: number; from: number; to: number }> = [];
  for (let i = 0; i < notes; i++) {
    const length = 0.06 + Math.random() * 0.06;
    const from = base * (1 + (Math.random() - 0.5) * 0.12);
    plan.push({ at: t, length, from, to: from * (rising ? 1.35 : 0.75) });
    t += length + 0.035 + Math.random() * 0.06;
  }
  const { osc, gain } = oneShot(ctx, out, 'sine', start, t + 0.02);
  for (const note of plan) {
    osc.frequency.setValueAtTime(note.from, note.at);
    osc.frequency.exponentialRampToValueAtTime(note.to, note.at + note.length);
    gain.gain.setValueAtTime(0, note.at);
    gain.gain.linearRampToValueAtTime(level, note.at + 0.012);
    gain.gain.linearRampToValueAtTime(0, note.at + note.length);
  }
}

/** Three or four pulses of a high, pure tone: a cricket's trill. */
function playCricket(ctx: BaseAudioContext, out: AudioNode, level: number): void {
  const pulses = 3 + Math.floor(Math.random() * 2);
  const start = ctx.currentTime + 0.01;
  const pulse = 0.022;
  const gap = 0.018;
  const end = start + pulses * (pulse + gap) + 0.02;
  const { osc, gain } = oneShot(ctx, out, 'sine', start, end);
  osc.frequency.value = 4300 + Math.random() * 500;
  for (let i = 0; i < pulses; i++) {
    const at = start + i * (pulse + gap);
    gain.gain.setValueAtTime(0, at);
    gain.gain.linearRampToValueAtTime(level, at + 0.004);
    gain.gain.linearRampToValueAtTime(0, at + pulse);
  }
}

/** Two detuned, slowly wavering low tones through a narrow band: a hinge's creak. */
function playCreak(ctx: BaseAudioContext, out: AudioNode, level: number): void {
  const start = ctx.currentTime + 0.01;
  const length = 0.35 + Math.random() * 0.2;
  const band = ctx.createBiquadFilter();
  band.type = 'bandpass';
  band.frequency.value = 850 + Math.random() * 300;
  band.Q.value = 5;
  band.connect(out);
  const base = 95 + Math.random() * 40;
  let open = 2;
  for (const ratio of [1, 1.47]) {
    const { osc, gain } = oneShot(ctx, band, 'sawtooth', start, start + length + 0.02);
    osc.frequency.setValueAtTime(base * ratio, start);
    osc.frequency.linearRampToValueAtTime(base * ratio * 1.18, start + length * 0.4);
    osc.frequency.linearRampToValueAtTime(base * ratio * 1.05, start + length);
    gain.gain.linearRampToValueAtTime(level, start + 0.04);
    gain.gain.setValueAtTime(level, start + length * 0.7);
    gain.gain.linearRampToValueAtTime(0, start + length);
    osc.addEventListener('ended', () => {
      open -= 1;
      if (open === 0) band.disconnect();
    });
  }
}

const KNOCK_SECONDS = 0.12;

/** A dull, low thump of noise: the leaf meeting its frame. */
function playKnock(ctx: BaseAudioContext, out: AudioNode, noise: AudioBuffer, level: number): void {
  const now = ctx.currentTime;
  const source = ctx.createBufferSource();
  source.buffer = noise;
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = 260;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(level * 2.2, now + 0.005);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + KNOCK_SECONDS);
  source.connect(filter).connect(gain).connect(out);
  source.start(now, Math.random() * (noise.duration - KNOCK_SECONDS), KNOCK_SECONDS + 0.02);
  source.onended = () => gain.disconnect();
}
