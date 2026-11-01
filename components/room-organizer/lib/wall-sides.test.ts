import { describe, expect, it } from 'vitest';
import { layoutReducer } from '../hooks/layout-reducer';
import { makeFloor, makeLayout } from './__testfixtures__/fixtures';
import { parseStoredLayout, isFloorLayout } from './schema';
import { DEFAULT_INTERIOR_WALL_COLOR, paintWallSide, wallSideAt, wallSideColor } from './wall-sides';
import type { InteriorWall } from './types';

const wall: InteriorWall = { id: 'w', x1: 0, z1: -2, x2: 0, z2: 2, color: '#111111' };

describe('wallSideAt (#720)', () => {
  it('tells the two faces apart, whichever way the wall was drawn', () => {
    // Running +z, the normal (-dz, dx) points to -x.
    expect(wallSideAt(wall, { x: -1, z: 0 })).toBe('a');
    expect(wallSideAt(wall, { x: 1, z: 0 })).toBe('b');
    const reversed = { ...wall, z1: 2, z2: -2 };
    expect(wallSideAt(reversed, { x: 1, z: 0 })).toBe('a');
  });
});

describe('paintWallSide (#720)', () => {
  it('one side leaves the other as it looked', () => {
    expect(paintWallSide(wall, '#222222', 'a')).toMatchObject({ color: '#222222', colorB: '#111111' });
    expect(paintWallSide(wall, '#222222', 'b')).toMatchObject({ color: '#111111', colorB: '#222222' });
  });

  it('an unpainted wall keeps its default on the side left alone', () => {
    const plain: InteriorWall = { id: 'p', x1: 0, z1: 0, x2: 1, z2: 0 };
    const painted = paintWallSide(plain, '#222222', 'a');
    expect(painted.colorB).toBe(DEFAULT_INTERIOR_WALL_COLOR);
    const back = paintWallSide(plain, '#222222', 'b');
    expect(back.color).toBeUndefined();
    expect(wallSideColor(back, 'a')).toBe(DEFAULT_INTERIOR_WALL_COLOR);
    expect(wallSideColor(back, 'b')).toBe('#222222');
  });

  it('both sides, or a side painted to match, drop colorB', () => {
    const two = { ...wall, colorB: '#333333' };
    expect(paintWallSide(two, '#222222', undefined)).toEqual({ ...wall, color: '#222222' });
    expect(paintWallSide(two, '#111111', 'b')).toEqual(wall);
  });

  it('an unchanged paint is the same object', () => {
    expect(paintWallSide(wall, '#111111', undefined)).toBe(wall);
    expect(paintWallSide(wall, '#111111', 'a')).toBe(wall);
    const two = { ...wall, colorB: '#333333' };
    expect(paintWallSide(two, '#333333', 'b')).toBe(two);
  });
});

describe('the paint path (#720)', () => {
  const state = () => ({ layout: makeLayout({ floors: [makeFloor({ id: 'g', interiorWalls: [wall] })] }), activeFloorIndex: 0 });

  it('the reducer paints one side, and a repeat is a no-op', () => {
    const start = state();
    const next = layoutReducer(start, { type: 'setInteriorWallColor', id: 'w', color: '#222222', side: 'b' });
    expect(next.layout.floors[0]!.interiorWalls![0]).toMatchObject({ color: '#111111', colorB: '#222222' });
    expect(layoutReducer(next, { type: 'setInteriorWallColor', id: 'w', color: '#222222', side: 'b' })).toBe(next);
  });

  it('with no side it paints both, as it always did', () => {
    const next = layoutReducer(state(), { type: 'setInteriorWallColor', id: 'w', color: '#222222' });
    expect(next.layout.floors[0]!.interiorWalls![0]).toEqual({ ...wall, color: '#222222' });
  });

  it('the schema keeps colorB and refuses a bad one', () => {
    const layout = makeLayout({ floors: [makeFloor({ interiorWalls: [{ ...wall, colorB: '#222222' }] })] });
    expect(parseStoredLayout(JSON.parse(JSON.stringify(layout)))?.floors[0]?.interiorWalls?.[0]?.colorB).toBe('#222222');
    expect(isFloorLayout({ ...makeFloor(), interiorWalls: [{ ...wall, colorB: 4 }] })).toBe(false);
  });
});
