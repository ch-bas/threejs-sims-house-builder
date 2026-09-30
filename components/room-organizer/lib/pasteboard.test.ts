import { describe, expect, it } from 'vitest';
import { makeFloor, makeItem, makeLayout } from './__testfixtures__/fixtures';
import {
  PASTEBOARD_STORAGE_KEY,
  addReceivedLayout,
  listReceivedLayouts,
  removeReceivedLayout,
  shareHashFromText,
} from './pasteboard';
import { encodeShareUrl } from './share';
import { VERSION_HISTORY_STORAGE_KEY, listSnapshots, recordSnapshot } from './version-history';
import type { VersionHistoryStore } from './version-history';

/** In-memory Storage stand-in; `failWrites` simulates QuotaExceededError. */
function makeStore(): VersionHistoryStore & { data: Map<string, string>; failWrites: boolean } {
  const store = {
    data: new Map<string, string>(),
    failWrites: false,
    getItem: (key: string) => store.data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      if (store.failWrites) throw new Error('QuotaExceededError');
      store.data.set(key, value);
    },
    removeItem: (key: string) => {
      store.data.delete(key);
    },
  };
  return store;
}

/** Storage with a hard character quota across all keys, like localStorage. */
function makeQuotaStore(capacity: number): VersionHistoryStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      let used = key.length + value.length;
      for (const [otherKey, otherValue] of data) {
        if (otherKey !== key) used += otherKey.length + otherValue.length;
      }
      if (used > capacity) throw new Error('QuotaExceededError');
      data.set(key, value);
    },
    removeItem: (key: string) => {
      data.delete(key);
    },
  };
}

const furnished = (name = 'Beach House') =>
  makeLayout({
    name,
    floors: [makeFloor({ items: [makeItem({ id: 'sofa', type: 'sofa', price: 900 })] })],
  });

describe('pasteboard (#190)', () => {
  it('round-trips a received layout and lists newest first', () => {
    const storage = makeStore();
    let clock = 1_000;
    const now = () => clock;

    const first = addReceivedLayout(furnished('First'), { storage, now });
    clock = 2_000;
    const second = addReceivedLayout(furnished('Second'), { storage, now });
    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    expect(first!.duplicate).toBe(false);

    const listed = listReceivedLayouts({ storage });
    expect(listed.map((entry) => entry.name)).toEqual(['Second', 'First']);
    expect(listed[1]!.id).toBe(first!.entry.id);
    expect(listed[1]!.receivedAt).toBe(1_000);
    expect(listed[1]!.layout).toEqual(furnished('First'));
  });

  it('keeps one card for the same house pasted twice', () => {
    const storage = makeStore();
    const a = addReceivedLayout(furnished(), { storage, now: () => 1 });
    const b = addReceivedLayout(furnished(), { storage, now: () => 2 });
    expect(b).toEqual({ entry: a!.entry, duplicate: true });
    expect(listReceivedLayouts({ storage })).toHaveLength(1);
  });

  it('strips the floor-plan image before storing', () => {
    const storage = makeStore();
    const withImage = makeLayout({ floorPlanImage: `data:image/png;base64,${'A'.repeat(4096)}` });
    const result = addReceivedLayout(withImage, { storage });
    expect(result!.entry.layout.floorPlanImage).toBeUndefined();
    expect(storage.data.get(PASTEBOARD_STORAGE_KEY)).not.toContain('floorPlanImage');
    expect(listReceivedLayouts({ storage })[0]!.layout.floorPlanImage).toBeUndefined();
  });

  it('removes a card by id and clears the key once the board is empty', () => {
    const storage = makeStore();
    const a = addReceivedLayout(furnished('A'), { storage, now: () => 1 });
    const b = addReceivedLayout(furnished('B'), { storage, now: () => 2 });
    expect(removeReceivedLayout(a!.entry.id, { storage })).toBe(true);
    expect(listReceivedLayouts({ storage }).map((entry) => entry.name)).toEqual(['B']);
    expect(removeReceivedLayout('nope', { storage })).toBe(false);
    expect(removeReceivedLayout(b!.entry.id, { storage })).toBe(true);
    expect(storage.data.has(PASTEBOARD_STORAGE_KEY)).toBe(false);
  });

  it('drops corrupt entries and a corrupt blob instead of throwing', () => {
    const storage = makeStore();
    storage.data.set(PASTEBOARD_STORAGE_KEY, '{not json');
    expect(listReceivedLayouts({ storage })).toEqual([]);

    storage.data.set(PASTEBOARD_STORAGE_KEY, JSON.stringify({ entries: [] }));
    expect(listReceivedLayouts({ storage })).toEqual([]);

    storage.data.set(
      PASTEBOARD_STORAGE_KEY,
      JSON.stringify([
        null,
        'string',
        { id: 'no-layout', receivedAt: 1 },
        { id: 'bad-layout', receivedAt: 2, layout: { name: 'x', width: 'wide' } },
        { id: 'no-time', layout: furnished() },
        { id: 'ok', receivedAt: 3, layout: furnished('Kept') },
        { id: 'ok', receivedAt: 4, layout: furnished('Shadowed by duplicate id') },
        // Pre-multi-floor share links are upgraded, not dropped.
        {
          id: 'legacy',
          receivedAt: 5,
          layout: { name: 'Legacy', width: 6, height: 6, items: [], floorColor: '#fff' },
        },
      ])
    );
    const listed = listReceivedLayouts({ storage });
    expect(listed.map((entry) => entry.id)).toEqual(['legacy', 'ok']);
    expect(listed[0]!.layout.floors).toHaveLength(1);
    expect(listed[1]!.name).toBe('Kept');
  });

  it('survives a corrupt blob when adding — the new card replaces it', () => {
    const storage = makeStore();
    storage.data.set(PASTEBOARD_STORAGE_KEY, '[[[');
    expect(addReceivedLayout(furnished(), { storage })).not.toBeNull();
    expect(listReceivedLayouts({ storage })).toHaveLength(1);
  });

  it('evicts restore points before giving up on a full quota (#295)', () => {
    const storage = makeStore();
    // Fill the ring, then size the quota so the board only fits once a
    // restore point has gone.
    expect(recordSnapshot(makeLayout({ name: 'Old' }), { storage, now: () => 1 })).toBe(true);
    expect(listSnapshots({ storage })).toHaveLength(1);
    let used = 0;
    for (const [key, value] of storage.data) used += key.length + value.length;
    const scratch = makeStore();
    addReceivedLayout(furnished(), { storage: scratch, now: () => 2 });
    const boardSize = PASTEBOARD_STORAGE_KEY.length + scratch.data.get(PASTEBOARD_STORAGE_KEY)!.length;
    // Room for the board only once the ring (and its sidecar) are gone.
    const bounded = makeQuotaStore(Math.max(used, boardSize) + 8);
    for (const [key, value] of storage.data) bounded.data.set(key, value);

    const result = addReceivedLayout(furnished(), { storage: bounded, now: () => 2 });
    expect(result).not.toBeNull();
    expect(listReceivedLayouts({ storage: bounded })).toHaveLength(1);
    expect(bounded.data.has(VERSION_HISTORY_STORAGE_KEY)).toBe(false);
  });

  it('returns null, leaving the board intact, when storage keeps refusing writes', () => {
    const storage = makeStore();
    const kept = addReceivedLayout(furnished('Kept'), { storage, now: () => 1 });
    addReceivedLayout(furnished('Also kept'), { storage, now: () => 2 });
    storage.failWrites = true;
    expect(addReceivedLayout(furnished('Refused'), { storage, now: () => 3 })).toBeNull();
    // Removing one of two cards rewrites the blob; only an emptied board
    // uses removeItem, which cannot hit the quota.
    expect(removeReceivedLayout(kept!.entry.id, { storage })).toBe(false);
    expect(listReceivedLayouts({ storage }).map((entry) => entry.name)).toEqual(['Also kept', 'Kept']);
  });

  it('returns empty / null / false without storage', () => {
    const storage: VersionHistoryStore = {
      getItem: () => {
        throw new Error('SecurityError');
      },
      setItem: () => {
        throw new Error('SecurityError');
      },
    };
    expect(listReceivedLayouts({ storage })).toEqual([]);
    expect(addReceivedLayout(furnished(), { storage })).toBeNull();
    expect(removeReceivedLayout('x', { storage })).toBe(false);
  });
});

describe('shareHashFromText (#190)', () => {
  it('extracts the hash from a whole share URL, a bare hash, or padded text', async () => {
    const { url } = await encodeShareUrl(furnished(), 'https://example.test/app/');
    const hash = url.slice(url.indexOf('#'));
    expect(shareHashFromText(url)).toBe(hash);
    expect(shareHashFromText(hash)).toBe(hash);
    expect(shareHashFromText(`  ${url}\n`)).toBe(hash);
  });

  it('rejects text with no share payload', () => {
    expect(shareHashFromText('')).toBeNull();
    expect(shareHashFromText('https://example.test/')).toBeNull();
    expect(shareHashFromText('https://example.test/#section')).toBeNull();
    expect(shareHashFromText('#layout=')).toBeNull();
  });
});
