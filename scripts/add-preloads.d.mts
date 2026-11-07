export const PAGE_ENTRY_PREFIX: string;

export interface LoadableManifestEntry {
  id?: number | string;
  files?: string[];
}

export function pageChunks(manifest: Record<string, LoadableManifestEntry>): string[];

export function addPreloads(html: string, files: readonly string[]): { html: string; hrefs: string[] };
