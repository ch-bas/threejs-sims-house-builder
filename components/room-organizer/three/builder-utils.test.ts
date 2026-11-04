import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { disposeScene, markSharedTexture, removeAndDispose } from './builder-utils';

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
