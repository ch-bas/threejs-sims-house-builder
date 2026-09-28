import { useEffect, useRef, type RefObject } from 'react';

const FOCUSABLE = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

export interface UseDialogFocusOptions {
  /** Focused on open; defaults to the container itself (give it tabIndex={-1}). */
  initialFocusRef?: RefObject<HTMLElement>;
  /**
   * Called on Escape while this dialog owns the keyboard (see activeDialog).
   * The event is consumed so the global shortcuts don't also see it.
   */
  onEscape?: () => void;
  /** Modal: keep Tab / Shift+Tab cycling inside the container. */
  trap?: boolean;
}

interface OpenDialog {
  container: HTMLElement;
  trap: boolean;
}

/** Every open dialog, in the order they opened. */
const openDialogs: OpenDialog[] = [];

/**
 * Key events already handled by a dialog. In a browser React applies a
 * dialog's close in a microtask that runs between two listeners of the same
 * event, so ownership can shift mid-dispatch — the first owner claims the
 * event and every other dialog skips it.
 */
const claimedEvents = new WeakSet<Event>();

/**
 * The one dialog that handles Tab/Escape: the most recently opened one that
 * holds focus, else the most recently opened modal. Exactly one owner means a
 * single Escape never closes two stacked overlays at once.
 */
function activeDialog(): OpenDialog | undefined {
  const focused = document.activeElement;
  for (let i = openDialogs.length - 1; i >= 0; i--) {
    if (openDialogs[i]!.container.contains(focused)) return openDialogs[i];
  }
  for (let i = openDialogs.length - 1; i >= 0; i--) {
    if (openDialogs[i]!.trap) return openDialogs[i];
  }
  return undefined;
}

/**
 * Focus management for a dialog-like overlay: move focus in when it opens,
 * optionally trap Tab inside it, close on Escape, and hand focus back to
 * whatever had it before opening once it closes (#152).
 */
export function useDialogFocus(
  open: boolean,
  containerRef: RefObject<HTMLElement>,
  { initialFocusRef, onEscape, trap = false }: UseDialogFocusOptions = {}
): void {
  const onEscapeRef = useRef(onEscape);
  onEscapeRef.current = onEscape;

  useEffect(() => {
    if (!open) return undefined;
    const container = containerRef.current;
    if (!container) return undefined;

    const self: OpenDialog = { container, trap };
    openDialogs.push(self);
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;

    // Deferred past the current input event: an overlay opened from a canvas
    // pointerdown would otherwise lose focus again to that same click's
    // mousedown default action (which blurs to <body>). Never pull focus out
    // of another open modal (e.g. the popover opening from the drawer).
    const focusTimer = window.setTimeout(() => {
      const active = document.activeElement;
      if (!container.isConnected || container.contains(active)) return;
      const hostModal = active?.closest('[aria-modal="true"]');
      if (hostModal && !container.contains(hostModal)) return;
      (initialFocusRef?.current ?? container).focus({ preventScroll: true });
    }, 0);

    const onKeyDown = (event: KeyboardEvent) => {
      // A control inside handled it (e.g. Escape cancelling an inline rename).
      if (event.defaultPrevented) return;
      if (claimedEvents.has(event) || activeDialog() !== self) return;
      claimedEvents.add(event);
      if (event.key === 'Escape' && onEscapeRef.current) {
        event.preventDefault();
        event.stopPropagation();
        onEscapeRef.current();
        return;
      }
      if (!trap || event.key !== 'Tab') return;
      const focusable = container.querySelectorAll<HTMLElement>(FOCUSABLE);
      if (focusable.length === 0) return;
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      const active = document.activeElement;
      if (event.shiftKey) {
        if (active === first || !container.contains(active)) {
          event.preventDefault();
          last.focus();
        }
      } else if (active === last || !container.contains(active)) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);

    return () => {
      window.clearTimeout(focusTimer);
      document.removeEventListener('keydown', onKeyDown);
      const index = openDialogs.indexOf(self);
      if (index !== -1) openDialogs.splice(index, 1);
      // Restore only if focus is still ours to give back: inside the closing
      // overlay, or dropped to <body> because the focused control unmounted.
      const active = document.activeElement;
      const focusIsOurs = !active || active === document.body || container.contains(active);
      if (focusIsOurs && previous && previous !== document.body && previous.isConnected) {
        previous.focus({ preventScroll: true });
      }
    };
  }, [open, containerRef, initialFocusRef, trap]);
}
