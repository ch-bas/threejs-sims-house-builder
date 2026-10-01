import { describe, expect, it } from 'vitest';
import { makeFloor, makeItem, makeLayout } from './__testfixtures__/fixtures';
import {
  MAX_RECEIVED_LAYOUTS,
  PASTEBOARD_STORAGE_KEY,
  addReceivedLayout,
  countUnreadableReceivedLayouts,
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
      if (store.failWrites) throw new DOMException('QuotaExceededError', 'QuotaExceededError');
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
      if (used > capacity) throw new DOMException('QuotaExceededError', 'QuotaExceededError');
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
    expect(b).toEqual({ entry: a!.entry, duplicate: true, dropped: [] });
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

  it('survives a corrupt blob when adding — and keeps the blob beside the new card (#340)', () => {
    const storage = makeStore();
    storage.data.set(PASTEBOARD_STORAGE_KEY, '[[[');
    expect(addReceivedLayout(furnished(), { storage })).not.toBeNull();
    expect(listReceivedLayouts({ storage })).toHaveLength(1);
    expect(countUnreadableReceivedLayouts({ storage })).toBe(1);
    expect(JSON.parse(storage.data.get(PASTEBOARD_STORAGE_KEY)!)).toContain('[[[');
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

describe('pasteboard — unreadable entries survive every rewrite (#340)', () => {
  const corrupt = { id: 'corrupt', receivedAt: 1, layout: { ...furnished('Corrupt'), width: -1 } };
  const noTime = { id: 'no-time', layout: furnished('No time') };

  function seeded() {
    const storage = makeStore();
    storage.data.set(
      PASTEBOARD_STORAGE_KEY,
      JSON.stringify([corrupt, { id: 'good', receivedAt: 2, layout: furnished('Good') }, noTime, 'junk'])
    );
    return storage;
  }

  function stored(storage: ReturnType<typeof makeStore>): unknown[] {
    return JSON.parse(storage.data.get(PASTEBOARD_STORAGE_KEY)!) as unknown[];
  }

  it('lists the readable cards and counts the rest', () => {
    const storage = seeded();
    expect(listReceivedLayouts({ storage }).map((entry) => entry.name)).toEqual(['Good']);
    expect(countUnreadableReceivedLayouts({ storage })).toBe(3);
  });

  it('keeps them verbatim through an add (the audit repro)', () => {
    const storage = seeded();
    expect(addReceivedLayout(furnished('Another'), { storage, now: () => 3 })).not.toBeNull();
    expect(listReceivedLayouts({ storage }).map((entry) => entry.name)).toEqual(['Another', 'Good']);
    expect(stored(storage)).toEqual(expect.arrayContaining([corrupt, noTime, 'junk']));
    expect(countUnreadableReceivedLayouts({ storage })).toBe(3);
  });

  it('keeps them through a remove, even of the last readable card', () => {
    const storage = seeded();
    expect(removeReceivedLayout('good', { storage })).toBe(true);
    expect(listReceivedLayouts({ storage })).toEqual([]);
    expect(stored(storage)).toEqual([corrupt, noTime, 'junk']);
  });

  it('keeps the visible card when a hidden same-id copy exists, and removes both together', () => {
    const storage = makeStore();
    const first = { id: 'dup', receivedAt: 1, layout: furnished('First') };
    const second = { id: 'dup', receivedAt: 2, layout: furnished('Second') };
    storage.data.set(PASTEBOARD_STORAGE_KEY, JSON.stringify([first, second]));
    expect(countUnreadableReceivedLayouts({ storage })).toBe(1);
    // An unrelated write must not let the hidden copy replace the shown one.
    addReceivedLayout(furnished('Other'), { storage, now: () => 3 });
    expect(listReceivedLayouts({ storage }).map((entry) => entry.name)).toEqual(['Other', 'First']);
    // Removing the card removes the copy too — it is the same house.
    expect(removeReceivedLayout('dup', { storage })).toBe(true);
    expect(listReceivedLayouts({ storage }).map((entry) => entry.name)).toEqual(['Other']);
    expect(countUnreadableReceivedLayouts({ storage })).toBe(0);
  });

  it('keeps a well-formed blob of the wrong shape as one unreadable value', () => {
    const storage = makeStore();
    storage.data.set(PASTEBOARD_STORAGE_KEY, JSON.stringify({ entries: [1] }));
    expect(countUnreadableReceivedLayouts({ storage })).toBe(1);
    addReceivedLayout(furnished(), { storage });
    expect(stored(storage)).toContainEqual({ entries: [1] });
  });

  it('re-counts once the stored blob changes', () => {
    const storage = seeded();
    expect(countUnreadableReceivedLayouts({ storage })).toBe(3);
    storage.data.set(PASTEBOARD_STORAGE_KEY, JSON.stringify(['junk']));
    expect(countUnreadableReceivedLayouts({ storage })).toBe(1);
    storage.data.delete(PASTEBOARD_STORAGE_KEY);
    expect(countUnreadableReceivedLayouts({ storage })).toBe(0);
  });
});

describe('pasteboard cap (#355)', () => {
  it('drops the oldest card past MAX_RECEIVED_LAYOUTS and keeps the newest', () => {
    const storage = makeStore();
    for (let i = 0; i <= MAX_RECEIVED_LAYOUTS; i++) {
      expect(addReceivedLayout(furnished(`House ${i}`), { storage, now: () => 1_000 + i })).not.toBeNull();
    }
    const listed = listReceivedLayouts({ storage });
    expect(listed).toHaveLength(MAX_RECEIVED_LAYOUTS);
    expect(listed[0]!.name).toBe(`House ${MAX_RECEIVED_LAYOUTS}`);
    expect(listed.some((entry) => entry.name === 'House 0')).toBe(false);
    expect(listed.some((entry) => entry.name === 'House 1')).toBe(true);
  });

  it('drops by receivedAt, not by stored position', () => {
    const storage = makeStore();
    const cards = Array.from({ length: MAX_RECEIVED_LAYOUTS }, (_, i) => ({
      id: `c${i}`,
      // Stored newest-first, so the oldest card sits last.
      receivedAt: 100 - i,
      layout: furnished(`Card ${i}`),
    }));
    storage.data.set(PASTEBOARD_STORAGE_KEY, JSON.stringify(cards));
    addReceivedLayout(furnished('Newest'), { storage, now: () => 1_000 });
    const names = listReceivedLayouts({ storage }).map((entry) => entry.name);
    expect(names).toHaveLength(MAX_RECEIVED_LAYOUTS);
    expect(names).not.toContain(`Card ${MAX_RECEIVED_LAYOUTS - 1}`);
    expect(names).toContain('Card 0');
  });

  it('names the dropped house, and shrinks an over-full legacy board one card per add', () => {
    const storage = makeStore();
    const legacy = Array.from({ length: MAX_RECEIVED_LAYOUTS + 20 }, (_, i) => ({
      id: `c${i}`,
      receivedAt: i,
      layout: furnished(`Card ${i}`),
    }));
    storage.data.set(PASTEBOARD_STORAGE_KEY, JSON.stringify(legacy));
    const result = addReceivedLayout(furnished('Newest'), { storage, now: () => 1_000 });
    expect(result!.dropped).toEqual(['Card 0']);
    expect(listReceivedLayouts({ storage })).toHaveLength(MAX_RECEIVED_LAYOUTS + 20);
  });

  it('never drops unreadable values to make room', () => {
    const storage = makeStore();
    storage.data.set(PASTEBOARD_STORAGE_KEY, JSON.stringify(['junk']));
    for (let i = 0; i <= MAX_RECEIVED_LAYOUTS; i++) {
      addReceivedLayout(furnished(`House ${i}`), { storage, now: () => 1_000 + i });
    }
    expect(listReceivedLayouts({ storage })).toHaveLength(MAX_RECEIVED_LAYOUTS);
    expect(countUnreadableReceivedLayouts({ storage })).toBe(1);
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
