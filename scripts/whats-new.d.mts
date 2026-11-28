export const MAX_ITEMS: number;

export const MAX_LINE: number;

export function shortLine(bullet: string): string;

export function pickBullets(bullets: readonly string[]): string[];

export function whatsNewFor(changelog: string, version: string): { version: string; items: string[] } | null;

export function whatsNewFromFile(readText: () => string, version: string): { version: string; items: string[] } | null;
