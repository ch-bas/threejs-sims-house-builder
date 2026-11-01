import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { buildRoom, withOutsideFace } from './room-builder';
import type * as ThreeNS from 'three';

function facing(geometry: ThreeNS.BufferGeometry): { in: number; out: number } {
  const normal = geometry.getAttribute('normal');
  const position = geometry.getAttribute('position');
  const seen = { in: 0, out: 0 };
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  for (let i = 0; i < position.count; i += 3) {
    a.fromBufferAttribute(position, i);
    b.fromBufferAttribute(position, i + 1);
    c.fromBufferAttribute(position, i + 2);
    const wound = b.sub(a).cross(c.sub(a)).z;
    // The winding has to agree with the stored normal, or the face is culled wrongly.
    expect(Math.sign(wound)).toBe(Math.sign(normal.getZ(i)));
    if (normal.getZ(i) > 0) seen.in += 1;
    else seen.out += 1;
  }
  return seen;
}

describe('outer wall faces (#752)', () => {
  it('backs the inward sheet with an outward face, wound and lit its own way', () => {
    const both = withOutsideFace(THREE, new THREE.PlaneGeometry(4, 3));
    expect(facing(both)).toEqual({ in: 2, out: 2 });
    expect(both.getAttribute('uv').count).toBe(12);
  });

  it('builds every shell wall single-sided, with a face each way, notch walls included', () => {
    const scene = new THREE.Scene();
    buildRoom(THREE, { scene, width: 8, depth: 6, cutout: { corner: 'ne', width: 3, depth: 2 } } as never);
    const walls = scene.children.filter((o) => o.name.startsWith('Wall ')) as ThreeNS.Mesh[];
    expect(walls).toHaveLength(6);
    for (const wall of walls) {
      const material = wall.material as ThreeNS.MeshStandardMaterial;
      expect(material.side).toBe(THREE.FrontSide);
      expect(material.shadowSide).toBe(THREE.DoubleSide);
      expect(wall.castShadow).toBe(true);
      const seen = facing(wall.geometry);
      expect(seen.in).toBe(seen.out);
    }
  });
});
