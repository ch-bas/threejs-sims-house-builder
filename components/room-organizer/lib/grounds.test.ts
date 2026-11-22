import { describe, expect, it } from 'vitest';
import { makeLayout } from './__testfixtures__/fixtures';
import {
  MAX_GROUNDS,
  buildingRects,
  discOnGround,
  drawnGround,
  fitGround,
  groundAt,
  groundBlockers,
  groundFits,
  groundMisfit,
  groundFromCorners,
  groundLot,
  groundsOverlap,
  groundsSceneKey,
  isGroundPatch,
  overlapsGround,
  shownGrounds,
  withGroundAdded,
} from './grounds';
import type { GroundPatch } from './types';

const patch = (overrides: Partial<GroundPatch> = {}): GroundPatch => ({ id: 'g1', kind: 'paving', x: 4, z: -2, w: 2, d: 3, ...overrides });

describe('garden surfaces (#924)', () => {
  const house = makeLayout({ width: 8, height: 6 });

  it('validates shape and kind only', () => {
    expect(isGroundPatch(patch())).toBe(true);
    expect(isGroundPatch(patch({ kind: 'lava' as GroundPatch['kind'] }))).toBe(false);
    expect(isGroundPatch(patch({ w: 0 }))).toBe(false);
    expect(isGroundPatch(patch({ x: Number.NaN }))).toBe(false);
    expect(isGroundPatch({ ...patch(), id: '' })).toBe(false);
    expect(isGroundPatch([])).toBe(false);
  });

  it('keeps a rectangle that already lies on the lot as it is', () => {
    const rect = { x: 4, z: -2, w: 2, d: 3 };
    expect(fitGround(rect, house)).toEqual(rect);
    expect(groundFits(rect, house)).toBe(true);
  });

  it('keeps the largest part clear of the house, flush to its wall', () => {
    // Drawn from inside the house out past the east wall.
    expect(fitGround({ x: 2, z: -1, w: 4, d: 2 }, house)).toEqual({ x: 4, z: -1, w: 2, d: 2 });
    // Wholly on the house: nothing.
    expect(fitGround({ x: -1, z: -1, w: 2, d: 2 }, house)).toBeNull();
  });

  it('clamps to the lot, and the front stops at the wall on a pavement frontage', () => {
    expect(groundLot(house)).toEqual({ x0: -10, x1: 10, z0: -9, z1: 9 });
    expect(fitGround({ x: 8, z: 0, w: 5, d: 1 }, house)).toEqual({ x: 8, z: 0, w: 2, d: 1 });
    const town = { ...house, frontage: 'pavement' as const };
    expect(groundLot(town).z0).toBe(-3);
    expect(fitGround({ x: -2, z: -6, w: 4, d: 2 }, town)).toBeNull();
  });

  it('lets a surface lie in the notch of an L, but not on its wings', () => {
    const ell = makeLayout({ width: 8, height: 6, cutout: { corner: 'ne', width: 3, depth: 2 } });
    expect(buildingRects(ell)).toHaveLength(2);
    // The notch: x 1..4, z -3..-1.
    expect(fitGround({ x: 1, z: -3, w: 3, d: 2 }, ell)).toEqual({ x: 1, z: -3, w: 3, d: 2 });
    expect(fitGround({ x: 0, z: -3, w: 4, d: 2 }, ell)).toEqual({ x: 1, z: -3, w: 3, d: 2 });
    expect(fitGround({ x: 1, z: -3, w: 3, d: 3 }, ell)).toEqual({ x: 1, z: -3, w: 3, d: 2 });
  });

  it('keeps off the porch steps on a site where the street lies below the porch', () => {
    const porch = makeLayout({ width: 8, height: 6, terrain: { frontY: -0.6, backY: -0.6 }, entrance: { width: 1.4, depth: 1.2 } });
    const steps = groundBlockers(porch).find((rect) => rect.z1 === -3 && rect.z0 < -3.35);
    expect(steps).toBeDefined();
    expect(fitGround({ x: -1, z: -4.5, w: 2, d: 1 }, porch)).not.toEqual({ x: -1, z: -4.5, w: 2, d: 1 });
    // The same patch on a flat site, no steps, fits.
    const flat = makeLayout({ width: 8, height: 6, entrance: { width: 1.4, depth: 1.2 } });
    expect(groundFits({ x: -1, z: -4.5, w: 2, d: 1 }, flat)).toBe(true);
  });

  it('keeps off the house beside a party wall', () => {
    const terrace = { ...house, neighbours: { east: true } };
    expect(fitGround({ x: 4, z: -2, w: 2, d: 3 }, terrace)).toBeNull();
    // Behind the row it is garden again.
    expect(groundFits({ x: 4, z: 3, w: 2, d: 2 }, terrace)).toBe(true);
    // The west side is open.
    expect(groundFits({ x: -6, z: -2, w: 2, d: 3 }, terrace)).toBe(true);
  });

  it('snaps drawn corners to the grid and onto a wall line near it', () => {
    expect(groundFromCorners({ x: 4.13, z: -1.04 }, { x: 6.02, z: 1.96 }, house)).toEqual({ x: 4, z: -1, w: 2, d: 3 });
    expect(groundFromCorners({ x: 4.3, z: 0 }, { x: 4.4, z: 2 }, house)).toBeNull();
  });

  it('says why a drawn rectangle adds nothing', () => {
    expect(drawnGround({ x: -1, z: -1 }, { x: 1, z: 1 }, house)).toEqual({ refusal: 'on-house' });
    expect(drawnGround({ x: 5, z: 0 }, { x: 5.1, z: 0.1 }, house)).toEqual({ refusal: 'too-small' });
    const busy = { ...house, grounds: [patch()] };
    expect(drawnGround({ x: 5, z: 0 }, { x: 7, z: 2 }, busy)).toEqual({ refusal: 'on-surface' });
    expect(drawnGround({ x: 6, z: 0 }, { x: 7, z: 2 }, busy)).toEqual({ rect: { x: 6, z: 0, w: 1, d: 2 } });
    const full = { ...house, grounds: Array.from({ length: MAX_GROUNDS }, (_, i) => patch({ id: `g${i}` })) };
    expect(drawnGround({ x: 6, z: 0 }, { x: 7, z: 2 }, full)).toEqual({ refusal: 'too-many' });
  });

  it('gives the right reason past the lot, on a pavement frontage, on the steps and beside a neighbour', () => {
    expect(drawnGround({ x: 11, z: 0 }, { x: 13, z: 2 }, house)).toEqual({ refusal: 'off-lot' });
    const town = { ...house, frontage: 'pavement' as const };
    expect(drawnGround({ x: -2, z: -6 }, { x: 2, z: -4 }, town)).toEqual({ refusal: 'on-pavement' });
    const porch = makeLayout({ width: 8, height: 6, terrain: { frontY: -0.6, backY: -0.6 }, entrance: { width: 1.4, depth: 1.2 } });
    expect(drawnGround({ x: -0.6, z: -4.2 }, { x: 0.6, z: -3.4 }, porch)).toEqual({ refusal: 'on-steps' });
    expect(drawnGround({ x: 4, z: -2 }, { x: 6, z: 1 }, { ...house, neighbours: { east: true } })).toEqual({ refusal: 'by-neighbour' });
  });

  it('lets a covered surface neither block a new one nor an edit', () => {
    // Stored where the grown house now stands: not drawn, so not in the way.
    const covered = patch({ x: 4.5, z: -1, w: 1, d: 2 });
    const grown = { ...makeLayout({ width: 10, height: 6 }), grounds: [covered] };
    expect(drawnGround({ x: 5, z: -1 }, { x: 7, z: 1 }, grown)).toEqual({ rect: { x: 5, z: -1, w: 2, d: 2 } });
    expect(withGroundAdded(grown, patch({ id: 'g2', x: 5, z: -1, w: 2, d: 2 })).grounds).toHaveLength(2);
  });

  it('treats touching surfaces as clear', () => {
    expect(groundsOverlap({ x: 0, z: 0, w: 1, d: 1 }, { x: 1, z: 0, w: 1, d: 1 })).toBe(false);
    expect(groundsOverlap({ x: 0, z: 0, w: 1, d: 1 }, { x: 0.5, z: 0.5, w: 1, d: 1 })).toBe(true);
    expect(overlapsGround({ x: 4, z: -2, w: 2, d: 3 }, [patch()], 'g1')).toBe(false);
  });

  it('shows only the surfaces the house as it stands leaves room for', () => {
    const grounds = [patch(), patch({ id: 'g2', x: -7, z: 0, w: 2, d: 2 })];
    const layout = { ...house, grounds };
    expect(shownGrounds(layout)).toBe(grounds);
    // The house grows over the first one.
    const grown = { ...layout, width: 10 };
    expect(shownGrounds(grown).map((g) => g.id)).toEqual(['g2']);
    expect(groundsSceneKey(makeLayout())).toBe('');
    expect(groundsSceneKey(layout)).toContain('paving');
  });

  it('finds the surface under a point and a disc reaching onto one', () => {
    const grounds = [patch(), patch({ id: 'g2', kind: 'deck', x: 5, z: -1, w: 0.5, d: 0.5 })];
    expect(groundAt(grounds, 5.2, -0.8)?.id).toBe('g2');
    expect(groundAt(grounds, 4.1, 0.5)?.id).toBe('g1');
    expect(groundAt(grounds, 0, 0)).toBeNull();
    expect(discOnGround(grounds, 3.8, 0, 0.3)).toBe(true);
    expect(discOnGround(grounds, 3.6, 0, 0.3)).toBe(false);
  });

  it('says why a stored surface is not drawn', () => {
    expect(groundMisfit({ x: 4, z: -2, w: 2, d: 3 }, house)).toBeNull();
    // The house grew over it.
    expect(groundMisfit({ x: 4, z: -2, w: 2, d: 3 }, makeLayout({ width: 10, height: 6 }))).toBe('on-house');
    expect(groundMisfit({ x: 3, z: -2, w: 2, d: 3 }, house)).toBe('on-house');
    // Past the lot, 6 m round the house.
    expect(groundMisfit({ x: 9, z: 0, w: 2, d: 1 }, house)).toBe('off-lot');
    expect(groundMisfit({ x: 20, z: 0, w: 2, d: 1 }, house)).toBe('off-lot');
  });
});
