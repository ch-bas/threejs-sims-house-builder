import { describe, expect, it } from 'vitest';
import { makeFloor, makeLayout } from './__testfixtures__/fixtures';
import { clearFacade, facadeColorOf, outsideColor, outsideFinish, outsidePattern, setFacadeColor, setFacadePattern, withPorchFacade } from './facade';
import { isFloorLayout, parseStoredLayout } from './schema';
import { ENTRANCE_WALL_ID } from './street';
import { wallSideColor } from './wall-sides';

describe('outside finish (#918)', () => {
  it('is the inside finish when the storey has no facade', () => {
    const floor = makeFloor({ wallPattern: 'plaster', wallColors: { north: '#123456' } });
    expect(outsideFinish(floor)).toEqual({ pattern: 'plaster', colors: { north: '#123456' } });
    expect(outsidePattern(floor)).toBe('plaster');
    expect(outsideColor(floor, 'north')).toBe('#123456');
    expect(outsideColor(floor, 'south')).toBe('#e8dcc4');
    expect(outsideFinish(makeFloor())).toEqual({});
  });

  it('takes the facade field by field', () => {
    const floor = makeFloor({ wallPattern: 'plaster', wallColors: { north: '#123456', east: '#222222' }, facade: { colors: { north: '#ffffff' } } });
    expect(outsideFinish(floor)).toEqual({ pattern: 'plaster', colors: { north: '#ffffff', east: '#222222' } });
    const brick = makeFloor({ wallPattern: 'plaster', facade: { pattern: 'brick' } });
    expect(outsideFinish(brick)).toEqual({ pattern: 'brick' });
  });
});

describe('setFacadePattern / setFacadeColor (#918)', () => {
  it('sets the outside without touching the inside', () => {
    const floor = makeFloor({ wallPattern: 'plaster', wallColors: { north: '#123456' } });
    const brick = setFacadePattern(floor, 'brick');
    expect(brick.facade).toEqual({ pattern: 'brick' });
    expect(brick.wallPattern).toBe('plaster');
    const white = setFacadeColor(brick, 'north', '#ffffff');
    expect(white.facade).toEqual({ pattern: 'brick', colors: { north: '#ffffff' } });
    expect(white.wallColors).toEqual({ north: '#123456' });
  });

  it('returns the same object when the outside already shows it', () => {
    const floor = makeFloor({ wallPattern: 'plaster', wallColors: { north: '#123456' } });
    expect(setFacadePattern(floor, 'plaster')).toBe(floor);
    expect(setFacadeColor(floor, 'north', '#123456')).toBe(floor);
    expect(setFacadeColor(floor, 'south', '#E8DCC4')).toBe(floor);
    expect(setFacadePattern(floor, null)).toBe(floor);
    expect(setFacadeColor(floor, 'north', null)).toBe(floor);
    expect(clearFacade(floor)).toBe(floor);
    const brick = setFacadePattern(floor, 'brick');
    expect(setFacadePattern(brick, 'brick')).toBe(brick);
  });

  it('drops the facade once nothing in it differs', () => {
    const floor = setFacadeColor(setFacadePattern(makeFloor(), 'siding'), 'east', '#000000');
    const noPattern = setFacadePattern(floor, null);
    expect(noPattern.facade).toEqual({ colors: { east: '#000000' } });
    const plain = setFacadeColor(noPattern, 'east', null);
    expect(plain).not.toHaveProperty('facade');
    expect(clearFacade(floor)).not.toHaveProperty('facade');
  });
});

describe('facade in the schema (#918)', () => {
  it('accepts a facade and refuses an unknown pattern or a non-string colour', () => {
    expect(isFloorLayout(makeFloor({ facade: { pattern: 'brick', colors: { north: '#fff' } } }))).toBe(true);
    expect(isFloorLayout(makeFloor({ facade: {} }))).toBe(true);
    expect(isFloorLayout({ ...makeFloor(), facade: { pattern: 'stucco' } })).toBe(false);
    expect(isFloorLayout({ ...makeFloor(), facade: { colors: { north: 5 } } })).toBe(false);
    expect(isFloorLayout({ ...makeFloor(), facade: 'brick' })).toBe(false);
  });

  it('survives a save and load, and loses only what is not its own', () => {
    const facade = { pattern: 'brick' as const, colors: { north: '#ffffff' } };
    const layout = makeLayout({ floors: [makeFloor({ facade })] });
    const parsed = parseStoredLayout(JSON.parse(JSON.stringify(layout)));
    expect(parsed?.floors[0]?.facade).toEqual(facade);
    const odd = JSON.parse(JSON.stringify(layout)) as { floors: Array<{ facade: Record<string, unknown> }> };
    odd.floors[0]!.facade = { ...facade, colors: { ...facade.colors, up: '#000' }, extra: 1 };
    expect(parseStoredLayout(odd)?.floors[0]?.facade).toEqual(facade);
  });

  it('drops an empty facade or colour map on load', () => {
    const empty = parseStoredLayout(JSON.parse(JSON.stringify(makeLayout({ floors: [makeFloor({ facade: { colors: {} } })] }))));
    expect(empty?.floors[0]).not.toHaveProperty('facade');
    const bare = parseStoredLayout(JSON.parse(JSON.stringify(makeLayout({ floors: [makeFloor({ facade: {} })] }))));
    expect(bare?.floors[0]).not.toHaveProperty('facade');
    const pattern = parseStoredLayout(JSON.parse(JSON.stringify(makeLayout({ floors: [makeFloor({ facade: { pattern: 'brick', colors: {} } })] }))));
    expect(pattern?.floors[0]?.facade).toEqual({ pattern: 'brick' });
  });

  it('leaves a save without one as it was', () => {
    const layout = makeLayout({ floors: [makeFloor({ wallPattern: 'brick' })] });
    const parsed = parseStoredLayout(JSON.parse(JSON.stringify(layout)));
    expect(parsed?.floors[0]).not.toHaveProperty('facade');
  });
});

describe('the porch back wall (#918)', () => {
  const back = { id: ENTRANCE_WALL_ID, x1: -1, z1: -3, x2: 1, z2: -3, color: '#123456' };
  const street = { x: 0, z: -4.5 };

  it('wears the facade colour on its street side only', () => {
    const [wall] = withPorchFacade([back], '#ffffff', street);
    expect(wallSideColor(wall!, 'b')).toBe('#ffffff');
    expect(wallSideColor(wall!, 'a')).toBe('#123456');
  });

  it('leaves the walls alone with no facade colour, and a side painted on its own', () => {
    const walls = [back];
    expect(withPorchFacade(walls, undefined, street)).toBe(walls);
    const painted = { ...back, colorB: '#00ff00' };
    expect(withPorchFacade([painted], '#ffffff', street)[0]).toBe(painted);
  });

  it('has a facade colour only where it differs from the inside', () => {
    expect(facadeColorOf(makeFloor({ wallColors: { north: '#111111' } }), 'north')).toBeUndefined();
    expect(facadeColorOf(makeFloor({ facade: { pattern: 'brick' } }), 'north')).toBeUndefined();
    expect(facadeColorOf(makeFloor({ facade: { colors: { north: '#FFFFFF' } } }), 'north')).toBe('#FFFFFF');
  });
});
