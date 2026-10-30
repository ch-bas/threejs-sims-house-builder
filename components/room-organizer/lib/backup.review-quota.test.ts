// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { makeFloor, makeItem, makeLayout } from './__testfixtures__/fixtures';
import { parseBackup, restoreBackup } from './backup';
import { snapshotBeforeReplace } from './restore-point';
import { listSnapshots } from './version-history';
import type { RoomLayout } from './types';

function house(name: string, itemCount: number, id = `house-${name}`): RoomLayout {
  return makeLayout({ id, name, floors: [makeFloor({ items: Array.from({ length: itemCount }, (_, i) => makeItem({ id: `${name}-${i}-${'x'.repeat(40)}`, position: { x: i % 7, z: 0 } })) })] });
}
beforeEach(() => localStorage.clear());

describe('review D5 c', () => {
  it('R9 replace on a nearly full browser keeps the outgoing house and swaps only a whole restore', () => {
    // Another site on this origin holds most of the quota.
    const current = house('Mine', 40);
    const lib = Array.from({ length: 6 }, (_, i) => ({ name: `Big ${i}`, savedAt: i, layout: house(`Big ${i}`, 600) }));
    const per = JSON.stringify(lib[0]!.layout).length + 60;
    localStorage.setItem('other-site', 'y'.repeat(5_000_000 - 6 * per - 1500));
    const parsed = parseBackup(JSON.stringify({ format: 'house-builder-backup', version: 1, main: house('Incoming', 1), library: lib }));
    if (!parsed.ok) throw new Error('parse');
    const report = restoreBackup(parsed.bundle, 'replace', current);
    // what the drawer does next:
    snapshotBeforeReplace(current);
    const kept = listSnapshots().some((s) => s.layoutId === current.id);
    // The library keeps the open house room to autosave (#565), so on a
    // browser this full part of the restore may be refused. Then the open
    // house isn't swapped and nothing is deleted.
    if (report.failed > 0) {
      expect(report.house).toBeNull();
      expect(report.houseWithheld).toBe(true);
      expect(report.keptExtras).toBe(true);
    } else {
      expect(report.house?.name).toBe('Incoming');
    }
    expect(kept).toBe(true);
  });
});
