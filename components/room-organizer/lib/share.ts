import { parseStoredLayout } from './schema';
import type { RoomLayout } from './types';

const HASH_PREFIX = '#layout=';
const MAX_REASONABLE_URL_LENGTH = 12_000;

export interface EncodeShareUrlResult {
  url: string;
  /** True when the layout had a floor-plan image that was stripped to keep the URL compact. */
  strippedFloorPlan: boolean;
}

export function encodeShareUrl(layout: RoomLayout, origin: string): EncodeShareUrlResult {
  const stripped = layout.floorPlanImage !== undefined;
  const shareable: RoomLayout = { ...layout };
  delete shareable.floorPlanImage;

  const json = JSON.stringify(shareable);
  const encoded = base64UrlEncode(json);
  return { url: `${origin}${HASH_PREFIX}${encoded}`, strippedFloorPlan: stripped };
}

export function decodeShareUrl(hash: string): RoomLayout | null {
  if (!hash.startsWith(HASH_PREFIX)) return null;
  const encoded = hash.slice(HASH_PREFIX.length);
  if (!encoded) return null;
  try {
    const json = base64UrlDecode(encoded);
    const parsed: unknown = JSON.parse(json);
    return parseStoredLayout(parsed);
  } catch {
    return null;
  }
}

export function isShareUrlReasonablySized(url: string): boolean {
  return url.length <= MAX_REASONABLE_URL_LENGTH;
}

function base64UrlEncode(input: string): string {
  if (typeof window === 'undefined') return '';
  // btoa requires a binary string; encodeURIComponent + unescape is the
  // canonical UTF-8 safe round-trip and avoids stack-overflow risks with
  // very long strings.
  const binary = unescape(encodeURIComponent(input));
  return window
    .btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function base64UrlDecode(input: string): string {
  if (typeof window === 'undefined') return '';
  const padded = input.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((input.length + 3) % 4);
  return decodeURIComponent(escape(window.atob(padded)));
}
