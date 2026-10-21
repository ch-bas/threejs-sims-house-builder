'use client';

import { useEffect, type RefObject } from 'react';

/**
 * Publishes one edge of an element (viewport px) as a CSS custom property on
 * <html>, so other overlays can sit against it instead of at a fixed offset
 * the element outgrows: chips under the top pills (#308), the touch buttons
 * and the View menu above the phone dock.
 */
export function useEdgeVar(
  ref: RefObject<HTMLElement>,
  property: string,
  edge: 'top' | 'bottom',
  /** Changes when the element mounts or is replaced, so it is observed. */
  layoutKey = ''
): void {
  useEffect(() => {
    const element = ref.current;
    if (!element) return undefined;
    const root = document.documentElement;
    const update = () => {
      root.style.setProperty(property, `${Math.round(element.getBoundingClientRect()[edge])}px`);
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
  }, [ref, property, edge, layoutKey]);
}
