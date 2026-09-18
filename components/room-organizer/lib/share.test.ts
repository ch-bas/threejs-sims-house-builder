import { describe, expect, it } from 'vitest';
import { makeFloor, makeItem, makeLayout } from './__testfixtures__/fixtures';
import { decodeShareUrl, encodeShareUrl, isShareHash, isShareUrlReasonablySized } from './share';
import type { RoomLayout } from './types';

// share.ts relies on btoa/atob and CompressionStream/DecompressionStream —
// all global in Node >= 18, so no shims are needed in the node environment.

const ORIGIN = 'https://example.com/app';
const PREFIX = '#layout=';

function hashOf(url: string): string {
  return url.slice(url.indexOf(PREFIX));
}

/**
 * The legacy (v1) encoding, reproduced inline: un-prefixed base64url of the
 * raw JSON. Existing links in the wild use this format and must keep decoding.
 */
function legacyEncodeHash(layout: RoomLayout): string {
  const json = JSON.stringify(layout);
  const binary = unescape(encodeURIComponent(json));
  const encoded = Buffer.from(binary, 'binary')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
  return `${PREFIX}${encoded}`;
}

/** A furnished 100-item, two-floor layout with unsnapped float positions. */
function makeLargeLayout(itemCount = 100): RoomLayout {
  const items = Array.from({ length: itemCount }, (_, i) =>
    makeItem({
      id: `item-${i}-${Math.random().toString(36).slice(2)}`,
      type: i % 2 === 0 ? 'sofa' : 'bed',
      name: `Furniture piece number ${i}`,
      position: { x: (i * 0.137 + 0.0001) % 7.5, z: (i * 0.291 + 0.0002) % 7.5 },
      rotation: (i * 15) % 360,
    })
  );
  return makeLayout({
    name: 'Fully Furnished Mansion',
    floors: [
      makeFloor({ id: 'g', items: items.slice(0, itemCount / 2) }),
      makeFloor({ id: 'u', name: 'First Floor', items: items.slice(itemCount / 2) }),
    ],
  });
}

describe('encodeShareUrl / decodeShareUrl roundtrip', () => {
  it('roundtrips a basic layout', async () => {
    const layout = makeLayout({ name: 'Roundtrip House' });
    const { url } = await encodeShareUrl(layout, ORIGIN);
    expect(url.startsWith(`${ORIGIN}${PREFIX}`)).toBe(true);
    const decoded = await decodeShareUrl(hashOf(url));
    expect(decoded).toEqual(layout);
  });

  it('emits the v2 compressed format (payload prefixed with "2.")', async () => {
    const { url } = await encodeShareUrl(makeLayout(), ORIGIN);
    const payload = url.slice(url.indexOf(PREFIX) + PREFIX.length);
    expect(payload.startsWith('2.')).toBe(true);
    expect(isShareHash(hashOf(url))).toBe(true);
  });

  it('roundtrips unicode and emoji names', async () => {
    const layout = makeLayout({ name: 'Château 🏰 des Rêves — 日本語' });
    const { url } = await encodeShareUrl(layout, ORIGIN);
    const decoded = await decodeShareUrl(hashOf(url));
    expect(decoded!.name).toBe('Château 🏰 des Rêves — 日本語');
  });

  it('roundtrips a layout with items across multiple floors', async () => {
    const layout = makeLayout({
      floors: [
        makeFloor({ id: 'g', items: [makeItem({ id: 'a', type: 'sofa' })] }),
        makeFloor({ id: 'u', name: 'First Floor', items: [makeItem({ id: 'b', type: 'bed' })] }),
      ],
    });
    const decoded = await decodeShareUrl(hashOf((await encodeShareUrl(layout, ORIGIN)).url));
    expect(decoded).toEqual(layout);
  });

  it('produces URL-safe base64 (no + / = characters in the payload)', async () => {
    const layout = makeLayout({ name: '???>>><<<~~~ padding padding padding' });
    const { url } = await encodeShareUrl(layout, ORIGIN);
    const payload = url.slice(url.indexOf(PREFIX) + PREFIX.length);
    expect(payload).not.toMatch(/[+/=]/);
  });

  it('roundtrips a 100-item layout in a URL under the 12,000-char cap (#147)', async () => {
    const layout = makeLargeLayout(100);
    const { url } = await encodeShareUrl(layout, ORIGIN);
    expect(url.length).toBeLessThan(12_000);
    expect(isShareUrlReasonablySized(url)).toBe(true);
    const decoded = await decodeShareUrl(hashOf(url));
    expect(decoded).toEqual(layout);
  });
});

describe('decodeShareUrl — legacy v1 (uncompressed) links keep working', () => {
  it('decodes an un-prefixed base64url-of-JSON payload', async () => {
    const layout = makeLayout({ name: 'Old Link House' });
    const decoded = await decodeShareUrl(legacyEncodeHash(layout));
    expect(decoded).toEqual(layout);
  });

  it('decodes a legacy payload with unicode content', async () => {
    const layout = makeLayout({ name: 'Château 🏰 legacy — 日本語' });
    const decoded = await decodeShareUrl(legacyEncodeHash(layout));
    expect(decoded!.name).toBe('Château 🏰 legacy — 日本語');
  });
});

describe('encodeShareUrl — floor-plan stripping', () => {
  it('strips a floor-plan image and reports strippedFloorPlan=true', async () => {
    const layout = makeLayout({ floorPlanImage: 'data:image/png;base64,AAAA' });
    const { url, strippedFloorPlan } = await encodeShareUrl(layout, ORIGIN);
    expect(strippedFloorPlan).toBe(true);
    const decoded = await decodeShareUrl(hashOf(url));
    expect(decoded!.floorPlanImage).toBeUndefined();
  });

  it('does not mutate the source layout when stripping', async () => {
    const layout = makeLayout({ floorPlanImage: 'data:image/png;base64,AAAA' });
    await encodeShareUrl(layout, ORIGIN);
    expect(layout.floorPlanImage).toBe('data:image/png;base64,AAAA');
  });

  it('reports strippedFloorPlan=false when there is no image', async () => {
    expect((await encodeShareUrl(makeLayout(), ORIGIN)).strippedFloorPlan).toBe(false);
  });
});

describe('decodeShareUrl — corrupt input returns null without throwing', () => {
  it('returns null when the hash prefix is missing', async () => {
    expect(await decodeShareUrl('#other=abc')).toBeNull();
  });

  it('returns null for an empty payload', async () => {
    expect(await decodeShareUrl(PREFIX)).toBeNull();
  });

  it('returns null for garbage base64 that is not valid JSON', async () => {
    expect(await decodeShareUrl(`${PREFIX}!!!not-base64!!!`)).toBeNull();
  });

  it('returns null when the payload decodes to a non-layout object', async () => {
    const encoded = Buffer.from(JSON.stringify({ foo: 'bar' }), 'binary').toString('base64');
    expect(await decodeShareUrl(`${PREFIX}${encoded}`)).toBeNull();
  });

  it('returns null for a v2 payload with no data after the version prefix', async () => {
    expect(await decodeShareUrl(`${PREFIX}2.`)).toBeNull();
  });

  it('returns null for a v2 payload that is not a valid deflate stream', async () => {
    expect(await decodeShareUrl(`${PREFIX}2.AAAAAAAA`)).toBeNull();
  });

  it('returns null for a truncated v2 payload', async () => {
    const { url } = await encodeShareUrl(makeLargeLayout(20), ORIGIN);
    const hash = hashOf(url);
    const truncated = hash.slice(0, PREFIX.length + 2 + Math.floor((hash.length - PREFIX.length) / 3));
    expect(await decodeShareUrl(truncated)).toBeNull();
  });
});

describe('isShareUrlReasonablySized', () => {
  it('accepts a short URL and rejects an oversized one', () => {
    expect(isShareUrlReasonablySized('https://x.com/#layout=abc')).toBe(true);
    expect(isShareUrlReasonablySized('x'.repeat(12_001))).toBe(false);
  });
});
