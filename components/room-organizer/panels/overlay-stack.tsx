'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import {
  fitAboveFloor,
  MAX_SQUEEZE,
  overlayStackTop,
  stackFloor,
  toastsHeldBack,
  type StackSqueeze,
} from '../lib/overlay-queue';

/**
 * One column under the top pills that the small-screen overlays share: the
 * save-failed / changed-in-another-tab notices (#385) first, then the single
 * toast slot. They come from different parts of the tree, so each renders
 * through a portal into this column and they stack instead of overlapping.
 * Styled by `.pc-overlay-stack` in app/globals.css ("Overlays").
 *
 * The phone HUD moves with the viewport and the toggles (touch camera row,
 * minimap, tool chips), so while the column has content it is placed just
 * under whatever chrome sits above it rather than at a fixed offset.
 */
let stack: HTMLDivElement | null = null;
let users = 0;
let stopPlacing: (() => void) | null = null;

/** Chrome in the top band that the stack must not cover. */
const TOP_CHROME =
  '[data-scene-occluder], .pc-top-right, .pc-lot-badge, .pc-touch-controls, .pc-minimap, .pc-top-chip';
/** `top` when nothing is in the way; `--pc-overlay-top` overrides it. */
const DEFAULT_TOP = 148;

/**
 * Under the chrome, and never over the open item sheet: when the band
 * between them is too short the stack gives ground step by step (notices on
 * one line, then toasts held back with their timers paused), and as a last
 * resort rises over the chrome to sit on the sheet. The save notices stay
 * visible throughout.
 */
function placeStack(el: HTMLDivElement): void {
  if (!el.firstElementChild) return;
  const chrome: DOMRect[] = [];
  for (const node of document.querySelectorAll(TOP_CHROME)) {
    if (!el.contains(node)) chrome.push(node.getBoundingClientRect());
  }
  const sheetNode =
    document.documentElement.dataset.sheetOpen !== undefined ? document.querySelector('.pc-item-popover') : null;
  const sheet = sheetNode?.getBoundingClientRect() ?? null;
  const minTop = parseFloat(getComputedStyle(el).getPropertyValue('--pc-overlay-top')) || DEFAULT_TOP;
  const viewportHeight = window.innerHeight;

  let squeeze: StackSqueeze = 0;
  let top = minTop;
  for (;;) {
    // `data-squeeze` is outside the observer's filter: no feedback loop.
    el.dataset.squeeze = String(squeeze);
    const own = el.getBoundingClientRect();
    const preferred = overlayStackTop(chrome, own, viewportHeight, minTop);
    const placement = fitAboveFloor(preferred, own.height, stackFloor(sheet, own, viewportHeight), minTop);
    top = placement.top;
    if (placement.fits || squeeze === MAX_SQUEEZE) break;
    squeeze = squeeze === 0 ? 1 : 2;
  }
  toastsHeldBack.set(squeeze === MAX_SQUEEZE);
  const topPx = `${top}px`;
  // Guarded: this write is itself a mutation the observer sees.
  if (el.style.top !== topPx) el.style.top = topPx;
}

function startPlacing(el: HTMLDivElement): () => void {
  let frame = 0;
  const schedule = () => {
    if (frame) return;
    frame = window.requestAnimationFrame(() => {
      frame = 0;
      placeStack(el);
    });
  };
  // DOM changes only (toggles, chips, HUD reflow, the sheet opening or
  // expanding, the stack's own content): the scene's drag fast-path and
  // camera moves never touch the DOM.
  const observer = new MutationObserver(schedule);
  observer.observe(document.documentElement, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ['class', 'style', 'hidden', 'data-minimap', 'data-sheet', 'data-sheet-open'],
  });
  window.addEventListener('resize', schedule);
  schedule();
  return () => {
    observer.disconnect();
    window.removeEventListener('resize', schedule);
    if (frame) window.cancelAnimationFrame(frame);
  };
}

function acquireStack(): HTMLDivElement {
  if (!stack) {
    stack = document.createElement('div');
    stack.className = 'pc-overlay-stack';
    document.body.appendChild(stack);
    stopPlacing = startPlacing(stack);
  }
  users += 1;
  return stack;
}

function releaseStack(): void {
  users -= 1;
  if (users === 0 && stack) {
    stopPlacing?.();
    stopPlacing = null;
    toastsHeldBack.set(false);
    stack.remove();
    stack = null;
  }
}

export interface OverlayStackPortalProps {
  /** `alert` entries sort above `toast` entries. */
  slot: 'alert' | 'toast';
  children: ReactNode;
}

export function OverlayStackPortal({ slot, children }: OverlayStackPortalProps): JSX.Element | null {
  const [host, setHost] = useState<HTMLDivElement | null>(null);
  useEffect(() => {
    setHost(acquireStack());
    return releaseStack;
  }, []);
  if (!host) return null;
  return createPortal(<div className={`pc-overlay-stack__${slot}`}>{children}</div>, host);
}
