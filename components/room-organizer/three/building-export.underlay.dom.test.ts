// @vitest-environment jsdom
import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { makeFloor, makeLayout } from '../lib/__testfixtures__/fixtures';
import { disposeObject } from './builder-utils';
import { buildExportBuilding, prepareExportBuilding } from './building-export';
import { ROOM_OBJECT_TAGS, clearFloorPlanImageCache } from './room-builder';
import type { FloorPlanMode, RoomLayout } from '../lib/types';

type ThreeModule = typeof import('./three-runtime');

/** Counts every ImageLoader decode asked for; none settles. */
function countingLoader() {
  const urls: string[] = [];
  class FakeImageLoader {
    load(url: string): void {
      urls.push(url);
    }
  }
  return { three: { ...THREE, ImageLoader: FakeImageLoader } as unknown as ThreeModule, urls };
}

function traced(mode?: FloorPlanMode): RoomLayout {
  return makeLayout({
    floors: [makeFloor(), makeFloor({ id: 'f1', name: 'Upstairs' })],
    floorPlanImage: 'data:image/png;base64,AAAA',
    floorPlanOpacity: 0.5,
    ...(mode ? { floorPlanMode: mode } : {}),
  });
}

/** The ground storey's shell: its outer wall meshes and the foundation. */
function groundShell(root: THREE.Object3D): { walls: number; foundation: boolean } {
  const storey = root.children[0]!;
  let walls = 0;
  let foundation = false;
  storey.traverse((node) => {
    if (node.userData.type === ROOM_OBJECT_TAGS.Wall && (node as THREE.Mesh).isMesh) walls += 1;
    if (node.name === 'Foundation') foundation = true;
  });
  return { walls, foundation };
}

afterEach(() => {
  clearFloorPlanImageCache();
  vi.restoreAllMocks();
});

describe('a traced plan as an underlay (#920)', () => {
  it('builds the ground floor shell and foundation, which the drawing leaves out', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {}); // jsdom has no canvas
    const { three } = countingLoader();
    const plain = buildExportBuilding(three, makeLayout({ floors: [makeFloor(), makeFloor({ id: 'f1', name: 'Upstairs' })] }));
    const underlay = buildExportBuilding(three, traced('underlay'));
    const drawing = buildExportBuilding(three, traced());

    const built = groundShell(plain);
    expect(built.walls).toBeGreaterThan(0);
    expect(built.foundation).toBe(true);
    expect(groundShell(underlay).walls).toBe(built.walls);
    expect(groundShell(underlay).foundation).toBe(true);
    // The drawing is unchanged: no outer walls, no foundation.
    expect(groundShell(drawing).walls).toBe(0);
    expect(groundShell(drawing).foundation).toBe(false);
    for (const root of [plain, underlay, drawing]) disposeObject(root);
  });

  it('never loads the image for the 3D floor or the file', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { three, urls } = countingLoader();
    await prepareExportBuilding(three, traced('underlay'));
    disposeObject(buildExportBuilding(three, traced('underlay')));
    expect(urls).toEqual([]);
    // The drawing still asks for it.
    disposeObject(buildExportBuilding(three, traced()));
    expect(urls).toEqual(['data:image/png;base64,AAAA']);
  });
});
