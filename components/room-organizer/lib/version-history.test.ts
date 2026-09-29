import { describe, expect, it, vi } from 'vitest';
import { makeFloor, makeItem, makeLayout } from './__testfixtures__/fixtures';
import { STORAGE_KEY } from './constants';
import { saveLayout } from './persistence';
import {
  VERSION_HISTORY_LIMIT,
  VERSION_HISTORY_MAX_CHARS,
  VERSION_HISTORY_META_KEY,
  VERSION_HISTORY_MIN_INTERVAL_MS,
  VERSION_HISTORY_STORAGE_KEY,
  clearSnapshots,
  evictOldestSnapshot,
  floorPlanFingerprint,
  getSnapshot,
  listSnapshots,
  recordSnapshot,
  setItemEvictingSnapshots,
  snapshotBelongsTo,
} from './version-history';
import type { RoomLayout } from './types';
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

/** A layout with `count` items — distinct content per count. */
function makeHouse(count: number, overrides: Partial<RoomLayout> = {}): RoomLayout {
  return makeLayout({
    floors: [
      makeFloor({
        items: Array.from({ length: count }, (_, i) => makeItem({ id: `item-${i}` })),
      }),
    ],
    ...overrides,
  });
}

/** Fixed, manually-advanced clock. */
function makeClock(start = 1_000_000): { now: () => number; advance: (ms: number) => void } {
  let time = start;
  return { now: () => time, advance: (ms) => { time += ms; } };
}

describe('version-history — cadence gating (#231)', () => {
  it('accepts the first snapshot and rejects one inside the interval', () => {
    const storage = makeStore();
    const clock = makeClock();
    expect(recordSnapshot(makeLayout(), { storage, now: clock.now })).toBe(true);
    clock.advance(VERSION_HISTORY_MIN_INTERVAL_MS - 1);
    expect(recordSnapshot(makeLayout(), { storage, now: clock.now })).toBe(false);
    expect(listSnapshots({ storage })).toHaveLength(1);
  });

  it('accepts a snapshot once the interval has elapsed', () => {
    const storage = makeStore();
    const clock = makeClock();
    recordSnapshot(makeLayout(), { storage, now: clock.now });
    clock.advance(VERSION_HISTORY_MIN_INTERVAL_MS);
    expect(recordSnapshot(makeHouse(1), { storage, now: clock.now })).toBe(true);
    expect(listSnapshots({ storage })).toHaveLength(2);
  });

  it('force bypasses the cadence gate (pagehide flush)', () => {
    const storage = makeStore();
    const clock = makeClock();
    recordSnapshot(makeLayout(), { storage, now: clock.now });
    clock.advance(10);
    expect(recordSnapshot(makeHouse(1), { storage, now: clock.now, force: true })).toBe(true);
    expect(listSnapshots({ storage })).toHaveLength(2);
  });

  it('keeps savedAt keys unique when forced within the same millisecond', () => {
    const storage = makeStore();
    const clock = makeClock();
    recordSnapshot(makeLayout(), { storage, now: clock.now });
    recordSnapshot(makeHouse(1), { storage, now: clock.now, force: true });
    const [a, b] = listSnapshots({ storage });
    expect(a!.savedAt).not.toBe(b!.savedAt);
    expect(a!.id).not.toBe(b!.id);
  });
});

describe('version-history — ring eviction', () => {
  it('evicts the oldest entry beyond the limit', () => {
    const storage = makeStore();
    const clock = makeClock();
    for (let i = 0; i < VERSION_HISTORY_LIMIT + 2; i++) {
      recordSnapshot(makeLayout({ name: `Rev ${i}` }), { storage, now: clock.now });
      clock.advance(VERSION_HISTORY_MIN_INTERVAL_MS);
    }
    const summaries = listSnapshots({ storage });
    expect(summaries).toHaveLength(VERSION_HISTORY_LIMIT);
    // Newest first; the two oldest revisions are gone.
    expect(getSnapshot(summaries[0]!.savedAt, { storage })?.name).toBe(
      `Rev ${VERSION_HISTORY_LIMIT + 1}`
    );
    expect(getSnapshot(summaries[summaries.length - 1]!.savedAt, { storage })?.name).toBe('Rev 2');
  });
});

describe('version-history — quota discipline', () => {
  it('evicts the oldest and retries when the write fails, then succeeds', () => {
    const storage = makeStore();
    const clock = makeClock();
    for (let i = 0; i < 4; i++) {
      recordSnapshot(makeLayout({ name: `Rev ${i}` }), { storage, now: clock.now });
      clock.advance(VERSION_HISTORY_MIN_INTERVAL_MS);
    }
    // Fail every write until only two entries remain in the candidate ring.
    let failures = 0;
    const original = storage.setItem;
    storage.setItem = (key: string, value: string) => {
      const entries = JSON.parse(value) as unknown[];
      if (entries.length > 2) {
        failures++;
        throw new Error('QuotaExceededError');
      }
      original(key, value);
    };
    expect(recordSnapshot(makeLayout({ name: 'Rev 4' }), { storage, now: clock.now })).toBe(true);
    expect(failures).toBeGreaterThan(0);
    const summaries = listSnapshots({ storage });
    expect(summaries).toHaveLength(2);
    expect(getSnapshot(summaries[0]!.savedAt, { storage })?.name).toBe('Rev 4');
  });

  it('gives up silently when storage rejects every write', () => {
    const storage = makeStore();
    storage.failWrites = true;
    expect(recordSnapshot(makeLayout(), { storage })).toBe(false);
    storage.failWrites = false;
    expect(listSnapshots({ storage })).toHaveLength(0);
  });
});

describe('version-history — corrupt-entry tolerance', () => {
  it('returns an empty ring for a non-JSON blob', () => {
    const storage = makeStore();
    storage.data.set(VERSION_HISTORY_STORAGE_KEY, '{not json');
    expect(listSnapshots({ storage })).toHaveLength(0);
    expect(getSnapshot(123, { storage })).toBeNull();
  });

  it('returns an empty ring for a non-array blob', () => {
    const storage = makeStore();
    storage.data.set(VERSION_HISTORY_STORAGE_KEY, JSON.stringify({ savedAt: 1 }));
    expect(listSnapshots({ storage })).toHaveLength(0);
  });

  it('drops entries whose layout fails schema validation, keeping the rest', () => {
    const storage = makeStore();
    storage.data.set(
      VERSION_HISTORY_STORAGE_KEY,
      JSON.stringify([
        { savedAt: 1, layout: makeLayout({ name: 'Good' }) },
        { savedAt: 2, layout: { totally: 'bogus' } },
        { savedAt: 'not-a-number', layout: makeLayout() },
        null,
        { savedAt: 3, layout: makeLayout({ name: 'Also good' }) },
      ])
    );
    const summaries = listSnapshots({ storage });
    expect(summaries.map((summary) => summary.savedAt)).toEqual([3, 1]);
    expect(getSnapshot(1, { storage })?.name).toBe('Good');
    expect(getSnapshot(2, { storage })).toBeNull();
  });

  it('a corrupt ring does not block recording a fresh snapshot', () => {
    const storage = makeStore();
    storage.data.set(VERSION_HISTORY_STORAGE_KEY, '{not json');
    expect(recordSnapshot(makeLayout(), { storage })).toBe(true);
    expect(listSnapshots({ storage })).toHaveLength(1);
  });
});

describe('version-history — floor-plan image stripping', () => {
  it('never stores floorPlanImage; the rest of the layout round-trips', () => {
    const storage = makeStore();
    const layout = makeLayout({
      name: 'With plan',
      floorPlanImage: 'data:image/png;base64,AAAA',
      floorPlanOpacity: 0.5,
    });
    recordSnapshot(layout, { storage });
    const [summary] = listSnapshots({ storage });
    const restored = getSnapshot(summary!.savedAt, { storage });
    expect(restored).not.toBeNull();
    expect(restored?.floorPlanImage).toBeUndefined();
    expect(restored?.floorPlanOpacity).toBe(0.5);
    expect(restored?.name).toBe('With plan');
    // The caller's layout is left untouched.
    expect(layout.floorPlanImage).toBe('data:image/png;base64,AAAA');
  });
});

describe('version-history — summaries', () => {
  it('reports item and floor counts across floors, newest first', () => {
    const storage = makeStore();
    const clock = makeClock();
    recordSnapshot(
      makeLayout({
        floors: [
          makeFloor({ id: 'ground', items: [makeItem({ id: 'a' }), makeItem({ id: 'b' })] }),
          makeFloor({ id: 'first', name: 'First Floor', items: [makeItem({ id: 'c' })] }),
        ],
      }),
      { storage, now: clock.now }
    );
    clock.advance(VERSION_HISTORY_MIN_INTERVAL_MS);
    recordSnapshot(makeLayout(), { storage, now: clock.now });
    const summaries = listSnapshots({ storage });
    expect(summaries).toHaveLength(2);
    expect(summaries[0]).toMatchObject({ itemCount: 0, floorCount: 1 });
    expect(summaries[1]).toMatchObject({ itemCount: 3, floorCount: 2 });
    expect(summaries[0]!.savedAt).toBeGreaterThan(summaries[1]!.savedAt);
  });
});

describe('version-history — lowest-priority tenant (#295)', () => {
  it('saveLayout evicts restore points oldest-first until the save fits', () => {
    const clock = makeClock();
    const house = makeHouse(40, { id: 'big' });
    const saveSize = STORAGE_KEY.length + JSON.stringify(house).length;
    const filler = makeQuotaStore(Number.MAX_SAFE_INTEGER);
    for (let i = 0; i < 4; i++) {
      recordSnapshot(makeHouse(i + 41, { id: 'big' }), { storage: filler, now: clock.now });
      clock.advance(VERSION_HISTORY_MIN_INTERVAL_MS);
    }
    let ringSize = 0;
    for (const [key, value] of filler.data) ringSize += key.length + value.length;

    // Room for the ring plus half the save: the ring alone blocks the save.
    const storage = makeQuotaStore(ringSize + Math.floor(saveSize / 2));
    for (const [key, value] of filler.data) storage.setItem(key, value);
    expect(listSnapshots({ storage, now: clock.now })).toHaveLength(4);

    expect(saveLayout(house, storage)).toBe(true);
    expect(storage.getItem(STORAGE_KEY)).toBe(JSON.stringify(house));
    const left = listSnapshots({ storage, now: clock.now });
    // Only as much as needed is evicted, and the newest restore points survive.
    expect(left.map((summary) => summary.itemCount)).toEqual([44, 43, 42]);
  });

  it('saveLayout still reports failure once the ring is empty', () => {
    const storage = makeQuotaStore(600);
    expect(recordSnapshot(makeLayout(), { storage })).toBe(true);
    expect(saveLayout(makeHouse(40), storage)).toBe(false);
    expect(storage.getItem(VERSION_HISTORY_STORAGE_KEY)).toBeNull();
    expect(storage.getItem(STORAGE_KEY)).toBeNull();
  });

  it('evictOldestSnapshot drops one entry at a time and reports when empty', () => {
    const storage = makeStore();
    const clock = makeClock();
    for (let i = 0; i < 2; i++) {
      recordSnapshot(makeHouse(i), { storage, now: clock.now });
      clock.advance(VERSION_HISTORY_MIN_INTERVAL_MS);
    }
    expect(evictOldestSnapshot({ storage })).toBe(true);
    expect(listSnapshots({ storage }).map((summary) => summary.itemCount)).toEqual([1]);
    expect(evictOldestSnapshot({ storage })).toBe(true);
    expect(storage.getItem(VERSION_HISTORY_STORAGE_KEY)).toBeNull();
    expect(storage.getItem(VERSION_HISTORY_META_KEY)).toBeNull();
    expect(evictOldestSnapshot({ storage })).toBe(false);
  });

  it('evicting the newest entry of a house reopens its cadence gate', () => {
    const storage = makeStore();
    const clock = makeClock();
    recordSnapshot(makeHouse(1), { storage, now: clock.now });
    evictOldestSnapshot({ storage });
    clock.advance(10);
    expect(recordSnapshot(makeHouse(1), { storage, now: clock.now })).toBe(true);
  });

  it('a corrupt ring is removed to free its space', () => {
    const storage = makeStore();
    storage.data.set(VERSION_HISTORY_STORAGE_KEY, '{not json');
    expect(evictOldestSnapshot({ storage })).toBe(true);
    expect(storage.getItem(VERSION_HISTORY_STORAGE_KEY)).toBeNull();
    expect(evictOldestSnapshot({ storage })).toBe(false);
  });

  it('terminates on a store without removeItem', () => {
    const data = new Map<string, string>();
    const storage: VersionHistoryStore = {
      getItem: (key) => data.get(key) ?? null,
      setItem: (key, value) => {
        if (key === 'other') throw new Error('QuotaExceededError');
        data.set(key, value);
      },
    };
    recordSnapshot(makeLayout(), { storage });
    expect(() => setItemEvictingSnapshots(storage, 'other', 'x')).toThrow('QuotaExceededError');
    expect(listSnapshots({ storage })).toHaveLength(0);
  });

  it('clearSnapshots removes the ring and its sidecar', () => {
    const storage = makeStore();
    recordSnapshot(makeLayout(), { storage });
    clearSnapshots({ storage });
    expect(storage.data.size).toBe(0);
  });

  it('keeps the serialised ring under the byte budget', () => {
    const storage = makeStore();
    const clock = makeClock();
    // ~150 KB per snapshot: four would overshoot the budget.
    const padding = 'x'.repeat(150 * 1024);
    for (let i = 0; i < 5; i++) {
      expect(
        recordSnapshot(makeLayout({ id: 'padded', name: `${i}${padding}` }), {
          storage,
          now: clock.now,
        })
      ).toBe(true);
      clock.advance(VERSION_HISTORY_MIN_INTERVAL_MS);
      expect(storage.getItem(VERSION_HISTORY_STORAGE_KEY)!.length).toBeLessThanOrEqual(
        VERSION_HISTORY_MAX_CHARS
      );
    }
    const summaries = listSnapshots({ storage, now: clock.now });
    expect(summaries.length).toBeLessThan(5);
    expect(summaries[0]!.name?.startsWith('4')).toBe(true);
  });

  it('refuses a snapshot larger than the budget and keeps the older entries', () => {
    const storage = makeStore();
    const clock = makeClock();
    recordSnapshot(makeLayout({ id: 'h' }), { storage, now: clock.now });
    clock.advance(VERSION_HISTORY_MIN_INTERVAL_MS);
    const huge = makeLayout({ id: 'h', name: 'x'.repeat(VERSION_HISTORY_MAX_CHARS) });
    expect(recordSnapshot(huge, { storage, now: clock.now })).toBe(false);
    expect(listSnapshots({ storage, now: clock.now })).toHaveLength(1);
  });
});

describe('version-history — per house (#296)', () => {
  it('stores the identity of the house and whether it had a floor plan', () => {
    const storage = makeStore();
    const clock = makeClock();
    recordSnapshot(
      makeLayout({ id: 'villa', name: 'Villa', floorPlanImage: 'data:image/png;base64,AAAA' }),
      { storage, now: clock.now }
    );
    recordSnapshot(makeLayout({ name: 'Cabin' }), { storage, now: clock.now });
    const [cabin, villa] = listSnapshots({ storage, now: clock.now });
    expect(villa).toMatchObject({ layoutId: 'villa', name: 'Villa', hadFloorPlan: true });
    expect(cabin).toMatchObject({ layoutId: null, name: 'Cabin', hadFloorPlan: false });
  });

  it('gates the cadence per house', () => {
    const storage = makeStore();
    const clock = makeClock();
    const a = { id: 'a', name: 'A' };
    const b = { id: 'b', name: 'B' };
    expect(recordSnapshot(makeHouse(1, a), { storage, now: clock.now })).toBe(true);
    clock.advance(VERSION_HISTORY_MIN_INTERVAL_MS - 10);
    // B's first snapshot is not held back by A's…
    expect(recordSnapshot(makeHouse(1, b), { storage, now: clock.now })).toBe(true);
    clock.advance(10);
    // …and B's snapshot, now the newest entry, does not hold back A's.
    expect(recordSnapshot(makeHouse(2, a), { storage, now: clock.now })).toBe(true);
    expect(recordSnapshot(makeHouse(2, b), { storage, now: clock.now })).toBe(false);
    expect(listSnapshots({ storage, now: clock.now })).toHaveLength(3);
  });

  it('tells houses apart by name when they have no id', () => {
    const storage = makeStore();
    const clock = makeClock();
    expect(recordSnapshot(makeLayout({ name: 'A' }), { storage, now: clock.now })).toBe(true);
    expect(recordSnapshot(makeLayout({ name: 'B' }), { storage, now: clock.now })).toBe(true);
    expect(recordSnapshot(makeHouse(1, { name: 'A' }), { storage, now: clock.now })).toBe(false);
  });

  it('matches a snapshot to a layout by id, or by name when neither has an id', () => {
    expect(snapshotBelongsTo({ layoutId: 'a', name: 'X' }, { id: 'a', name: 'Renamed' })).toBe(true);
    expect(snapshotBelongsTo({ layoutId: 'a', name: 'X' }, { id: 'b', name: 'X' })).toBe(false);
    expect(snapshotBelongsTo({ layoutId: null, name: 'X' }, { name: 'X' })).toBe(true);
    expect(snapshotBelongsTo({ layoutId: null, name: 'X' }, { name: 'Y' })).toBe(false);
    expect(snapshotBelongsTo({ layoutId: null, name: 'X' }, { id: 'x', name: 'X' })).toBe(false);
    expect(snapshotBelongsTo({ layoutId: 'x', name: 'X' }, { name: 'X' })).toBe(false);
    expect(snapshotBelongsTo({ layoutId: null, name: null }, { name: 'X' })).toBe(false);
  });

  it('loads entries written before identities were stored', () => {
    const storage = makeStore();
    const clock = makeClock(10 * VERSION_HISTORY_MIN_INTERVAL_MS);
    storage.data.set(
      VERSION_HISTORY_STORAGE_KEY,
      JSON.stringify([
        { savedAt: 1, layout: makeHouse(2, { name: 'Old house' }) },
        { savedAt: 2, layout: makeHouse(1, { name: 'Older house' }) },
      ])
    );
    const [newer, older] = listSnapshots({ storage, now: clock.now });
    expect(older).toMatchObject({ id: 1, itemCount: 2, floorCount: 1, hadFloorPlan: false });
    expect(newer).toMatchObject({ id: 2, itemCount: 1, floorCount: 1, hadFloorPlan: false });
    expect(getSnapshot(1, { storage })?.name).toBe('Old house');

    // Recording next to them keeps them restorable.
    expect(recordSnapshot(makeLayout({ id: 'new' }), { storage, now: clock.now })).toBe(true);
    expect(listSnapshots({ storage, now: clock.now })).toHaveLength(3);
    expect(getSnapshot(1, { storage })?.name).toBe('Old house');
  });
});

describe('version-history — gate hygiene (#297)', () => {
  it('counts a clock corrected backwards as elapsed', () => {
    const storage = makeStore();
    const day = 24 * 60 * 60 * 1000;
    const clock = makeClock(10 * day);
    recordSnapshot(makeHouse(1), { storage, now: clock.now });
    clock.advance(-day);
    expect(recordSnapshot(makeHouse(2), { storage, now: clock.now })).toBe(true);
    // The cadence then resumes against the corrected clock.
    clock.advance(10);
    expect(recordSnapshot(makeHouse(3), { storage, now: clock.now })).toBe(false);
    clock.advance(VERSION_HISTORY_MIN_INTERVAL_MS);
    expect(recordSnapshot(makeHouse(3), { storage, now: clock.now })).toBe(true);
  });

  it('clamps future timestamps so they do not sort as permanently newest', () => {
    const storage = makeStore();
    const day = 24 * 60 * 60 * 1000;
    const clock = makeClock(10 * day);
    recordSnapshot(makeHouse(1), { storage, now: clock.now });
    const futureId = listSnapshots({ storage, now: clock.now })[0]!.id;
    clock.advance(-day);

    // Read-only: displayed at the present, still restorable by its id.
    const [clamped] = listSnapshots({ storage, now: clock.now });
    expect(clamped).toMatchObject({ id: futureId, savedAt: clock.now() });
    expect(getSnapshot(clamped!.id, { storage })).not.toBeNull();

    recordSnapshot(makeHouse(2), { storage, now: clock.now });
    const summaries = listSnapshots({ storage, now: clock.now });
    expect(summaries.map((summary) => summary.itemCount)).toEqual([2, 1]);
    expect(summaries.every((summary) => summary.id <= clock.now() + 1)).toBe(true);
    expect(new Set(summaries.map((summary) => summary.id)).size).toBe(2);
  });

  it('skips a layout identical to the newest entry of its house', () => {
    const storage = makeStore();
    const clock = makeClock();
    const withPlan = makeHouse(1, { floorPlanImage: 'data:image/png;base64,AAAA' });
    expect(recordSnapshot(withPlan, { storage, now: clock.now })).toBe(true);
    clock.advance(VERSION_HISTORY_MIN_INTERVAL_MS);
    // Only the (stripped) image differs.
    const otherPlan = makeHouse(1, { floorPlanImage: 'data:image/png;base64,BBBB' });
    expect(recordSnapshot(otherPlan, { storage, now: clock.now })).toBe(false);
    expect(recordSnapshot(otherPlan, { storage, now: clock.now, force: true })).toBe(false);
    expect(listSnapshots({ storage, now: clock.now })).toHaveLength(1);
    expect(recordSnapshot(makeHouse(2), { storage, now: clock.now })).toBe(true);
  });

  it('compares against the same house only', () => {
    const storage = makeStore();
    const clock = makeClock();
    recordSnapshot(makeHouse(1, { id: 'a' }), { storage, now: clock.now });
    recordSnapshot(makeHouse(2, { id: 'b' }), { storage, now: clock.now });
    clock.advance(VERSION_HISTORY_MIN_INTERVAL_MS);
    expect(recordSnapshot(makeHouse(1, { id: 'a' }), { storage, now: clock.now })).toBe(false);
  });

  it('refuses inside the interval without reading the ring', () => {
    const storage = makeStore();
    const clock = makeClock();
    recordSnapshot(makeHouse(1), { storage, now: clock.now });
    const getItem = vi.spyOn(storage, 'getItem');
    clock.advance(VERSION_HISTORY_MIN_INTERVAL_MS - 1);
    expect(recordSnapshot(makeHouse(2), { storage, now: clock.now })).toBe(false);
    expect(getItem).toHaveBeenCalledWith(VERSION_HISTORY_META_KEY);
    expect(getItem).not.toHaveBeenCalledWith(VERSION_HISTORY_STORAGE_KEY);
  });

  it('falls back to the ring and rebuilds a missing sidecar', () => {
    const storage = makeStore();
    const clock = makeClock();
    recordSnapshot(makeHouse(1), { storage, now: clock.now });
    storage.data.delete(VERSION_HISTORY_META_KEY);
    clock.advance(10);
    expect(recordSnapshot(makeHouse(2), { storage, now: clock.now })).toBe(false);
    expect(storage.getItem(VERSION_HISTORY_META_KEY)).not.toBeNull();
  });

  it('lists from stored summaries without validating layouts', () => {
    const storage = makeStore();
    storage.data.set(
      VERSION_HISTORY_STORAGE_KEY,
      JSON.stringify([
        { savedAt: 5, name: 'Broken', itemCount: 7, floorCount: 2, layout: { totally: 'bogus' } },
      ])
    );
    expect(listSnapshots({ storage })).toEqual([
      {
        id: 5,
        savedAt: 5,
        itemCount: 7,
        floorCount: 2,
        name: 'Broken',
        layoutId: null,
        hadFloorPlan: false,
        floorPlanFingerprint: null,
      },
    ]);
    // Validation happens on restore.
    expect(getSnapshot(5, { storage })).toBeNull();
  });
});

describe('floor-plan fingerprint (#296)', () => {
  const imageA = `data:image/png;base64,${'A'.repeat(20000)}`;
  const imageB = `data:image/png;base64,${'A'.repeat(19999)}B`;

  it('is stable for the same image and differs for a different one of equal length', () => {
    expect(floorPlanFingerprint(imageA)).toBe(floorPlanFingerprint(imageA));
    expect(imageB.length).toBe(imageA.length);
    expect(floorPlanFingerprint(imageB)).not.toBe(floorPlanFingerprint(imageA));
  });

  it('is null without an image', () => {
    expect(floorPlanFingerprint(undefined)).toBeNull();
    expect(floorPlanFingerprint('')).toBeNull();
  });

  it('travels with the summary so two houses sharing the default name stay apart', () => {
    const storage = makeStore();
    // Both are called "My Home" and neither has an id — the common case.
    recordSnapshot(makeLayout({ floorPlanImage: imageA }), { storage, now: () => 1_000 });
    const [summary] = listSnapshots({ storage, now: () => 2_000 });
    expect(summary!.floorPlanFingerprint).toBe(floorPlanFingerprint(imageA));
    // The other house's image must not match, so a restore won't graft it.
    expect(summary!.floorPlanFingerprint).not.toBe(floorPlanFingerprint(imageB));
  });

  it('is null for entries written before fingerprints existed', () => {
    const storage = makeStore();
    storage.setItem(
      VERSION_HISTORY_STORAGE_KEY,
      JSON.stringify([{ savedAt: 500, layout: makeLayout() }])
    );
    const [summary] = listSnapshots({ storage, now: () => 2_000 });
    expect(summary!.floorPlanFingerprint).toBeNull();
  });
});
