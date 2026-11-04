import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { withOutsideFace } from './builder-utils';
import { buildRoof } from './roof';
import { buildRoom } from './room-builder';
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

/** Every triangle's winding, in world space: +1 facing away from `centre`, -1 toward it. */
function windings(mesh: ThreeNS.Mesh, centre: ThreeNS.Vector3, keep: (mid: ThreeNS.Vector3) => boolean = () => true): number[] {
  mesh.updateWorldMatrix(true, false);
  const geometry = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry;
  const position = geometry.getAttribute('position');
  const [a, b, c] = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  const signs: number[] = [];
  for (let i = 0; i < position.count; i += 3) {
    a.fromBufferAttribute(position, i).applyMatrix4(mesh.matrixWorld);
    b.fromBufferAttribute(position, i + 1).applyMatrix4(mesh.matrixWorld);
    c.fromBufferAttribute(position, i + 2).applyMatrix4(mesh.matrixWorld);
    const mid = a.clone().add(b).add(c).divideScalar(3);
    if (!keep(mid)) continue;
    const n = b.clone().sub(a).cross(c.clone().sub(a));
    signs.push(Math.sign(n.dot(mid.sub(centre))));
  }
  return signs;
}

describe('dormer faces (#782)', () => {
  it('builds the face and both cheeks single-sided, with a face each way', () => {
    const scene = new THREE.Scene();
    buildRoof(THREE, {
      scene, width: 10, depth: 8, baseY: 6,
      spec: { style: 'gable', dormers: [{ id: 'd', side: 'north', width: 2, window: true }] },
    });
    const dormer = scene.children.find((o) => o.userData.dormerId === 'd')!;
    dormer.updateMatrixWorld(true);
    const centre = new THREE.Box3().setFromObject(dormer).getCenter(new THREE.Vector3());
    const sheets = dormer.children.filter(
      (o): o is ThreeNS.Mesh => o instanceof THREE.Mesh && (o.material as ThreeNS.Material).shadowSide === THREE.DoubleSide
    );
    // The face and two cheeks.
    expect(sheets).toHaveLength(3);
    for (const sheet of sheets) {
      expect((sheet.material as ThreeNS.Material).side).toBe(THREE.FrontSide);
      const signs = windings(sheet, centre);
      expect(signs.filter((s) => s > 0).length).toBe(signs.filter((s) => s < 0).length);
    }
  });

  it('winds the gable and hipped roof bodies outward, so a DoubleSide roof lights its outside', () => {
    for (const style of ['gable', 'hipped'] as const) {
      const scene = new THREE.Scene();
      buildRoof(THREE, { scene, width: 10, depth: 8, baseY: 6, spec: { style } });
      const roof = scene.getObjectByName('Roof') as ThreeNS.Mesh;
      roof.updateMatrixWorld(true);
      const centre = new THREE.Box3().setFromObject(roof).getCenter(new THREE.Vector3());
      // The base sits under the centre: lift it to the solid's centroid height.
      centre.y = 6 + 0.3;
      // The gable's verges, past its end walls at x = ±5, are solids of their own.
      const signs = windings(roof, centre, (mid) => style === 'hipped' || Math.abs(mid.x) <= 5 + 1e-6);
      expect(signs.length).toBeGreaterThan(4);
      expect(signs.every((s) => s > 0)).toBe(true);
    }
  });
});
