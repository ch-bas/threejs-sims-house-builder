// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeLayout } from './__testfixtures__/fixtures';
import { MAX_ROOM_DIMENSION, STORAGE_KEY } from './constants';
import {
  RECOVERY_STORAGE_KEY,
  RELOAD_RETRY_WINDOW_MS,
  backupStoredLayout,
  classifyStorageError,
  crashRecurredAfterReload,
  loadLayout,
  noteReloadAttempt,
  readRecoveryCopy,
  resetStoredLayout,
  saveLayout,
} from './persistence';
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

describe('persistence — unreadable-save recovery (#113)', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('round-trips a valid layout without touching the recovery key', () => {
    const layout = makeLayout({ name: 'Round trip' });
    expect(saveLayout(layout).ok).toBe(true);
    expect(loadLayout()).toEqual(layout);
    expect(window.localStorage.getItem(RECOVERY_STORAGE_KEY)).toBeNull();
  });

  it('stashes a schema-invalid blob under the recovery key', () => {
    const corrupt = JSON.stringify(makeLayout({ width: MAX_ROOM_DIMENSION + 100 }));
    window.localStorage.setItem(STORAGE_KEY, corrupt);
    expect(loadLayout()).toBeNull();
    backupStoredLayout();
    expect(window.localStorage.getItem(RECOVERY_STORAGE_KEY)).toBe(corrupt);
  });

  it('stashes a non-JSON blob under the recovery key', () => {
    window.localStorage.setItem(STORAGE_KEY, '{not json');
    expect(loadLayout()).toBeNull();
    backupStoredLayout();
    expect(window.localStorage.getItem(RECOVERY_STORAGE_KEY)).toBe('{not json');
  });

  it('stashes a readable blob too — used when applying it throws (#206)', () => {
    const healthy = JSON.stringify(makeLayout({ name: 'Crashes on apply' }));
    window.localStorage.setItem(STORAGE_KEY, healthy);
    backupStoredLayout();
    expect(window.localStorage.getItem(RECOVERY_STORAGE_KEY)).toBe(healthy);
  });

  it('does nothing when no blob is stored', () => {
    backupStoredLayout();
    expect(window.localStorage.getItem(RECOVERY_STORAGE_KEY)).toBeNull();
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
    expect(store.getItem(RECOVERY_STORAGE_KEY)).toBe('house');
  });

  it('frees the save first when the copy only fits in its space', () => {
    const house = 'h'.repeat(100);
    const store = quotaStore(STORAGE_KEY.length + RECOVERY_STORAGE_KEY.length + 150);
    store.setItem(STORAGE_KEY, house);
    expect(resetStoredLayout(store)).toBe('moved');
    expect(store.getItem(STORAGE_KEY)).toBeNull();
    expect(store.getItem(RECOVERY_STORAGE_KEY)).toBe(house);
  });

  it('refuses and leaves the save in place when no copy can be kept', () => {
    const store = quotaStore(Number.MAX_SAFE_INTEGER);
    store.setItem(STORAGE_KEY, 'house');
    const full: RawStore = {
      getItem: (key) => store.getItem(key),
      setItem: (key, value) => {
        if (key === RECOVERY_STORAGE_KEY) throw domError('QuotaExceededError', 22);
        store.setItem(key, value);
      },
      removeItem: (key) => store.removeItem(key),
    };
    expect(resetStoredLayout(full)).toBe('refused');
    expect(store.getItem(STORAGE_KEY)).toBe('house');
    expect(store.getItem(RECOVERY_STORAGE_KEY)).toBeNull();
  });

  it('never frees the save for a blocked (non-quota) failure', () => {
    const store = quotaStore(Number.MAX_SAFE_INTEGER);
    store.setItem(STORAGE_KEY, 'house');
    const removeItem = vi.fn();
    const blocked: RawStore = {
      getItem: (key) => store.getItem(key),
      setItem: () => {
        throw domError('SecurityError', 18);
      },
      removeItem,
    };
    expect(resetStoredLayout(blocked)).toBe('refused');
    expect(removeItem).not.toHaveBeenCalled();
  });

  it('reports a house lost mid-move so the caller offers its in-memory copy', () => {
    const store = quotaStore(Number.MAX_SAFE_INTEGER);
    store.setItem(STORAGE_KEY, 'house');
    const broken: RawStore = {
      getItem: (key) => store.getItem(key),
      setItem: () => {
        throw domError('QuotaExceededError', 22);
      },
      removeItem: (key) => store.removeItem(key),
    };
    expect(resetStoredLayout(broken)).toBe('lost');
  });

  it('reads the recovery copy through the schema', () => {
    expect(readRecoveryCopy()).toBeNull();
    const house = makeLayout({ name: 'Kept' });
    window.localStorage.setItem(RECOVERY_STORAGE_KEY, JSON.stringify(house));
    expect(readRecoveryCopy()?.layout).toEqual(house);
    window.localStorage.setItem(RECOVERY_STORAGE_KEY, JSON.stringify(makeLayout({ width: MAX_ROOM_DIMENSION + 1 })));
    expect(readRecoveryCopy()?.layout).toBeNull();
    window.localStorage.setItem(RECOVERY_STORAGE_KEY, '{not json');
    expect(readRecoveryCopy()).toEqual({ raw: '{not json', layout: null });
  });

  it('suspects the save only when the crash recurs soon after a reload', () => {
    window.sessionStorage.clear();
    expect(crashRecurredAfterReload(1_000)).toBe(false);
    noteReloadAttempt(1_000);
    expect(crashRecurredAfterReload(5_000)).toBe(true);
    expect(crashRecurredAfterReload(1_000 + RELOAD_RETRY_WINDOW_MS)).toBe(false);
  });
});
