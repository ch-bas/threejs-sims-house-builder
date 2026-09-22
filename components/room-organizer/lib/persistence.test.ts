// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { makeLayout } from './__testfixtures__/fixtures';
import { MAX_ROOM_DIMENSION, STORAGE_KEY } from './constants';
import { RECOVERY_STORAGE_KEY, backupStoredLayout, loadLayout, saveLayout } from './persistence';

describe('persistence — unreadable-save recovery (#113)', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('round-trips a valid layout without touching the recovery key', () => {
    const layout = makeLayout({ name: 'Round trip' });
    expect(saveLayout(layout)).toBe(true);
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
