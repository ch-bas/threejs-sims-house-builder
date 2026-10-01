import { MAX_LAYOUT_JSON_BYTES, parseStoredLayout } from './schema';
import type { RoomLayout } from './types';

const HASH_PREFIX = '#layout=';
/**
 * Version prefix for compressed payloads: `#layout=2.<base64url(deflate-raw(json))>`.
 * Legacy (v1) links carry un-prefixed `base64url(json)`; base64url never contains
 * a dot, so the prefix is unambiguous. Decoding supports both forever; encoding
 * always emits v2.
 */
const V2_PREFIX = '2.';
const MAX_REASONABLE_URL_LENGTH = 12_000;
/**
 * Longest `#layout=…` hash decoding will touch (#332). The app never makes
 * one past MAX_REASONABLE_URL_LENGTH, so this leaves five times that for
 * links from older versions — while a crafted 270 KB hash, which inflates
 * to 200 MB, is refused before a single byte is inflated.
 */
export const MAX_SHARE_HASH_LENGTH = 64 * 1024;

/** Why a share hash didn't open: far too big to be a house, or not readable as one. */
export type ShareDecodeFailure = 'too-large' | 'unreadable';

export type ShareDecodeResult =
  | { ok: true; layout: RoomLayout }
  | { ok: false; reason: ShareDecodeFailure };

export interface EncodeShareUrlResult {
  url: string;
  /** True when the layout had a floor-plan image that was stripped to keep the URL compact. */
  strippedFloorPlan: boolean;
}

export async function encodeShareUrl(
  layout: RoomLayout,
  origin: string
): Promise<EncodeShareUrlResult> {
  const stripped = layout.floorPlanImage !== undefined;
  const shareable: RoomLayout = { ...layout };
  delete shareable.floorPlanImage;

  const json = JSON.stringify(shareable);
  const compressed = await deflateRaw(new TextEncoder().encode(json));
  const encoded = `${V2_PREFIX}${bytesToBase64Url(compressed)}`;
  return { url: `${origin}${HASH_PREFIX}${encoded}`, strippedFloorPlan: stripped };
}

/**
 * True when a URL hash carries a share payload (starts with `#layout=`),
 * regardless of whether that payload decodes cleanly. Lets callers distinguish
 * "no share link" from "a share link that failed to decode" so a corrupt link
 * can surface user feedback instead of silently falling back to the local save.
 */
export function isShareHash(hash: string): boolean {
  return hash.startsWith(HASH_PREFIX) && hash.length > HASH_PREFIX.length;
}

/** True when a share hash is short enough to be worth decoding at all (#332). */
export function isShareHashWithinBudget(hash: string): boolean {
  return hash.length <= MAX_SHARE_HASH_LENGTH;
}

export async function decodeShareUrl(hash: string): Promise<RoomLayout | null> {
  const result = await readShareHash(hash);
  return result.ok ? result.layout : null;
}

/**
 * `decodeShareUrl` that says why it failed. A hash over the length budget is
 * refused before decoding, and the inflated payload is read in chunks and
 * dropped as soon as it passes MAX_LAYOUT_JSON_BYTES, so a deflate bomb
 * costs a few milliseconds instead of the tab (#332).
 */
export async function readShareHash(hash: string): Promise<ShareDecodeResult> {
  if (!isShareHash(hash)) return { ok: false, reason: 'unreadable' };
  if (!isShareHashWithinBudget(hash)) return { ok: false, reason: 'too-large' };
  const encoded = hash.slice(HASH_PREFIX.length);
  try {
    const jsonBytes = encoded.startsWith(V2_PREFIX)
      ? await inflateRawBounded(base64UrlToBytes(encoded.slice(V2_PREFIX.length)), MAX_LAYOUT_JSON_BYTES)
      : base64UrlToBytes(encoded);
    if (!jsonBytes) return { ok: false, reason: 'too-large' };
    // fatal: true so truncated/garbage byte sequences throw here (→ null)
    // instead of silently decoding to replacement characters.
    const json = new TextDecoder('utf-8', { fatal: true }).decode(jsonBytes);
    const parsed: unknown = JSON.parse(json);
    const layout = parseStoredLayout(parsed);
    return layout ? { ok: true, layout } : { ok: false, reason: 'unreadable' };
  } catch {
    return { ok: false, reason: 'unreadable' };
  }
}

export function isShareUrlReasonablySized(url: string): boolean {
  return url.length <= MAX_REASONABLE_URL_LENGTH;
}

// CompressionStream/DecompressionStream are native in every modern browser and
// in Node >= 18 (which covers the vitest node environment) — no dependency and
// no node:zlib import needed. Piping through Blob/Response keeps error
// propagation contained: a corrupt deflate stream rejects the arrayBuffer()
// promise instead of raising an unhandled rejection.
async function deflateRaw(bytes: Uint8Array<ArrayBuffer>): Promise<Uint8Array> {
  return pumpThrough(bytes, new CompressionStream('deflate-raw'));
}

/** The inflated bytes, or null as soon as they pass `maxBytes`. */
async function inflateRawBounded(bytes: Uint8Array<ArrayBuffer>, maxBytes: number): Promise<Uint8Array | null> {
  const reader = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw')).getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

async function pumpThrough(
  bytes: Uint8Array<ArrayBuffer>,
  transform: ReadableWritablePair<Uint8Array, BufferSource>
): Promise<Uint8Array> {
  const stream = new Blob([bytes]).stream().pipeThrough(transform);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

// btoa/atob are global in browsers and in Node >= 16, so these helpers work in
// both the client bundle and the vitest node environment without shims.
function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  const CHUNK = 0x8000; // keep String.fromCharCode argument counts stack-safe
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlToBytes(input: string): Uint8Array<ArrayBuffer> {
  const padded = input.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((input.length + 3) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
