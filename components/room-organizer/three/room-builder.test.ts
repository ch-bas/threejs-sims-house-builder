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

const wall = (wallId: string, visible = true, storey = 0): FakeObject => ({ visible, userData: { type: 'wall', wallId, storey } });
const grid = (): FakeObject => ({ visible: true, userData: { type: 'wall' } });
const roof = (visible = true): FakeObject => ({ visible, userData: { type: 'roof' } });
const interior = (wallId: string, visible = true): FakeObject => ({ visible, userData: { type: 'interior-wall', wallId, storey: 0 } });
const outline = (ownerTag: string, wallId: string, visible = true): FakeObject => ({
  visible,
  userData: { type: 'wall-selection', ownerTag, ownerStorey: 0, wallId },
});

describe('applyWallDisplay', () => {
  it("'up' shows every wall and the roof; 'down' hides walls but keeps the grid", () => {
    const children = [wall('north'), wall('south'), grid(), roof(), interior('iw1')];
    applyWallDisplay(makeScene(children), 0, 10, 'up', 8, 8);
    expect(children.map((c) => c.visible)).toEqual([true, true, true, true, true]);

    applyWallDisplay(makeScene(children), 0, 10, 'down', 8, 8);
    expect(children.map((c) => c.visible)).toEqual([false, false, true, false, false]);
  });

  it('keeps a roof flagged off-storey hidden even with every wall up (#283)', () => {
    const offStorey: FakeObject = { visible: true, userData: { type: 'roof', roofOffStorey: true } };
    const children = [wall('north'), roof(), offStorey];
    applyWallDisplay(makeScene(children), 0, 10, 'up', 8, 8);
    expect(children.map((c) => c.visible)).toEqual([true, true, false]);
  });

  it('keeps walls and partitions of a storey the walkthrough hides hidden in every mode (#446)', () => {
    const off = (o: FakeObject): FakeObject => ({ ...o, userData: { ...o.userData, offStorey: true } });
    const children = [wall('north'), off(wall('north')), off(grid()), off(interior('iw1')), interior('iw2')];
    applyWallDisplay(makeScene(children), 0, 10, 'up', 8, 8);
    expect(children.map((c) => c.visible)).toEqual([true, false, false, false, true]);
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

// A door or window is a furniture group stamped with the wall it is cut
// into; cutaway and walls-down left every frame standing where the wall had
// been (#659).
describe('applyWallDisplay: doors and windows follow their wall (#659)', () => {
  const opening = (ownerTag: string, wallId: string, extra: Record<string, unknown> = {}): FakeObject => ({
    visible: true,
    userData: { type: 'furniture', ownerTag, wallId, floorIndex: 0, ...extra },
  });
  const sofa = (): FakeObject => ({ visible: true, userData: { type: 'furniture', floorIndex: 0 } });

  it('hides a window with the wall the cutaway removes, and brings it back', () => {
    const children = [wall('south'), wall('north'), opening('wall', 'south'), opening('wall', 'north'), sofa()];
    const scene = makeScene(children);
    applyWallDisplay(scene, 0, 10, 'cutaway', 8, 8);
    expect(children.map((c) => c.visible)).toEqual([false, true, false, true, true]);
    applyWallDisplay(scene, 0, -10, 'cutaway', 8, 8);
    expect(children.map((c) => c.visible)).toEqual([true, false, true, false, true]);
  });

  it('walls-down hides every opening, in exterior and interior walls, and keeps the furniture', () => {
    const children = [wall('east'), interior('iw1'), opening('wall', 'east'), opening('interior-wall', 'iw1'), sofa()];
    const scene = makeScene(children);
    applyWallDisplay(scene, 0, 10, 'down', 8, 8);
    expect(children.map((c) => c.visible)).toEqual([false, false, false, false, true]);
    applyWallDisplay(scene, 0, 10, 'up', 8, 8);
    expect(children.every((c) => c.visible)).toBe(true);
  });

  it('never shows an opening of a storey the walkthrough hides', () => {
    const children = [wall('north'), opening('wall', 'north', { offStorey: true })];
    applyWallDisplay(makeScene(children), 0, 10, 'up', 8, 8);
    expect(children[1]!.visible).toBe(false);
  });

  describe('on a two-storey house', () => {
    const storeyWall = (wallId: string, storey: number, off: boolean): FakeObject => ({
      visible: true,
      userData: { type: 'wall', wallId, storey, offStorey: off },
    });

    it('a hidden storey leaves the walker storey openings with their walls, whichever storey is built last', () => {
      for (const shell of [
        [storeyWall('south', 0, false), storeyWall('south', 1, true)],
        [storeyWall('south', 1, true), storeyWall('south', 0, false)],
      ]) {
        const below = opening('wall', 'south');
        const above = opening('wall', 'south', { floorIndex: 1, offStorey: true });
        applyWallDisplay(makeScene([...shell, below, above]), 0, 0, 'up', 8, 8);
        expect(below.visible).toBe(true);
        expect(above.visible).toBe(false);
      }
    });

    it('each storey keeps its own cutaway answer', () => {
      const walls = [storeyWall('south', 0, false), storeyWall('south', 1, false)];
      const ground = opening('wall', 'south');
      const first = opening('wall', 'south', { floorIndex: 1 });
      const scene = makeScene([...walls, ground, first]);
      applyWallDisplay(scene, 0, 10, 'cutaway', 8, 8);
      expect([ground.visible, first.visible]).toEqual([false, false]);
      applyWallDisplay(scene, 0, 0, 'cutaway', 8, 8);
      expect([ground.visible, first.visible]).toEqual([true, true]);
    });
  });

  describe('on the notch walls of an L', () => {
    const notchWall = (side: string, plane: number, shellWall: string, extra: Record<string, unknown> = {}): FakeObject => ({
      visible: true,
      userData: { type: 'wall', wallId: side, wallPlane: plane, shellWall, storey: 0, ...extra },
    });

    it('walls-down hides a door on a notch wall, and the wall keeps its own cutaway answer', () => {
      const children = [wall('north'), notchWall('north', -2, 'notch-x'), opening('wall', 'notch-x'), opening('wall', 'north')];
      const scene = makeScene(children);
      applyWallDisplay(scene, 0, 10, 'down', 8, 8);
      expect(children.map((c) => c.visible)).toEqual([false, false, false, false]);
      applyWallDisplay(scene, 0, -3, 'cutaway', 8, 8);
      expect(children[2]!.visible).toBe(children[1]!.visible);
      expect(children[3]!.visible).toBe(children[0]!.visible);
    });

    it('a notch wall never answers for the main wall of its side', () => {
      const main = wall('north');
      const notch = notchWall('north', -2, 'notch-x');
      const onMain = opening('wall', 'north');
      // Between the two planes: outside the notch wall, inside the main wall.
      applyWallDisplay(makeScene([main, notch, onMain]), 0, -3, 'cutaway', 8, 8);
      expect(notch.visible).toBe(false);
      expect(main.visible).toBe(true);
      expect(onMain.visible).toBe(true);
    });

    it('an opening on a hidden storey stays hidden while its notch wall is hidden too', () => {
      const children = [
        notchWall('north', -2, 'notch-x', { storey: 1, offStorey: true }),
        opening('wall', 'notch-x', { floorIndex: 1, offStorey: true }),
      ];
      applyWallDisplay(makeScene(children), 0, 0, 'up', 8, 8);
      expect(children[1]!.visible).toBe(false);
    });
  });

  describe('with no such wall built', () => {
    it('honours a hidden storey', () => {
      const door = opening('wall', 'south', { offStorey: true });
      applyWallDisplay(makeScene([door]), 0, 0, 'up', 8, 8);
      expect(door.visible).toBe(false);
    });

    it('shows with the walls up and goes in walls-down', () => {
      const door = opening('wall', 'south');
      const scene = makeScene([door]);
      applyWallDisplay(scene, 0, 0, 'down', 8, 8);
      expect(door.visible).toBe(false);
      applyWallDisplay(scene, 0, 0, 'up', 8, 8);
      expect(door.visible).toBe(true);
    });
  });
});
