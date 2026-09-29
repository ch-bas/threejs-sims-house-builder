import { describe, expect, it } from 'vitest';
import { makeFloor, makeItem, makeLayout } from './__testfixtures__/fixtures';
import {
  VERSION_HISTORY_LIMIT,
  VERSION_HISTORY_MIN_INTERVAL_MS,
  VERSION_HISTORY_STORAGE_KEY,
  getSnapshot,
  listSnapshots,
  recordSnapshot,
} from './version-history';
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
  };
  return store;
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
    expect(recordSnapshot(makeLayout(), { storage, now: clock.now })).toBe(true);
    expect(listSnapshots({ storage })).toHaveLength(2);
  });

  it('force bypasses the cadence gate (pagehide flush)', () => {
    const storage = makeStore();
    const clock = makeClock();
    recordSnapshot(makeLayout(), { storage, now: clock.now });
    clock.advance(10);
    expect(recordSnapshot(makeLayout(), { storage, now: clock.now, force: true })).toBe(true);
    expect(listSnapshots({ storage })).toHaveLength(2);
  });

  it('keeps savedAt keys unique when forced within the same millisecond', () => {
    const storage = makeStore();
    const clock = makeClock();
    recordSnapshot(makeLayout(), { storage, now: clock.now });
    recordSnapshot(makeLayout(), { storage, now: clock.now, force: true });
    const [a, b] = listSnapshots({ storage });
    expect(a!.savedAt).not.toBe(b!.savedAt);
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
