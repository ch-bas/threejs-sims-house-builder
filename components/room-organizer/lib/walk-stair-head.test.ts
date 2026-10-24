import { describe, expect, it } from 'vitest';
import {
  advanceWalker,
  buildShellColliders,
  buildWalkColliders,
  buildWalkerColliders,
  type WalkCollider,
  type WalkerState,
} from './walk-collision';
import { buildWalkWorld, type WalkBuilding } from './walk-world';
import type { FloorLayout, FurnitureItem, InteriorWall } from './types';

const R = 0.3;
function item(o: Partial<FurnitureItem> & { type: string; position: { x: number; z: number } }): FurnitureItem {
  return { id: o.type, name: o.type, width: 1, depth: 1, height: 1, color: '#000', icon: '', rotation: 0, ...o };
}
type Floor = Pick<FloorLayout, 'height' | 'items' | 'hiddenWalls' | 'interiorWalls'>;
function cols(b: WalkBuilding & { floors: Floor[] }, i: number): WalkCollider[] {
  const f = b.floors[i]!;
  return [
    ...buildWalkColliders(f.items, f.interiorWalls ?? [], { roomWidth: b.width, roomDepth: b.depth, stairsAsRamps: true }),
    ...buildShellColliders(b, i),
  ];
}
// As the hook does: colliders are the active floor's, and the active floor follows walker.floorIndex.
function walk(b: WalkBuilding & { floors: Floor[] }, w: WalkerState, dx: number, dz: number, frame = 0.05) {
  const world = buildWalkWorld(b);
  const len = Math.hypot(dx, dz);
  for (let i = 0; i < Math.ceil(len / frame); i++) advanceWalker(world, cols(b, w.floorIndex), w, (dx / len) * frame, (dz / len) * frame, R);
  return w;
}
const STAIRS = item({ id: 'stairs', type: 'stairs', width: 1.2, depth: 2.4, height: 3, position: { x: 3.2, z: 0.3 } });

// The review's failing proofs (#446 review): the stair head against what
// stands on the storey below, three storeys, and a short flight.
describe('stair head against something on the storey below', () => {
  it('baseline: climbs onto the storey above', () => {
    const b = { width: 8, depth: 8, floors: [{ items: [STAIRS] }, { items: [] }] };
    const w = walk(b, { x: 3.2, z: -1.5, y: 0, kind: 'floor', floorIndex: 0 }, 0, 4);
    expect(w.floorIndex).toBe(1);
  });
  it('a ground-floor partition just past the top of the flight does not block the landing upstairs', () => {
    const wall: InteriorWall = { id: 'w', x1: 2, z1: 1.65, x2: 4, z2: 1.65 };
    const b = { width: 8, depth: 8, floors: [{ items: [STAIRS], interiorWalls: [wall] }, { items: [] }] };
    const w = walk(b, { x: 3.2, z: -1.5, y: 0, kind: 'floor', floorIndex: 0 }, 0, 4);
    expect({ z: w.z, y: w.y, floor: w.floorIndex }).toMatchObject({ floor: 1 });
  });
  it('a ground-floor wardrobe past the top of the flight does not block the landing upstairs', () => {
    const ward = item({ id: 'ward', type: 'wardrobe', width: 1.2, depth: 0.6, height: 2, position: { x: 3.2, z: 2.0 } });
    const b = { width: 8, depth: 8, floors: [{ items: [STAIRS, ward] }, { items: [] }] };
    const w = walk(b, { x: 3.2, z: -1.5, y: 0, kind: 'floor', floorIndex: 0 }, 0, 4);
    expect({ z: w.z, y: w.y, floor: w.floorIndex }).toMatchObject({ floor: 1 });
  });
  it('an upstairs item beside the hole does not stop the walker coming down', () => {
    const desk = item({ id: 'desk', type: 'desk', width: 1, depth: 0.6, height: 0.75, position: { x: 3.2, z: -1.6 } });
    const b = { width: 8, depth: 8, floors: [{ items: [STAIRS] }, { items: [desk] }] };
    const w = walk(b, { x: 3.2, z: 2.6, y: 3, kind: 'floor', floorIndex: 1 }, 0, -5);
    expect(w.floorIndex).toBe(0);
    expect(w.y).toBe(0);
  });
  it('three storeys stacked: climbs from ground to second', () => {
    const s2 = { ...STAIRS, id: 's2', position: { x: 1.6, z: 0.3 } };
    const b = { width: 8, depth: 8, floors: [{ items: [STAIRS] }, { items: [s2] }, { items: [] }] };
    const w = walk(b, { x: 3.2, z: -1.5, y: 0, kind: 'floor', floorIndex: 0 }, 0, 4);
    expect(w.floorIndex).toBe(1);
    walk(b, w, -2.7, 0); // across to x=0.5
    walk(b, w, 0, -4); // z=-1.5
    walk(b, w, 1.1, 0); // x=1.6, foot of s2
    const at = { ...w };
    walk(b, w, 0, 4);
    expect(at).toMatchObject({ floorIndex: 1 });
    expect(w.floorIndex).toBe(2);
    expect(w.y).toBeCloseTo(6, 5);
  });
  it('a stair shorter than a classic storey still reaches the floor above', () => {
    const short = { ...STAIRS, height: 2.6 };
    const b = { width: 8, depth: 8, floors: [{ items: [short] }, { items: [] }] };
    const w = walk(b, { x: 3.2, z: -1.5, y: 0, kind: 'floor', floorIndex: 0 }, 0, 4);
    expect(w.floorIndex).toBe(1);
  });
});

describe('buildWalkerColliders: per-storey colliders by height (#446)', () => {
  const run = (b: WalkBuilding & { floors: Floor[] }, w: WalkerState, dx: number, dz: number) => {
    const world = buildWalkWorld(b);
    const byStorey = buildWalkerColliders(b);
    const len = Math.hypot(dx, dz);
    for (let i = 0; i < Math.ceil(len / 0.05); i++) {
      advanceWalker(world, byStorey[w.floorIndex]!, w, (dx / len) * 0.05, (dz / len) * 0.05, R);
    }
    return w;
  };

  it('climbs past a ground-floor partition and wardrobe under the landing', () => {
    const wall: InteriorWall = { id: 'w', x1: 2, z1: 1.65, x2: 4, z2: 1.65 };
    const ward = item({ id: 'ward', type: 'wardrobe', width: 1.2, depth: 0.6, height: 2, position: { x: 3.2, z: 2.6 } });
    const b = { width: 8, depth: 8, floors: [{ items: [STAIRS, ward], interiorWalls: [wall] }, { items: [] }] };
    const w = run(b, { x: 3.2, z: -1.5, y: 0, kind: 'floor', floorIndex: 0 }, 0, 4);
    expect(w.floorIndex).toBe(1);
    expect(w.z).toBeGreaterThan(2);
  });

  it('still stops at upstairs furniture once on the landing', () => {
    const bed = item({ id: 'bed', type: 'bed', width: 2, depth: 1.6, height: 0.6, position: { x: 3, z: 3 } });
    const b = { width: 8, depth: 8, floors: [{ items: [STAIRS] }, { items: [bed] }] };
    const w = run(b, { x: 3.2, z: -1.5, y: 0, kind: 'floor', floorIndex: 0 }, 0, 4);
    expect(w.floorIndex).toBe(1);
    expect(w.z).toBeCloseTo(3 - 0.8 - R, 2);
  });

  it("downstairs, upstairs furniture is overhead and the storey's own furniture blocks", () => {
    const upstairs = item({ id: 'desk', type: 'desk', width: 1, depth: 0.6, height: 0.75, position: { x: -2, z: 0 } });
    const sofa = item({ id: 'sofa', type: 'sofa', width: 2, depth: 0.9, height: 0.8, position: { x: 1, z: 0 } });
    const b = { width: 8, depth: 8, floors: [{ items: [STAIRS, sofa] }, { items: [upstairs] }] };
    const w = run(b, { x: -2, z: -2, y: 0, kind: 'floor', floorIndex: 0 }, 0, 3);
    expect(w.z).toBeCloseTo(1, 6);
    const v = run(b, { x: 1, z: -2, y: 0, kind: 'floor', floorIndex: 0 }, 0, 3);
    expect(v.z).toBeCloseTo(-0.45 - R, 2);
  });
});
