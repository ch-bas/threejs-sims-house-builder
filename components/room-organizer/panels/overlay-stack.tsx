'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { overlayStackTop } from '../lib/overlay-queue';

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

function placeStack(el: HTMLDivElement): void {
  if (!el.firstElementChild) return;
  const own = el.getBoundingClientRect();
  const chrome: DOMRect[] = [];
  for (const node of document.querySelectorAll(TOP_CHROME)) {
    if (!el.contains(node)) chrome.push(node.getBoundingClientRect());
  }
  const minTop = parseFloat(getComputedStyle(el).getPropertyValue('--pc-overlay-top')) || DEFAULT_TOP;
  const top = `${overlayStackTop(chrome, own, window.innerHeight, minTop)}px`;
  // Guarded: this write is itself a mutation the observer sees.
  if (el.style.top !== top) el.style.top = top;
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
  // DOM changes only (toggles, chips, HUD reflow, the stack's own content):
  // the scene's drag fast-path and camera moves never touch the DOM.
  const observer = new MutationObserver(schedule);
  observer.observe(document.body, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ['class', 'style', 'hidden', 'data-minimap'],
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
