// @vitest-environment jsdom
import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { makeFloor, makeLayout } from '../lib/__testfixtures__/fixtures';
import { disposeObject } from './builder-utils';
import { buildExportBuilding, prepareExportBuilding } from './building-export';
import { buildRoom, clearFloorPlanImageCache } from './room-builder';
import type { RoomLayout } from '../lib/types';

type ThreeModule = typeof import('./three-runtime');

/** An ImageLoader whose decodes the test settles by hand. */
function controlledLoader() {
  const pending: Array<{ onLoad: (image: HTMLImageElement) => void; onError: (error: unknown) => void }> = [];
  class FakeImageLoader {
    load(_url: string, onLoad: (image: HTMLImageElement) => void, _onProgress: unknown, onError: (error: unknown) => void): void {
      pending.push({ onLoad, onError });
    }
  }
  const three = { ...THREE, ImageLoader: FakeImageLoader } as unknown as ThreeModule;
  return { three, pending };
}

function tracedLayout(): RoomLayout {
  return makeLayout({
    floors: [makeFloor(), makeFloor({ id: 'f1', name: 'Upstairs' })],
    floorPlanImage: 'data:image/png;base64,AAAA',
    floorPlanOpacity: 0.5,
    floorPlanFitMode: 'stretch',
  });
}

function floorMap(root: THREE.Object3D): THREE.Texture {
  const floor = root.children[0]!.children.find((child) => child.name === 'Floor') as THREE.Mesh;
  return (floor.material as THREE.MeshStandardMaterial).map!;
}

function decodedImage(): HTMLImageElement {
  const image = document.createElement('img');
  Object.defineProperty(image, 'naturalWidth', { value: 64 });
  Object.defineProperty(image, 'naturalHeight', { value: 64 });
  return image;
}

afterEach(() => {
  clearFloorPlanImageCache();
  vi.restoreAllMocks();
});

describe('GLB export of a traced floor plan (#373)', () => {
  it('waits for a cold plan to decode, so the export carries it', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {}); // jsdom has no canvas
    const { three, pending } = controlledLoader();
    const layout = tracedLayout();
    const ready = prepareExportBuilding(three, layout);
    const image = decodedImage();
    pending[0]!.onLoad(image);
    await ready;

    const root = buildExportBuilding(three, layout);
    expect(floorMap(root).image).toBe(image);
    disposeObject(root);
  });

  it('goes on without the plan when it fails to decode', async () => {
    const { three, pending } = controlledLoader();
    const layout = tracedLayout();
    const ready = prepareExportBuilding(three, layout);
    pending[0]!.onError(new Error('broken'));
    await expect(ready).resolves.toBeUndefined();
  });

  it('a decode landing after the floor was disposed leaves its textures alone', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { three, pending } = controlledLoader();
    const root = buildExportBuilding(three, tracedLayout());
    const map = floorMap(root);
    const version = map.version;
    disposeObject(root);

    pending[0]!.onLoad(decodedImage());
    expect(map.version).toBe(version);
    expect(map.image).not.toBeInstanceOf(HTMLImageElement);
  });
});

describe('GLB export of the pattern relief (#757)', () => {
  /** A 2D context that draws nothing but hands back pixel buffers, so the relief maps get made. */
  function fakeCanvas(): void {
    const pixels = (w: number, h: number) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) });
    const named: Record<string, unknown> = {
      getImageData: (_x: number, _y: number, w: number, h: number) => pixels(w, h),
      createImageData: (w: number, h: number) => pixels(w, h),
      createLinearGradient: () => ({ addColorStop: () => undefined }),
      createRadialGradient: () => ({ addColorStop: () => undefined }),
    };
    const context = new Proxy({}, { get: (_t, key) => (key === 'canvas' ? undefined : (named[key as string] ?? (() => undefined))), set: () => true });
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => context as never);
  }

  it('leaves the normal and roughness maps out, at the flat roughness', () => {
    fakeCanvas();
    const layout = makeLayout({ floors: [makeFloor({ floorPattern: 'wood', wallPattern: 'brick' })] });
    // The view's materials do carry them.
    const scratch = new THREE.Scene();
    buildRoom(THREE, {
      scene: scratch, width: layout.width, depth: layout.height, floorColor: '#ccc', floorPattern: 'wood', wallPattern: 'brick',
      floorPlanImage: null, floorPlanOpacity: 1, floorPlanFitMode: 'stretch', floorPlan3DEffect: false,
    });
    const relief = (root: THREE.Object3D) => {
      const out: THREE.MeshStandardMaterial[] = [];
      root.traverse((node) => {
        const material = (node as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
        for (const m of material ? (Array.isArray(material) ? material : [material]) : []) {
          if ((m as THREE.MeshStandardMaterial).map) out.push(m as THREE.MeshStandardMaterial);
        }
      });
      return out;
    };
    expect(relief(scratch).some((m) => m.normalMap && m.roughnessMap)).toBe(true);

    const root = buildExportBuilding(THREE, layout);
    const patterned = relief(root).filter((m) => m.map?.image instanceof HTMLCanvasElement);
    expect(patterned.length).toBeGreaterThan(0);
    for (const m of patterned) {
      expect(m.normalMap).toBeNull();
      expect(m.roughnessMap).toBeNull();
      expect(m.roughness).toBeLessThan(1);
    }
    disposeObject(scratch);
    disposeObject(root);
  });
});
