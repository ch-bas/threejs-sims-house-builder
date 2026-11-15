import { describe, expect, it } from 'vitest';
import {
  MAX_DORMER_WIDTH,
  clampDormer,
  dormerFrame,
  dormerMaxWidth,
  dormerOffsetRange,
  dormerOpeningRects,
  dormerPresetFields,
  dormerPresetOf,
  isDormerSpec,
  julietRailSpan,
  roofSlope,
  roofSlopeSides,
  roofWithRidge,
  roofWithStyle,
  unfittedDormers,
  type DormerPreset,
} from './dormers';
import type { DormerSpec, RoofSpec } from './types';

const dormer = (overrides: Partial<DormerSpec> = {}): DormerSpec => ({ id: 'd', side: 'south', width: 2, ...overrides });
/** `dormer()` wearing a preset, with the fields the preset clears dropped. */
const preset = (name: DormerPreset): DormerSpec => clampDormer({ ...dormer(), ...dormerPresetFields(name) });

describe('roof slopes (#203)', () => {
  it('has slopes only on a gable’s long sides, and on every side of a hipped roof', () => {
    expect(roofSlopeSides('gable', 10, 8)).toEqual(['north', 'south']);
    expect(roofSlopeSides('gable', 6, 9)).toEqual(['east', 'west']);
    expect(roofSlopeSides('hipped', 10, 8)).toEqual(['north', 'south', 'east', 'west']);
    expect(roofSlopeSides('flat', 10, 8)).toEqual([]);
    expect(roofSlopeSides('none', 10, 8)).toEqual([]);
  });

  it('mirrors the gable builder’s pitch', () => {
    // span = 8 + 0.7 → peak min(2.5, 4.35).
    expect(roofSlope('gable', 10, 8, 'south')).toMatchObject({ peak: 2.5, halfRun: 4.35, wallHalfRun: 4 });
  });
});

describe('dormerFrame (#203)', () => {
  const eaves = 6;
  const slopeY = (z: number) => eaves + 2.5 * (1 - Math.abs(z) / 4.35);

  it('stands the face on the slope behind the wall line and keeps the top under the ridge', () => {
    const frame = dormerFrame('gable', 10, 8, eaves, dormer({ setback: 0.5 }))!;
    expect(frame.faceZ).toBeCloseTo(-3.5);
    expect(frame.bottomY).toBeCloseTo(slopeY(-3.5));
    expect(frame.topY).toBeLessThanOrEqual(eaves + 2.5 - 0.15 + 1e-9);
    // The flat top meets the slope exactly.
    expect(slopeY(frame.backZ)).toBeCloseTo(frame.topY);
    expect(frame.rotationY).toBeCloseTo(Math.PI);
  });

  it('trims a face that would hit the ridge', () => {
    const frame = dormerFrame('gable', 10, 8, eaves, dormer({ height: 2.5, setback: 1.5 }))!;
    expect(frame.topY).toBeCloseTo(eaves + 2.5 - 0.15);
    expect(frame.topY - frame.bottomY).toBeLessThan(2.5);
  });

  it('keeps width and offset inside the walls', () => {
    const wide = dormerFrame('gable', 10, 8, eaves, dormer({ width: MAX_DORMER_WIDTH, offset: 30 }))!;
    expect(wide.width).toBeLessThanOrEqual(10 - 0.4);
    expect(Math.abs(wide.centerX) + wide.width / 2).toBeLessThanOrEqual(5 - 0.2 + 1e-9);
  });

  it('lines offsets up on the world axis on both slopes', () => {
    const north = dormerFrame('gable', 10, 8, eaves, dormer({ side: 'north', offset: 2 }))!;
    const south = dormerFrame('gable', 10, 8, eaves, dormer({ side: 'south', offset: 2 }))!;
    // Local x maps to world x through the rotation: north keeps it, south flips it.
    expect(north.centerX * Math.cos(north.rotationY)).toBeCloseTo(2);
    expect(south.centerX * Math.cos(south.rotationY)).toBeCloseTo(2);
  });

  it('narrows a hipped dormer to fit its tapering face', () => {
    const gable = dormerFrame('gable', 10, 8, eaves, dormer({ width: 8 }))!;
    const hipped = dormerFrame('hipped', 10, 8, eaves, dormer({ width: 8 }))!;
    expect(hipped.width).toBeLessThan(gable.width);
  });

  it('exposes the offsets and width the slope can take, matching its own clamp (#281)', () => {
    // 10 m ridge, 0.2 m margins, a 2 m face: ±(5 − 0.2 − 1).
    expect(dormerOffsetRange('gable', 10, 8, eaves, dormer())).toEqual([-3.8, 3.8]);
    const [, max] = dormerOffsetRange('gable', 10, 8, eaves, dormer())!;
    const pushed = dormerFrame('gable', 10, 8, eaves, dormer({ offset: 30 }))!;
    expect(pushed.centerX * Math.cos(pushed.rotationY)).toBeCloseTo(max);
    expect(dormerMaxWidth('gable', 10, 8, eaves, dormer())).toBeCloseTo(8);
    expect(dormerMaxWidth('gable', 5, 4, eaves, dormer())).toBeCloseTo(4.6);
    // A hipped face narrows toward the apex, so it takes less.
    expect(dormerMaxWidth('hipped', 10, 8, eaves, dormer())!).toBeLessThan(8);
    // No slope, or nothing fits: no range either.
    expect(dormerOffsetRange('gable', 10, 8, eaves, dormer({ side: 'east' }))).toBeNull();
    expect(dormerOffsetRange('gable', 3, 1.2, eaves, dormer())).toBeNull();
    expect(dormerMaxWidth('flat', 10, 8, eaves, dormer())).toBeNull();
  });

  it('builds nothing on a gable end, a flat roof, or a slope too low for a face', () => {
    expect(dormerFrame('gable', 10, 8, eaves, dormer({ side: 'east' }))).toBeNull();
    expect(dormerFrame('flat', 10, 8, eaves, dormer())).toBeNull();
    expect(dormerFrame('gable', 3, 1.2, eaves, dormer())).toBeNull();
  });
});

describe('dormer openings (#203)', () => {
  it('turns the ribbon `window` shorthand into one casement band', () => {
    const rects = dormerOpeningRects(dormer({ window: true }), 2, 1.4);
    expect(rects).toHaveLength(1);
    expect(rects[0]).toMatchObject({ kind: 'casement' });
    expect(rects[0]!.x0).toBeCloseTo(-0.8);
    expect(rects[0]!.x1).toBeCloseTo(0.8);
  });

  it('lets explicit openings win over the shorthand', () => {
    const rects = dormerOpeningRects(dormer({ window: true, ...preset('french') }), 2, 1.8);
    expect(rects.map((r) => r.kind)).toEqual(['sidelight', 'french', 'sidelight']);
  });

  it('runs doors floor-to-head and sits casements on a sill', () => {
    const [door] = dormerOpeningRects(dormer({ openings: [{ kind: 'french', from: 0.2, to: 0.8 }] }), 2, 1.8);
    const [casement] = dormerOpeningRects(dormer({ openings: [{ kind: 'casement', from: 0.2, to: 0.8 }] }), 2, 1.8);
    expect(door!.y0).toBeCloseTo(0.05);
    expect(casement!.y0).toBeGreaterThan(0.5);
    expect(door!.y1).toBeCloseTo(casement!.y1);
  });

  it('drops slivers and overlapping openings', () => {
    const rects = dormerOpeningRects(
      dormer({
        openings: [
          { kind: 'casement', from: 0.1, to: 0.5 },
          { kind: 'casement', from: 0.4, to: 0.9 },
          { kind: 'sidelight', from: 0.95, to: 0.97 },
        ],
      }),
      2,
      1.4
    );
    expect(rects).toHaveLength(1);
  });

  it('guards the French doors with the Juliet rail, else the whole face', () => {
    const rects = dormerOpeningRects(dormer(preset('juliet')), 2, 1.8);
    const [x0, x1] = julietRailSpan(rects, 2);
    expect(x0).toBeCloseTo((0.28 - 0.5) * 2 - 0.05);
    expect(x1).toBeCloseTo((0.72 - 0.5) * 2 + 0.05);
    expect(julietRailSpan([], 2)).toEqual([-0.95, 0.95]);
  });
});

describe('dormer data (#203)', () => {
  it('round-trips every preset', () => {
    for (const name of ['window', 'casements', 'french', 'juliet'] as DormerPreset[]) {
      expect(dormerPresetOf(clampDormer(dormer(preset(name))))).toBe(name);
    }
    expect(dormerPresetOf(dormer({ openings: [{ kind: 'french', from: 0, to: 1 }] }))).toBeNull();
  });

  it('validates specs', () => {
    expect(isDormerSpec(dormer(preset('juliet')))).toBe(true);
    for (const bad of [
      { ...dormer(), side: 'up' },
      { ...dormer(), width: 0.1 },
      { ...dormer(), offset: Number.NaN },
      { ...dormer(), height: 9 },
      { ...dormer(), openings: [{ kind: 'porthole', from: 0, to: 1 }] },
      { ...dormer(), openings: [{ kind: 'french', from: 0.8, to: 0.2 }] },
      { ...dormer(), balcony: 'yes' },
      { side: 'south', width: 2 },
    ]) {
      expect(isDormerSpec(bad)).toBe(false);
    }
  });

  it('clamps numbers and drops cleared fields', () => {
    const clamped = clampDormer({ ...dormer({ width: 99, height: 0.1, setback: 9 }), window: undefined });
    expect(clamped).toEqual({ id: 'd', side: 'south', width: MAX_DORMER_WIDTH, height: 0.8, setback: 2 });
  });
});

describe('turning the ridge (#916)', () => {
  const gable = (dormers: DormerSpec[], extra: Partial<RoofSpec> = {}): RoofSpec => ({ style: 'gable', color: '#555555', dormers, ...extra });

  it('fits dormers to a turned ridge and a pitch', () => {
    expect(roofSlopeSides({ style: 'gable', ridge: 'z' }, 10, 8)).toEqual(['east', 'west']);
    // Across a 10 m width the gable rises 2.5 m; scaled by 0.6, 1.5 m.
    expect(roofSlope({ style: 'gable', ridge: 'z', pitch: 0.6 }, 10, 8, 'east')).toMatchObject({ peak: 1.5, halfRun: 5.35, wallHalfRun: 5 });
    expect(dormerFrame({ style: 'gable', ridge: 'z' }, 10, 8, 6, dormer({ side: 'east' }))).not.toBeNull();
    expect(dormerFrame({ style: 'gable', ridge: 'z' }, 10, 8, 6, dormer({ side: 'south' }))).toBeNull();
    // A shallow pitch leaves no room for a face.
    expect(dormerFrame({ style: 'gable', pitch: 0.5 }, 4, 3, 6, dormer())).toBeNull();
  });

  it('swaps every dormer across, built or not, and back', () => {
    const roof = gable([dormer({ id: 'a', side: 'south', offset: 1 }), dormer({ id: 'b', side: 'north' }), dormer({ id: 'end', side: 'east' })]);
    const turned = roofWithRidge(roof, 'z', 10, 8);
    expect(turned).toMatchObject({ style: 'gable', color: '#555555', ridge: 'z' });
    expect(turned.dormers!.map((d) => [d.id, d.side, d.offset])).toEqual([
      ['a', 'west', 1],
      ['b', 'east', undefined],
      // The one on a gable end goes across too: it no longer lands on 'b'.
      ['end', 'north', undefined],
    ]);
    expect(roofWithRidge(turned, undefined, 10, 8)).toEqual(roof);
  });

  it('never stacks two dormers that weren’t stacked (#916 review)', () => {
    // 'b' slopes north, 'end' waits on the east gable end at the same offset.
    const roof = gable([dormer({ id: 'b', side: 'north' }), dormer({ id: 'end', side: 'east' })]);
    const sides = roofWithRidge(roof, 'z', 10, 8).dormers!.map((d) => d.side);
    expect(new Set(sides).size).toBe(2);
  });

  it('turns back to the exact list, for any dormers, ridge and footprint', () => {
    let seed = 7;
    const rand = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    const SIDES = ['north', 'south', 'east', 'west'] as const;
    const RIDGES = [undefined, 'x', 'z'] as const;
    for (let run = 0; run < 300; run++) {
      const width = 3 + Math.floor(rand() * 12);
      const depth = 3 + Math.floor(rand() * 12);
      const dormers = Array.from({ length: Math.floor(rand() * 7) }, (_, i) =>
        dormer({ id: `d${i}`, side: SIDES[Math.floor(rand() * 4)]!, width: 0.6 + rand() * 4, offset: Math.round((rand() - 0.5) * 80) / 10 })
      );
      const from = RIDGES[Math.floor(rand() * 3)];
      const to = RIDGES[Math.floor(rand() * 3)];
      const roof = gable(dormers, from ? { ridge: from } : {});
      expect(roofWithRidge(roofWithRidge(roof, to, width, depth), from, width, depth)).toEqual(roof);
    }
  });

  it('leaves dormers alone when the ridge keeps its way, or the roof has no ridge', () => {
    const roof = gable([dormer()]);
    // The longer side of 10 × 8 already runs east–west.
    const named = roofWithRidge(roof, 'x', 10, 8);
    expect(named).toEqual({ ...roof, ridge: 'x' });
    expect(named.dormers).toBe(roof.dormers);
    const hipped: RoofSpec = { style: 'hipped', dormers: [dormer({ side: 'east' })] };
    expect(roofWithRidge(hipped, 'z', 10, 8)).toEqual({ ...hipped, ridge: 'z' });
  });

  it('returns the roof itself for the ridge it already has', () => {
    const roof = gable([dormer()], { ridge: 'z' });
    expect(roofWithRidge(roof, 'z', 10, 8)).toBe(roof);
    const auto = gable([]);
    expect(roofWithRidge(auto, undefined, 10, 8)).toBe(auto);
  });
});

describe('a gable coming back with a stored ridge (#916)', () => {
  it('moves a dormer off a gable end to the slope across', () => {
    const hipped: RoofSpec = { style: 'hipped', ridge: 'z', dormers: [dormer({ id: 'n', side: 'north' }), dormer({ id: 'w', side: 'west' })] };
    const gabled = roofWithStyle(hipped, 'gable', 10, 8);
    expect(gabled.dormers!.map((d) => [d.id, d.side])).toEqual([['n', 'east'], ['w', 'west']]);
  });

  it('leaves it on the end when another dormer stands in the way', () => {
    const hipped: RoofSpec = { style: 'hipped', ridge: 'z', dormers: [dormer({ id: 'n', side: 'north' }), dormer({ id: 'e', side: 'east' })] };
    expect(roofWithStyle(hipped, 'gable', 10, 8).dormers!.map((d) => d.side)).toEqual(['north', 'east']);
  });

  it('changes nothing else: no stored ridge, other styles, the same style', () => {
    const plain: RoofSpec = { style: 'hipped', dormers: [dormer({ side: 'east' })] };
    expect(roofWithStyle(plain, 'gable', 10, 8)).toEqual({ ...plain, style: 'gable' });
    const ridged: RoofSpec = { style: 'gable', ridge: 'z', dormers: [dormer({ side: 'west' })] };
    expect(roofWithStyle(ridged, 'hipped', 10, 8)).toEqual({ ...ridged, style: 'hipped' });
    expect(roofWithStyle(ridged, 'gable', 10, 8)).toBe(ridged);
  });
});

describe('unfittedDormers (#916)', () => {
  it('names the dormers a low pitch can’t take, not those on a gable end', () => {
    const roof: RoofSpec = { style: 'gable', pitch: 0.5, dormers: [dormer({ id: 'tall', setback: 1 }), dormer({ id: 'end', side: 'east' })] };
    expect(unfittedDormers({ ...roof, pitch: 1 }, 5, 4)).toEqual([]);
    expect(unfittedDormers(roof, 5, 4).map((d) => d.id)).toEqual(['tall']);
  });
});
