'use client';

import { useEffect, useLayoutEffect, type RefObject } from 'react';
import { topBarSlot, type SlotRect } from '../lib/top-bar-slot';

export interface EdgeVarOptions {
  /** Changes when the element mounts or is replaced, so it is observed. */
  layoutKey?: string;
  /**
   * Attributes of <html> whose changes can move the element without
   * resizing it, such as `data-sheet-open` lifting the phone dock.
   */
  rootAttributes?: readonly string[];
}

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
  { layoutKey = '', rootAttributes }: EdgeVarOptions = {}
): void {
  const attributeKey = rootAttributes?.join(' ') ?? '';
  useEffect(() => {
    const element = ref.current;
    if (!element) return undefined;
    const root = document.documentElement;
    let written = '';
    let frame = 0;
    const update = () => {
      const value = `${Math.round(element.getBoundingClientRect()[edge])}px`;
      // Unchanged values aren't rewritten: a write is a style mutation on
      // <html>, which an observer of the root's style would see again.
      if (value === written) return;
      written = value;
      root.style.setProperty(property, value);
    };
    update();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update);
    observer?.observe(element);
    // A breakpoint can move the element without resizing it.
    window.addEventListener('resize', update);
    // So can a root attribute, through the rules and custom properties it
    // drives; measure once the frame's styles have settled.
    const attributes = attributeKey ? attributeKey.split(' ') : [];
    const rootObserver =
      attributes.length > 0
        ? new MutationObserver(() => {
            cancelAnimationFrame(frame);
            frame = requestAnimationFrame(update);
          })
        : null;
    rootObserver?.observe(root, { attributes: true, attributeFilter: attributes });
    return () => {
      observer?.disconnect();
      rootObserver?.disconnect();
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', update);
      root.style.removeProperty(property);
    };
  }, [ref, property, edge, layoutKey, attributeKey]);
}

const BADGE_SELECTOR = '.pc-lot-badge';
const PILLS_SELECTOR = '.pc-top-right';
/** Clear space kept around the row in the top bar. */
const SLOT_GAP = 8;

/**
 * Places a row (`ref`, the touch buttons on short screens) in the top bar's
 * free strip, between the title badge and the pills, through custom
 * properties on <html> (viewport px): `--pc-top-slot-start` and
 * `--pc-top-slot-end` bound it, and `--pc-top-slot-top` is set only when
 * the strip is too narrow, dropping the row below the pills. The row's
 * bottom is `--pc-top-slot-bottom`, for the panels that must stay under it.
 */
export function useTopBarSlot(ref: RefObject<HTMLElement>, active: boolean): void {
  // Before paint: the row is placed from these, so it never flashes at a
  // stale spot over the pills.
  useLayoutEffect(() => {
    const row = ref.current;
    if (!active || !row) return undefined;
    const root = document.documentElement;
    const written = new Map<string, string | null>();
    const write = (property: string, px: number | null) => {
      const value = px === null ? null : `${Math.round(px)}px`;
      if (written.has(property) && written.get(property) === value) return;
      written.set(property, value);
      if (value === null) root.style.removeProperty(property);
      else root.style.setProperty(property, value);
    };
    const rects = (selector: string): SlotRect[] => {
      const container = document.querySelector(selector);
      return container ? [...container.children].map((child) => child.getBoundingClientRect()) : [];
    };
    const update = () => {
      // The row's natural width, whatever it is wrapped to now.
      const buttons = [...row.children] as HTMLElement[];
      const gap = parseFloat(getComputedStyle(row).columnGap) || 0;
      const rowWidth = buttons.reduce((sum, button) => sum + button.offsetWidth, 0) + gap * Math.max(0, buttons.length - 1);
      const slot = topBarSlot(rects(BADGE_SELECTOR), rects(PILLS_SELECTOR), rowWidth, window.innerWidth, SLOT_GAP);
      write('--pc-top-slot-start', slot.start);
      write('--pc-top-slot-end', slot.end);
      write('--pc-top-slot-top', slot.top);
      write('--pc-top-slot-bottom', row.getBoundingClientRect().bottom);
    };
    update();
    // The pills grow with the floor count and the badge with the house name;
    // the row itself changes height when it wraps.
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update);
    for (const selector of [BADGE_SELECTOR, PILLS_SELECTOR]) {
      const element = document.querySelector(selector);
      if (element) observer?.observe(element);
    }
    observer?.observe(row);
    window.addEventListener('resize', update);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', update);
      for (const property of written.keys()) root.style.removeProperty(property);
    };
  }, [ref, active]);
}
