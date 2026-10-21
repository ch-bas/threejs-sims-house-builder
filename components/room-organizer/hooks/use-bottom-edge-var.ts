'use client';

import { useEffect, type RefObject } from 'react';

/**
 * Publishes an element's bottom edge (viewport px) as a CSS custom property
 * on <html>, so overlays can sit below it instead of at a fixed offset that
 * the element outgrows when it wraps (#308).
 */
export function useBottomEdgeVar(ref: RefObject<HTMLElement>, property: string): void {
  useEffect(() => {
    const element = ref.current;
    if (!element) return undefined;
    const root = document.documentElement;
    const update = () => {
      root.style.setProperty(property, `${Math.round(element.getBoundingClientRect().bottom)}px`);
    };
    update();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update);
    observer?.observe(element);
    // A breakpoint can move the element without resizing it.
    window.addEventListener('resize', update);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', update);
      root.style.removeProperty(property);
    };
  }, [ref, property]);
}
