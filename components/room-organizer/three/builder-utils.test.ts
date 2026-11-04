import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { disposeScene, softBox } from './builder-utils';

describe('disposeScene (#213)', () => {
  it('disposes every geometry, material, texture and instanced buffer, and empties the scene', () => {
    const scene = new THREE.Scene();
    const disposed = new Set<object>();
    const track = <T extends THREE.EventDispatcher<{ dispose: object }>>(resource: T): T => {
      resource.addEventListener('dispose', () => disposed.add(resource));
      return resource;
    };

    const texture = track(new THREE.Texture());
    const spriteMaterial = track(new THREE.SpriteMaterial({ map: texture }));
    const sprite = new THREE.Sprite(spriteMaterial);
    const geometry = track(new THREE.BoxGeometry());
    const material = track(new THREE.MeshStandardMaterial());
    const nested = new THREE.Group().add(new THREE.Mesh(geometry, material));
    const instanced = track(
      new THREE.InstancedMesh(track(new THREE.BoxGeometry()), track(new THREE.MeshBasicMaterial()), 4)
    );
    const background = track(new THREE.Texture());
    scene.background = background;
    scene.add(sprite, nested, instanced);

    disposeScene(scene);

    expect(scene.children).toHaveLength(0);
    expect(scene.background).toBeNull();
    for (const resource of [texture, spriteMaterial, geometry, material, instanced, background]) {
      expect(disposed.has(resource)).toBe(true);
    }
    expect(disposed.size).toBe(8);
  });
});

describe('softBox (#755)', () => {
  const triangles = (geometry: THREE.BufferGeometry): THREE.Vector3[][] => {
    const position = geometry.getAttribute('position');
    const index = geometry.getIndex()!;
    const out: THREE.Vector3[][] = [];
    for (let i = 0; i < index.count; i += 3) {
      out.push([0, 1, 2].map((k) => new THREE.Vector3().fromBufferAttribute(position, index.getX(i + k))));
    }
    return out;
  };

  it('costs 44 triangles: 6 faces, 12 edges, 8 corners', () => {
    expect(triangles(softBox(THREE, 2, 1, 0.5, 0.04))).toHaveLength(44);
  });

  it('is exactly the size of the box it replaces, centred', () => {
    const geometry = softBox(THREE, 2, 1, 0.5, 0.04);
    geometry.computeBoundingBox();
    expect(geometry.boundingBox!.min.toArray()).toEqual([-1, -0.5, -0.25]);
    expect(geometry.boundingBox!.max.toArray()).toEqual([1, 0.5, 0.25]);
  });

  it('winds every triangle outwards', () => {
    for (const [a, b, c] of triangles(softBox(THREE, 2, 1, 0.5, 0.04))) {
      const normal = b!.clone().sub(a!).cross(c!.clone().sub(a!));
      const centre = a!.clone().add(b!).add(c!);
      expect(normal.dot(centre)).toBeGreaterThan(0);
    }
  });

  it('keeps faces flat and turns the normals across a chamfer', () => {
    const normal = softBox(THREE, 2, 1, 0.5, 0.04).getAttribute('normal');
    for (let i = 0; i < normal.count; i += 1) {
      const n = new THREE.Vector3().fromBufferAttribute(normal, i);
      expect(Math.max(Math.abs(n.x), Math.abs(n.y), Math.abs(n.z))).toBe(1);
    }
  });

  it('tilts the normals of a puffed cushion outwards, still on the same box', () => {
    const geometry = softBox(THREE, 1, 0.2, 1, 0.05, { puff: 0.4 });
    const normal = geometry.getAttribute('normal');
    const tilted = Array.from({ length: normal.count }, (_, i) => Math.abs(normal.getY(i))).filter((y) => y > 0.5 && y < 0.99);
    expect(tilted.length).toBeGreaterThan(0);
    expect(new THREE.Vector3().fromBufferAttribute(normal, 0).length()).toBeCloseTo(1, 5);
    geometry.computeBoundingBox();
    expect(geometry.boundingBox!.max.y).toBeCloseTo(0.1, 6);
  });

  it('never lets the chamfer pass the middle of a thin part', () => {
    const position = softBox(THREE, 1, 0.01, 1, 0.04).getAttribute('position');
    for (let i = 0; i < position.count; i += 1) {
      expect(Math.abs(position.getX(i))).toBeGreaterThan(0.49);
    }
  });

  it('measures UVs in metres along the longer side of a face', () => {
    const uv = softBox(THREE, 0.08, 2, 0.08, 0.005).getAttribute('uv');
    const us = Array.from({ length: uv.count }, (_, i) => uv.getX(i));
    expect(Math.max(...us) - Math.min(...us)).toBeCloseTo(2, 5);
  });
});
