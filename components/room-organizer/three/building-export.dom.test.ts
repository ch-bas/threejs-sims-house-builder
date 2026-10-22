// @vitest-environment jsdom
import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { makeFloor, makeLayout } from '../lib/__testfixtures__/fixtures';
import { disposeObject } from './builder-utils';
import { buildExportBuilding, prepareExportBuilding } from './building-export';
import { clearFloorPlanImageCache } from './room-builder';
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
