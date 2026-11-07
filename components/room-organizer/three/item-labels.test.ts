// @vitest-environment jsdom
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { makeItem } from '../lib/__testfixtures__/fixtures';
import { FURNITURE_CATALOG } from '../lib/constants';
import { mountBand } from '../lib/mount-band';
import { ROOF_STAIR_GAP } from '../lib/storeys';
import { LABEL_RISE, itemLabelY, renderItemLabels } from './item-labels';
import type { FurnitureItem } from '../lib/types';

type ThreeModule = typeof import('./three-runtime');
const T = THREE as unknown as ThreeModule;

const catalogItem = (type: string): FurnitureItem => {
  const entry = FURNITURE_CATALOG.find((c) => c.type === type);
  if (!entry) throw new Error(`no catalog entry for ${type}`);
  return makeItem({ ...entry, id: type, position: { x: 1, z: 2 } });
};

// A label floated at floor + height, which is where a floor-standing item
// ends but 60 cm under a pendant's shade, across a window's glass and inside
// a painting (#657). It floats above the built mesh now, as the selection
// outline does.
describe('item labels float above the built mesh (#657)', () => {
  it('keeps a floor-standing item where it was', () => {
    const sofa = catalogItem('sofa');
    expect(itemLabelY(sofa, undefined, 0)).toBeCloseTo(sofa.height + LABEL_RISE);
  });

  it.each(['pendant-light', 'wall-clock', 'painting', 'window'])('%s: above the top of its mount band', (type) => {
    const item = catalogItem(type);
    const top = mountBand(item).top;
    expect(top).toBeGreaterThan(item.height);
    expect(itemLabelY(item, undefined, 0)).toBeCloseTo(top + LABEL_RISE);
  });

  it('follows the storey: a pendant under a 2.4 m ceiling', () => {
    const pendant = catalogItem('pendant-light');
    expect(itemLabelY(pendant, { height: 2.4 }, 3)).toBeCloseTo(3 + 2.4 + LABEL_RISE);
  });

  it('sits over the rise a flight is built with (#654)', () => {
    const stairs = catalogItem('stairs');
    expect(itemLabelY(stairs, undefined, 0, true)).toBeCloseTo(3 - ROOF_STAIR_GAP + LABEL_RISE);
    expect(itemLabelY(stairs, undefined, 0)).toBeCloseTo(3 + LABEL_RISE);
  });

  it('places the sprite there', () => {
    const scene = new THREE.Scene();
    const clock = catalogItem('wall-clock');
    renderItemLabels(T, scene, [clock], 3, { height: 3 });
    const sprite = scene.children.find((child) => child.userData.itemId === clock.id)!;
    expect(sprite.position.y).toBeCloseTo(itemLabelY(clock, { height: 3 }, 3));
    expect(sprite.position.x).toBe(1);
    expect(sprite.position.z).toBe(2);
  });

  it("floats over a garden item from the ground it stands on (#665)", () => {
    const scene = new THREE.Scene();
    const clock = catalogItem('wall-clock');
    renderItemLabels(T, scene, [clock], 0, { height: 3 }, false, () => -3);
    const sprite = scene.children.find((child) => child.userData.itemId === clock.id)!;
    expect(sprite.position.y).toBeCloseTo(itemLabelY(clock, { height: 3 }, -3));
  });
});
