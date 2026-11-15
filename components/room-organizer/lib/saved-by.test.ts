// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { autoAnswerConfirms, type AutoAnswer } from './__testfixtures__/confirm';
import { INITIAL_LAYOUT } from './initial-layout';
import { parseSavedLayoutEntry } from './library';
import { saveLayout } from './persistence';
import {
  isNewerVersion,
  newerLibraryNote,
  newerSaveQuestion,
  resetSavedByChoice,
  SAVED_BY_STORAGE_KEY,
  savedByNewer,
  savingHereChosen,
  stampSavedBy,
  subscribeSaveHereChosen,
} from './saved-by';
import { STORAGE_KEY } from './saved-house';

// An older build doesn't save over a newer build's house unasked (#933).

function memoryStore(entries: Record<string, string> = {}) {
  const map = new Map(Object.entries(entries));
  return {
    map,
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, value),
    removeItem: (key: string) => void map.delete(key),
  };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('isNewerVersion', () => {
  it('compares versions part by part', () => {
    expect(isNewerVersion('1.37.0', '1.36.9')).toBe(true);
    expect(isNewerVersion('1.36.10', '1.36.9')).toBe(true);
    expect(isNewerVersion('1.36.0', '1.36.0')).toBe(false);
    expect(isNewerVersion('1.35.9', '1.36.0')).toBe(false);
  });

  it('never counts junk or a missing version as newer', () => {
    expect(isNewerVersion(null, '1.36.0')).toBe(false);
    expect(isNewerVersion('2.0.0-beta', '1.36.0')).toBe(false);
    expect(isNewerVersion('2.0.0', null)).toBe(false);
  });
});

describe('the saved-by stamp', () => {
  let confirms: AutoAnswer | null = null;
  beforeEach(() => resetSavedByChoice());
  afterEach(() => {
    confirms?.stop();
    confirms = null;
  });

  it('is written with each save, by a stamped build only', () => {
    const store = memoryStore();
    expect(saveLayout(INITIAL_LAYOUT, store, '1.36.0').ok).toBe(true);
    expect(store.map.get(SAVED_BY_STORAGE_KEY)).toBe('1.36.0');
    const unstamped = memoryStore();
    stampSavedBy(unstamped, null);
    expect(saveLayout(INITIAL_LAYOUT, unstamped, null).ok).toBe(true);
    expect(unstamped.map.has(SAVED_BY_STORAGE_KEY)).toBe(false);
  });

  it('lets the same or a newer build save, and moves the stamp forward', () => {
    const store = memoryStore({ [SAVED_BY_STORAGE_KEY]: '1.36.0' });
    expect(saveLayout(INITIAL_LAYOUT, store, '1.36.0').ok).toBe(true);
    expect(saveLayout(INITIAL_LAYOUT, store, '1.37.0').ok).toBe(true);
    expect(store.map.get(SAVED_BY_STORAGE_KEY)).toBe('1.37.0');
  });

  it('keeps a newer version\'s house when the player says Not now, and asks once a session', async () => {
    confirms = autoAnswerConfirms(false);
    const newerHouse = JSON.stringify({ ...INITIAL_LAYOUT, name: 'Newer', futureField: 1 });
    const store = memoryStore({ [STORAGE_KEY]: newerHouse, [SAVED_BY_STORAGE_KEY]: '1.37.0' });
    expect(savedByNewer(store, '1.36.0')).toBe(true);
    expect(saveLayout({ ...INITIAL_LAYOUT, name: 'Older' }, store, '1.36.0')).toEqual({ ok: false, reason: 'newer' });
    await flush();
    expect(saveLayout({ ...INITIAL_LAYOUT, name: 'Older' }, store, '1.36.0')).toEqual({ ok: false, reason: 'newer' });
    await flush();
    expect(store.map.get(STORAGE_KEY)).toBe(newerHouse);
    expect(store.map.get(SAVED_BY_STORAGE_KEY)).toBe('1.37.0');
    expect(confirms.asked).toHaveLength(1);
    expect(confirms.asked[0]).toMatchObject({
      title: 'This house was last saved by version 1.37.0, newer than this one (1.36.0).',
      confirmLabel: 'Save here anyway',
      cancelLabel: 'Not now',
    });
    expect(confirms.asked[0]?.danger).toBeFalsy();
  });

  // A reverted release, or a version bumped by mistake: the stamp is "newer"
  // for no reason, and the player must be able to keep working.
  it('saves after Save here anyway, for the session, and the stamp drops back (1.40.0 on 1.37.0)', async () => {
    confirms = autoAnswerConfirms(true);
    let chosen = 0;
    const unsubscribe = subscribeSaveHereChosen(() => (chosen += 1));
    const store = memoryStore({ [STORAGE_KEY]: JSON.stringify(INITIAL_LAYOUT), [SAVED_BY_STORAGE_KEY]: '1.40.0' });
    expect(saveLayout({ ...INITIAL_LAYOUT, name: 'Mine' }, store, '1.37.0')).toEqual({ ok: false, reason: 'newer' });
    await flush();
    expect(savingHereChosen()).toBe(true);
    expect(chosen).toBe(1);
    expect(saveLayout({ ...INITIAL_LAYOUT, name: 'Mine' }, store, '1.37.0').ok).toBe(true);
    expect(store.map.get(SAVED_BY_STORAGE_KEY)).toBe('1.37.0');
    expect(JSON.parse(store.map.get(STORAGE_KEY) ?? '{}').name).toBe('Mine');
    unsubscribe();
  });

  it('suggests a reload only when a newer version is really waiting', () => {
    expect(newerSaveQuestion('1.40.0', '1.37.0', false).body).not.toMatch(/reload/i);
    expect(newerSaveQuestion('1.40.0', '1.37.0', true).body).toMatch(/reloading the page opens it/);
  });
});

describe('newerLibraryNote', () => {
  it('warns about a saved layout from a newer version only', () => {
    expect(newerLibraryNote('1.40.0', '1.37.0')).toMatch(/saved by a newer version \(1\.40\.0\)/);
    expect(newerLibraryNote('1.37.0', '1.37.0')).toBeNull();
    expect(newerLibraryNote(undefined, '1.37.0')).toBeNull();
  });
});

describe('saved layouts carry the version that saved them', () => {
  it('keeps the stamp through the index, and nothing when absent', () => {
    const entry = { id: 'a', name: 'A', savedAt: 1, itemCount: 0, floorCount: 1 };
    expect(parseSavedLayoutEntry({ ...entry, savedBy: '1.40.0' })?.savedBy).toBe('1.40.0');
    expect(parseSavedLayoutEntry(entry)).toEqual(entry);
  });
});
