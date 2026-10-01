import { describe, expect, it, vi } from 'vitest';
import { makeItem, makeLayout, makeUnplacedItem } from './__testfixtures__/fixtures';
import {
  CUSTOM_SETS_STORAGE_KEY,
  MAX_CUSTOM_SETS,
  countUnreadableCustomSets,
  customSetToFurnitureSet,
  deleteCustomSet,
  isCustomSetKey,
  listCustomSets,
  parseCustomSet,
  parseCustomSets,
  saveCustomSet,
  subscribeCustomSets,
} from './custom-sets';
import { buildFurnitureSet } from './furniture-sets';
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

const dining = () => [
  makeItem({ id: 't', type: 'dining-table', name: 'Table', width: 1.6, depth: 0.9, color: '#112233', position: { x: 2, z: 2 }, locked: true, groupId: 'g1' }),
  makeItem({ id: 'c1', type: 'dining-chair', name: 'Chair', width: 0.5, depth: 0.5, position: { x: 1, z: 2 }, rotation: Math.PI / 2, groupId: 'g1' }),
  makeItem({ id: 'c2', type: 'dining-chair', name: 'Chair', width: 0.5, depth: 0.5, position: { x: 3, z: 2 }, rotation: -Math.PI / 2, groupId: 'g1' }),
];

describe('custom sets — save / list / delete round-trip (#302)', () => {
  it('stores full snapshots as offsets from the centroid, unlocked, newest first', () => {
    const storage = makeStore();
    let t = 1000;
    const now = () => t;
    const saved = saveCustomSet(dining(), '  Dining corner  ', { storage, now, idTag: 'a' });
    expect(saved).not.toBeNull();
    expect(saved!.name).toBe('Dining corner');
    expect(saved!.items.map((item) => item.position)).toEqual([
      { x: 0, z: 0 },
      { x: -1, z: 0 },
      { x: 1, z: 0 },
    ]);
    // Overrides survive; the lock does not; groups are kept for placement.
    expect(saved!.items[0]).toMatchObject({ color: '#112233', width: 1.6, groupId: 'g1' });
    expect('locked' in saved!.items[0]!).toBe(false);

    t = 2000;
    saveCustomSet([makeItem({ id: 'x' }), makeItem({ id: 'y', position: { x: 1, z: 1 } })], 'Later', { storage, now, idTag: 'b' });
    const listed = listCustomSets({ storage });
    expect(listed.map((set) => set.name)).toEqual(['Later', 'Dining corner']);
    // What went to storage is exactly what comes back.
    expect(parseCustomSets(JSON.parse(storage.data.get(CUSTOM_SETS_STORAGE_KEY)!))).toEqual(
      listed.slice().sort((a, b) => b.savedAt - a.savedAt)
    );

    expect(deleteCustomSet(saved!.id, { storage })).toBe(true);
    expect(deleteCustomSet(saved!.id, { storage })).toBe(false);
    expect(listCustomSets({ storage }).map((set) => set.name)).toEqual(['Later']);
  });

  it('refuses a blank name and a selection with nothing placed', () => {
    const storage = makeStore();
    expect(saveCustomSet(dining(), '   ', { storage })).toBeNull();
    expect(saveCustomSet([makeUnplacedItem()], 'Ghosts', { storage })).toBeNull();
    expect(storage.data.size).toBe(0);
  });

  it('caps the list, dropping the oldest', () => {
    const storage = makeStore();
    let t = 0;
    for (let i = 0; i <= MAX_CUSTOM_SETS; i++) {
      t += 1;
      saveCustomSet(dining(), `Set ${i}`, { storage, now: () => t, idTag: String(i) });
    }
    const listed = listCustomSets({ storage });
    expect(listed).toHaveLength(MAX_CUSTOM_SETS);
    expect(listed[0]!.name).toBe(`Set ${MAX_CUSTOM_SETS}`);
    expect(listed.some((set) => set.name === 'Set 0')).toBe(false);
  });

  it('notifies subscribers on save and delete, and stops after unsubscribe', () => {
    const storage = makeStore();
    const listener = vi.fn();
    const unsubscribe = subscribeCustomSets(listener);
    const saved = saveCustomSet(dining(), 'Dining', { storage, idTag: 'n' });
    expect(listener).toHaveBeenCalledTimes(1);
    deleteCustomSet(saved!.id, { storage });
    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
    saveCustomSet(dining(), 'Dining', { storage, idTag: 'm' });
    expect(listener).toHaveBeenCalledTimes(2);
  });
});

describe('custom sets — corrupt data (#302)', () => {
  it('parseCustomSet rejects malformed entries', () => {
    const good = { id: 's1', name: 'Dining', savedAt: 1, items: [makeItem()] };
    expect(parseCustomSet(good)).toEqual(good);
    expect(parseCustomSet(null)).toBeNull();
    expect(parseCustomSet([])).toBeNull();
    expect(parseCustomSet({ ...good, id: '' })).toBeNull();
    expect(parseCustomSet({ ...good, name: 42 })).toBeNull();
    expect(parseCustomSet({ ...good, savedAt: 'yesterday' })).toBeNull();
    expect(parseCustomSet({ ...good, items: [] })).toBeNull();
    expect(parseCustomSet({ ...good, items: [{ id: 'x' }] })).toBeNull();
    // A piece with no offset can't be placed.
    expect(parseCustomSet({ ...good, items: [makeUnplacedItem()] })).toBeNull();
    // Item-level schema applies (oversized dimension).
    expect(parseCustomSet({ ...good, items: [makeItem({ width: 1e12 })] })).toBeNull();
  });

  it('parseCustomSets drops bad entries and duplicates without losing the rest', () => {
    const good = { id: 's1', name: 'Dining', savedAt: 1, items: [makeItem()] };
    const parsed = parseCustomSets({ sets: [good, { id: 's2' }, 'junk', { ...good }, { ...good, id: 's3' }] });
    expect(parsed.map((set) => set.id)).toEqual(['s1', 's3']);
    expect(parseCustomSets({ sets: 'nope' })).toEqual([]);
    expect(parseCustomSets(undefined)).toEqual([]);
  });

  it('listCustomSets reads a corrupt blob as empty instead of throwing', () => {
    const storage = makeStore();
    storage.data.set(CUSTOM_SETS_STORAGE_KEY, '{not json');
    expect(listCustomSets({ storage })).toEqual([]);
    storage.data.set(CUSTOM_SETS_STORAGE_KEY, JSON.stringify({ sets: [{ id: 'bad' }] }));
    expect(listCustomSets({ storage })).toEqual([]);
  });
});

describe('custom sets — unreadable entries survive every rewrite (#340)', () => {
  const good = { id: 's1', name: 'Dining', savedAt: 1, items: [makeItem()] };
  const tooBig = { id: 's2', name: 'Huge', savedAt: 2, items: [makeItem({ width: 1e12 })] };

  function seeded() {
    const storage = makeStore();
    storage.data.set(
      CUSTOM_SETS_STORAGE_KEY,
      JSON.stringify({ version: 2, sets: [tooBig, good, 'junk', { ...good, name: 'Same id' }] })
    );
    return storage;
  }

  function stored(storage: ReturnType<typeof makeStore>): Record<string, unknown> {
    return JSON.parse(storage.data.get(CUSTOM_SETS_STORAGE_KEY)!) as Record<string, unknown>;
  }

  it('lists the readable sets and counts the rest, duplicates included', () => {
    const storage = seeded();
    expect(listCustomSets({ storage }).map((set) => set.id)).toEqual(['s1']);
    expect(countUnreadableCustomSets({ storage })).toBe(3);
  });

  it('keeps them verbatim (and other top-level fields) through a save and a delete', () => {
    const storage = seeded();
    const saved = saveCustomSet(dining(), 'New', { storage, now: () => 5, idTag: 'x' });
    expect(saved).not.toBeNull();
    expect(stored(storage).sets).toEqual(
      expect.arrayContaining([tooBig, 'junk', { ...good, name: 'Same id' }])
    );
    expect(stored(storage).version).toBe(2);

    expect(deleteCustomSet(saved!.id, { storage })).toBe(true);
    expect(stored(storage)).toEqual({ version: 2, sets: [good, tooBig, 'junk', { ...good, name: 'Same id' }] });
    expect(countUnreadableCustomSets({ storage })).toBe(3);

    // Deleting the first copy of an id surfaces the one it shadowed.
    expect(deleteCustomSet('s1', { storage })).toBe(true);
    expect(listCustomSets({ storage }).map((set) => set.name)).toEqual(['Same id']);
    expect(countUnreadableCustomSets({ storage })).toBe(2);
  });

  it('keeps a corrupt or wrong-shaped blob as one unreadable value', () => {
    const storage = makeStore();
    storage.data.set(CUSTOM_SETS_STORAGE_KEY, '{not json');
    expect(countUnreadableCustomSets({ storage })).toBe(1);
    saveCustomSet(dining(), 'New', { storage, idTag: 'y' });
    expect(stored(storage).sets).toEqual([expect.objectContaining({ name: 'New' }), '{not json']);

    storage.data.set(CUSTOM_SETS_STORAGE_KEY, JSON.stringify({ sets: 'nope' }));
    saveCustomSet(dining(), 'New', { storage, idTag: 'z' });
    expect(stored(storage).sets).toEqual([expect.objectContaining({ name: 'New' }), { sets: 'nope' }]);
  });

  it('never drops an unreadable value to stay under the cap', () => {
    const storage = makeStore();
    storage.data.set(CUSTOM_SETS_STORAGE_KEY, JSON.stringify({ sets: ['junk'] }));
    for (let i = 0; i <= MAX_CUSTOM_SETS; i++) {
      saveCustomSet(dining(), `Set ${i}`, { storage, now: () => i, idTag: String(i) });
    }
    expect(listCustomSets({ storage })).toHaveLength(MAX_CUSTOM_SETS);
    expect(countUnreadableCustomSets({ storage })).toBe(1);
  });

  it('counts nothing without a store', () => {
    expect(countUnreadableCustomSets({ storage: makeStore() })).toBe(0);
  });
});

describe('custom sets — quota (#302, #295)', () => {
  it('evicts restore points before giving up on a full store', () => {
    // Record a restore point in a roomy store, then replay its contents into
    // one that only has room for the set once the ring is gone.
    const roomy = makeStore();
    expect(recordSnapshot(makeLayout({ name: 'Snapshotted' }), { storage: roomy })).toBe(true);
    expect(listSnapshots({ storage: roomy })).toHaveLength(1);
    const probe = makeStore();
    saveCustomSet(dining(), 'Dining', { storage: probe, now: () => 1, idTag: 'q' });
    const setBytes = CUSTOM_SETS_STORAGE_KEY.length + probe.data.get(CUSTOM_SETS_STORAGE_KEY)!.length;
    // Room for the set alone, not for the set beside the ring.
    const tight = makeQuotaStore(setBytes + 10);
    for (const [key, value] of roomy.data) tight.data.set(key, value);

    const saved = saveCustomSet(dining(), 'Dining', { storage: tight, now: () => 1, idTag: 'q' });
    expect(saved).not.toBeNull();
    expect(listCustomSets({ storage: tight })).toHaveLength(1);
    expect(tight.data.has(VERSION_HISTORY_STORAGE_KEY)).toBe(false);
  });

  it('returns null (and keeps the old list) when nothing is left to evict', () => {
    const store = makeStore();
    saveCustomSet(dining(), 'Kept', { storage: store, idTag: 'k' });
    store.failWrites = true;
    expect(saveCustomSet(dining(), 'Lost', { storage: store, idTag: 'l' })).toBeNull();
    expect(deleteCustomSet(listCustomSets({ storage: store })[0]!.id, { storage: store })).toBe(false);
    expect(listCustomSets({ storage: store }).map((set) => set.name)).toEqual(['Kept']);
  });
});

describe('custom sets place through buildFurnitureSet (#302)', () => {
  it('converts to a snapshot-backed FurnitureSet that keeps overrides and regroups on placement', () => {
    const storage = makeStore();
    const saved = saveCustomSet(dining(), 'Dining', { storage, idTag: 'p' })!;
    const set = customSetToFurnitureSet(saved);
    expect(isCustomSetKey(set.key)).toBe(true);
    expect(set.label).toBe('Dining');
    expect(set.items[1]).toMatchObject({ type: 'dining-chair', offset: { x: -1, z: 0 }, rotation: Math.PI / 2 });

    const placed = buildFurnitureSet(set, { center: { x: 1, z: 1 }, idPrefix: 'stamp', roomWidth: 8, roomDepth: 8 });
    expect(placed).toHaveLength(3);
    expect(placed[0]).toMatchObject({ id: 'stamp-0', color: '#112233', width: 1.6, position: { x: 1, z: 1 } });
    expect(placed[1]!.position).toEqual({ x: 0, z: 1 });
    expect(placed[1]!.rotation).toBe(Math.PI / 2);
    // Pieces arrive unlocked and in a NEW group of their own.
    expect(placed.every((item) => item.locked === undefined)).toBe(true);
    expect(placed[0]!.groupId).toBe('stamp-g0');
    expect(placed.every((item) => item.groupId === 'stamp-g0')).toBe(true);
  });

  it('is refused in a room too small for its largest piece, like a built-in', () => {
    const saved = saveCustomSet(
      [makeItem({ id: 'w', width: 5, depth: 1, position: { x: 0, z: 0 } }), makeItem({ id: 'v', position: { x: 1, z: 1 } })],
      'Wide',
      { storage: makeStore(), idTag: 'w' }
    )!;
    const set = customSetToFurnitureSet(saved);
    expect(buildFurnitureSet(set, { idPrefix: 's', roomWidth: 4, roomDepth: 4 })).toEqual([]);
    expect(buildFurnitureSet(set, { idPrefix: 's', roomWidth: 8, roomDepth: 8 })).toHaveLength(2);
  });

  it('a snapshot set survives a type the catalog no longer knows', () => {
    const saved = saveCustomSet(
      [makeItem({ id: 'a', type: 'retired-thing', position: { x: 0, z: 0 } }), makeItem({ id: 'b', position: { x: 1, z: 0 } })],
      'Old',
      { storage: makeStore(), idTag: 'o' }
    )!;
    const placed = buildFurnitureSet(customSetToFurnitureSet(saved), { idPrefix: 's', roomWidth: 8, roomDepth: 8 });
    expect(placed.map((item) => item.type)).toEqual(['retired-thing', 'chair']);
  });
});
