import { describe, expect, it } from 'vitest';
import { sceneWallDisplay, walkthroughCeiling } from './walkthrough-view';

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
