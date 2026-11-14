export function policy(scriptHashes: readonly string[], scriptSource?: string): string;

export function scriptSource(page: string, siteOrigin: string | null, file?: string): string;

export function siteOrigin(env: Readonly<Record<string, string | undefined>>, homepage: string | undefined): string | null;

export function addPolicy(
  html: string,
  file: string,
  origin?: string | null,
): { html: string; hashes: number; source: string };
