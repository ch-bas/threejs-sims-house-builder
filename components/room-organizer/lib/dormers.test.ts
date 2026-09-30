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
  type DormerPreset,
} from './dormers';
import type { DormerSpec } from './types';

const dormer = (overrides: Partial<DormerSpec> = {}): DormerSpec => ({ id: 'd', side: 'south', width: 2, ...overrides });

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
    const rects = dormerOpeningRects(dormer({ window: true, ...dormerPresetFields('french') }), 2, 1.8);
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
    const rects = dormerOpeningRects(dormer(dormerPresetFields('juliet')), 2, 1.8);
    const [x0, x1] = julietRailSpan(rects, 2);
    expect(x0).toBeCloseTo((0.28 - 0.5) * 2 - 0.05);
    expect(x1).toBeCloseTo((0.72 - 0.5) * 2 + 0.05);
    expect(julietRailSpan([], 2)).toEqual([-0.95, 0.95]);
  });
});

describe('dormer data (#203)', () => {
  it('round-trips every preset', () => {
    for (const preset of ['window', 'casements', 'french', 'juliet'] as DormerPreset[]) {
      expect(dormerPresetOf(clampDormer(dormer(dormerPresetFields(preset))))).toBe(preset);
    }
    expect(dormerPresetOf(dormer({ openings: [{ kind: 'french', from: 0, to: 1 }] }))).toBeNull();
  });

  it('validates specs', () => {
    expect(isDormerSpec(dormer(dormerPresetFields('juliet')))).toBe(true);
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
