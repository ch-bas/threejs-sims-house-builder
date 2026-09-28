import { useEffect, useRef, type RefObject } from 'react';

const FOCUSABLE = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

export interface UseDialogFocusOptions {
  /** Focused on open; defaults to the container itself (give it tabIndex={-1}). */
  initialFocusRef?: RefObject<HTMLElement>;
  /**
   * Called on Escape while open — anywhere for a trapping (modal) dialog, only
   * while focus is inside it otherwise. The event is consumed so the global
   * shortcuts don't also see it.
   */
  onEscape?: () => void;
  /** Keep Tab / Shift+Tab cycling inside the container (modal dialogs). */
  trap?: boolean;
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

    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    // Deferred past the current input event: an overlay opened from a canvas
    // pointerdown would otherwise lose focus again to that same click's
    // mousedown default action (which blurs to <body>).
    const focusTimer = window.setTimeout(() => {
      if (!container.isConnected || container.contains(document.activeElement)) return;
      (initialFocusRef?.current ?? container).focus({ preventScroll: true });
    }, 0);

    const onKeyDown = (event: KeyboardEvent) => {
      if (
        event.key === 'Escape' &&
        onEscapeRef.current &&
        (trap || container.contains(document.activeElement))
      ) {
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
