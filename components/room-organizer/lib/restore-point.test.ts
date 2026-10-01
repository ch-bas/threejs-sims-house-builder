import { beforeEach, describe, expect, it, vi } from 'vitest';
import { INITIAL_LAYOUT as REDUCER_INITIAL_LAYOUT } from '../hooks/layout-reducer';
import { makeFloor, makeItem, makeLayout } from './__testfixtures__/fixtures';
import { INITIAL_GROUND_FLOOR, INITIAL_LAYOUT } from './initial-layout';
import { confirmReplace, snapshotBeforeReplace } from './restore-point';
import { parseStoredLayout } from './schema';
import { recordSnapshot } from './version-history';
import type { RoomLayout } from './types';

vi.mock('./version-history', () => ({
  recordSnapshot: vi.fn(),
}));

const mockedRecord = vi.mocked(recordSnapshot);

const furnished = () =>
  makeLayout({ name: 'Furnished', floors: [makeFloor({ items: [makeItem()] })] });

describe('snapshotBeforeReplace (#298)', () => {
  beforeEach(() => {
    mockedRecord.mockReset();
    mockedRecord.mockReturnValue(true);
  });

  it('forces a restore point of a furnished layout', () => {
    const layout = furnished();
    snapshotBeforeReplace(layout);
    expect(mockedRecord).toHaveBeenCalledTimes(1);
    expect(mockedRecord).toHaveBeenCalledWith(layout, { force: true });
  });

  it('snapshots when only an upper floor holds items', () => {
    const layout = makeLayout({
      floors: [makeFloor(), makeFloor({ id: 'first', name: 'First Floor', items: [makeItem()] })],
    });
    snapshotBeforeReplace(layout);
    expect(mockedRecord).toHaveBeenCalledWith(layout, { force: true });
  });

  it('snapshots an item-less layout that carries a floor-plan image', () => {
    const layout = makeLayout({ floorPlanImage: 'data:image/png;base64,AAAA' });
    snapshotBeforeReplace(layout);
    expect(mockedRecord).toHaveBeenCalledWith(layout, { force: true });
  });

  it('skips an empty house', () => {
    snapshotBeforeReplace(INITIAL_LAYOUT);
    expect(mockedRecord).not.toHaveBeenCalled();
  });

  it('skips a missing layout', () => {
    snapshotBeforeReplace(null);
    snapshotBeforeReplace(undefined);
    expect(mockedRecord).not.toHaveBeenCalled();
  });

  it('swallows a throwing recordSnapshot', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mockedRecord.mockImplementation(() => {
      throw new Error('quota');
    });
    expect(() => snapshotBeforeReplace(furnished())).not.toThrow();
    expect(mockedRecord).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });
});

describe('snapshotBeforeReplace — structure counts as work (#298)', () => {
  it.each([
    ['interior walls', makeLayout({ floors: [makeFloor({ interiorWalls: [{ id: 'w', x1: 0, z1: 0, x2: 1, z2: 0 }] })] })],
    ['a second floor', makeLayout({ floors: [makeFloor(), makeFloor({ id: 'first', name: 'First Floor' })] })],
    ['a sloped site', makeLayout({ terrain: { frontY: 1, backY: 0 } })],
    ['a dormer', makeLayout({ roof: { style: 'gable', color: '#5d3a23', dormers: [{ id: 'd', side: 'south', width: 2, offset: 0 }] } as never })],
  ])('snapshots an unfurnished house with %s', (_label, layout) => {
    vi.mocked(recordSnapshot).mockClear();
    snapshotBeforeReplace(layout);
    expect(recordSnapshot).toHaveBeenCalledTimes(1);
  });
});

describe('untouched means "the initial layout" (#346)', () => {
  const withFloor = (patch: Partial<typeof INITIAL_GROUND_FLOOR>): RoomLayout => ({
    ...INITIAL_LAYOUT,
    floors: [{ ...INITIAL_GROUND_FLOOR, ...patch }],
  });

  it.each([
    ['room zones', withFloor({ zones: [{ id: 'z', name: 'Living', color: '#fff', x: 0, z: 0, w: 2, d: 2 }] })],
    ['a floor colour', withFloor({ floorColor: '#000000' })],
    ['a floor pattern', withFloor({ floorPattern: 'tile' })],
    ['wall colours', withFloor({ wallColors: { north: '#123456' } })],
    ['a storey height', withFloor({ height: 3.5 })],
    ['a resized room', { ...INITIAL_LAYOUT, width: 12 }],
    ['a roof style', { ...INITIAL_LAYOUT, roof: { ...INITIAL_LAYOUT.roof, style: 'flat' as const } }],
    ['neighbours', { ...INITIAL_LAYOUT, neighbours: { west: true } }],
  ])('snapshots and confirms over a house with only %s', (_label, layout) => {
    vi.mocked(recordSnapshot).mockClear();
    snapshotBeforeReplace(layout);
    expect(recordSnapshot).toHaveBeenCalledTimes(1);
    const ask = vi.fn(() => false);
    expect(confirmReplace(layout, 'x', ask)).toBe(false);
  });

  it('treats a renamed or reloaded initial layout as untouched', () => {
    vi.mocked(recordSnapshot).mockClear();
    snapshotBeforeReplace({ ...INITIAL_LAYOUT, name: 'Beach house' });
    const reloaded = parseStoredLayout(JSON.parse(JSON.stringify(INITIAL_LAYOUT)));
    expect(reloaded).not.toBeNull();
    snapshotBeforeReplace(reloaded);
    expect(recordSnapshot).not.toHaveBeenCalled();
  });

  it('is the layout the editor starts from', () => {
    expect(INITIAL_LAYOUT).toEqual(REDUCER_INITIAL_LAYOUT);
  });
});

describe('confirmReplace (#364)', () => {
  it('replaces an untouched house without asking', () => {
    const ask = vi.fn(() => false);
    expect(confirmReplace(INITIAL_LAYOUT, 'the Bedroom template', ask)).toBe(true);
    expect(ask).not.toHaveBeenCalled();
  });

  it('asks once before replacing a house with work, naming what replaces it', () => {
    const ask = vi.fn(() => true);
    expect(confirmReplace(furnished(), 'the Bedroom template', ask)).toBe(true);
    expect(ask).toHaveBeenCalledTimes(1);
    expect(ask).toHaveBeenCalledWith('Replace your current house with the Bedroom template? Undo restores it.');
  });

  it('declining keeps the house', () => {
    expect(confirmReplace(furnished(), '“Cabin”', () => false)).toBe(false);
  });

  it('treats structure as work too', () => {
    const ask = vi.fn(() => false);
    const walled = makeLayout({ floors: [makeFloor({ interiorWalls: [{ id: 'w', x1: 0, z1: 0, x2: 1, z2: 0 }] })] });
    expect(confirmReplace(walled, 'this restore point', ask)).toBe(false);
    expect(ask).toHaveBeenCalledTimes(1);
  });
});
