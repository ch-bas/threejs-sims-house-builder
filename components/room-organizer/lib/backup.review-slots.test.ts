// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { makeFloor, makeItem, makeLayout } from './__testfixtures__/fixtures';
import { createBackup, parseBackup, restoreBackup } from './backup';
import { listSavedLayouts, saveNamedLayout } from './library';
import type { RoomLayout } from './types';

function house(name: string, itemCount: number, id = `house-${name}`): RoomLayout {
  return makeLayout({ id, name, floors: [makeFloor({ items: Array.from({ length: itemCount }, (_, i) => makeItem({ id: `${name}-${i}`, position: { x: i, z: 0 } })) })] });
}
beforeEach(() => localStorage.clear());

describe('review D5 b', () => {
  it('R1b replace round trip of non-ASCII-named library houses (real clock)', () => {
    // Saved one by one in the past (different ms), as a person would.
    const names = ['Дом', 'Дача', '日本の家', 'بيت', 'Σπίτι'];
    for (const n of names) {
      saveNamedLayout(house(n, 2), n);
      const t = Date.now(); while (Date.now() === t) { /* next ms */ }
    }
    expect(listSavedLayouts()).toHaveLength(names.length);
    const text = JSON.stringify(createBackup(house('Open', 1)));
    localStorage.clear();
    const parsed = parseBackup(text);
    if (!parsed.ok) throw new Error('parse');
    const report = restoreBackup(parsed.bundle, 'replace', house('Open', 1));
    expect(report.failed).toBe(0);
    expect(listSavedLayouts()).toHaveLength(names.length);
  });
  it('R1c replace on a browser that already holds them', () => {
    const names = ['Дом', 'Дача', '日本の家'];
    for (const n of names) { saveNamedLayout(house(n, 2), n); const t = Date.now(); while (Date.now() === t) { /* */ } }
    const text = JSON.stringify(createBackup(house('Open', 1)));
    const parsed = parseBackup(text);
    if (!parsed.ok) throw new Error('parse');
    restoreBackup(parsed.bundle, 'replace', house('Open', 1));
    expect(listSavedLayouts()).toHaveLength(names.length);
  });
});
