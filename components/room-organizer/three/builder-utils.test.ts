import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { disposeScene, markSharedTexture, mergeParts, removeAndDispose, softBox } from './builder-utils';

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

describe('shared textures', () => {
  it('frees the material but not a texture a module cache shares', () => {
    const scene = new THREE.Scene();
    const shared = markSharedTexture(new THREE.Texture());
    const own = new THREE.Texture();
    const material = new THREE.MeshStandardMaterial({ map: shared, emissiveMap: own });
    const freed: object[] = [];
    for (const resource of [shared, own, material]) resource.addEventListener('dispose', () => freed.push(resource));
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(), material);
    scene.add(mesh);
    removeAndDispose(scene, mesh);
    expect(freed).toContain(material);
    expect(freed).toContain(own);
    expect(freed).not.toContain(shared);
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

describe('mergeParts (#755)', () => {
  it('keeps every placed part, re-indexed, as one geometry, and frees the parts', () => {
    const a = softBox(THREE, 1, 1, 1, 0.01).translate(-2, 0, 0);
    const b = new THREE.BoxGeometry(1, 1, 1).translate(2, 0, 0);
    const disposed = vi.fn();
    b.addEventListener('dispose', disposed);
    const counts = [a, b].map((part) => [part.getAttribute('position').count, part.index!.count] as const);
    const merged = mergeParts(THREE, [a, b]);
    expect(merged.getAttribute('position').count).toBe(counts[0]![0] + counts[1]![0]);
    expect(merged.index!.count).toBe(counts[0]![1] + counts[1]![1]);
    expect(Math.max(...Array.from(merged.index!.array))).toBe(merged.getAttribute('position').count - 1);
    merged.computeBoundingBox();
    expect(merged.boundingBox!.min.x).toBeCloseTo(-2.5, 6);
    expect(merged.boundingBox!.max.x).toBeCloseTo(2.5, 6);
    expect(disposed).toHaveBeenCalledTimes(1);
  });
});
