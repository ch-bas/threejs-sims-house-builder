import { describe, expect, it } from 'vitest';
import {
  SEEN_VERSION_STORAGE_KEY,
  compareVersions,
  loadSeenVersion,
  parseVersion,
  stampSeenVersion,
  updatedSinceLastVisit,
} from './app-version';

function fakeStorage(initial: Record<string, string> = {}): { storage: Storage; map: Map<string, string> } {
  const map = new Map(Object.entries(initial));
  const storage = {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, value),
  } as unknown as Storage;
  return { storage, map };
}

describe('parseVersion / compareVersions', () => {
  it('reads plain three-part versions only', () => {
    expect(parseVersion('1.36.0')).toEqual([1, 36, 0]);
    expect(parseVersion('1.36')).toBeNull();
    expect(parseVersion('1.36.0-beta')).toBeNull();
    expect(parseVersion(' 1.36.0')).toBeNull();
    expect(parseVersion('')).toBeNull();
    expect(parseVersion(null)).toBeNull();
  });

  it('orders by number, not by text', () => {
    const v = (s: string) => parseVersion(s)!;
    expect(compareVersions(v('1.9.0'), v('1.10.0'))).toBeLessThan(0);
    expect(compareVersions(v('2.0.0'), v('1.99.99'))).toBeGreaterThan(0);
    expect(compareVersions(v('1.36.1'), v('1.36.1'))).toBe(0);
  });
});

describe('the stored last-seen version', () => {
  it('reads back only a version', () => {
    expect(loadSeenVersion(fakeStorage().storage)).toBeNull();
    expect(loadSeenVersion(fakeStorage({ [SEEN_VERSION_STORAGE_KEY]: 'soon' }).storage)).toBeNull();
    expect(loadSeenVersion(fakeStorage({ [SEEN_VERSION_STORAGE_KEY]: '1.35.2' }).storage)).toBe('1.35.2');
  });

  it('stamps a newer version and says what was seen before', () => {
    const { storage, map } = fakeStorage({ [SEEN_VERSION_STORAGE_KEY]: '1.35.0' });
    expect(stampSeenVersion('1.36.0', storage)).toBe('1.35.0');
    expect(map.get(SEEN_VERSION_STORAGE_KEY)).toBe('1.36.0');
    expect(stampSeenVersion('1.36.0', storage)).toBe('1.36.0');
  });

  it('stamps a first visit, and replaces junk', () => {
    const fresh = fakeStorage();
    expect(stampSeenVersion('1.36.0', fresh.storage)).toBeNull();
    expect(fresh.map.get(SEEN_VERSION_STORAGE_KEY)).toBe('1.36.0');
    const junk = fakeStorage({ [SEEN_VERSION_STORAGE_KEY]: '{"x":1}' });
    expect(stampSeenVersion('1.36.0', junk.storage)).toBeNull();
    expect(junk.map.get(SEEN_VERSION_STORAGE_KEY)).toBe('1.36.0');
  });

  it('never moves back, and never stores a build without a version', () => {
    const { storage, map } = fakeStorage({ [SEEN_VERSION_STORAGE_KEY]: '1.36.0' });
    stampSeenVersion('1.35.0', storage);
    expect(map.get(SEEN_VERSION_STORAGE_KEY)).toBe('1.36.0');
    stampSeenVersion('dev', storage);
    expect(map.get(SEEN_VERSION_STORAGE_KEY)).toBe('1.36.0');
  });
});

describe('updatedSinceLastVisit', () => {
  it('is true after an update, false on the same or an older build', () => {
    expect(updatedSinceLastVisit('1.35.0', '1.36.0', true)).toBe(true);
    expect(updatedSinceLastVisit('1.36.0', '1.36.0', true)).toBe(false);
    expect(updatedSinceLastVisit('1.37.0', '1.36.0', true)).toBe(false);
  });

  it('without a stamp: an update for a player with a house, a first run otherwise', () => {
    expect(updatedSinceLastVisit(null, '1.36.0', true)).toBe(true);
    expect(updatedSinceLastVisit(null, '1.36.0', false)).toBe(false);
  });

  it('never for a build without a version', () => {
    expect(updatedSinceLastVisit('1.35.0', '0.0.0-dev', true)).toBe(false);
  });
});
