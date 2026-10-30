import { deflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { makeFloor, makeItem, makeLayout } from './__testfixtures__/fixtures';
import { FURNITURE_CATALOG } from './constants';
import { planFurniture } from './furniture-scene';
import { hasCollisions, itemInBounds, snapToNeighbors, snapToWall } from './geometry';
import { MAX_LAYOUT_JSON_BYTES, MAX_NAME_LENGTH } from './schema';
import {
  MAX_SHARE_HASH_LENGTH,
  decodeShareUrl,
  encodeShareUrl,
  isShareHash,
  isShareHashWithinBudget,
  isShareUrlReasonablySized,
  readShareHash,
  roundLayoutForShare,
} from './share';
import type { FurnitureItem, RoomLayout } from './types';

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
      category: i % 2 === 0 ? 'seating' : 'bedroom',
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
        makeFloor({ id: 'g', items: [makeItem({ id: 'a', type: 'sofa', category: 'seating' })] }),
        makeFloor({ id: 'u', name: 'First Floor', items: [makeItem({ id: 'b', type: 'bed', category: 'bedroom' })] }),
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
    expect(decoded).toEqual(roundLayoutForShare(layout));
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

describe('untrusted share hashes (#332)', () => {
  /** A v2 hash carrying exactly `json`, deflated with node's zlib. */
  function v2Hash(json: string): string {
    return `${PREFIX}2.${deflateRawSync(Buffer.from(json), { level: 9 }).toString('base64url')}`;
  }

  it('refuses a hash over the length budget without decoding it', async () => {
    // The issue's 200 MB-name bomb deflates to a 271,811-character hash.
    const hash = `${PREFIX}2.${'A'.repeat(271_811)}`;
    expect(isShareHashWithinBudget(hash)).toBe(false);
    expect(await readShareHash(hash)).toEqual({ ok: false, reason: 'too-large' });
    expect(await decodeShareUrl(hash)).toBeNull();
    expect(isShareHashWithinBudget(`${PREFIX}2.${'A'.repeat(MAX_SHARE_HASH_LENGTH - 10)}`)).toBe(true);
  });

  it('cuts a deflate bomb off at the output budget, cheaply', async () => {
    // The issue's smaller probe: a 30 M-space name compresses to ~39 K characters.
    const json = `{"name":"${' '.repeat(30_000_000)}","width":8,"height":8,"floors":[]}`;
    const hash = v2Hash(json);
    expect(hash.length).toBeLessThan(MAX_SHARE_HASH_LENGTH);
    const started = performance.now();
    expect(await readShareHash(hash)).toEqual({ ok: false, reason: 'too-large' });
    // Inflating stops at MAX_LAYOUT_JSON_BYTES instead of materialising 30 MB
    // and parsing it; generous for slow CI machines.
    expect(performance.now() - started).toBeLessThan(1000);
  });

  it('a payload just under the output budget still reaches the schema', async () => {
    const name = 'A'.repeat(MAX_LAYOUT_JSON_BYTES - 200);
    const result = await readShareHash(v2Hash(JSON.stringify({ ...makeLayout(), name })));
    // Inflated in full, then repaired by the schema's name cap.
    expect(result.ok && result.layout.name).toBe('A'.repeat(MAX_NAME_LENGTH));
  });

  it('reads a normal link as before', async () => {
    const layout = makeLargeLayout();
    const { url } = await encodeShareUrl(layout, ORIGIN);
    expect(await readShareHash(hashOf(url))).toEqual({ ok: true, layout: roundLayoutForShare(layout) });
    expect(await readShareHash(`${PREFIX}2.@@@`)).toEqual({ ok: false, reason: 'unreadable' });
    // A payload version past this build's: a newer app made it (#607).
    expect(await readShareHash(`${PREFIX}3.AAAA`)).toEqual({ ok: false, reason: 'newer-version' });
    expect(await readShareHash(`${PREFIX}12.AAAA`)).toEqual({ ok: false, reason: 'newer-version' });
    expect(await readShareHash(`${PREFIX}1.AAAA`)).toEqual({ ok: false, reason: 'unreadable' });
    expect(await readShareHash('#other')).toEqual({ ok: false, reason: 'unreadable' });
  });
});

describe('share encode rounds positions and rotations (#192)', () => {
  /** Free-drag floats: every coordinate carries the full 17 digits. */
  function makeDraggedLayout(): RoomLayout {
    const items = Array.from({ length: 60 }, (_, i) =>
      makeItem({
        id: `d${i}`,
        width: 0.9,
        depth: 0.6,
        position: { x: -3.5 + (i % 8) + Math.sin(i) * 0.123456789, z: -3.5 + Math.floor(i / 8) + Math.cos(i) * 0.0987654321 },
        rotation: i % 3 === 0 ? Math.PI / 2 : i % 3 === 1 ? 0.26179938779914946 : -Math.PI,
      })
    );
    return makeLayout({ width: 8, height: 8, floors: [makeFloor({ items })] });
  }

  it('rounds positions to millimetres and off-axis rotations to 3 decimals, within half a unit', async () => {
    const layout = makeDraggedLayout();
    const { url } = await encodeShareUrl(layout, ORIGIN);
    const decoded = await decodeShareUrl(hashOf(url));
    const before = layout.floors[0]!.items;
    const after = decoded!.floors[0]!.items;
    expect(after).toHaveLength(before.length);
    after.forEach((item, i) => {
      const source = before[i]!;
      expect(Math.abs(item.position!.x - source.position!.x)).toBeLessThanOrEqual(0.0005);
      expect(Math.abs(item.position!.z - source.position!.z)).toBeLessThanOrEqual(0.0005);
      expect(Math.abs(item.rotation! - source.rotation!)).toBeLessThanOrEqual(0.0005);
      expect(item.position!.x * 1000).toBeCloseTo(Math.round(item.position!.x * 1000), 9);
    });
    expect(after[1]!.rotation).toBe(0.262);
  });

  it('keeps exact quarter turns exact', async () => {
    const layout = makeDraggedLayout();
    const decoded = await decodeShareUrl(hashOf((await encodeShareUrl(layout, ORIGIN)).url));
    expect(decoded!.floors[0]!.items[0]!.rotation).toBe(Math.PI / 2);
    expect(decoded!.floors[0]!.items[2]!.rotation).toBe(-Math.PI);
  });

  it('never touches the layout it encodes', async () => {
    const layout = makeDraggedLayout();
    const snapshot = structuredClone(layout);
    await encodeShareUrl(layout, ORIGIN);
    expect(layout).toEqual(snapshot);
  });

  it('a rounded link decodes to itself: encoding again changes nothing', async () => {
    const layout = makeDraggedLayout();
    const first = await decodeShareUrl(hashOf((await encodeShareUrl(layout, ORIGIN)).url));
    const second = await decodeShareUrl(hashOf((await encodeShareUrl(first!, ORIGIN)).url));
    expect(second).toEqual(first);
  });

  it('abutting rotated items stay clear of each other and of the walls', async () => {
    // Free-dragged anchor, a neighbour snapped flush to it, both quarter-turned
    // and the anchor flush against the east wall.
    const anchorX = 4 - 0.3;
    const z = 1.234567890123;
    const items = [
      makeItem({ id: 'a', width: 1.2, depth: 0.6, position: { x: anchorX, z }, rotation: Math.PI / 2 }),
      makeItem({ id: 'b', width: 1.2, depth: 0.6, position: { x: anchorX - 0.6, z }, rotation: -Math.PI / 2 }),
      makeItem({ id: 'c', width: 0.8, depth: 0.5, position: { x: -1.123456789, z: 0.2 }, rotation: 0 }),
      makeItem({ id: 'd', width: 0.8, depth: 0.5, position: { x: -1.123456789 + 0.8, z: 0.2 }, rotation: 0 }),
    ];
    const layout = makeLayout({ width: 8, height: 8, floors: [makeFloor({ items })] });
    const decoded = await decodeShareUrl(hashOf((await encodeShareUrl(layout, ORIGIN)).url));
    const status = (list: readonly (typeof items)[number][]) =>
      list.map((item) => [hasCollisions(item, list, 8, 8), itemInBounds(item, 8, 8)]);
    expect(status(decoded!.floors[0]!.items)).toEqual(status(items));
  });
});

describe('share rounding never changes what the editor computes (#192)', () => {
  /** Per item, in floor order: in bounds, and the editor's collision tint (furniture-scene). */
  function statuses(layout: RoomLayout): string[] {
    return planFurniture(layout, true, 0).map((floor) =>
      floor.items.map((item, i) => `${itemInBounds(item, layout.width, layout.height) ? 'in' : 'out'}/${floor.collisions[i] ? 'hit' : 'clear'}`).join(' ')
    );
  }
  const ROTATIONS = [0, Math.PI / 12, Math.PI / 6, Math.PI / 4, Math.PI / 3, (5 * Math.PI) / 12, Math.PI / 2, Math.PI, -Math.PI / 2];
  const ROOMS = [[8, 6], [7.5, 5.5], [10, 8], [6.3, 4.7], [12, 9]] as const;
  const indoorCatalog = FURNITURE_CATALOG.filter((entry) => entry.category !== 'outdoor');

  it('a wall-flush item keeps its state: sweep over catalog × room sizes × rotations × corners', () => {
    let flush = 0;
    let changed = 0;
    let rounded = 0;
    for (const [w, d] of ROOMS) {
      for (const entry of indoorCatalog) {
        for (const rotation of ROTATIONS) {
          for (const [sx, sz] of [[1, 1], [-1, -1], [1, -1]] as const) {
            const base = makeItem({ id: 'x', type: entry.type, width: entry.width, depth: entry.depth, height: entry.height, rotation });
            const position = snapToWall({ position: { x: sx * (w / 2 - 0.1), z: sz * (d / 2 - 0.1) }, item: base, roomWidth: w, roomDepth: d });
            const item = { ...base, position };
            if (!itemInBounds(item, w, d)) continue;
            flush++;
            const layout = makeLayout({ width: w, height: d, floors: [makeFloor({ items: [item] })] });
            const shared = roundLayoutForShare(layout);
            if (statuses(shared)[0] !== statuses(layout)[0]) changed++;
            if (shared.floors[0]!.items[0] !== item) rounded++;
          }
        }
      }
    }
    expect(flush).toBeGreaterThan(2000);
    expect(changed).toBe(0);
    // Most items still shrink; only the ones the nearest millimetre would push out stay exact.
    expect(rounded).toBeGreaterThan(flush / 3);
  });

  it('abutting pairs at any turn keep their state', () => {
    let changed = 0;
    for (const rotation of ROTATIONS) {
      for (const entry of indoorCatalog.slice(0, 30)) {
        const a = makeItem({ id: 'a', type: entry.type, width: entry.width, depth: entry.depth, height: entry.height, rotation, position: { x: -0.123456789, z: 0.987654321 } });
        // b shares a's +width edge exactly, along the rotated axis.
        const b = { ...a, id: 'b', position: { x: a.position!.x + Math.cos(rotation) * entry.width, z: a.position!.z - Math.sin(rotation) * entry.width } };
        // c snapped flush to a the way the editor's neighbour snap does it.
        const cBase = { ...a, id: 'c', rotation: 0 };
        const c = { ...cBase, position: snapToNeighbors({ position: { x: a.position!.x, z: a.position!.z + entry.depth + 0.05 }, movingItem: cBase, otherItems: [a] }) };
        const layout = makeLayout({ width: 12, height: 12, floors: [makeFloor({ items: [a, b, c] })] });
        if (statuses(roundLayoutForShare(layout))[0] !== statuses(layout)[0]) changed++;
      }
    }
    expect(changed).toBe(0);
  });

  it('a 15°-turned chair flush to the east wall stays clear through a share link', async () => {
    const base = makeItem({ id: 'chair', width: 0.5, depth: 0.5, rotation: Math.PI / 12 });
    const item = { ...base, position: snapToWall({ position: { x: 3.8, z: 0 }, item: base, roomWidth: 8, roomDepth: 6 }) };
    expect(hasCollisions(item, [item], 8, 6)).toBe(false);
    const layout = makeLayout({ width: 8, height: 6, floors: [makeFloor({ items: [item] })] });
    const decoded = (await decodeShareUrl(hashOf((await encodeShareUrl(layout, ORIGIN)).url)))!.floors[0]!.items[0]!;
    expect(hasCollisions(decoded, [decoded], 8, 6)).toBe(false);
  });

  it('an unturned toilet flush to the east wall of a 6.3 m room stays clear', async () => {
    const base = makeItem({ id: 't', width: 0.4, depth: 0.7, rotation: 0 });
    const item = { ...base, position: snapToWall({ position: { x: 3.0, z: 0 }, item: base, roomWidth: 6.3, roomDepth: 4.7 }) };
    expect(hasCollisions(item, [item], 6.3, 4.7)).toBe(false);
    const layout = makeLayout({ width: 6.3, height: 4.7, floors: [makeFloor({ items: [item] })] });
    const decoded = (await decodeShareUrl(hashOf((await encodeShareUrl(layout, ORIGIN)).url)))!.floors[0]!.items[0]!;
    expect(hasCollisions(decoded, [decoded], 6.3, 4.7)).toBe(false);
  });

  it('a dense free-dragged storey keeps every item\'s state', () => {
    let seed = 42;
    const rnd = (): number => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const items: FurnitureItem[] = [];
    for (let i = 0; i < 90; i++) {
      const entry = indoorCatalog[i % indoorCatalog.length]!;
      const moving = makeItem({ id: `n${i}`, type: entry.type, width: entry.width, depth: entry.depth, height: entry.height, rotation: ROTATIONS[i % ROTATIONS.length]! });
      const free = { x: (rnd() - 0.5) * 9, z: (rnd() - 0.5) * 9 };
      const near = snapToNeighbors({ position: free, movingItem: moving, otherItems: items });
      items.push({ ...moving, position: snapToWall({ position: near, item: moving, roomWidth: 10, roomDepth: 10 }) });
    }
    const layout = makeLayout({ width: 10, height: 10, floors: [makeFloor({ items })] });
    expect(statuses(roundLayoutForShare(layout))).toEqual(statuses(layout));
  });

  it('stairs stay exact: they cut the keep-out of the storey above', () => {
    const stairs = makeItem({ id: 's', type: 'stairs', width: 1, depth: 3, position: { x: 1.23456789, z: -0.98765432 }, rotation: 0.3 });
    const layout = makeLayout({ floors: [makeFloor({ items: [stairs] }), makeFloor({ id: 'u' })] });
    expect(roundLayoutForShare(layout).floors[0]!.items[0]).toBe(stairs);
  });
});
