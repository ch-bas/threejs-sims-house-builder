// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { makeFloor, makeItem, makeLayout } from './__testfixtures__/fixtures';
import { parseBackup, restoreBackup, summarizeBackup } from './backup';
import { listSavedLayouts, saveNamedLayout } from './library';
import type { RoomLayout } from './types';

function house(name: string, n: number): RoomLayout {
  return makeLayout({ id: `h-${name}`, name, floors: [makeFloor({ items: Array.from({ length: n }, (_, i) => makeItem({ id: `${name}${i}`, position: { x: i, z: 0 } })) })] });
}
beforeEach(() => localStorage.clear());

describe('review D5 d', () => {
  it('R10 a backup whose every library house fails validation', () => {
    saveNamedLayout(house('Mine A', 2), 'Mine A');
    saveNamedLayout(house('Mine B', 3), 'Mine B');
    const parsed = parseBackup(JSON.stringify({
      format: 'house-builder-backup', version: 1, main: house('Incoming', 1),
      library: [{ name: 'Mine A', savedAt: 1, layout: { name: 'Mine A', floors: 'corrupt' } }, { name: 'Other', savedAt: 2, layout: null }],
    }));
    if (!parsed.ok) throw new Error('parse');
    expect(summarizeBackup(parsed.bundle)).toMatchObject({ library: 0, invalid: 2 });
    const report = restoreBackup(parsed.bundle, house('Open', 1));
    expect(report.invalid).toBe(2);
    expect(listSavedLayouts().map((entry) => entry.name).sort()).toEqual(['Incoming (backup)', 'Mine A', 'Mine B']);
  });
  it('R11 a backup whose library field is the wrong shape', () => {
    saveNamedLayout(house('Mine A', 2), 'Mine A');
    const parsed = parseBackup(JSON.stringify({ format: 'house-builder-backup', version: 1, main: house('Incoming', 1), library: { 'Mine A': house('Mine A', 2) } }));
    if (!parsed.ok) throw new Error('parse');
    const report = restoreBackup(parsed.bundle, house('Open', 1));
    expect(report.invalid).toBe(1);
    expect(listSavedLayouts().length).toBeGreaterThan(0);
  });
});
