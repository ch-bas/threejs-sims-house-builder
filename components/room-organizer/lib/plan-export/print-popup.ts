/**
 * The popup the print and blueprint routes write into (#230, #589). It must
 * open synchronously inside the click, because browsers allow
 * `window.open()` only during the user gesture; the code that fills it may
 * load afterwards.
 */

import { notify } from '../editor-notices';

/**
 * Open an empty popup for a print sheet, or say pop-ups are blocked and
 * return null. `what` names the sheet: "the plan", "the blueprint".
 */
export function openPrintPopup(what: string): Window | null {
  const printWindow = window.open('', '_blank');
  if (!printWindow) {
    notify(`Pop-ups are blocked — allow pop-ups for this site to print ${what}.`, 'error');
    return null;
  }
  // The popup only needs the opener's handle on it, not the reverse (#455).
  printWindow.opener = null;
  return printWindow;
}

/**
 * Close a popup whose content could not be produced, so no blank tab is
 * left behind (#619), and say why.
 */
export function abandonPrintPopup(printWindow: Window, message: string): void {
  printWindow.close();
  notify(message, 'error');
}

/**
 * Print a popup the opener has just written, once its document has loaded
 * (images included), after a short beat for layout. The opener drives it
 * rather than an inline `<body onload>`: an about:blank popup inherits the
 * opener's Content-Security-Policy, which blocks inline handlers (#445).
 * Called after `document.close()`, because `document.open()` erases the
 * window's event listeners.
 */
export function printWhenLoaded(printWindow: Window): void {
  const print = (): void => {
    printWindow.setTimeout(() => printWindow.print(), 200);
  };
  if (printWindow.document.readyState === 'complete') print();
  else printWindow.addEventListener('load', print, { once: true });
}

/** What fills a print popup, once its code has loaded. */
export type PrintPopupFill = (printWindow: Window) => void | Promise<void>;

/**
 * Open the popup inside the click, then load the code that fills it (#589):
 * the exporters aren't part of the editor's first load. A load that fails
 * (a dropped connection, a redeploy) and a fill that throws each close the
 * popup and say which went wrong.
 */
export function printInPopup(what: string, load: () => Promise<PrintPopupFill>): void {
  const printWindow = openPrintPopup(what);
  if (!printWindow) return;
  void load().then(
    async (fill) => {
      try {
        await fill(printWindow);
      } catch (error) {
        console.error(`Printing ${what} failed`, error);
        abandonPrintPopup(printWindow, `Couldn’t print ${what}. Close some tabs and try again.`);
      }
    },
    (error: unknown) => {
      console.error(`Loading the code to print ${what} failed`, error);
      abandonPrintPopup(printWindow, `Couldn’t load what printing ${what} needs. Check your connection and try again.`);
    }
  );
}
