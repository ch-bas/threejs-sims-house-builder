import { describe, expect, it } from 'vitest';
import { buildWalkerColliders } from './walk-collision';
import { walkSpawn } from './walk-spawn';
import { buildWalkWorld, walkLampStorey } from './walk-world';
import type { FurnitureItem } from './types';
function item(o: Partial<FurnitureItem> & { type: string; position: { x: number; z: number } }): FurnitureItem {
  return { id: o.type, name: o.type, width: 1, depth: 1, height: 1, color: '#000', icon: '', rotation: 0, ...o };
}
// The review's proof (#446 re-review): spawns and arrivals look only at
// what stands on the storey they land on.
describe('spawn ignores other storeys', () => {
  it('a wardrobe upstairs over the spot inside the front door does not push the ground-floor spawn away', () => {
    const door = item({ id: 'd', type: 'door', width: 0.9, depth: 0.12, height: 2.05, position: { x: 0, z: -4 } });
    const ward = item({ id: 'w', type: 'wardrobe', width: 1.6, depth: 1.2, height: 2, position: { x: 0, z: -3.1 } });
    const b = { width: 8, depth: 8, floors: [{ items: [door] }, { items: [ward] }] };
    const world = buildWalkWorld(b);
    const colliders = buildWalkerColliders(b)[0]!;
    const pose = walkSpawn({ world, building: b, colliders, radius: 0.3 }, 0);
    expect({ x: pose.x, z: pose.z }).toEqual({ x: 0, z: -3.1 });
  });
});

describe('walkLampStorey (#446)', () => {
  const stairs = item({ id: 's', type: 'stairs', width: 1.2, depth: 2.4, height: 3, position: { x: 3.2, z: 0.3 } });
  const world = buildWalkWorld({ width: 8, depth: 8, floors: [{ items: [stairs] }, { items: [] }] });

  it('is the storey above from the top tread on, its own below that and on plates', () => {
    expect(walkLampStorey(world, { y: 3, kind: 'tread', floorIndex: 0 })).toBe(1);
    expect(walkLampStorey(world, { y: 3 - 3 / 14, kind: 'tread', floorIndex: 0 })).toBe(0);
    expect(walkLampStorey(world, { y: 0, kind: 'floor', floorIndex: 0 })).toBe(0);
    expect(walkLampStorey(world, { y: 3, kind: 'floor', floorIndex: 1 })).toBe(1);
  });
});
