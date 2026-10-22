/**
 * Browser download helpers and the one naming rule for every file the app
 * downloads (#230, #427). This is the only plan-export module (besides
 * print.ts) allowed to touch the DOM — svg.ts and dxf.ts stay pure so they
 * run in the Node test environment.
 */

import type { FloorLayout, RoomLayout } from '../types';

/**
 * Longest slug kept, in UTF-8 bytes (file systems count bytes, and a CJK
 * character is three), well inside the 255-byte name limit.
 */
const MAX_SLUG_BYTES = 100;
/** Longest basename `exportFileName` joins, in UTF-8 bytes. */
const MAX_BASENAME_BYTES = 200;

/** Basenames Windows reserves in every folder, whatever the extension. */
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/;

function utf8Length(codePoint: number): number {
  if (codePoint < 0x80) return 1;
  if (codePoint < 0x800) return 2;
  return codePoint < 0x10000 ? 3 : 4;
}

/** The longest prefix of `text` that fits in `maxBytes` of UTF-8, never splitting a character. */
function truncateUtf8(text: string, maxBytes: number): string {
  let bytes = 0;
  let out = '';
  for (const char of text) {
    bytes += utf8Length(char.codePointAt(0) ?? 0);
    if (bytes > maxBytes) break;
    out += char;
  }
  return out;
}

/**
 * Lowercase letters, digits and dashes, in any script, for filenames; never
 * empty unless the fallback is. Latin accents fold to their base letter
 * (`été` → `ete`); other scripts are kept (`Дом мечты` → `дом-мечты`,
 * `東京の家` stays). Everything else — punctuation, quotes, `&`, `%`, path
 * separators, `..`, emoji, control and bidi characters — collapses to a
 * dash, so a house name can never smuggle a path, a fake extension or a
 * reordered name into the download.
 */
export function slugify(input: string, fallback = 'plan'): string {
  const words = input
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '') // strip the Latin accents NFKD split off
    .normalize('NFC') // recompose the rest: Hangul syllables, kana voicing marks
    // Emoji variation selectors and keycap-style enclosing marks are marks
    // too, but invisible without their emoji.
    .replace(/[\p{Me}︀-️\u{E0100}-\u{E01EF}]/gu, '')
    .replace(/[^\p{L}\p{M}\p{N}]+/gu, '-')
    // A mark only means something on a letter (Devanagari, Arabic vowels).
    .replace(/(^|[-\p{N}])\p{M}+/gu, '$1')
    .replace(/-{2,}/g, '-')
    .replace(/^-+/, '');
  const slug = truncateUtf8(words, MAX_SLUG_BYTES).replace(/-+$/, '');
  return slug || fallback;
}

/**
 * Every download's name (#427): `<house>[-<part>…].<ext>`, each piece
 * slugified, e.g. `maison-d-ete-inventory.csv` or `my-home-ground-floor.png`.
 * The house falls back to `layout`; a part that slugifies to nothing is
 * dropped rather than leaving a double dash. A basename Windows reserves
 * (`con`, `nul`, `com1`, …) gets a `-house` suffix.
 */
export function exportFileName(houseName: string, extension: string, ...parts: string[]): string {
  const segments = [slugify(houseName, 'layout'), ...parts.map((part) => slugify(part, '')).filter(Boolean)];
  let base = truncateUtf8(segments.join('-'), MAX_BASENAME_BYTES).replace(/-+$/, '');
  if (WINDOWS_RESERVED.test(base)) base = `${base}-house`;
  return `${base}.${slugify(extension, 'bin')}`;
}

/** `<layout-name>-<floor-name>.<ext>`, e.g. `my-home-ground-floor.svg`. */
export function planExportFileName(layout: RoomLayout, floor: FloorLayout, extension: string): string {
  return exportFileName(layout.name, extension, slugify(floor.name, 'floor'));
}

/**
 * The whole-building plan's name (#405): `<layout-name>-all-floors.<ext>`,
 * numbered (`-all-floors-2`, …) when a floor's own name would give it the
 * same file, so a floor called "All floors" can't overwrite it or be
 * overwritten.
 */
export function buildingExportFileName(layout: RoomLayout, extension: string): string {
  const floorParts = new Set(layout.floors.map((floor) => slugify(floor.name, 'floor')));
  let part = 'all-floors';
  for (let n = 2; floorParts.has(part); n++) part = `all-floors-${n}`;
  return exportFileName(layout.name, extension, part);
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
