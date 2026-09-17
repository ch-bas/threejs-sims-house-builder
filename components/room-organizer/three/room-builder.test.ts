import { describe, expect, it } from 'vitest';
import { applyWallDisplay } from './room-builder';
import type * as ThreeNS from 'three';

/**
 * applyWallDisplay only reads/writes `.visible` and `.userData` on scene
 * children, so plain objects stand in for Object3D — no GPU or three renderer
 * needed to pin the visibility contract (#132/#133).
 */
interface FakeObject {
  visible: boolean;
  userData: Record<string, unknown>;
}

function makeScene(children: FakeObject[]): ThreeNS.Scene {
  return { children } as unknown as ThreeNS.Scene;
}

const wall = (wallId: string, visible = true): FakeObject => ({ visible, userData: { type: 'wall', wallId } });
const grid = (): FakeObject => ({ visible: true, userData: { type: 'wall' } });
const roof = (visible = true): FakeObject => ({ visible, userData: { type: 'roof' } });
const interior = (wallId: string, visible = true): FakeObject => ({ visible, userData: { type: 'interior-wall', wallId } });
const outline = (ownerTag: string, wallId: string, visible = true): FakeObject => ({
  visible,
  userData: { type: 'wall-selection', ownerTag, wallId },
});

describe('applyWallDisplay', () => {
  it("'up' shows every wall and the roof; 'down' hides walls but keeps the grid", () => {
    const children = [wall('north'), wall('south'), grid(), roof(), interior('iw1')];
    applyWallDisplay(makeScene(children), 0, 10, 'up', 8, 8);
    expect(children.map((c) => c.visible)).toEqual([true, true, true, true, true]);

    applyWallDisplay(makeScene(children), 0, 10, 'down', 8, 8);
    expect(children.map((c) => c.visible)).toEqual([false, false, true, false, false]);
  });

  it('cutaway hides only the walls between the camera and the room', () => {
    const children = [wall('north'), wall('south'), wall('east'), wall('west'), roof()];
    // Camera south of the room: the south wall faces it and is cut away.
    applyWallDisplay(makeScene(children), 0, 10, 'cutaway', 8, 8);
    expect(children.map((c) => c.visible)).toEqual([true, false, true, true, false]);
  });

  it('returns true only when some visibility actually flipped (#132)', () => {
    const children = [wall('north'), wall('south'), roof()];
    const scene = makeScene(children);
    expect(applyWallDisplay(scene, 0, 10, 'cutaway', 8, 8)).toBe(true);
    // Same camera side again: nothing changes, no shadow refresh needed.
    expect(applyWallDisplay(scene, 1, 12, 'cutaway', 8, 8)).toBe(false);
    // Crossing to the north side flips both walls.
    expect(applyWallDisplay(scene, 0, -10, 'cutaway', 8, 8)).toBe(true);
  });

  it('keeps the selection outline in lockstep with its owner wall (#133)', () => {
    const children = [wall('south'), outline('wall', 'south'), interior('iw1'), outline('interior-wall', 'iw1')];
    const scene = makeScene(children);
    // Camera south: the south wall is cut away — its outline must go too.
    applyWallDisplay(scene, 0, 10, 'cutaway', 8, 8);
    expect(children[0]!.visible).toBe(false);
    expect(children[1]!.visible).toBe(false);
    expect(children[3]!.visible).toBe(true);
    // Walls-down hides interior walls — and their outlines.
    applyWallDisplay(scene, 0, 10, 'down', 8, 8);
    expect(children[2]!.visible).toBe(false);
    expect(children[3]!.visible).toBe(false);
    // Back up: everything (and both outlines) returns.
    applyWallDisplay(scene, 0, 10, 'up', 8, 8);
    expect(children.every((c) => c.visible)).toBe(true);
  });
});
