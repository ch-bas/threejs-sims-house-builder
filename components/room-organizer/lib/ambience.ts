/**
 * Ambient sound in EXPLORE (#911): rain on the roof and footsteps, with no
 * audio assets. Web Audio only, on the AudioContext the UI cues use
 * (`sharedAudioContext`, lib/sounds.ts). The mappings are pure and tested;
 * the engine is a thin graph over them: a looped noise buffer through a
 * low-pass filter for the rain, and a short filtered noise burst per step.
 */

import type { Weather } from './types';

export interface RainSound {
  /** Gain of the rain loop, 0 for silence. */
  gain: number;
  /** Low-pass cutoff (Hz): indoors the roof and the walls muffle it. */
  cutoffHz: number;
}

/** Rain heard out on the lot. */
const RAIN_OUTDOORS: RainSound = { gain: 0.16, cutoffHz: 5200 };
/** Rain heard through the roof: quieter and duller. */
const RAIN_INDOORS: RainSound = { gain: 0.07, cutoffHz: 900 };

/**
 * What the rain sounds like from where the walker is. Snow falls silently, and
 * a clear sky has no rain. The cutoff is kept whatever the gain, so a fade
 * never sweeps the filter.
 */
export function rainSound(weather: Weather, indoors: boolean): RainSound {
  const heard = indoors ? RAIN_INDOORS : RAIN_OUTDOORS;
  return weather === 'rain' ? heard : { gain: 0, cutoffHz: heard.cutoffHz };
}

/** Metres walked per footstep. */
export const STRIDE_METRES = 0.75;

export interface StrideState {
  /** Metres walked since the last step. */
  carry: number;
  /** Steps that fall due over this stretch. */
  steps: number;
}

/**
 * Footsteps paced by the distance walked, not by time: standing still or
 * walking into a wall makes no sound, and a sprint steps twice as often. At
 * most one step per call, so a long frame never plays a burst of them.
 */
export function advanceStride(carry: number, walked: number, stride: number = STRIDE_METRES): StrideState {
  const total = carry + Math.max(0, walked);
  if (total < stride) return { carry: total, steps: 0 };
  return { carry: total % stride, steps: 1 };
}

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
      if (disposed) return;
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
