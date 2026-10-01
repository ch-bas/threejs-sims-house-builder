// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeLayout } from './__testfixtures__/fixtures';
import { MAX_ROOM_DIMENSION, STORAGE_KEY } from './constants';
import { randomId } from './ids';
import { INITIAL_LAYOUT } from './initial-layout';
import {
  MAX_RECOVERY_COPIES,
  RECOVERY_STORAGE_KEY,
  RELOAD_RETRY_WINDOW_MS,
  backupStoredLayout,
  classifyStorageError,
  clearReloadAttempt,
  crashRecurredAfterReload,
  discardRecoveryCopy,
  keepStoredLayout,
  isRecoveryKey,
  loadLayout,
  localStorageOrNull,
  noteReloadAttempt,
  parseLayoutJson,
  readRecoveryCopies,
  readRecoveryCopy,
  readStoredLayoutRaw,
  resetStoredLayout,
  sameLayoutContent,
  saveLayout,
} from './persistence';
import { VERSION_HISTORY_STORAGE_KEY } from './version-history';
import type { RawStore } from './persistence';

function domError(name: string, code = 0): Error {
  const error = new Error(name);
  Object.defineProperty(error, 'name', { value: name });
  Object.defineProperty(error, 'code', { value: code });
  return error;
}

/** A store that throws `failWith` on every setItem. */
function throwingStore(failWith: Error): RawStore {
  return {
    length: 0,
    key: () => null,
    getItem: () => null,
    setItem: () => {
      throw failWith;
    },
    removeItem: () => {},
  };
}

/** A store holding at most `capacity` characters of keys plus values. */
function quotaStore(capacity: number): RawStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    get length() {
      return data.size;
    },
    key: (index) => [...data.keys()][index] ?? null,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      let used = key.length + value.length;
      for (const [k, v] of data) if (k !== key) used += k.length + v.length;
      if (used > capacity) throw domError('QuotaExceededError', 22);
      data.set(key, value);
    },
    removeItem: (key) => {
      data.delete(key);
    },
  };
}

/** `store` with some of its methods replaced. */
function withOverrides(store: RawStore, overrides: Partial<Pick<RawStore, 'getItem' | 'setItem' | 'removeItem'>>): RawStore {
  return {
    get length() {
      return store.length;
    },
    key: (index) => store.key(index),
    getItem: overrides.getItem ?? ((key) => store.getItem(key)),
    setItem: overrides.setItem ?? ((key, value) => store.setItem(key, value)),
    removeItem: overrides.removeItem ?? ((key) => store.removeItem(key)),
  };
}

/** The recovery copies' contents, newest first. */
function keptRaws(store?: RawStore): string[] {
  return readRecoveryCopies(store).map(({ raw }) => raw);
}

describe('persistence — unreadable-save recovery (#113)', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('round-trips a valid layout without touching the recovery key', () => {
    const layout = makeLayout({ name: 'Round trip' });
    expect(saveLayout(layout).ok).toBe(true);
    expect(loadLayout()).toEqual(layout);
    expect(keptRaws()).toEqual([]);
  });

  it('stashes a schema-invalid blob under the recovery key', () => {
    const corrupt = JSON.stringify(makeLayout({ width: MAX_ROOM_DIMENSION + 100 }));
    window.localStorage.setItem(STORAGE_KEY, corrupt);
    expect(loadLayout()).toBeNull();
    backupStoredLayout();
    expect(keptRaws()).toEqual([corrupt]);
  });

  it('stashes a non-JSON blob under the recovery key', () => {
    window.localStorage.setItem(STORAGE_KEY, '{not json');
    expect(loadLayout()).toBeNull();
    backupStoredLayout();
    expect(keptRaws()).toEqual(['{not json']);
  });

  it('stashes a readable blob too — used when applying it throws (#206)', () => {
    const healthy = JSON.stringify(makeLayout({ name: 'Crashes on apply' }));
    window.localStorage.setItem(STORAGE_KEY, healthy);
    backupStoredLayout();
    expect(keptRaws()).toEqual([healthy]);
  });

  it('does nothing when no blob is stored', () => {
    backupStoredLayout();
    expect(keptRaws()).toEqual([]);
  });
});

describe('persistence — a load that trims the house keeps the original (#332)', () => {
  beforeEach(() => window.localStorage.clear());

  it('backs the stored blob up before the trimmed house can be autosaved over it', () => {
    const items = Array.from({ length: 2100 }, (_, i) => ({
      id: `i${i}`, type: 'chair', name: 'Chair', width: 0.5, depth: 0.5, height: 0.9, color: '#8B4513', icon: 'c', position: { x: 0, z: 0 }, rotation: 0,
    }));
    const raw = JSON.stringify({ name: 'Big', width: 20, height: 20, floors: [{ id: 'g', name: 'Ground', floorColor: '#fff', items }] });
    window.localStorage.setItem(STORAGE_KEY, raw);
    const loaded = loadLayout();
    expect(loaded!.floors[0]!.items.length).toBeLessThan(2100);
    const kept = Object.keys(window.localStorage).filter((key) => key.startsWith(RECOVERY_STORAGE_KEY));
    expect(kept.map((key) => window.localStorage.getItem(key))).toContain(raw);
  });

  it('opens nothing when the original cannot be kept, so the trimmed house is never autosaved over it', () => {
    const items = Array.from({ length: 2100 }, (_, i) => ({
      id: `i${i}`, type: 'chair', name: 'Chair', width: 0.5, depth: 0.5, height: 0.9, color: '#8B4513', icon: 'c', position: { x: 0, z: 0 }, rotation: 0,
    }));
    const raw = JSON.stringify({ name: 'Big', width: 20, height: 20, floors: [{ id: 'g', name: 'Ground', floorColor: '#fff', items }] });
    window.localStorage.setItem(STORAGE_KEY, raw);
    const realSetItem = Storage.prototype.setItem;
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key: string, value: string) {
      if (key.startsWith(RECOVERY_STORAGE_KEY)) throw new DOMException('full', 'QuotaExceededError');
      realSetItem.call(this, key, value);
    });
    try {
      expect(loadLayout()).toBeNull();
      expect(window.localStorage.getItem(STORAGE_KEY)).toBe(raw);
    } finally {
      spy.mockRestore();
    }
  });

  it('takes no backup for a house that loads whole', () => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(makeLayout()));
    loadLayout();
    expect(Object.keys(window.localStorage).some((key) => key.startsWith(RECOVERY_STORAGE_KEY))).toBe(false);
  });
});

describe('persistence — save failure reasons (#472)', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('classifies quota, blocked and other failures', () => {
    expect(classifyStorageError(domError('QuotaExceededError', 22))).toBe('quota');
    expect(classifyStorageError(domError('NS_ERROR_DOM_QUOTA_REACHED', 1014))).toBe('quota');
    expect(classifyStorageError(domError('Error', 22))).toBe('quota');
    expect(classifyStorageError(domError('SecurityError', 18))).toBe('blocked');
    expect(classifyStorageError(new TypeError('boom'))).toBe('unknown');
    expect(classifyStorageError('nope')).toBe('unknown');
  });

  it('saveLayout reports the reason instead of a bare false', () => {
    const layout = makeLayout();
    expect(saveLayout(layout, throwingStore(domError('SecurityError', 18)))).toEqual({ ok: false, reason: 'blocked' });
    expect(saveLayout(layout, throwingStore(new TypeError('boom')))).toEqual({ ok: false, reason: 'unknown' });
    expect(saveLayout(layout, quotaStore(10))).toEqual({ ok: false, reason: 'quota' });
  });

  it('saveLayout returns the exact JSON it wrote', () => {
    const layout = makeLayout({ name: 'Written' });
    expect(saveLayout(layout)).toEqual({ ok: true, json: JSON.stringify(layout) });
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe(JSON.stringify(layout));
  });

  it('reports a throwing window.localStorage getter as blocked', () => {
    const spy = vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => {
      throw domError('SecurityError', 18);
    });
    try {
      expect(saveLayout(makeLayout())).toEqual({ ok: false, reason: 'blocked' });
    } finally {
      spy.mockRestore();
    }
  });
});

describe('persistence — start fresh keeps a copy (#336)', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('moves the save to the recovery key', () => {
    const store = quotaStore(Number.MAX_SAFE_INTEGER);
    store.setItem(STORAGE_KEY, 'house');
    expect(resetStoredLayout(store)).toBe('moved');
    expect(store.getItem(STORAGE_KEY)).toBeNull();
    expect(keptRaws(store)).toEqual(['house']);
  });

  it('frees the save first when the copy only fits in its space', () => {
    const house = 'h'.repeat(100);
    // Room for the house once, under either key — not for both.
    const store = quotaStore(STORAGE_KEY.length + RECOVERY_STORAGE_KEY.length + 170);
    store.setItem(STORAGE_KEY, house);
    expect(resetStoredLayout(store, 1_000)).toBe('moved');
    expect(store.getItem(STORAGE_KEY)).toBeNull();
    expect(keptRaws(store)).toEqual([house]);
  });

  it('refuses and leaves the save in place when no copy can be kept', () => {
    const store = quotaStore(Number.MAX_SAFE_INTEGER);
    store.setItem(STORAGE_KEY, 'house');
    const full = withOverrides(store, {
      setItem: (key, value) => {
        if (isRecoveryKey(key)) throw domError('QuotaExceededError', 22);
        store.setItem(key, value);
      },
    });
    expect(resetStoredLayout(full)).toBe('refused');
    expect(store.getItem(STORAGE_KEY)).toBe('house');
    expect(keptRaws(store)).toEqual([]);
  });

  it('never frees the save for a blocked (non-quota) failure', () => {
    const store = quotaStore(Number.MAX_SAFE_INTEGER);
    store.setItem(STORAGE_KEY, 'house');
    const removeItem = vi.fn();
    const blocked = withOverrides(store, {
      setItem: () => {
        throw domError('SecurityError', 18);
      },
      removeItem,
    });
    expect(resetStoredLayout(blocked)).toBe('refused');
    expect(removeItem).not.toHaveBeenCalled();
  });

  it('reports a house lost mid-move so the caller offers its in-memory copy', () => {
    const store = quotaStore(Number.MAX_SAFE_INTEGER);
    store.setItem(STORAGE_KEY, 'house');
    const broken = withOverrides(store, {
      setItem: () => {
        throw domError('QuotaExceededError', 22);
      },
    });
    expect(resetStoredLayout(broken)).toBe('lost');
  });

  it('reads recovery copies through the schema, the legacy undated one as the oldest', () => {
    expect(readRecoveryCopies()).toEqual([]);
    const house = makeLayout({ name: 'Kept' });
    window.localStorage.setItem(RECOVERY_STORAGE_KEY, JSON.stringify(house));
    window.localStorage.setItem(`${RECOVERY_STORAGE_KEY}-5000`, '{not json');
    const [newest, legacy] = readRecoveryCopies();
    expect(newest).toEqual({ key: `${RECOVERY_STORAGE_KEY}-5000`, savedAt: 5000, raw: '{not json', layout: null });
    expect(legacy?.savedAt).toBeNull();
    expect(legacy?.layout).toEqual(house);
    expect(readRecoveryCopy(RECOVERY_STORAGE_KEY)?.layout).toEqual(house);
    window.localStorage.setItem(RECOVERY_STORAGE_KEY, JSON.stringify(makeLayout({ width: MAX_ROOM_DIMENSION + 1 })));
    expect(readRecoveryCopy(RECOVERY_STORAGE_KEY)?.layout).toBeNull();
    // Only recovery keys can be read or deleted through these helpers.
    expect(readRecoveryCopy(STORAGE_KEY)).toBeNull();
    expect(discardRecoveryCopy(STORAGE_KEY)).toBe(false);
    expect(discardRecoveryCopy(`${RECOVERY_STORAGE_KEY}-5000`)).toBe(true);
    expect(readRecoveryCopies()).toHaveLength(1);
  });

  it('suspects the save only when the crash recurs soon after a reload', () => {
    window.sessionStorage.clear();
    expect(crashRecurredAfterReload(1_000)).toBe(false);
    noteReloadAttempt(1_000);
    expect(crashRecurredAfterReload(5_000)).toBe(true);
    expect(crashRecurredAfterReload(1_000 + RELOAD_RETRY_WINDOW_MS)).toBe(false);
  });

  it('stops suspecting the save once the editor came up and cleared the marker', () => {
    window.sessionStorage.clear();
    noteReloadAttempt(1_000);
    clearReloadAttempt();
    expect(crashRecurredAfterReload(5_000)).toBe(false);
  });
});

describe('persistence — recovery copies are never overwritten (#336)', () => {
  const unreadable = (n: number): string => `{broken house ${n}`;

  it('hydration backup keeps the copy "start fresh" promised', () => {
    const store = quotaStore(Number.MAX_SAFE_INTEGER);
    store.setItem(STORAGE_KEY, 'moved by start fresh');
    expect(resetStoredLayout(store, 1_000)).toBe('moved');
    // The fresh lot's save later turns out unreadable and is backed up too.
    store.setItem(STORAGE_KEY, unreadable(2));
    backupStoredLayout(store, 2_000);
    expect(keptRaws(store)).toEqual([unreadable(2), 'moved by start fresh']);
  });

  it('"start fresh" keeps the copy an earlier hydration backup made', () => {
    const store = quotaStore(Number.MAX_SAFE_INTEGER);
    store.setItem(STORAGE_KEY, unreadable(1));
    backupStoredLayout(store, 1_000);
    store.setItem(STORAGE_KEY, 'house that crashes');
    expect(resetStoredLayout(store, 2_000)).toBe('moved');
    expect(keptRaws(store)).toEqual(['house that crashes', unreadable(1)]);
  });

  it('keeps an undated legacy copy alongside a new one', () => {
    const store = quotaStore(Number.MAX_SAFE_INTEGER);
    store.setItem(RECOVERY_STORAGE_KEY, 'legacy');
    store.setItem(STORAGE_KEY, 'new');
    expect(resetStoredLayout(store, 1_000)).toBe('moved');
    expect(keptRaws(store)).toEqual(['new', 'legacy']);
  });

  it('does not duplicate a copy that is already kept', () => {
    const store = quotaStore(Number.MAX_SAFE_INTEGER);
    store.setItem(STORAGE_KEY, unreadable(1));
    backupStoredLayout(store, 1_000);
    backupStoredLayout(store, 2_000);
    expect(resetStoredLayout(store, 3_000)).toBe('moved');
    expect(keptRaws(store)).toEqual([unreadable(1)]);
  });

  it('drops the oldest only once a third copy has been written', () => {
    const store = quotaStore(Number.MAX_SAFE_INTEGER);
    for (const [n, now] of [
      [1, 1_000],
      [2, 2_000],
      [3, 3_000],
    ] as const) {
      store.setItem(STORAGE_KEY, unreadable(n));
      backupStoredLayout(store, now);
    }
    expect(MAX_RECOVERY_COPIES).toBe(2);
    expect(keptRaws(store)).toEqual([unreadable(3), unreadable(2)]);
  });

  it('keeps both copies and the save when the third cannot be written even after dropping them', () => {
    const store = quotaStore(Number.MAX_SAFE_INTEGER);
    store.setItem(STORAGE_KEY, unreadable(1));
    backupStoredLayout(store, 1_000);
    store.setItem(STORAGE_KEY, unreadable(2));
    backupStoredLayout(store, 2_000);
    const third = `{${'x'.repeat(2_000)}`;
    store.setItem(STORAGE_KEY, third);
    const before = [...store.data.keys()].reduce((sum, key) => sum + key.length + (store.getItem(key) ?? '').length, 0);
    // Room for everything already stored, but not for a 2 000-char copy even
    // with both older copies gone.
    const full = quotaStore(before + 100);
    for (const [key, value] of store.data) full.setItem(key, value);
    expect(backupStoredLayout(full, 3_000)).toBe(false);
    expect(full.getItem(STORAGE_KEY)).toBe(third);
    expect(keptRaws(full)).toEqual([unreadable(2), unreadable(1)]);
  });

  it('dates a copy after the newest even when the clock went backwards', () => {
    const store = quotaStore(Number.MAX_SAFE_INTEGER);
    store.setItem(STORAGE_KEY, unreadable(1));
    backupStoredLayout(store, 5_000);
    store.setItem(STORAGE_KEY, unreadable(2));
    backupStoredLayout(store, 1_000);
    expect(readRecoveryCopies(store).map(({ savedAt }) => savedAt)).toEqual([5_001, 5_000]);
  });
});

describe('persistence — recovery copies on a full quota (#336)', () => {
  const blob = (tag: string): string => `{${tag}${'.'.repeat(1_000)}`;

  /** The reviewer's case: two ~1 KB copies and a ~1 KB unreadable save in a 3 400-char quota. */
  function nearlyFull(): RawStore & { data: Map<string, string> } {
    const store = quotaStore(3_400);
    store.setItem(`${RECOVERY_STORAGE_KEY}-1000-a`, blob('first'));
    store.setItem(`${RECOVERY_STORAGE_KEY}-2000-b`, blob('second'));
    store.setItem(STORAGE_KEY, blob('third'));
    return store;
  }

  it('drops the oldest copy to keep the newest unreadable house, leaving the save in place', () => {
    const store = nearlyFull();
    expect(backupStoredLayout(store, 3_000)).toBe(true);
    expect(keptRaws(store)).toEqual([blob('third'), blob('second')]);
    expect(store.getItem(STORAGE_KEY)).toBe(blob('third'));
  });

  it('evicts restore points before any recovery copy', () => {
    const store = quotaStore(3_400 + 1_100);
    store.setItem(`${RECOVERY_STORAGE_KEY}-1000-a`, blob('first'));
    store.setItem(`${RECOVERY_STORAGE_KEY}-2000-b`, blob('second'));
    store.setItem(VERSION_HISTORY_STORAGE_KEY, 'r'.repeat(1_050));
    store.setItem(STORAGE_KEY, blob('third'));
    expect(backupStoredLayout(store, 3_000)).toBe(true);
    expect(store.getItem(VERSION_HISTORY_STORAGE_KEY)).toBeNull();
    // Three copies fit once the ring is gone; the cap then drops the oldest.
    expect(keptRaws(store)).toEqual([blob('third'), blob('second')]);
  });

  it('reports failure and touches nothing when even the main save is the only room', () => {
    const store = quotaStore(1_100 + 40);
    store.setItem(STORAGE_KEY, blob('only'));
    expect(backupStoredLayout(store, 1_000)).toBe(false);
    expect(store.getItem(STORAGE_KEY)).toBe(blob('only'));
    expect(keptRaws(store)).toEqual([]);
  });

  it('"start fresh" puts every copy and the save back when nothing makes room', () => {
    // Too big to fit even with both older copies dropped; then the save is
    // freed and the copy retried in its space, where old copies must not be
    // dropped — nothing else holds the house at that point.
    const big = `{${'x'.repeat(3_000)}`;
    const seed = new Map([
      [`${RECOVERY_STORAGE_KEY}-1000-a`, blob('first')],
      [`${RECOVERY_STORAGE_KEY}-2000-b`, blob('second')],
      [STORAGE_KEY, big],
    ]);
    const used = [...seed].reduce((sum, [key, value]) => sum + key.length + value.length, 0);
    const store = quotaStore(used + 5);
    for (const [key, value] of seed) store.setItem(key, value);
    expect(resetStoredLayout(store, 3_000)).toBe('refused');
    expect(store.getItem(STORAGE_KEY)).toBe(big);
    expect(keptRaws(store)).toEqual([blob('second'), blob('first')]);
  });
});

describe('persistence — copies hold real houses, once each (#336)', () => {
  const blank = (): string => JSON.stringify({ ...INITIAL_LAYOUT, id: randomId('house') });
  const real = JSON.stringify(makeLayout({ name: 'Real house', id: 'house-1' }));

  it('repeated "start fresh" on blank lots keeps the real house', () => {
    const store = quotaStore(Number.MAX_SAFE_INTEGER);
    store.setItem(STORAGE_KEY, real);
    expect(resetStoredLayout(store, 1_000)).toBe('moved');
    for (const now of [2_000, 3_000, 4_000]) {
      store.setItem(STORAGE_KEY, blank());
      expect(resetStoredLayout(store, now)).toBe('moved');
      expect(store.getItem(STORAGE_KEY)).toBeNull();
    }
    expect(keptRaws(store)).toEqual([real]);
  });

  it('keeps no copy of a blank lot on a failed load either', () => {
    const store = quotaStore(Number.MAX_SAFE_INTEGER);
    store.setItem(STORAGE_KEY, blank());
    expect(backupStoredLayout(store, 1_000)).toBe(true);
    expect(keptRaws(store)).toEqual([]);
  });

  it('does not re-keep a restored copy that crashes again in its normalised form', () => {
    const store = quotaStore(Number.MAX_SAFE_INTEGER);
    const other = JSON.stringify(makeLayout({ name: 'Other house', width: 10 }));
    store.setItem(STORAGE_KEY, other);
    backupStoredLayout(store, 1_000);
    store.setItem(STORAGE_KEY, real);
    backupStoredLayout(store, 2_000);
    // Restored through the schema and autosaved with its keys reordered.
    const restored = parseLayoutJson(other)!;
    store.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(Object.entries(restored).reverse())));
    expect(backupStoredLayout(store, 3_000)).toBe(true);
    expect(keptRaws(store)).toEqual([real, other]);
  });

  it('treats the same house under another id as already kept', () => {
    const store = quotaStore(Number.MAX_SAFE_INTEGER);
    store.setItem(STORAGE_KEY, real);
    backupStoredLayout(store, 1_000);
    store.setItem(STORAGE_KEY, JSON.stringify(makeLayout({ name: 'Real house', id: 'house-2' })));
    backupStoredLayout(store, 2_000);
    expect(keptRaws(store)).toEqual([real]);
  });

  it('compares unreadable blobs raw', () => {
    const store = quotaStore(Number.MAX_SAFE_INTEGER);
    store.setItem(STORAGE_KEY, '{a');
    backupStoredLayout(store, 1_000);
    store.setItem(STORAGE_KEY, '{b');
    backupStoredLayout(store, 2_000);
    expect(keptRaws(store)).toEqual(['{b', '{a']);
  });

  it('sameLayoutContent ignores the id', () => {
    expect(sameLayoutContent(makeLayout({ id: 'a' }), makeLayout({ id: 'b' }))).toBe(true);
    expect(sameLayoutContent(makeLayout({ id: 'a' }), makeLayout({ id: 'a', width: 9 }))).toBe(false);
  });
});

describe('persistence — recovery keys (#336)', () => {
  it('accepts the dated-random shape and the older shapes', () => {
    expect(isRecoveryKey(RECOVERY_STORAGE_KEY)).toBe(true);
    expect(isRecoveryKey(`${RECOVERY_STORAGE_KEY}-1700000000000`)).toBe(true);
    expect(isRecoveryKey(`${RECOVERY_STORAGE_KEY}-1700000000000-k3x9a1`)).toBe(true);
    expect(isRecoveryKey(`${RECOVERY_STORAGE_KEY}-abc`)).toBe(false);
    expect(isRecoveryKey(`${RECOVERY_STORAGE_KEY}-1700-K3X!`)).toBe(false);
    expect(isRecoveryKey(STORAGE_KEY)).toBe(false);
  });

  it('gives two copies kept in the same millisecond distinct keys', () => {
    const store = quotaStore(Number.MAX_SAFE_INTEGER);
    const tabA = withOverrides(store, {});
    store.setItem(STORAGE_KEY, '{one');
    backupStoredLayout(tabA, 5_000);
    // The other tab saw no copy yet when it picked its stamp.
    const [first] = readRecoveryCopies(store);
    const blind = withOverrides(store, { getItem: (key) => (key === first!.key ? null : store.getItem(key)) });
    const hidden = { ...blind, length: 0, key: () => null };
    store.setItem(STORAGE_KEY, '{two');
    backupStoredLayout(hidden, 5_000);
    expect(keptRaws(store).sort()).toEqual(['{one', '{two']);
    expect(readRecoveryCopy(first!.key, store)?.savedAt).toBe(5_000);
  });
});

describe('persistence — missing storage object (#472)', () => {
  it('treats a null window.localStorage (Firefox, storage disabled) as blocked', () => {
    const spy = vi.spyOn(window, 'localStorage', 'get').mockReturnValue(null as unknown as Storage);
    try {
      expect(localStorageOrNull()).toBeNull();
      expect(saveLayout(makeLayout())).toEqual({ ok: false, reason: 'blocked' });
      expect(loadLayout()).toBeNull();
      expect(resetStoredLayout()).toBe('refused');
      expect(readStoredLayoutRaw()).toBeNull();
      expect(readRecoveryCopies()).toEqual([]);
      expect(() => backupStoredLayout()).not.toThrow();
    } finally {
      spy.mockRestore();
    }
  });
});

describe('persistence — third-review fixes (#336)', () => {
  const chair = (i: number) => ({
    id: `i${i}`, type: 'chair', name: 'Chair', width: 0.5, depth: 0.5, height: 0.9, color: '#8B4513', icon: 'c', position: { x: 0, z: 0 }, rotation: 0,
  });
  const overCap = (extra: string) =>
    JSON.stringify({
      name: 'Big', width: 20, height: 20,
      floors: [{ id: 'g', name: 'Ground', floorColor: '#fff', items: [...Array.from({ length: 2100 }, (_, i) => chair(i)), { ...chair(9999), name: extra }] }],
    });

  it('keeps an over-cap original even when its trimmed form is already kept', () => {
    const store = quotaStore(Number.MAX_SAFE_INTEGER);
    const original = overCap('past the cap');
    const trimmed = JSON.stringify(parseLayoutJson(original));
    store.setItem(`${RECOVERY_STORAGE_KEY}-1-aaaaaa`, trimmed);
    store.setItem(STORAGE_KEY, original);
    expect(keepStoredLayout(store, 2)).toBe('kept');
    expect(keptRaws(store)).toContain(original);
  });

  it('puts dropped copies back when a later drop throws', () => {
    const base = quotaStore(0);
    const a = 'a'.repeat(400);
    const b = 'b'.repeat(400);
    // Big enough that only dropping BOTH old copies would make room.
    const house = JSON.stringify({ ...makeLayout({ name: 'H', width: 7 }), padding: 'c'.repeat(600) });
    base.data.set(`${RECOVERY_STORAGE_KEY}-1-aaaaaa`, a);
    base.data.set(`${RECOVERY_STORAGE_KEY}-2-bbbbbb`, b);
    base.data.set(STORAGE_KEY, house);
    let used = 0;
    for (const [k, v] of base.data) used += k.length + v.length;
    const tight = quotaStore(used + 10);
    for (const [k, v] of base.data) tight.data.set(k, v);
    const store = withOverrides(tight, {
      removeItem: (key) => {
        if (key.endsWith('bbbbbb')) throw new Error('remove failed');
        tight.removeItem(key);
      },
    });
    expect(keepStoredLayout(store, 3)).not.toBe('kept');
    expect(tight.data.get(`${RECOVERY_STORAGE_KEY}-1-aaaaaa`)).toBe(a);
    expect(tight.data.get(`${RECOVERY_STORAGE_KEY}-2-bbbbbb`)).toBe(b);
    expect(tight.data.get(STORAGE_KEY)).toBe(house);
  });

  it('says why a copy failed, and whether one was made', () => {
    const blocked = withOverrides(quotaStore(Number.MAX_SAFE_INTEGER), {
      setItem: () => {
        throw domError('SecurityError', 18);
      },
    });
    blocked.removeItem(STORAGE_KEY);
    expect(keepStoredLayout(quotaStore(Number.MAX_SAFE_INTEGER), 1)).toBe('nothing');
    const withHouse = quotaStore(Number.MAX_SAFE_INTEGER);
    withHouse.setItem(STORAGE_KEY, JSON.stringify(makeLayout({ name: 'Kept', width: 6 })));
    expect(keepStoredLayout(withHouse, 1)).toBe('kept');
    expect(keepStoredLayout(withHouse, 2)).toBe('nothing');
    const unwritable = withOverrides(withHouse, {
      setItem: () => {
        throw domError('SecurityError', 18);
      },
    });
    unwritable.removeItem(`${RECOVERY_STORAGE_KEY}`);
    for (const { key } of readRecoveryCopies(withHouse)) withHouse.removeItem(key);
    expect(keepStoredLayout(unwritable, 3)).toBe('blocked');
  });
});
