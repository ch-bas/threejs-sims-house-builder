import { useEffect, useRef, type RefObject } from 'react';

// Tab stops only: a roving-tabindex widget (the drawer's tabs, #434) parks its
// inactive items at tabindex -1, and wrapping onto one would skip the widget.
const FOCUSABLE = ['button', '[href]', 'input', 'select', 'textarea', '[tabindex]']
  .map((selector) => `${selector}:not([tabindex="-1"])`)
  .join(', ');

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
  /**
   * Take focus even from another open modal: a confirm asked from inside
   * the drawer must hold the keyboard until it is answered (#649).
   */
  takeFocus?: boolean;
  /**
   * A trap that shares Tab with the overlays it opens (#632): every visible
   * `[data-focus-companion]` joins the cycle, after the container. Only the
   * drawer asks; a confirm or the welcome modal stays strict.
   */
  companions?: boolean;
  /**
   * With nothing to go back to (opened by a shortcut, focus on <body>), hand
   * focus to the `[data-focus-home]` control when closing (#638).
   */
  returnHome?: boolean;
}

interface OpenDialog {
  container: HTMLElement;
  trap: boolean;
  companions: boolean;
  /** Where focus goes when this dialog closes. */
  previous: HTMLElement | null;
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

/** A control that gave up focus for the dialog about to open; see holdFocusReturn. */
let heldReturn: HTMLElement | null = null;

/**
 * For a control that blurs itself to hand the keys over, as a catalogue tile
 * does: focus was already on <body> when the dialog opened, so the dialog would
 * have nothing to go back to (#638). The next dialog to open returns here. If
 * none does, the open popover takes the keys, with this as its way back (a tile
 * pressed with an item already selected), or else the control simply keeps
 * focus (a refused add).
 */
export function holdFocusReturn(control: HTMLElement): void {
  heldReturn = control;
  window.setTimeout(() => {
    if (heldReturn !== control) return;
    heldReturn = null;
    const active = document.activeElement;
    if (active && active !== document.body) return;
    const host = openDialogs.findLast((dialog) => !dialog.trap);
    if (!host) {
      control.focus({ preventScroll: true });
      return;
    }
    host.previous = control;
    host.container.focus({ preventScroll: true });
  }, 0);
}

function takeHeldReturn(): HTMLElement | null {
  const held = heldReturn;
  heldReturn = null;
  return held;
}

const canTakeFocus = (element: HTMLElement): boolean =>
  element.isConnected && !element.matches(':disabled') && (element.checkVisibility?.() ?? true);

const focusHome = (): HTMLElement | null => {
  const home = document.querySelector<HTMLElement>('[data-focus-home]');
  return home && canTakeFocus(home) ? home : null;
};

const tabStops = (root: HTMLElement): HTMLElement[] =>
  [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(canTakeFocus);

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

/** The trap that governs Tab for this dialog: its own, or the modal it is a companion of. */
function tabScope(owner: OpenDialog): OpenDialog | undefined {
  if (owner.trap) return owner;
  if (!owner.container.matches('[data-focus-companion]')) return undefined;
  return openDialogs.findLast((dialog) => dialog.trap && dialog.companions);
}

/**
 * Keep Tab inside a modal and its companions. Native Tab walks each surface;
 * only a step off the edge of one is steered, onto the next.
 */
function cycleTab(event: KeyboardEvent, scope: OpenDialog): void {
  const companions = scope.companions
    ? [...document.querySelectorAll<HTMLElement>('[data-focus-companion]')].filter(
        (element) => !scope.container.contains(element)
      )
    : [];
  const surfaces = [scope.container, ...companions]
    .map((root) => ({ root, stops: tabStops(root) }))
    .filter((surface) => surface.stops.length > 0);
  if (surfaces.length === 0) return;
  const active = document.activeElement;
  const index = surfaces.findIndex((surface) => surface.root.contains(active));
  const step = event.shiftKey ? -1 : 1;
  const target = (from: number) => {
    const next = surfaces[(from + surfaces.length) % surfaces.length]!;
    return event.shiftKey ? next.stops[next.stops.length - 1]! : next.stops[0]!;
  };
  const leave = (element: HTMLElement) => {
    event.preventDefault();
    element.focus();
  };
  if (index === -1) {
    leave(target(event.shiftKey ? -1 : 0));
    return;
  }
  const { root, stops } = surfaces[index]!;
  const edge = event.shiftKey ? stops[0] : stops[stops.length - 1];
  // A surface's own box holds focus when it opened: Shift+Tab from there
  // would walk off the front of it.
  if (active === edge || (event.shiftKey && active === root)) leave(target(index + step));
}

/**
 * Focus management for a dialog-like overlay: move focus in when it opens,
 * optionally trap Tab inside it, close on Escape, and hand focus back to
 * whatever had it before opening once it closes (#152).
 */
export function useDialogFocus(
  open: boolean,
  containerRef: RefObject<HTMLElement>,
  {
    initialFocusRef,
    onEscape,
    trap = false,
    takeFocus = false,
    companions = false,
    returnHome = false,
  }: UseDialogFocusOptions = {}
): void {
  const onEscapeRef = useRef(onEscape);
  onEscapeRef.current = onEscape;

  useEffect(() => {
    if (!open) return undefined;
    const container = containerRef.current;
    if (!container) return undefined;

    const self: OpenDialog = {
      container,
      trap,
      companions,
      previous: takeHeldReturn() ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null),
    };
    openDialogs.push(self);

    // Deferred past the current input event: an overlay opened from a canvas
    // pointerdown would otherwise lose focus again to that same click's
    // mousedown default action (which blurs to <body>). Never pull focus out
    // of another open modal (e.g. the popover opening from the drawer).
    const focusTimer = window.setTimeout(() => {
      const active = document.activeElement;
      if (!container.isConnected || container.contains(active)) return;
      const insideModal = openDialogs.some((dialog) => dialog !== self && dialog.trap && dialog.container.contains(active));
      if (!takeFocus && insideModal) return;
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
      if (event.key !== 'Tab') return;
      const scope = tabScope(self);
      if (scope) cycleTab(event, scope);
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
      if (!focusIsOurs) return;
      const { previous } = self;
      const hadOne = previous !== null && previous !== document.body;
      if (hadOne && canTakeFocus(previous)) {
        previous.focus({ preventScroll: true });
        return;
      }
      // Its opener is gone or hidden (a row in the closed drawer). Inside a
      // modal that is still open, what comes next is that modal's business.
      if (!hadOne && !returnHome) return;
      if (openDialogs.some((dialog) => dialog.trap)) return;
      focusHome()?.focus({ preventScroll: true });
    };
  }, [open, containerRef, initialFocusRef, trap, takeFocus, companions, returnHome]);
}
