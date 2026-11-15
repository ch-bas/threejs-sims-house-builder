import { BACKUP_FORMAT } from './backup';
import { confirmOpen } from './confirm-dialog';

/**
 * A house file dropped anywhere on the page (#934). Without a page-wide drop
 * target the browser opened a dropped file itself, and the editor was lost.
 * Now a drag that carries files shows the drop overlay, every file drop is
 * caught, and a JSON file opens the way Import and Restore do: a house
 * through the import path, a backup through the add-only restore.
 */

/** Whether a drag carries files from outside the page (not the catalogue's own drag). */
export function dragHasFiles(types: readonly string[] | DOMStringList): boolean {
  return Array.prototype.includes.call(types, 'Files');
}

/** A file that may hold a house or a backup: JSON by type or by name. */
export function isJsonFile(file: { name: string; type: string }): boolean {
  return file.type === 'application/json' || /\.json$/i.test(file.name);
}

/**
 * Past this a file can't be a backup (they hold a browser's local storage,
 * a few MB), so it isn't read to find out; the import's own size check
 * refuses it with its usual reason.
 */
export const MAX_SNIFFED_FILE_BYTES = 32 * 1024 * 1024;

export type DroppedFileKind = 'backup' | 'house';

/** A backup bundle or, for anything else, a house to import (which validates it). */
export function droppedFileKind(text: string): DroppedFileKind {
  try {
    const json: unknown = JSON.parse(text);
    return typeof json === 'object' && json !== null && (json as { format?: unknown }).format === BACKUP_FORMAT ? 'backup' : 'house';
  } catch {
    return 'house';
  }
}

export const MODAL_OPEN_MESSAGE = 'Close the open dialog first, then try the file again.';

/**
 * Dialogs that hold the page. The drawer (an aside) is not one, and a dialog
 * marked `data-file-drop="open"` takes the file (the start chooser: a house
 * dropped on it answers it).
 */
const BLOCKING_DIALOGS =
  'div[role="dialog"][aria-modal="true"]:not([data-file-drop="open"]), [role="alertdialog"][aria-modal="true"]:not([data-file-drop="open"])';

/** Why no file can open now: a question waiting or a blocking dialog on the page. */
export function modalBlocksFiles(doc: Pick<Document, 'querySelector'> | null): string | null {
  if (confirmOpen()) return MODAL_OPEN_MESSAGE;
  return doc?.querySelector(BLOCKING_DIALOGS) ? MODAL_OPEN_MESSAGE : null;
}

/**
 * Why files are refused, or null when the one JSON file can open. `how` says
 * how they came: dropped on the page, or opened with the installed app.
 */
export function dropRefusal(
  files: readonly { name: string; type: string }[],
  lockedReason: string | null,
  how: 'drop' | 'open' = 'drop'
): string | null {
  if (lockedReason) return lockedReason;
  if (files.length === 0) return null;
  const verb = how === 'drop' ? 'Drop' : 'Open';
  if (files.length > 1) return `${verb} one file at a time.`;
  const [file] = files;
  if (file && !isJsonFile(file)) return `“${file.name}” isn’t a house file. ${verb} a .json house or backup.`;
  return null;
}
