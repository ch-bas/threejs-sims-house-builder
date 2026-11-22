import { useCallback, useEffect, useRef } from 'react';
import { WILDLIFE_KINDS, advanceStride, doorSoundGain, nextCallDelay, rainSound, wildlifeSound, type DoorSound } from '../lib/ambience';
import { REDUCED_MOTION_QUERY } from '../lib/reduced-motion';
import { sharedAudioContext } from '../lib/sounds';
import type { Ambience } from '../lib/ambience-engine';
import type { Weather } from '../lib/types';
import type { DecorativeStep } from '../three/frame-budget';

export interface UseAmbienceOptions {
  /** Sounds and their ambience are on (the sound tile), and the walker is in EXPLORE. */
  enabled: boolean;
  /**
   * The ambience is switched on, walking or not: its engine is fetched
   * ahead, so the door the walk starts beside is heard as it opens.
   */
  preload?: boolean;
  weather: Weather;
  /** The walker is inside the house: the rain comes through the roof. */
  indoors: boolean;
  /** Metres walked this walk, read live (`useWalkthrough().walkedDistance`). */
  walkedDistance(): number;
  /** The hour of the day, read live: the clock ticks without a render (#911). */
  hour(): number;
  /** Where the listener (the player) stands, read live; null before the walk places it. */
  listener(): { x: number; z: number; floorIndex: number } | null;
  addDecorativeStep(step: DecorativeStep): () => void;
}

/** A door's sound, from where it is (plan metres) and its storey; silent while the ambience is off. */
export type AmbienceDoorSound = (sound: DoorSound, x: number, z: number, floorIndex: number) => void;

/**
 * EXPLORE's ambience (#911): rain on the roof, footsteps, birds by day,
 * crickets at night, and the doors (through the returned callback, which the
 * door swinger calls). The graph lives while `enabled`; the footsteps and the
 * calls are timed on the frame budget's cadence, never on a loop or a timer
 * of their own, and ask for no repaint, so a hidden page (no steps) is
 * silent and the ambience is muted too (the shared context keeps running for
 * the UI cues). With reduced motion the rain, the calls and the doors stay
 * and the per-step footsteps go.
 */
export function useAmbience({ enabled, preload = false, weather, indoors, walkedDistance, hour, listener, addDecorativeStep }: UseAmbienceOptions): AmbienceDoorSound {
  const ambienceRef = useRef<Ambience | null>(null);
  const indoorsRef = useRef(indoors);
  indoorsRef.current = indoors;
  const walkedRef = useRef(walkedDistance);
  walkedRef.current = walkedDistance;
  const weatherRef = useRef(weather);
  weatherRef.current = weather;
  const hourRef = useRef(hour);
  hourRef.current = hour;
  const listenerRef = useRef(listener);
  listenerRef.current = listener;

  useEffect(() => {
    if (preload) void import('../lib/ambience-engine').catch(() => undefined);
  }, [preload]);

  useEffect(() => {
    if (!enabled) return undefined;
    const ctx = sharedAudioContext();
    if (!ctx) return undefined;
    // Entering EXPLORE was a press: the context may start now, before the
    // engine's module arrives.
    if (ctx.state === 'suspended') void ctx.resume().catch(() => undefined);
    let ambience: Ambience | null = null;
    let cancelled = false;
    void import('../lib/ambience-engine')
      .then(({ createAmbience }) => {
        if (cancelled) return;
        ambience = createAmbience(ctx);
        ambienceRef.current = ambience;
        if (document.hidden) ambience.setMuted(true);
        ambience.setRain(rainSound(weatherRef.current, indoorsRef.current));
      })
      .catch(() => undefined);
    // Read live: the system setting may change mid-walk.
    const reducedMotion = typeof window.matchMedia === 'function' ? window.matchMedia(REDUCED_MOTION_QUERY) : null;

    let last = walkedRef.current();
    let carry = 0;
    // Seconds to each kind's next call; drawn when it falls due, or when the
    // hour or the weather first lets that kind call.
    const due = { birds: Infinity, crickets: Infinity };
    // Reused every frame: the step allocates nothing.
    const wildlife = { birds: 0, crickets: 0 };
    const stride = { carry: 0, steps: 0 };
    const removeStep = addDecorativeStep((delta) => {
      const now = walkedRef.current();
      const walked = now - last;
      last = now;
      // Suspended (no gesture yet, or an interruption): nothing falls due, so
      // nothing queues up to burst out on resume.
      if (!ambience || ctx.state !== 'running') return false;
      wildlifeSound(hourRef.current(), weatherRef.current, indoorsRef.current, wildlife);
      for (const kind of WILDLIFE_KINDS) {
        const gain = wildlife[kind];
        if (!(gain > 0)) {
          due[kind] = Infinity;
          continue;
        }
        if (due[kind] === Infinity) due[kind] = nextCallDelay(kind, gain, Math.random());
        due[kind] -= delta;
        if (due[kind] > 0) continue;
        ambience.call(kind, gain);
        due[kind] = nextCallDelay(kind, gain, Math.random());
      }
      if (reducedMotion?.matches === true) return false;
      advanceStride(carry, walked, undefined, stride);
      carry = stride.carry;
      if (stride.steps > 0) ambience.footstep(indoorsRef.current);
      return false;
    });

    const onVisibility = () => ambience?.setMuted(document.hidden);
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      cancelled = true;
      removeStep();
      ambience?.dispose();
      ambienceRef.current = null;
    };
  }, [enabled, addDecorativeStep]);

  useEffect(() => {
    ambienceRef.current?.setRain(rainSound(weather, indoors));
  }, [enabled, weather, indoors]);

  return useCallback<AmbienceDoorSound>((sound, x, z, floorIndex) => {
    const ambience = ambienceRef.current;
    const at = listenerRef.current();
    if (!ambience || !at) return;
    ambience.door(sound, doorSoundGain(Math.hypot(x - at.x, z - at.z), floorIndex === at.floorIndex));
  }, []);
}
