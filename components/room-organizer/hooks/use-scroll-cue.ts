'use client';

import { useEffect, type RefObject } from 'react';
import { hasContentBelow } from '../lib/hud-layout';

/**
 * Marks a scrolling column so CSS can show that it scrolls (#426):
 * `data-scrollable` while its content overflows, `data-more-below` while some
 * of it is hidden under the bottom edge. Written straight to the DOM — a
 * scroll must not re-render the HUD. `layoutKey` changes when the column's
 * children do, so the new ones are observed.
 */
export function useScrollCue(ref: RefObject<HTMLElement>, layoutKey: string): void {
  useEffect(() => {
    const column = ref.current;
    if (!column) return undefined;
    const update = () => {
      const { scrollTop, clientHeight, scrollHeight } = column;
      column.toggleAttribute('data-scrollable', scrollHeight > clientHeight + 1);
      column.toggleAttribute('data-more-below', hasContentBelow(scrollTop, clientHeight, scrollHeight));
    };
    update();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update);
    observer?.observe(column);
    for (const child of Array.from(column.children)) observer?.observe(child);
    column.addEventListener('scroll', update, { passive: true });
    return () => {
      observer?.disconnect();
      column.removeEventListener('scroll', update);
    };
  }, [ref, layoutKey]);
}
