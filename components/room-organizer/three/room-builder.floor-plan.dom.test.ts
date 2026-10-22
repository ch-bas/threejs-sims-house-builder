// @vitest-environment jsdom
import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { disposeObject } from './builder-utils';
import { buildRoom, clearFloorPlanImageCache } from './room-builder';

type ThreeModule = typeof import('./three-runtime');

/** An ImageLoader whose decodes the test settles by hand. */
function deferredLoader() {
  const pending: Array<(image: HTMLImageElement) => void> = [];
  class FakeImageLoader {
    load(_url: string, onLoad: (image: HTMLImageElement) => void): void {
      pending.push(onLoad);
    }
  }
  const three = { ...THREE, ImageLoader: FakeImageLoader } as unknown as ThreeModule;
  return { three, pending };
}

function decodedImage(): HTMLImageElement {
  const image = document.createElement('img');
  Object.defineProperty(image, 'naturalWidth', { value: 64 });
  Object.defineProperty(image, 'naturalHeight', { value: 48 });
  return image;
}

function buildTracedFloor(three: ThreeModule, onTextureLoaded = () => {}): { scene: THREE.Scene; material: THREE.MeshStandardMaterial } {
  const scene = new THREE.Scene();
  buildRoom(three, {
    scene,
    width: 8,
    depth: 6,
    floorColor: '#c9a57d',
    floorPlanImage: 'data:image/png;base64,AAAA',
    floorPlanOpacity: 0.5,
    floorPlanFitMode: 'stretch',
    floorPlan3DEffect: false,
    onTextureLoaded,
  });
  const floor = scene.children.find((child) => child.name === 'Floor') as THREE.Mesh;
  return { scene, material: floor.material as THREE.MeshStandardMaterial };
}

beforeEach(() => {
  // jsdom has no 2D canvas; the placeholder and the fitted composite need one.
  const ctx = { fillRect: () => {}, drawImage: () => {}, fillStyle: '', globalAlpha: 1 };
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
    () => ctx as unknown as CanvasRenderingContext2D
  );
});

afterEach(() => {
  clearFloorPlanImageCache();
  vi.restoreAllMocks();
});

describe('floor-plan texture when the decode lands late (#521)', () => {
  it('swaps in a fresh texture on its own source and disposes the 1×1 placeholder', () => {
    const { three, pending } = deferredLoader();
    const loaded = vi.fn();
    const { scene, material } = buildTracedFloor(three, loaded);
    const placeholder = material.map!;
    expect((placeholder.image as HTMLCanvasElement).width).toBe(1);
    const onDispose = vi.fn();
    placeholder.addEventListener('dispose', onDispose);

    pending[0]!(decodedImage());

    const fresh = material.map!;
    expect(fresh).not.toBe(placeholder);
    expect(fresh.source).not.toBe(placeholder.source);
    expect((fresh.image as HTMLCanvasElement).width).toBeGreaterThan(1);
    expect(fresh.version).toBeGreaterThan(0);
    expect(fresh.colorSpace).toBe(THREE.SRGBColorSpace);
    expect(onDispose).toHaveBeenCalledTimes(1);
    expect(loaded).toHaveBeenCalledTimes(1);
    disposeObject(scene);
  });

  it('a floor disposed before the decode lands is left alone', () => {
    const { three, pending } = deferredLoader();
    const loaded = vi.fn();
    const { scene, material } = buildTracedFloor(three, loaded);
    const placeholder = material.map!;
    const version = placeholder.version;
    disposeObject(scene);

    pending[0]!(decodedImage());

    expect(material.map).toBe(placeholder);
    expect(placeholder.version).toBe(version);
    expect(loaded).not.toHaveBeenCalled();
  });
});
