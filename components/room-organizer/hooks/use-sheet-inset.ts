'use client';

import { useEffect } from 'react';

const SHEET_SELECTOR = '.pc-item-popover';
const PROPERTY = '--pc-sheet-height';

/**
 * While the phone item sheet is open (`data-sheet-open` on <html>, set by
 * the popover), publishes how much of the viewport's bottom it covers as
 * `--pc-sheet-height`, so the mode bar can ride above it and Undo / Redo
 * stay in reach.
 */
export function useSheetInset(): void {
  useEffect(() => {
    const root = document.documentElement;
    let observed: Element | null = null;
    const publish = () => {
      const sheet = root.hasAttribute('data-sheet-open') ? document.querySelector(SHEET_SELECTOR) : null;
      if (sheet !== observed) {
        if (observed) resizeObserver?.unobserve(observed);
        if (sheet) resizeObserver?.observe(sheet);
        observed = sheet;
      }
      const rect = sheet?.getBoundingClientRect();
      // Only a bottom sheet: one that spans the bottom edge and most of the
      // width. A side panel leaves the mode bar where it is.
      if (rect && rect.bottom >= window.innerHeight - 1 && rect.width >= window.innerWidth * 0.6) {
        root.style.setProperty(PROPERTY, `${Math.round(Math.max(0, window.innerHeight - rect.top))}px`);
      } else if (rect) {
        root.style.setProperty(PROPERTY, '0px');
      } else {
        root.style.removeProperty(PROPERTY);
      }
    };
    const resizeObserver = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(publish);
    const attributeObserver = new MutationObserver(publish);
    attributeObserver.observe(root, { attributes: true, attributeFilter: ['data-sheet-open'] });
    window.addEventListener('resize', publish);
    publish();
    return () => {
      attributeObserver.disconnect();
      resizeObserver?.disconnect();
      window.removeEventListener('resize', publish);
      root.style.removeProperty(PROPERTY);
    };
  }, []);
}
