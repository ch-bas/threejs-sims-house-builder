import { describe, expect, it } from 'vitest';
import { interiorWallHeight } from './storeys';
import { modeAfterExplore, rememberModeBeforeExplore, sceneWallDisplay, WALKTHROUGH_CEILING_GAP, walkthroughCeiling, walkthroughPartitionHeight, walkthroughPit } from './walkthrough-view';

describe('sceneWallDisplay', () => {
  it('keeps the chosen mode outside walkthrough', () => {
    expect(sceneWallDisplay('cutaway', false)).toBe('cutaway');
    expect(sceneWallDisplay('down', false)).toBe('down');
    expect(sceneWallDisplay('up', false)).toBe('up');
  });

  it('puts every wall and the roof up while walking (#359)', () => {
    expect(sceneWallDisplay('cutaway', true)).toBe('up');
    expect(sceneWallDisplay('down', true)).toBe('up');
    expect(sceneWallDisplay('up', true)).toBe('up');
  });
});

describe('walkthroughCeiling', () => {
  it('has no ceiling on a single-storey house: the roof covers it', () => {
    expect(walkthroughCeiling([{}], 0)).toBeNull();
  });

  it('puts the ceiling at the top of every storey below the top one', () => {
    expect(walkthroughCeiling([{}, {}], 0)).toEqual({ y: 3, capY: 6 });
    expect(walkthroughCeiling([{}, {}], 1)).toBeNull();
  });

  it('follows per-storey heights (#202)', () => {
    const floors = [{ height: 2.5 }, { height: 3.5 }, {}];
    expect(walkthroughCeiling(floors, 0)).toEqual({ y: 2.5, capY: 6 });
    expect(walkthroughCeiling(floors, 1)).toEqual({ y: 6, capY: 9 });
    expect(walkthroughCeiling(floors, 2)).toBeNull();
  });

  it('refuses an out-of-range floor index', () => {
    expect(walkthroughCeiling([{}, {}], -1)).toBeNull();
    expect(walkthroughCeiling([{}, {}], 5)).toBeNull();
  });
});

describe('walkthroughPit', () => {
  it('has no pit on the ground floor', () => {
    expect(walkthroughPit([{}], 0)).toBeNull();
    expect(walkthroughPit([{}, {}], 0)).toBeNull();
  });

  it('drops from the active floor to the storey below, following per-storey heights (#202)', () => {
    const floors = [{ height: 2.5 }, { height: 3.5 }, {}];
    expect(walkthroughPit(floors, 1)).toEqual({ y: 0, topY: 2.5 });
    expect(walkthroughPit(floors, 2)).toEqual({ y: 2.5, topY: 6 });
  });

  it('refuses an out-of-range floor index', () => {
    expect(walkthroughPit([{}, {}], 2)).toBeNull();
  });
});

describe('leaving EXPLORE (#454)', () => {
  it('remembers the last mode before EXPLORE, never EXPLORE itself', () => {
    let remembered = rememberModeBeforeExplore('build', 'buy');
    expect(remembered).toBe('buy');
    remembered = rememberModeBeforeExplore(remembered, 'live');
    expect(remembered).toBe('buy');
  });

  it('goes back to the mode EXPLORE was entered from', () => {
    expect(modeAfterExplore('live', 'buy')).toBe('buy');
    expect(modeAfterExplore('live', 'build')).toBe('build');
  });

  it('leaves another mode alone', () => {
    expect(modeAfterExplore('build', 'buy')).toBe('build');
  });
});

describe('walkthroughPartitionHeight (#656)', () => {
  it('reaches the ceiling the walker sees, 1 cm under the plate', () => {
    expect(walkthroughPartitionHeight({ height: 3 })).toBeCloseTo(2.99);
    expect(walkthroughPartitionHeight({ height: 2.4 })).toBeCloseTo(2.39);
    expect(walkthroughPartitionHeight(undefined)).toBeCloseTo(3 - WALKTHROUGH_CEILING_GAP);
  });

  it('is taller than the orbit partition, which stops 0.4 m short', () => {
    for (const height of [2.4, 3, 3.5]) {
      expect(walkthroughPartitionHeight({ height }) - interiorWallHeight({ height })).toBeCloseTo(0.39);
    }
  });
});
