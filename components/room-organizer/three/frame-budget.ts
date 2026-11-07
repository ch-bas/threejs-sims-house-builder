/**
 * One frame budget for the decorative loops (#671): rain and snow, the
 * walkers and the camera cones' sweep. Instead of each running its own
 * requestAnimationFrame at display rate, they register a step here and the
 * scene's render loop calls `tick` once per animation frame. The steps run
 * at most `DECORATIVE_FPS` times a second, or every frame while the frame
 * draws anyway (an orbit, a drag), and not at all while the page is hidden.
 * An unfocused window that is still on screen (a second monitor, a shared
 * screen) keeps animating. Render-on-demand still holds: a tick asks
 * for a frame only when a step reports a change.
 *
 * No React, no three.js: the scene hook owns one budget per editor.
 */

/** Advance by `deltaSeconds`; true when something changed and needs a repaint. */
export type DecorativeStep = (deltaSeconds: number) => boolean;

/** Decorative steps run this often while nothing else draws. */
export const DECORATIVE_FPS = 30;
/** rAF timestamps jitter; a tick this close to the interval still runs it. */
const SLACK_MS = 2;
/** Longest step: coming back to the tab never teleports a walker or a column of rain. */
const MAX_STEP_SECONDS = 0.1;

export interface FrameBudget {
  /** Register a step; returns its removal. */
  add(step: DecorativeStep): () => void;
  /**
   * Called by the render loop each animation frame. `busy`: this frame draws
   * anyway. True when a step asked for a repaint.
   */
  tick(now: number, busy: boolean): boolean;
  /** Drop every step. */
  dispose(): void;
}

export interface FrameBudgetEnv {
  /** Visibility comes from here; absent (tests, prerender), always running. */
  document?: { readonly hidden: boolean };
}

export function createFrameBudget(env: FrameBudgetEnv = {}): FrameBudget {
  const steps = new Set<DecorativeStep>();
  const doc = env.document;
  // The last tick that ran the steps; null after a pause, so the first tick
  // back starts the clock instead of stepping over the time away.
  let last: number | null = null;

  return {
    add(step) {
      steps.add(step);
      return () => {
        steps.delete(step);
      };
    },
    tick(now, busy) {
      // A hidden page gets no animation frames anyway; this keeps the clock
      // from stepping over the time away when it comes back.
      if (steps.size === 0 || doc?.hidden) {
        last = null;
        return false;
      }
      if (last === null) {
        last = now;
        return false;
      }
      const elapsed = now - last;
      if (!busy && elapsed < 1000 / DECORATIVE_FPS - SLACK_MS) return false;
      last = now;
      const delta = Math.min(MAX_STEP_SECONDS, Math.max(0, elapsed / 1000));
      let changed = false;
      // A copy: a step may remove itself (or another) while running.
      for (const step of [...steps]) if (step(delta)) changed = true;
      return changed;
    },
    dispose() {
      steps.clear();
    },
  };
}
