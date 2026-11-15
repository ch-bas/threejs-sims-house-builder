export const WORKER_FILE: string;
export const PAGE_ENTRY: string;
export const SHELL_FILES: readonly string[];

export type SwRoute = 'static' | 'page' | 'fresh';

export function precacheEntries(files: readonly string[]): string[];

export function pageMarker(html: string): string;

export function sha256(bytes: string | Uint8Array): string;

export function cachePrefix(scope: string): string;

export function routeFor(url: string, scope: string, mode: string, method: string, precached: readonly string[]): SwRoute | null;

export function pageFallback(url: string, scope: string): string;

export function contentType(entry: string): string;

export function workerSource(build: { hashes: Readonly<Record<string, string>> }): string;

export function removalWorkerSource(): string;

export function workerOff(env: Readonly<Record<string, string | undefined>>): boolean;

export const OWN_PAGES: { RELOAD_PAGE: string; OFFLINE_PAGE: string; OWN_PAGE_STYLE: string; OWN_PAGE_POLICY: string };
