import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { buildExcavationGeometry, buildTerrainGeometry } from './terrain';

const HALF_W = 4;
const HALF_D = 3;

function vertices(geometry: THREE.BufferGeometry): THREE.Vector3[] {
  const position = geometry.getAttribute('position');
  return Array.from({ length: position.count }, (_, i) => new THREE.Vector3().fromBufferAttribute(position, i));
}

function triangles(geometry: THREE.BufferGeometry): THREE.Vector3[][] {
  const v = vertices(geometry);
  const out: THREE.Vector3[][] = [];
  for (let i = 0; i < v.length; i += 3) out.push([v[i]!, v[i + 1]!, v[i + 2]!]);
  return out;
}

describe('terrain ground (#202)', () => {
  const hill = { frontY: 2.5, backY: 0 };
  const geometry = buildTerrainGeometry(THREE, hill, 60, HALF_W, HALF_D, -0.05);

  it('sits on the ground line: street level in front, garden level behind', () => {
    for (const v of vertices(geometry)) {
      const expected = v.z <= -HALF_D ? 2.5 : v.z >= HALF_D ? 0 : 2.5 * (1 - (v.z + HALF_D) / (2 * HALF_D));
      expect(v.y).toBeCloseTo(expected - 0.05);
    }
  });

  it('faces up everywhere', () => {
    for (const tri of triangles(geometry)) {
      const [a, b, c] = tri as [THREE.Vector3, THREE.Vector3, THREE.Vector3];
      const normal = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a));
      expect(normal.y).toBeGreaterThan(0);
    }
  });

  it('leaves the house footprint open (the lot is excavated there)', () => {
    for (const tri of triangles(geometry)) {
      const cx = (tri[0]!.x + tri[1]!.x + tri[2]!.x) / 3;
      const cz = (tri[0]!.z + tri[1]!.z + tri[2]!.z) / 3;
      expect(Math.abs(cx) < HALF_W && Math.abs(cz) < HALF_D).toBe(false);
    }
  });
});

describe('excavation faces (#202)', () => {
  it('is absent when nothing is buried', () => {
    expect(buildExcavationGeometry(THREE, { frontY: 0, backY: 0 }, HALF_W, HALF_D)).toBeNull();
    expect(buildExcavationGeometry(THREE, { frontY: -1, backY: -2 }, HALF_W, HALF_D)).toBeNull();
  });

  it('covers the buried facade up to the ground line, never above it', () => {
    const geometry = buildExcavationGeometry(THREE, { frontY: 2, backY: -1 }, HALF_W, HALF_D)!;
    const verts = vertices(geometry);
    expect(Math.max(...verts.map((v) => v.y))).toBeCloseTo(2);
    for (const v of verts) {
      expect(v.y).toBeGreaterThanOrEqual(0);
      // The slope along the side walls: 2 m at the front falling to -1 m.
      const ground = 2 + (-1 - 2) * Math.min(1, Math.max(0, (v.z + HALF_D) / (2 * HALF_D)));
      expect(v.y).toBeLessThanOrEqual(Math.max(0, ground) + 0.02);
    }
    // No face on the south wall: the garden is below the floor there.
    expect(verts.some((v) => v.z > HALF_D && v.y > 0)).toBe(false);
  });
});
