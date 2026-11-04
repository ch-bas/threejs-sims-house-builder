import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { makeFloor, makeItem, makeLayout } from '../lib/__testfixtures__/fixtures';
import { BASEBOARD_WALL_GAP } from './baseboard';
import { disposeObject } from './builder-utils';
import { buildExportBuilding } from './building-export';
import { createFurnitureModel } from './furniture-builders';
import { EXTERIOR_SILL_KEY, REVEAL_BOARD, REVEAL_DECOR_GAP, REVEAL_DEPTH, REVEAL_SETBACK, REVEAL_WALL_GAP, openingSetback, revealBoxes, revealSetbacks, setBackOpening } from './reveals';
import { buildRoom } from './room-builder';
import { classifyOpeningOwners, computeWallOpenings } from './wall-openings';
import type { FurnitureItem } from '../lib/types';
import type * as ThreeNS from 'three';

const window = (overrides: Partial<FurnitureItem> = {}) =>
  makeItem({ id: 'w', type: 'window', name: 'Window', width: 1.2, depth: 0.12, height: 1.2, position: { x: 1, z: -3 }, ...overrides });
const door = (overrides: Partial<FurnitureItem> = {}) =>
  makeItem({ id: 'd', type: 'door', name: 'Door', width: 0.9, depth: 0.12, height: 2.05, position: { x: -2, z: -3 }, ...overrides });
const curtains = (overrides: Partial<FurnitureItem> = {}) =>
  makeItem({ id: 'c', type: 'curtains', name: 'Curtains', width: 1.4, depth: 0.2, height: 2.4, position: { x: 1, z: -2.9 }, ...overrides });
const context = { width: 8, depth: 6 };
const owner = (item: FurnitureItem) => classifyOpeningOwners([item], 8, 6).get(item.id);

describe('opening set-back (#758)', () => {
  it('sets a door or window in an outer wall back into the house, along its own facing', () => {
    expect(openingSetback(window(), owner(window()), context)).toBe(REVEAL_SETBACK);
    // Turned round, its +z faces out: the set-back flips to keep it going in.
    const turned = window({ rotation: Math.PI });
    expect(openingSetback(turned, owner(turned), context)).toBe(-REVEAL_SETBACK);
    const east = door({ position: { x: 4, z: 0 }, rotation: -Math.PI / 2 });
    expect(openingSetback(east, owner(east), context)).toBe(REVEAL_SETBACK);
  });

  it('leaves anything else where it is', () => {
    expect(openingSetback(window(), owner(window()), { ...context, hiddenWalls: ['north'] })).toBe(0);
    expect(openingSetback(window(), owner(window()), { ...context, noWalls: true })).toBe(0);
    const free = window({ position: { x: 0, z: 0 } });
    expect(openingSetback(free, owner(free), context)).toBe(0);
    expect(openingSetback(makeItem(), undefined, context)).toBe(0);
    expect(openingSetback(window(), { kind: 'interior', wallId: 'p' }, context)).toBe(0);
  });

  it('moves every part but the outside sill, and never the group itself', () => {
    const plain = createFurnitureModel(THREE, window(), false, 3);
    const set = createFurnitureModel(THREE, window(), false, 3, REVEAL_SETBACK);
    expect(set.position.z).toBe(0);
    set.children.forEach((child, i) => {
      const moved = child.position.z - plain.children[i]!.position.z;
      expect(moved).toBeCloseTo(child.userData[EXTERIOR_SILL_KEY] === true ? 0 : REVEAL_SETBACK);
    });
    expect(set.children.filter((c) => c.userData[EXTERIOR_SILL_KEY] === true)).toHaveLength(1);
    disposeObject(plain);
    disposeObject(set);
  });
});

describe('curtains over a set-back window (#758)', () => {
  const setbacksOf = (items: FurnitureItem[]) => revealSetbacks(items, classifyOpeningOwners(items, 8, 6), context, 3);

  it('stand out into the room until their back clears the frame and lining', () => {
    const items = [window(), curtains()];
    const standOff = setbacksOf(items).get('c')!;
    // Centre 0.1 m in, back on the wall: out to just past the lining.
    expect(standOff).toBeCloseTo(REVEAL_DEPTH + REVEAL_DECOR_GAP);
    const group = createFurnitureModel(THREE, curtains(), false, 3, standOff);
    group.position.set(1, 0, -2.9);
    const box = new THREE.Box3().setFromObject(group);
    expect(box.min.z).toBeGreaterThan(-3 + REVEAL_DEPTH);
    disposeObject(group);
  });

  it('along their own facing, and only where a set-back opening is behind them', () => {
    // Turned round, their +z faces the wall: out is −z.
    expect(setbacksOf([window(), curtains({ rotation: Math.PI })]).get('c')!).toBeLessThan(0);
    // Hung clear of it already, beside it, or over a window in an interior wall: left alone.
    expect(setbacksOf([window(), curtains({ position: { x: 1, z: -2.5 } })]).has('c')).toBe(false);
    expect(setbacksOf([window(), curtains({ position: { x: 3.5, z: -2.9 } })]).has('c')).toBe(false);
    expect(setbacksOf([curtains()]).has('c')).toBe(false);
    expect(revealSetbacks([window(), curtains()], classifyOpeningOwners([window(), curtains()], 8, 6), { ...context, hiddenWalls: ['north'] }, 3).size).toBe(0);
    // A painting under a window's sill stays on the wall; one across a low window stands out too.
    const painting = makeItem({ id: 'p', type: 'painting', width: 0.6, depth: 0.05, height: 0.4, position: { x: 1, z: -2.97 } });
    expect(setbacksOf([window({ sillHeight: 1.5 }), painting]).has('p')).toBe(false);
    expect(setbacksOf([window({ sillHeight: 0.5 }), painting]).get('p')!).toBeGreaterThan(0);
  });

  it('moves a group by the difference when set again, as the placement ghost does', () => {
    const plain = createFurnitureModel(THREE, window(), false, 3);
    const moved = createFurnitureModel(THREE, window(), false, 3);
    setBackOpening(moved, REVEAL_SETBACK);
    setBackOpening(moved, -REVEAL_SETBACK);
    setBackOpening(moved, 0);
    moved.children.forEach((child, i) => expect(child.position.z).toBeCloseTo(plain.children[i]!.position.z));
    disposeObject(plain);
    disposeObject(moved);
  });
});

describe('reveal linings (#758)', () => {
  it('lines a window on four sides and a door on three, outside the hole', () => {
    const openings = computeWallOpenings([window(), door()], 8, 6, 3);
    const boxes = revealBoxes(openings.get('north')!, 8, 3);
    expect(boxes).toHaveLength(7);
    // Nothing inside either hole: the frame fills it, and the walker's door gap stays.
    for (const o of openings.get('north')!) {
      const [x0, x1] = [o.centerAlongWall - o.width / 2, o.centerAlongWall + o.width / 2];
      const [y0, y1] = [-1.5 + o.bottomFromFloor, -1.5 + o.bottomFromFloor + o.height];
      for (const b of boxes) expect(b.x1 <= x0 + 1e-9 || b.x0 >= x1 - 1e-9 || b.y1 <= y0 + 1e-9 || b.y0 >= y1 - 1e-9).toBe(true);
    }
  });

  it("keeps a low window's sill board above its storey's floor", () => {
    const boxes = revealBoxes([{ id: 'w', centerAlongWall: 0, bottomFromFloor: 0.03, width: 1, height: 1 }], 8, 3);
    expect(Math.min(...boxes.map((b) => b.y0))).toBeCloseTo(-1.5);
    expect(boxes).toHaveLength(4);
  });

  it('ends the skirting inside the jamb, never in the plane of its face (#276)', () => {
    const scene = new THREE.Scene();
    buildRoom(THREE, {
      scene, width: 8, depth: 6, floorColor: '#ccc', wallOpenings: computeWallOpenings([door()], 8, 6, 3),
      floorPlanImage: null, floorPlanOpacity: 1, floorPlanFitMode: 'stretch', floorPlan3DEffect: false,
    });
    const boards = scene.children.filter((o) => o.name === 'Baseboard north').map((o) => new THREE.Box3().setFromObject(o));
    expect(boards).toHaveLength(2);
    // The door's hole runs x = -2.45..-1.55; its jambs a board wider each side.
    const ends = boards.map((b) => (b.max.x < -2 ? b.max.x : b.min.x));
    expect(ends[0]).toBeCloseTo(-2.45 - REVEAL_BOARD / 2);
    expect(ends[1]).toBeCloseTo(-1.55 + REVEAL_BOARD / 2);
    // Its back is still clear of the wall, its front inside the lining's depth.
    for (const b of boards) expect(b.min.z).toBeCloseTo(-3 + BASEBOARD_WALL_GAP);
    disposeObject(scene);
  });

  it('leaves the recessed entrance to its porch', () => {
    expect(revealBoxes([{ id: 'entrance', centerAlongWall: 0, bottomFromFloor: 0, width: 2, height: 2.2 }], 8, 3)).toHaveLength(0);
  });

  it('builds one lining per wall, tagged like it, running into the house from just behind its plane', () => {
    const scene = new THREE.Scene();
    const items = [window(), door()];
    buildRoom(THREE, {
      scene, width: 8, depth: 6, floorColor: '#ccc', wallOpenings: computeWallOpenings(items, 8, 6, 3),
      floorPlanImage: null, floorPlanOpacity: 1, floorPlanFitMode: 'stretch', floorPlan3DEffect: false,
    });
    const linings = scene.children.filter((o) => o.name.startsWith('Reveal ')) as ThreeNS.Mesh[];
    expect(linings).toHaveLength(1);
    const [lining] = linings;
    expect(lining!.userData).toMatchObject({ type: 'wall', wallId: 'north' });
    expect(lining!.castShadow).toBe(true);
    const box = new THREE.Box3().setFromObject(lining!);
    expect(box.min.z).toBeCloseTo(-3 + REVEAL_WALL_GAP);
    expect(box.max.z).toBeCloseTo(-3 + REVEAL_DEPTH);
  });

  it('goes into the GLB with the door and window set back in it', () => {
    const root = buildExportBuilding(THREE, makeLayout({ width: 8, height: 6, floors: [makeFloor({ items: [window(), door()] })] }));
    expect(root.getObjectByName('Reveal north')).toBeDefined();
    const win = root.getObjectByName('Window')!;
    expect(win.userData.revealSetback).toBe(REVEAL_SETBACK);
    disposeObject(root);
  });
});
