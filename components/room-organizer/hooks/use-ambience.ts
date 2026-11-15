import { useEffect, useRef } from 'react';
import { advanceStride, createAmbience, rainSound, type Ambience } from '../lib/ambience';
import { REDUCED_MOTION_QUERY } from '../lib/reduced-motion';
import { sharedAudioContext } from '../lib/sounds';
import type { Weather } from '../lib/types';
import type { DecorativeStep } from '../three/frame-budget';

export interface UseAmbienceOptions {
  /** Sounds and their ambience are on (the sound tile), and the walker is in EXPLORE. */
  enabled: boolean;
  weather: Weather;
  /** The walker is inside the house: the rain comes through the roof. */
  indoors: boolean;
  /** Metres walked this walk, read live (`useWalkthrough().walkedDistance`). */
  walkedDistance(): number;
  addDecorativeStep(step: DecorativeStep): () => void;
}

/**
 * EXPLORE's ambience (#911): rain on the roof and footsteps. The graph lives
 * while `enabled`; the footsteps are checked on the frame budget's cadence,
 * never on a loop of their own, and ask for no repaint. A hidden page mutes
 * the ambience (the shared context keeps running for the UI cues). With
 * reduced motion the rain stays and the per-step footsteps go.
 */
export function useAmbience({ enabled, weather, indoors, walkedDistance, addDecorativeStep }: UseAmbienceOptions): void {
  const ambienceRef = useRef<Ambience | null>(null);
  const indoorsRef = useRef(indoors);
  indoorsRef.current = indoors;
  const walkedRef = useRef(walkedDistance);
  walkedRef.current = walkedDistance;

  useEffect(() => {
    if (!enabled) return undefined;
    const ctx = sharedAudioContext();
    if (!ctx) return undefined;
    // Entering EXPLORE was a press: the context may start now.
    if (ctx.state === 'suspended') void ctx.resume().catch(() => undefined);
    const ambience = createAmbience(ctx);
    ambienceRef.current = ambience;
    if (document.hidden) ambience.setMuted(true);
    // Read live: the system setting may change mid-walk.
    const reducedMotion = typeof window.matchMedia === 'function' ? window.matchMedia(REDUCED_MOTION_QUERY) : null;

    let last = walkedRef.current();
    let carry = 0;
    const removeStep = addDecorativeStep(() => {
      const now = walkedRef.current();
      const walked = now - last;
      last = now;
      if (reducedMotion?.matches === true) return false;
      const stride = advanceStride(carry, walked);
      carry = stride.carry;
      if (stride.steps > 0) ambience.footstep(indoorsRef.current);
      return false;
    });

    const onVisibility = () => ambience.setMuted(document.hidden);
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      removeStep();
      ambience.dispose();
      ambienceRef.current = null;
    };
  }, [enabled, addDecorativeStep]);

  useEffect(() => {
    ambienceRef.current?.setRain(rainSound(weather, indoors));
  }, [enabled, weather, indoors]);
}
