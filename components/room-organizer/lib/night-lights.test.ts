import { describe, expect, it } from 'vitest';
import { collectLampLights, isNightLit } from './night-lights';
import type { FloorLayout, FurnitureItem } from './types';

function item(type: string, height: number, x = 1, z = 2): FurnitureItem {
  return {
    id: `${type}-${x}-${z}`,
    type,
    category: 'decor',
    name: type,
    width: 0.4,
    depth: 0.4,
    height,
    color: '#ffffff',
    icon: '',
    price: 0,
    position: { x, z },
    rotation: 0,
  } as FurnitureItem;
}

function floor(items: FurnitureItem[], height?: number): FloorLayout {
  return { items, ...(height !== undefined ? { height } : {}) } as FloorLayout;
}

describe('collectLampLights (#215)', () => {
  it('lights lamps, floor lamps, pendants and lampposts, nothing else', () => {
    for (const type of ['lamp', 'floor-lamp', 'pendant-light', 'lamppost']) expect(isNightLit(type)).toBe(true);
    for (const type of ['sofa', 'tv', 'window', 'toString']) expect(isNightLit(type)).toBe(false);
    const lights = collectLampLights([
      floor([item('lamp', 1.5), item('sofa', 0.9), item('lamppost', 3.2), item('pendant-light', 1)]),
    ]);
    expect(lights).toHaveLength(3);
  });

  it('puts each bulb where its builder draws it', () => {
    const [lamp, post, pendant] = collectLampLights([
      floor([item('lamp', 1.5), item('lamppost', 3.2), item('pendant-light', 1)]),
    ]);
    expect(lamp!.y).toBeCloseTo(1.35, 10);
    expect(post!.y).toBeCloseTo(3.2 * 0.93, 10);
    expect(pendant!.y).toBeCloseTo(0.35, 10);
  });

  it('offsets an upper floor by the storeys below, not by the bulb factor (#146)', () => {
    const [upper] = collectLampLights([floor([], 2.5), floor([item('lamp', 1.5, 3, 4)])]);
    expect(upper).toMatchObject({ x: 3, z: 4 });
    expect(upper!.y).toBeCloseTo(2.5 + 1.35, 10);
  });

  it('skips unplaced items', () => {
    const { position: _position, ...unplaced } = item('lamp', 1.5);
    expect(collectLampLights([floor([unplaced as FurnitureItem])])).toEqual([]);
  });
});
