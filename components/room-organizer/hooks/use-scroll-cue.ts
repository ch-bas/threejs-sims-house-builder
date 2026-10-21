'use client';

import { useEffect, type RefObject } from 'react';
import { scrollCue } from '../lib/hud-layout';

/**
 * Marks a scroller so CSS can show that it scrolls (#426): `data-scrollable`
 * while its content overflows, `data-more-before` / `data-more-after` while
 * some of it is hidden past the start / end edge. Written straight to the
 * DOM — a scroll must not re-render the HUD. `layoutKey` changes when the
 * scroller's children do, so the new ones are observed.
 */
export function useScrollCue(ref: RefObject<HTMLElement>, layoutKey: string, axis: 'x' | 'y' = 'y'): void {
  useEffect(() => {
    const scroller = ref.current;
    if (!scroller) return undefined;
    const update = () => {
      const cue =
        axis === 'y'
          ? scrollCue(scroller.scrollTop, scroller.clientHeight, scroller.scrollHeight)
          : scrollCue(scroller.scrollLeft, scroller.clientWidth, scroller.scrollWidth);
      scroller.toggleAttribute('data-scrollable', cue.scrollable);
      scroller.toggleAttribute('data-more-before', cue.before);
      scroller.toggleAttribute('data-more-after', cue.after);
    };
    update();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update);
    observer?.observe(scroller);
    for (const child of Array.from(scroller.children)) observer?.observe(child);
    scroller.addEventListener('scroll', update, { passive: true });
    return () => {
      observer?.disconnect();
      scroller.removeEventListener('scroll', update);
    };
  }, [ref, layoutKey, axis]);
}
