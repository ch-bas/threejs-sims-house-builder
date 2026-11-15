import { describe, expect, it, vi } from 'vitest';
import { makeFloor, makeItem, makeLayout } from './__testfixtures__/fixtures';
import {
  KEPT_LABEL_MAX_LENGTH,
  VERSION_HISTORY_LIMIT,
  VERSION_HISTORY_META_KEY,
  VERSION_HISTORY_MIN_INTERVAL_MS,
  VERSION_HISTORY_STORAGE_KEY,
  VERSION_KEPT_LIMIT,
  VERSION_KEPT_MAX_CHARS,
  VERSION_KEPT_STORAGE_KEY,
  clearSnapshots,
  evictOldestSnapshot,
  getKeptVersion,
  getSnapshot,
  keepSnapshot,
  listKeptVersions,
  listSnapshots,
  readKeptEntriesForBackup,
  recordSnapshot,
  renameKeptVersion,
  setItemEvictingSnapshots,
  importKeptVersions,
  importSnapshots,
  keepLayout,
  subscribeSnapshots,
  unkeepOutcome,
  unkeepVersion,
} from './version-history';
import type { RoomLayout } from './types';
import type { VersionHistoryStore } from './version-history';

function makeQuotaStore(capacity = Infinity) {
  const data = new Map<string, string>();
  const store = {
    data,
    capacity,
    failWrites: false,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      if (store.failWrites) throw new DOMException('full', 'QuotaExceededError');
      let used = key.length + value.length;
      for (const [otherKey, otherValue] of data) if (otherKey !== key) used += otherKey.length + otherValue.length;
      if (used > store.capacity) throw new DOMException('full', 'QuotaExceededError');
      data.set(key, value);
    },
    removeItem: (key: string) => {
      data.delete(key);
    },
  };
  return store;
}

function house(count: number, overrides: Partial<RoomLayout> = {}): RoomLayout {
  return makeLayout({
    id: 'house-a',
    name: 'Cottage',
    floors: [makeFloor({ items: Array.from({ length: count }, (_, i) => makeItem({ id: `item-${i}` })) })],
    ...overrides,
  });
}

/** Records `count` distinct points of house A, five minutes apart; returns the clock. */
function fillRing(storage: VersionHistoryStore, count: number, start = 1_000_000) {
  let time = start;
  const now = () => time;
  for (let i = 0; i < count; i++) {
    recordSnapshot(house(i + 1), { storage, now });
    time += VERSION_HISTORY_MIN_INTERVAL_MS;
  }
  return { now, advance: (ms: number) => (time += ms) };
}

describe('kept versions (#935): pin, list, rename, unpin', () => {
  it('moves a restore point to the kept list, named after the house', () => {
    const storage = makeQuotaStore();
    const clock = fillRing(storage, 3);
    const [newest] = listSnapshots({ storage });
    expect(keepSnapshot(newest!.id, { storage, now: clock.now })).toEqual({ ok: true, id: newest!.id });
    expect(listSnapshots({ storage }).map((s) => s.id)).not.toContain(newest!.id);
    const kept = listKeptVersions({ storage });
    expect(kept).toHaveLength(1);
    expect(kept[0]).toMatchObject({ id: newest!.id, label: 'Cottage', itemCount: 3, name: 'Cottage' });
    expect(getKeptVersion(newest!.id, { storage })?.floors[0]?.items).toHaveLength(3);
    expect(getSnapshot(newest!.id, { storage })).toBeNull();
  });

  it('lists the newest kept first and caps the list', () => {
    const storage = makeQuotaStore();
    const clock = fillRing(storage, VERSION_KEPT_LIMIT + 1);
    const ids = listSnapshots({ storage }).map((s) => s.id);
    for (const id of ids.slice(0, VERSION_KEPT_LIMIT)) expect(keepSnapshot(id, { storage, now: clock.now }).ok).toBe(true);
    expect(keepSnapshot(ids[VERSION_KEPT_LIMIT]!, { storage, now: clock.now })).toEqual({ ok: false, reason: 'full' });
    expect(listKeptVersions({ storage }).map((k) => k.id)).toEqual(ids.slice(0, VERSION_KEPT_LIMIT).reverse());
    expect(listSnapshots({ storage }).map((s) => s.id)).toEqual([ids[VERSION_KEPT_LIMIT]]);
  });

  it('refuses a version that would push the list over its size cap', () => {
    const storage = makeQuotaStore();
    const big = house(1, { name: 'x'.repeat(100 * 1024) });
    recordSnapshot(big, { storage, now: () => 1 });
    const [first] = listSnapshots({ storage });
    expect(keepSnapshot(first!.id, { storage }).ok).toBe(true);
    recordSnapshot({ ...big, id: 'house-b' }, { storage, now: () => 2 });
    recordSnapshot({ ...big, id: 'house-c' }, { storage, now: () => 3 });
    const ids = listSnapshots({ storage }).map((s) => s.id);
    expect(keepSnapshot(ids[0]!, { storage }).ok).toBe(true);
    expect(keepSnapshot(ids[1]!, { storage })).toEqual({ ok: false, reason: 'too-big' });
    expect(storage.data.get(VERSION_KEPT_STORAGE_KEY)!.length).toBeLessThanOrEqual(VERSION_KEPT_MAX_CHARS);
  });

  it('says missing for a point that is gone, and keeps nothing', () => {
    const storage = makeQuotaStore();
    expect(keepSnapshot('rp-nope', { storage })).toEqual({ ok: false, reason: 'missing' });
    expect(storage.data.has(VERSION_KEPT_STORAGE_KEY)).toBe(false);
  });

  it('loses nothing when storage is blocked', () => {
    const storage = makeQuotaStore();
    fillRing(storage, 2);
    const ids = listSnapshots({ storage }).map((s) => s.id);
    const write = storage.setItem;
    storage.setItem = () => {
      throw new DOMException('blocked', 'SecurityError');
    };
    expect(keepSnapshot(ids[0]!, { storage })).toEqual({ ok: false, reason: 'storage' });
    storage.setItem = write;
    expect(listSnapshots({ storage }).map((s) => s.id)).toEqual(ids);
    expect(listKeptVersions({ storage })).toEqual([]);
  });

  it('a keep that fails for room puts the ring back byte for byte', () => {
    const storage = makeQuotaStore();
    fillRing(storage, 3);
    const [newest] = listSnapshots({ storage });
    const before = new Map(storage.data);
    // The kept copy never fits.
    const write = storage.setItem;
    storage.setItem = (key, value) => {
      if (key === VERSION_KEPT_STORAGE_KEY) throw new DOMException('full', 'QuotaExceededError');
      write(key, value);
    };
    expect(keepSnapshot(newest!.id, { storage })).toEqual({ ok: false, reason: 'storage' });
    expect(storage.data).toEqual(before);
  });

  it('renames, trimming and capping the name; an empty name is refused', () => {
    const storage = makeQuotaStore();
    fillRing(storage, 1);
    const [point] = listSnapshots({ storage });
    keepSnapshot(point!.id, { storage });
    expect(renameKeptVersion(point!.id, '  The   one I liked ', { storage })).toBe(true);
    expect(listKeptVersions({ storage })[0]!.label).toBe('The one I liked');
    expect(renameKeptVersion(point!.id, '   ', { storage })).toBe(false);
    expect(renameKeptVersion(point!.id, 'y'.repeat(500), { storage })).toBe(true);
    expect(listKeptVersions({ storage })[0]!.label).toHaveLength(KEPT_LABEL_MAX_LENGTH);
    expect(renameKeptVersion('rp-gone', 'x', { storage })).toBe(false);
  });

  it('unpinning puts the version back among the restore points in time order', () => {
    const storage = makeQuotaStore();
    fillRing(storage, 3);
    const ids = listSnapshots({ storage }).map((s) => s.id);
    keepSnapshot(ids[1]!, { storage });
    expect(unkeepOutcome(ids[1]!, { storage })).toEqual({ outcome: 'history', clears: [] });
    expect(unkeepVersion(ids[1]!, { storage })).toEqual({ removed: true, outcome: 'history', clears: [] });
    expect(listSnapshots({ storage }).map((s) => s.id)).toEqual(ids);
    expect(listKeptVersions({ storage })).toEqual([]);
    expect(storage.data.has(VERSION_KEPT_STORAGE_KEY)).toBe(false);
    expect(unkeepOutcome(ids[1]!, { storage })).toBeNull();
    expect(unkeepVersion(ids[1]!, { storage })).toEqual({ removed: false, reason: 'missing' });
  });

  it('an unpinned version older than a full ring is cleared at once; no newer point gives way', () => {
    const storage = makeQuotaStore();
    const clock = fillRing(storage, 1);
    const [old] = listSnapshots({ storage });
    keepSnapshot(old!.id, { storage });
    clock.advance(VERSION_HISTORY_MIN_INTERVAL_MS);
    for (let i = 0; i < VERSION_HISTORY_LIMIT; i++) {
      recordSnapshot(house(50 + i), { storage, now: clock.now });
      clock.advance(VERSION_HISTORY_MIN_INTERVAL_MS);
    }
    const ring = listSnapshots({ storage }).map((s) => s.id);
    expect(unkeepOutcome(old!.id, { storage })).toEqual({ outcome: 'deleted', clears: [] });
    expect(unkeepVersion(old!.id, { storage })).toEqual({ removed: true, outcome: 'deleted', clears: [] });
    expect(listSnapshots({ storage }).map((s) => s.id)).toEqual(ring);
  });

  it('tells History listeners about every change', () => {
    const storage = makeQuotaStore();
    fillRing(storage, 1);
    const [point] = listSnapshots({ storage });
    const listener = vi.fn();
    const unsubscribe = subscribeSnapshots(listener);
    keepSnapshot(point!.id, { storage });
    renameKeptVersion(point!.id, 'Mine', { storage });
    unkeepVersion(point!.id, { storage });
    unsubscribe();
    expect(listener).toHaveBeenCalledTimes(3);
  });
});

describe('kept versions are never evicted (#935)', () => {
  it('the ring filling up never touches a kept version', () => {
    const storage = makeQuotaStore();
    const clock = fillRing(storage, 1);
    const [point] = listSnapshots({ storage });
    keepSnapshot(point!.id, { storage });
    const before = storage.data.get(VERSION_KEPT_STORAGE_KEY);
    for (let i = 0; i < VERSION_HISTORY_LIMIT * 3; i++) {
      clock.advance(VERSION_HISTORY_MIN_INTERVAL_MS);
      recordSnapshot(house(100 + i, { id: `other-${i % 3}` }), { storage, now: clock.now });
    }
    expect(storage.data.get(VERSION_KEPT_STORAGE_KEY)).toBe(before);
  });

  it('eviction for a bigger save drops ring points, never kept ones', () => {
    const storage = makeQuotaStore();
    fillRing(storage, 4);
    const [newest] = listSnapshots({ storage });
    keepSnapshot(newest!.id, { storage });
    const kept = storage.data.get(VERSION_KEPT_STORAGE_KEY)!;
    while (evictOldestSnapshot({ storage }));
    expect(storage.data.has(VERSION_HISTORY_STORAGE_KEY)).toBe(false);
    expect(storage.data.get(VERSION_KEPT_STORAGE_KEY)).toBe(kept);
  });

  it('a save that cannot fit once the ring is empty fails rather than evict a kept version', () => {
    const probe = makeQuotaStore();
    fillRing(probe, 2);
    keepSnapshot(listSnapshots({ storage: probe })[0]!.id, { storage: probe });
    const used = [...probe.data].reduce((sum, [k, v]) => sum + k.length + v.length, 0);
    const storage = makeQuotaStore(used + 100);
    for (const [k, v] of probe.data) storage.data.set(k, v);
    const kept = storage.data.get(VERSION_KEPT_STORAGE_KEY);
    expect(() => setItemEvictingSnapshots(storage, 'standalone-room-organizer-layout', 'z'.repeat(used))).toThrow();
    expect(storage.data.has(VERSION_HISTORY_STORAGE_KEY)).toBe(false);
    expect(storage.data.get(VERSION_KEPT_STORAGE_KEY)).toBe(kept);
  });

  it('clearing the restore points leaves kept versions', () => {
    const storage = makeQuotaStore();
    fillRing(storage, 2);
    keepSnapshot(listSnapshots({ storage })[0]!.id, { storage });
    clearSnapshots({ storage });
    expect(listKeptVersions({ storage })).toHaveLength(1);
  });

  it('keeping one moves the ring copy out first, so no other point gives way for it', () => {
    const probe = makeQuotaStore();
    fillRing(probe, 3);
    const used = [...probe.data].reduce((sum, [k, v]) => sum + k.length + v.length, 0);
    const storage = makeQuotaStore(used + 200);
    for (const [k, v] of probe.data) storage.data.set(k, v);
    const [newest] = listSnapshots({ storage });
    expect(keepSnapshot(newest!.id, { storage }).ok).toBe(true);
    expect(listKeptVersions({ storage }).map((k) => k.id)).toEqual([newest!.id]);
    expect(listSnapshots({ storage }).length).toBe(2);
  });
});

describe('kept versions on read', () => {
  it('tolerates a corrupt list and names an entry without a label', () => {
    const storage = makeQuotaStore();
    storage.data.set(VERSION_KEPT_STORAGE_KEY, 'not json');
    expect(listKeptVersions({ storage })).toEqual([]);
    storage.data.set(
      VERSION_KEPT_STORAGE_KEY,
      JSON.stringify([{ id: 'k1', savedAt: 5, layout: house(2) }, { id: 'k2', savedAt: 'x', layout: {} }, null])
    );
    const kept = listKeptVersions({ storage });
    expect(kept.map((k) => [k.id, k.label, k.keptAt])).toEqual([['k1', 'Cottage', 5]]);
  });

  it('never carries the floor-plan image, and a backup gets the entries with their names', () => {
    const storage = makeQuotaStore();
    recordSnapshot(house(1, { floorPlanImage: 'data:image/png;base64,AAAA' }), { storage, now: () => 1 });
    const [point] = listSnapshots({ storage });
    keepSnapshot(point!.id, { storage, label: 'Mine' });
    expect(storage.data.get(VERSION_KEPT_STORAGE_KEY)).not.toContain('data:image');
    const [entry] = readKeptEntriesForBackup(storage) as Record<string, unknown>[];
    expect(entry).toMatchObject({ id: point!.id, savedAt: 1, label: 'Mine', keptAt: expect.any(Number) });
  });
});

describe('the open house always wins (#935 review)', () => {
  function nearlyFull() {
    const storage = makeQuotaStore();
    const clock = fillRing(storage, 3);
    for (const summary of listSnapshots({ storage })) keepSnapshot(summary.id, { storage, now: clock.now });
    recordSnapshot(house(20, { id: 'house-b' }), { storage, now: () => 50_000_000 });
    storage.data.set('standalone-room-organizer-layout', 'h'.repeat(1000));
    storage.capacity = [...storage.data].reduce((sum, [k, v]) => sum + k.length + v.length, 0) + 10;
    return storage;
  }

  it('the main save evicts the ring, then kept versions oldest kept first, and names them', () => {
    const storage = nearlyFull();
    const before = listKeptVersions({ storage }).map((kept) => kept.label);
    const ring = storage.data.get(VERSION_HISTORY_STORAGE_KEY)!.length + storage.data.get(VERSION_HISTORY_META_KEY)!.length;
    const bigger = 'h'.repeat(1000 + ring + storage.data.get(VERSION_KEPT_STORAGE_KEY)!.length / 2);
    const evicted = setItemEvictingSnapshots(storage, 'standalone-room-organizer-layout', bigger, { evictKept: true });
    expect(storage.data.get('standalone-room-organizer-layout')).toBe(bigger);
    expect(storage.data.has(VERSION_HISTORY_STORAGE_KEY)).toBe(false);
    expect(evicted.length).toBeGreaterThan(0);
    // Oldest kept first: the list newest-first, so they go from its end.
    expect(evicted).toEqual(before.slice(-evicted.length).reverse());
  });

  it('without evictKept, or when even that is not enough, every kept version stays', () => {
    const storage = nearlyFull();
    const kept = storage.data.get(VERSION_KEPT_STORAGE_KEY);
    const huge = 'h'.repeat(storage.capacity);
    expect(() => setItemEvictingSnapshots(storage, 'standalone-room-organizer-layout', huge, { evictKept: true })).toThrow();
    expect(storage.data.get(VERSION_KEPT_STORAGE_KEY)).toBe(kept);
    const fresh = nearlyFull();
    const freshKept = fresh.data.get(VERSION_KEPT_STORAGE_KEY);
    const ring = fresh.data.get(VERSION_HISTORY_STORAGE_KEY)!.length + fresh.data.get(VERSION_HISTORY_META_KEY)!.length;
    const bigger = 'h'.repeat(1000 + ring + 200);
    expect(() => setItemEvictingSnapshots(fresh, 'standalone-room-organizer-layout', bigger)).toThrow();
    expect(fresh.data.get(VERSION_KEPT_STORAGE_KEY)).toBe(freshKept);
  });

  it('a keep runs the room check with what the kept copy holds, and refuses on its word', () => {
    const storage = makeQuotaStore();
    fillRing(storage, 2);
    const [newest] = listSnapshots({ storage });
    const roomCheck = vi.fn(() => 'autosave-room' as const);
    expect(keepSnapshot(newest!.id, { storage, roomCheck })).toEqual({ ok: false, reason: 'autosave-room' });
    expect(roomCheck).toHaveBeenCalledWith(expect.any(Number));
    expect(listSnapshots({ storage }).map((s) => s.id)).toContain(newest!.id);
    expect(listKeptVersions({ storage })).toEqual([]);
  });
});

describe('kept versions: review fixes (#935)', () => {
  it('refuses to keep a point whose layout can not be read', () => {
    const storage = makeQuotaStore();
    storage.data.set(VERSION_HISTORY_STORAGE_KEY, JSON.stringify([{ id: 'rp-bad', savedAt: 5, itemCount: 2, floorCount: 1, layout: { junk: true } }]));
    expect(keepSnapshot('rp-bad', { storage })).toEqual({ ok: false, reason: 'unreadable' });
    expect(listKeptVersions({ storage })).toEqual([]);
  });

  it('strips control and bidi characters from names', () => {
    const storage = makeQuotaStore();
    fillRing(storage, 1);
    const [point] = listSnapshots({ storage });
    keepSnapshot(point!.id, { storage });
    const hidden = [0, 0x202e, 0x200b, 0x2066, 0xfeff, 0x0a].map((code) => String.fromCharCode(code));
    expect(renameKeptVersion(point!.id, `${hidden[0]}${hidden[1]}evil${hidden[2]} name${hidden[3]}${hidden[4]}${hidden[5]}x`, { storage })).toBe(true);
    expect(listKeptVersions({ storage })[0]!.label).toBe('evil name x');
    expect(renameKeptVersion(point!.id, hidden.join(''), { storage })).toBe(false);
  });

  it('a forced snapshot of a house just kept adds no copy of it to the ring', () => {
    const storage = makeQuotaStore();
    const clock = fillRing(storage, 3);
    const [newest] = listSnapshots({ storage });
    keepSnapshot(newest!.id, { storage, now: clock.now });
    expect(recordSnapshot(house(3), { storage, now: clock.now, force: true })).toBe(false);
    expect(recordSnapshot(house(3), { storage, now: () => clock.now() + 1 })).toBe(false);
    expect(recordSnapshot(house(4), { storage, now: clock.now, force: true })).toBe(true);
  });

  it('importing restore points skips the ones kept here', () => {
    const storage = makeQuotaStore();
    fillRing(storage, 3);
    const ring = JSON.parse(storage.data.get(VERSION_HISTORY_STORAGE_KEY)!) as unknown[];
    const [newest] = listSnapshots({ storage });
    keepSnapshot(newest!.id, { storage });
    expect(importSnapshots(ring, { storage })).toEqual({ added: 0, skipped: 0 });
    expect(listSnapshots({ storage }).map((s) => s.id)).not.toContain(newest!.id);
  });

  it('a keep made in between (another tab) is merged, not written over', () => {
    const storage = makeQuotaStore();
    fillRing(storage, 3);
    const [x, y] = listSnapshots({ storage });
    const write = storage.setItem;
    // The other tab keeps y while this one is between reading the kept
    // list and writing it: at this keep's first write.
    storage.setItem = (key, value) => {
      storage.setItem = write;
      expect(keepSnapshot(y!.id, { storage }).ok).toBe(true);
      write(key, value);
    };
    expect(keepSnapshot(x!.id, { storage }).ok).toBe(true);
    expect(listKeptVersions({ storage }).map((k) => k.id).sort()).toEqual([x!.id, y!.id].sort());
    expect(listSnapshots({ storage }).map((s) => s.id)).not.toContain(y!.id);
  });

  it('unpinning shrinks the kept list first, so a tight quota never deletes the version', () => {
    const storage = makeQuotaStore();
    const clock = fillRing(storage, 3);
    const [newest] = listSnapshots({ storage });
    keepSnapshot(newest!.id, { storage, now: clock.now });
    storage.capacity = [...storage.data].reduce((sum, [k, v]) => sum + k.length + v.length, 0) + 100;
    expect(unkeepVersion(newest!.id, { storage })).toEqual({ removed: true, outcome: 'history', clears: [] });
    expect(listSnapshots({ storage }).map((s) => s.id)).toContain(newest!.id);
  });

  it('when the ring can not be written, an unpinned version stays kept', () => {
    const storage = makeQuotaStore();
    fillRing(storage, 2);
    const [newest] = listSnapshots({ storage });
    keepSnapshot(newest!.id, { storage });
    const write = storage.setItem;
    storage.setItem = (key, value) => {
      if (key === VERSION_HISTORY_STORAGE_KEY) throw new DOMException('full', 'QuotaExceededError');
      write(key, value);
    };
    expect(unkeepVersion(newest!.id, { storage })).toEqual({ removed: false, reason: 'no-room' });
    expect(listKeptVersions({ storage }).map((k) => k.id)).toEqual([newest!.id]);
  });

  it('keeps the house on screen; a second time it is kept already', () => {
    const storage = makeQuotaStore();
    const clock = fillRing(storage, 2);
    const shown = house(7, { floorPlanImage: 'data:image/png;base64,AAAA' });
    const result = keepLayout(shown, { storage, now: clock.now });
    expect(result.ok).toBe(true);
    const [kept] = listKeptVersions({ storage });
    expect(kept).toMatchObject({ itemCount: 7, label: 'Cottage' });
    expect(storage.data.get(VERSION_KEPT_STORAGE_KEY)).not.toContain('data:image');
    expect(keepLayout(shown, { storage, now: clock.now })).toEqual({ ok: false, reason: 'already' });
  });

  it('imports kept versions add-only, under the cap, skipping what is here', () => {
    const source = makeQuotaStore();
    const clock = fillRing(source, 6);
    for (const summary of listSnapshots({ storage: source }).slice(0, 5)) keepSnapshot(summary.id, { storage: source, now: clock.now });
    const part = readKeptEntriesForBackup(source);
    const target = makeQuotaStore();
    fillRing(target, 1, 90_000_000);
    const [own] = listSnapshots({ storage: target });
    keepSnapshot(own!.id, { storage: target });
    const result = importKeptVersions(part, { storage: target });
    expect(result).toEqual({ added: 4, skipped: 1 });
    expect(listKeptVersions({ storage: target }).map((k) => k.id)).toContain(own!.id);
    expect(importKeptVersions(part, { storage: target })).toEqual({ added: 0, skipped: 1 });
  });

  it('kept entries among imported restore points go back as kept, so a full ring never costs one', () => {
    const source = makeQuotaStore();
    const clock = fillRing(source, 5);
    for (const summary of listSnapshots({ storage: source })) keepSnapshot(summary.id, { storage: source, now: clock.now });
    for (let i = 0; i < VERSION_HISTORY_LIMIT; i++) {
      recordSnapshot(house(i + 1, { id: 'house-b' }), { storage: source, now: () => 50_000_000 + i * VERSION_HISTORY_MIN_INTERVAL_MS });
    }
    const keptIds = listKeptVersions({ storage: source }).map((k) => k.id);
    const mixed = [...(JSON.parse(source.data.get(VERSION_HISTORY_STORAGE_KEY)!) as unknown[]), ...readKeptEntriesForBackup(source)];
    const target = makeQuotaStore();
    expect(importSnapshots(mixed, { storage: target, now: () => 99_000_000 })).toEqual({ added: 15, skipped: 0 });
    expect(listKeptVersions({ storage: target }).map((k) => k.id).sort()).toEqual([...keptIds].sort());
    expect(listSnapshots({ storage: target })).toHaveLength(VERSION_HISTORY_LIMIT);
  });

});

describe('Keep this version and put-backs (#935 verification)', () => {
  /** A full ring of house A, ten points five minutes apart. */
  function fullRing() {
    const storage = makeQuotaStore();
    const clock = fillRing(storage, VERSION_HISTORY_LIMIT);
    return { storage, clock };
  }
  const shown = house(42, { id: 'house-shown', name: 'Shown' });

  it('refused because the list is full: storage stays byte for byte', () => {
    const { storage, clock } = fullRing();
    for (let i = 0; i < VERSION_KEPT_LIMIT; i++) {
      expect(keepLayout(house(100 + i, { id: `k${i}` }), { storage, now: clock.now }).ok).toBe(true);
    }
    const before = new Map(storage.data);
    expect(keepLayout(shown, { storage, now: clock.now })).toEqual({ ok: false, reason: 'full' });
    expect(storage.data).toEqual(before);
  });

  it('refused for autosave room: storage stays byte for byte', () => {
    const { storage, clock } = fullRing();
    const before = new Map(storage.data);
    expect(keepLayout(shown, { storage, now: clock.now, roomCheck: () => 'autosave-room' })).toEqual({
      ok: false,
      reason: 'autosave-room',
    });
    expect(storage.data).toEqual(before);
  });

  it('kept with a full ring: the ring keeps all ten points', () => {
    const { storage, clock } = fullRing();
    const ring = storage.data.get(VERSION_HISTORY_STORAGE_KEY);
    expect(keepLayout(shown, { storage, now: clock.now }).ok).toBe(true);
    expect(storage.data.get(VERSION_HISTORY_STORAGE_KEY)).toBe(ring);
    expect(listSnapshots({ storage })).toHaveLength(VERSION_HISTORY_LIMIT);
    expect(listKeptVersions({ storage }).map((k) => k.itemCount)).toEqual([42]);
  });

  it('another writer taking room between the two writes of a keep costs no restore point', () => {
    const storage = makeQuotaStore();
    fillRing(storage, 4);
    const ids = listSnapshots({ storage }).map((s) => s.id);
    const before = new Map(storage.data);
    storage.capacity = [...storage.data].reduce((sum, [k, v]) => sum + k.length + v.length, 0) + 50;
    const write = storage.setItem;
    storage.setItem = (key, value) => {
      // Right after the ring copy comes out, another tab takes 40 characters.
      if (key === VERSION_KEPT_STORAGE_KEY && !storage.data.has('other-tab')) write('other-tab', 'o'.repeat(30));
      write(key, value);
    };
    expect(keepSnapshot(ids[0]!, { storage })).toEqual({ ok: false, reason: 'storage' });
    storage.setItem = write;
    expect(listSnapshots({ storage }).map((s) => s.id)).toEqual(ids);
    expect(storage.data.get(VERSION_HISTORY_STORAGE_KEY)).toBe(before.get(VERSION_HISTORY_STORAGE_KEY));
  });

  it('another writer taking room before an unpin reaches the ring: every restore point survives', () => {
    const storage = makeQuotaStore();
    fillRing(storage, 4);
    const [newest] = listSnapshots({ storage });
    keepSnapshot(newest!.id, { storage });
    const ring = storage.data.get(VERSION_HISTORY_STORAGE_KEY);
    const kept = storage.data.get(VERSION_KEPT_STORAGE_KEY);
    storage.capacity = [...storage.data].reduce((sum, [k, v]) => sum + k.length + v.length, 0) + 10;
    const write = storage.setItem;
    storage.setItem = (key, value) => {
      if (key === VERSION_HISTORY_STORAGE_KEY && !storage.data.has('other-tab')) {
        write('other-tab', 'o'.repeat(kept!.length - 5));
      }
      write(key, value);
    };
    const result = unkeepVersion(newest!.id, { storage });
    storage.setItem = write;
    // The other writer took the kept copy's room, so it can't come back
    // either: said, never silent. No restore point is evicted for it.
    expect(result).toEqual({ removed: true, lost: true, outcome: 'deleted', clears: [] });
    expect(storage.data.get(VERSION_HISTORY_STORAGE_KEY)).toBe(ring);
  });

  it('an unpin the ring has no room for stays kept, bytes and all', () => {
    const storage = makeQuotaStore();
    fillRing(storage, 4);
    const [newest] = listSnapshots({ storage });
    keepSnapshot(newest!.id, { storage });
    const before = new Map(storage.data);
    const write = storage.setItem;
    storage.setItem = (key, value) => {
      if (key === VERSION_HISTORY_STORAGE_KEY) throw new DOMException('full', 'QuotaExceededError');
      write(key, value);
    };
    expect(unkeepVersion(newest!.id, { storage })).toEqual({ removed: false, reason: 'no-room' });
    storage.setItem = write;
    expect(storage.data).toEqual(before);
  });

  it('unpinning into a full ring names the point that gives way, before and after', () => {
    const storage = makeQuotaStore();
    let time = 1_000_000;
    const at = () => time;
    for (let i = 0; i < VERSION_HISTORY_LIMIT; i++, time += VERSION_HISTORY_MIN_INTERVAL_MS) {
      recordSnapshot(house(60 + i, { id: 'house-b' }), { storage, now: at });
    }
    recordSnapshot(house(1), { storage, now: at });
    const [newest] = listSnapshots({ storage });
    keepSnapshot(newest!.id, { storage, now: at });
    time += VERSION_HISTORY_MIN_INTERVAL_MS;
    recordSnapshot(house(99, { id: 'house-b' }), { storage, now: at });
    expect(listSnapshots({ storage })).toHaveLength(VERSION_HISTORY_LIMIT);
    const oldest = listSnapshots({ storage }).at(-1)!;
    const plan = unkeepOutcome(newest!.id, { storage });
    expect(plan).toEqual({ outcome: 'history', clears: [oldest.savedAt] });
    expect(unkeepVersion(newest!.id, { storage })).toEqual({ removed: true, ...plan });
    expect(listSnapshots({ storage }).map((s) => s.id)).not.toContain(oldest.id);
  });

  it('a refused keep on storage full to the byte, with no sidecar yet, leaves storage byte for byte', () => {
    const storage = makeQuotaStore();
    const now = 50_000_000;
    const ring = [0, 1, 2, 3, 4].map((i) => ({
      id: `rp-s-${i}`,
      savedAt: now - (20 - i) * 3_600_000,
      layoutId: 'house-a',
      name: 'Cottage',
      hadFloorPlan: false,
      itemCount: 1,
      floorCount: 1,
      layout: { ...house(1), pad: 'y'.repeat(2_000) + i },
    }));
    storage.data.set(VERSION_HISTORY_STORAGE_KEY, JSON.stringify(ring));
    storage.data.set('standalone-room-organizer-layout', JSON.stringify(house(1)));
    storage.capacity = [...storage.data].reduce((sum, [k, v]) => sum + k.length + v.length, 0);
    const before = new Map(storage.data);
    expect(keepSnapshot('rp-s-0', { storage, now: () => now })).toEqual({ ok: false, reason: 'storage' });
    expect(storage.data).toEqual(before);
  });
});
