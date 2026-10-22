/**
 * Browser download helpers and the one naming rule for every file the app
 * downloads (#230, #427). This is the only plan-export module (besides
 * print.ts) allowed to touch the DOM — svg.ts and dxf.ts stay pure so they
 * run in the Node test environment.
 */

import type { FloorLayout, RoomLayout } from '../types';

/** Longest slug kept, well inside every file system's 255-byte name limit. */
const MAX_SLUG_LENGTH = 80;

/**
 * Lowercase, ASCII alphanumeric-and-dashes slug for filenames; never empty
 * unless the fallback is. Accents fold to their base letter; everything else
 * — quotes, `&`, `%`, path separators, `..`, control and bidi characters —
 * collapses to a dash, so a house name can never smuggle a path, a fake
 * extension or a reordered name into the download.
 */
export function slugify(input: string, fallback = 'plan'): string {
  const slug = input
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '') // strip combining accents left by NFKD
    .replace(/[^a-z0-9]+/g, '-')
    .slice(0, MAX_SLUG_LENGTH)
    .replace(/^-+|-+$/g, '');
  return slug || fallback;
}

/**
 * Every download's name (#427): `<house>[-<part>…].<ext>`, each piece
 * slugified, e.g. `maison-d-ete-inventory.csv` or `my-home-ground-floor.png`.
 * The house falls back to `layout`; a part that slugifies to nothing is
 * dropped rather than leaving a double dash.
 */
export function exportFileName(houseName: string, extension: string, ...parts: string[]): string {
  const segments = [slugify(houseName, 'layout'), ...parts.map((part) => slugify(part, '')).filter(Boolean)];
  return `${segments.join('-')}.${slugify(extension, 'bin')}`;
}

/** `<layout-name>-<floor-name>.<ext>`, e.g. `my-home-ground-floor.svg`. */
export function planExportFileName(layout: RoomLayout, floor: FloorLayout, extension: string): string {
  return exportFileName(layout.name, extension, slugify(floor.name, 'floor'));
}

/** Trigger a download of `blob` via an object URL. */
export function downloadBlob(fileName: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  try {
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    link.click();
  } finally {
    // Defer the revoke: revoking synchronously right after click() can cancel
    // the download mid-flight in some browsers. A 0ms timeout releases the URL
    // after the click has been dispatched.
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}

/** Trigger a text-file download via Blob + object URL. */
export function downloadTextFile(fileName: string, mimeType: string, text: string): void {
  downloadBlob(fileName, new Blob([text], { type: mimeType }));
}
