/**
 * Browser download helpers for the plan exporters (#230). This is the only
 * plan-export module (besides print.ts) allowed to touch the DOM — svg.ts
 * and dxf.ts stay pure so they run in the Node test environment.
 */

import type { FloorLayout, RoomLayout } from '../types';

/** Lowercase, alphanumeric-and-dashes slug for filenames; never empty. */
export function slugify(input: string, fallback = 'plan'): string {
  const slug = input
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '') // strip combining accents left by NFKD
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || fallback;
}

/** `<layout-name>-<floor-name>.<ext>`, e.g. `my-home-ground-floor.svg`. */
export function planExportFileName(layout: RoomLayout, floor: FloorLayout, extension: string): string {
  return `${slugify(layout.name, 'layout')}-${slugify(floor.name, 'floor')}.${extension}`;
}

/** Trigger a text-file download via Blob + object URL. */
export function downloadTextFile(fileName: string, mimeType: string, text: string): void {
  const blob = new Blob([text], { type: mimeType });
  const url = URL.createObjectURL(blob);
  try {
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    link.click();
  } finally {
    // Defer the revoke so it can't truncate the download (same pattern as
    // lib/file-io.ts downloadLayoutAsJson).
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}
