/**
 * The What's new card's content (#931): the newest release's Added lines,
 * written from CHANGELOG.md at build time (`scripts/whats-new.mjs`) and
 * stamped in as a JSON string. Loaded on demand by the card, and importing
 * nothing, so the lines ride in a chunk of their own and the editor's
 * bundle keeps its shape.
 */
export interface WhatsNew {
  version: string;
  items: readonly string[];
}

/** Lines the card shows at most, whatever the string holds. */
const MAX_ITEMS = 5;

/** The stamped string as content; null when absent or not the expected shape. */
export function readWhatsNew(raw: string | undefined): WhatsNew | null {
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const { version, items } = parsed as { version?: unknown; items?: unknown };
  if (typeof version !== 'string' || !Array.isArray(items)) return null;
  const lines = items.filter((item): item is string => typeof item === 'string' && item.trim() !== '').slice(0, MAX_ITEMS);
  return lines.length > 0 ? { version, items: lines } : null;
}

/** This build's lines; null outside a Next build (tests) or with none. */
export const WHATS_NEW: WhatsNew | null = readWhatsNew(process.env.NEXT_PUBLIC_WHATS_NEW);
