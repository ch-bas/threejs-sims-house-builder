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
