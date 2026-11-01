import { describe, expect, it } from 'vitest';
import { makeFloor, makeItem } from './__testfixtures__/fixtures';
import { ENTRANCE_DOOR_ID, ENTRANCE_WALL_ID, type EntrancePlanOutline } from './street';
import { dragWalls, planWallMove, wallPatches, wallsOverlap, type WallGrab } from './wall-edit';
import type { InteriorWall } from './types';

const ROOM = { roomWidth: 10, roomDepth: 8 };
const wall = (id: string, x1: number, z1: number, x2: number, z2: number): InteriorWall => ({ id, x1, z1, x2, z2 });

/** A closed 4 × 3 room. */
const room = [wall('n', -2, -1, 2, -1), wall('e', 2, -1, 2, 2), wall('s', 2, 2, -2, 2), wall('w', -2, 2, -2, -1)];

function grab(walls: readonly InteriorWall[], wallId: string, grip: WallGrab['grip'] = 'body'): WallGrab {
  return { wallId, grip, at: { x: 0, z: 0 }, walls };
}

const byId = (walls: readonly InteriorWall[], id: string): InteriorWall => walls.find((entry) => entry.id === id)!;

describe('dragWalls: sliding (#718)', () => {
  it('slides along the normal only, and the room stays closed', () => {
    const after = dragWalls(grab(room, 'e'), { x: 0.5, z: 3 }, ROOM)!;
    expect(byId(after, 'e')).toMatchObject({ x1: 2.5, z1: -1, x2: 2.5, z2: 2 });
    expect(byId(after, 'n')).toMatchObject({ x1: -2, z1: -1, x2: 2.5, z2: -1 });
    expect(byId(after, 's')).toMatchObject({ x1: 2.5, z1: 2, x2: -2, z2: 2 });
    expect(byId(after, 'w')).toBe(room[3]);
  });

  it('lands on the grid, or free with Shift', () => {
    expect(byId(dragWalls(grab(room, 'e'), { x: 0.53, z: 0 }, ROOM)!, 'e').x1).toBeCloseTo(2.5, 9);
    expect(byId(dragWalls(grab(room, 'e'), { x: 0.53, z: 0 }, { ...ROOM, free: true })!, 'e').x1).toBeCloseTo(2.53, 9);
  });

  it('catches the line of a corner near it', () => {
    const walls = [...room, wall('far', 3.04, 3, 4, 3)];
    expect(byId(dragWalls(grab(walls, 'e'), { x: 1, z: 0 }, ROOM)!, 'e').x1).toBe(3.04);
  });

  it('stops a step short of the shell, which it can\'t land on', () => {
    expect(byId(dragWalls(grab(room, 'e'), { x: 9, z: 0 }, ROOM)!, 'e').x1).toBe(4.9);
  });

  it('skips a corner that would land it on a parallel wall (M2)', () => {
    const walls = [...room, wall('twin', 3, -1, 3, 2)];
    expect(byId(dragWalls(grab(walls, 'e'), { x: 0.92, z: 0 }, ROOM)!, 'e').x1).toBeCloseTo(2.9, 9);
    expect(byId(dragWalls(grab(walls, 'e'), { x: 1.08, z: 0 }, ROOM)!, 'e').x1).toBeCloseTo(3.1, 9);
  });

  it('still catches the line of a parallel wall it passes clear of', () => {
    const walls = [...room, wall('twin', 3.04, 3, 3.04, 3.9)];
    expect(byId(dragWalls(grab(walls, 'e'), { x: 1, z: 0 }, ROOM)!, 'e').x1).toBe(3.04);
  });

  it('keeps an oblique wall on its hosts, each end sliding along (M3)', () => {
    const walls = [wall('host-a', -4, -2, 4, -2), wall('host-b', -4, 2, 4, 2), wall('o', -1, -2, 1, 2)];
    const after = dragWalls(grab(walls, 'o'), { x: 1, z: 0 }, { ...ROOM, free: true })!;
    expect(byId(after, 'o').z1).toBeCloseTo(-2, 9);
    expect(byId(after, 'o').z2).toBeCloseTo(2, 9);
    expect(byId(after, 'o').x2 - byId(after, 'o').x1).toBeCloseTo(2, 9);
    expect(byId(after, 'o').x1).toBeGreaterThan(-1);
  });

  it('keeps a wall on a diagonal host, and on the shell when oblique', () => {
    const diagonal = wall('d', -4, -4, 4, 4);
    const after = dragWalls(grab([diagonal, wall('t', 0, 0, 0, 3)], 't'), { x: 1, z: 0 }, { ...ROOM, free: true })!;
    const t = byId(after, 't');
    expect(t.x1).toBeCloseTo(t.z1, 9);
    expect(t.x1).toBeCloseTo(1, 9);
    const oblique = dragWalls(grab([wall('o', -1, -4, 1, 0)], 'o'), { x: 1, z: 0 }, { ...ROOM, free: true })!;
    expect(byId(oblique, 'o').z1).toBeCloseTo(-4, 9);
  });

  it('holds a wall past the end of its host', () => {
    const walls = [wall('host', -1, -2, 1, -2), wall('t', 0, -2, 0, 2)];
    expect(dragWalls(grab(walls, 't'), { x: 3, z: 0 }, { ...ROOM, free: true })).toBeNull();
  });

  it('carries a T-junction on a T-junction (M3)', () => {
    const walls = [wall('main', -4, 0, 4, 0), wall('first', 0, 0, 0, 3), wall('second', 0, 1.5, 3, 1.5)];
    // The end of `first` drags `main` nowhere: bend main's end, so first follows, so second does.
    const after = dragWalls(grab(walls, 'main', 'end'), { x: 0, z: 2 }, { ...ROOM, free: true })!;
    expect(byId(after, 'first').z1).toBeCloseTo(1, 9);
    const first = byId(after, 'first');
    const onFirst = Math.abs((byId(after, 'second').x1 - first.x1) * (first.z2 - first.z1) - (byId(after, 'second').z1 - first.z1) * (first.x2 - first.x1));
    expect(onFirst).toBeLessThan(1e-6);
  });

  it('takes a T-junction on its body along', () => {
    const walls = [...room, wall('t', 0, -1, 0, 2)];
    const after = dragWalls(grab(walls, 'n'), { x: 0, z: -0.5 }, ROOM)!;
    expect(byId(after, 't')).toMatchObject({ z1: -1.5, z2: 2 });
  });

  it('leaves a T-junction alone on a wall that only grew', () => {
    const t = wall('t', -2, 0.5, 0, 0.5);
    const walls = [...room, t];
    expect(byId(dragWalls(grab(walls, 'n'), { x: 0, z: -0.5 }, ROOM)!, 't')).toBe(t);
  });

  it('never drags the porch back wall along', () => {
    const porch = wall(ENTRANCE_WALL_ID, 2, -1, 4, -1);
    const walls = [...room, porch];
    expect(byId(dragWalls(grab(walls, 'e'), { x: 1, z: 0 }, ROOM)!, ENTRANCE_WALL_ID)).toBe(porch);
  });

  it('keeps a diagonal square to itself', () => {
    const diagonal = [wall('d', 0, 0, 2, 2)];
    const after = dragWalls(grab(diagonal, 'd'), { x: 1, z: -1 }, { ...ROOM, free: true })!;
    expect(byId(after, 'd').x1).toBeCloseTo(1, 9);
    expect(byId(after, 'd').z1).toBeCloseTo(-1, 9);
  });
});

describe('dragWalls: ends (#718)', () => {
  it('moves one end, and the walls sharing it', () => {
    const after = dragWalls(grab(room, 'e', 'end'), { x: 0.5, z: 0.4 }, { ...ROOM, free: true })!;
    expect(byId(after, 'e')).toMatchObject({ x1: 2, z1: -1, x2: 2.5, z2: 2.4 });
    expect(byId(after, 's')).toMatchObject({ x1: 2.5, z1: 2.4, x2: -2, z2: 2 });
  });

  it('snaps through snapWallEndpoint, past the walls moving with it', () => {
    const walls = [wall('a', -3, 0, 0, 0), wall('b', 1, 2, 1, 3)];
    expect(byId(dragWalls(grab(walls, 'a', 'end'), { x: 1.1, z: 1.9 }, ROOM)!, 'a')).toMatchObject({ x2: 1, z2: 2 });
  });

  it('holds rather than fold a wall to nothing', () => {
    expect(dragWalls(grab(room, 'e', 'end'), { x: 0, z: -3 }, { ...ROOM, free: true })).toBeNull();
  });
});

describe('wallsOverlap', () => {
  it('finds a wall on another, not one that ends on it or runs beside it', () => {
    expect(wallsOverlap(wall('a', 0, 0, 4, 0), wall('b', 1, 0, 2, 0))).toBe(true);
    expect(wallsOverlap(wall('a', 0, 0, 4, 0), wall('b', 4, 0, 6, 0))).toBe(false);
    expect(wallsOverlap(wall('a', 0, 0, 4, 0), wall('b', 1, 0.2, 2, 0.2))).toBe(false);
  });
});

describe('planWallMove (#718)', () => {
  const door = makeItem({ id: 'door', type: 'door', name: 'Door', width: 0.9, depth: 0.1, position: { x: 2, z: 0.5 }, rotation: -Math.PI / 2, locked: true });
  const floor = makeFloor({ interiorWalls: room, items: [door, makeItem({ id: 'sofa', position: { x: 0, z: 0 } })] });
  const context = { ...ROOM, porch: null };
  const slid = wallPatches(room, dragWalls(grab(room, 'e'), { x: 1, z: 0 }, ROOM)!);

  it('carries hung decor with the wall, turned with it, but not a ceiling light (M4)', () => {
    const picture = makeItem({ id: 'pic', type: 'painting', name: 'Painting', width: 0.8, depth: 0.05, position: { x: 1.9, z: 0.5 }, rotation: -Math.PI / 2 });
    const pendant = makeItem({ id: 'lamp', type: 'pendant-light', name: 'Lamp', width: 0.4, depth: 0.4, position: { x: 2, z: 0.5 } });
    const far = makeItem({ id: 'far', type: 'mirror', name: 'Mirror', width: 0.5, depth: 0.05, position: { x: 0, z: 0.5 } });
    const onShell = makeItem({ id: 'shell', type: 'painting', name: 'Painting', width: 0.8, depth: 0.05, position: { x: 4.97, z: 0.5 } });
    const plan = planWallMove(makeFloor({ interiorWalls: room, items: [picture, pendant, far, onShell] }), slid, context);
    if (!plan || 'refusal' in plan) throw new Error('refused');
    expect(plan.items[0]!.position).toEqual({ x: 2.9, z: 0.5 });
    expect(plan.items[0]!.rotation).toBe(-Math.PI / 2);
    expect(plan.items[1]).toBe(pendant);
    expect(plan.items[2]).toBe(far);
    expect(plan.items[3]).toBe(onShell);
    const turned = planWallMove(makeFloor({ interiorWalls: room, items: [picture] }), [{ id: 'e', x1: 2, z1: -1, x2: 4, z2: 2 }], context);
    if (!turned || 'refusal' in turned) throw new Error('refused');
    expect(turned.items[0]!.rotation).toBeCloseTo(-Math.PI / 2 - (Math.atan2(3, 2) - Math.PI / 2), 6);
  });

  it('refuses two doors a shortening would overlap (M5)', () => {
    const near = makeItem({ ...door, id: 'a', name: 'Door A', position: { x: 2, z: -0.4 } });
    const fartherOn = makeItem({ ...door, id: 'b', name: 'Door B', position: { x: 2, z: 1.4 } });
    const shorter = makeFloor({ interiorWalls: room, items: [near, fartherOn] });
    expect(planWallMove(shorter, [{ id: 'e', x1: 2, z1: -1, x2: 2, z2: 0.2 }], context)).toEqual({ refusal: expect.stringContaining('both') });
  });

  it('does not refuse two doors that overlapped already', () => {
    const a = makeItem({ ...door, id: 'a', position: { x: 2, z: 0.4 } });
    const b = makeItem({ ...door, id: 'b', position: { x: 2, z: 0.6 } });
    expect(planWallMove(makeFloor({ interiorWalls: room, items: [a, b] }), slid, context)).not.toHaveProperty('refusal');
  });

  it('keeps a door where it is when only the far end moved (M6)', () => {
    const plan = planWallMove(floor, [{ id: 'e', x1: 2, z1: -1, x2: 2, z2: 3 }], context);
    if (!plan || 'refusal' in plan) throw new Error('refused');
    expect(plan.items[0]!.position).toEqual({ x: 2, z: 0.5 });
    const fromStart = planWallMove(floor, [{ id: 'e', x1: 2, z1: -2, x2: 2, z2: 2 }], context);
    if (!fromStart || 'refusal' in fromStart) throw new Error('refused');
    expect(fromStart.items[0]!.position).toEqual({ x: 2, z: 0.5 });
  });

  it('clamps a door to what is left of the wall', () => {
    const plan = planWallMove(floor, [{ id: 'e', x1: 2, z1: -1, x2: 2, z2: 0.2 }], context);
    if (!plan || 'refusal' in plan) throw new Error('refused');
    expect(plan.items[0]!.position!.z).toBeCloseTo(-0.25, 6);
  });

  it('carries a locked door along with its wall, and leaves the sofa', () => {
    const plan = planWallMove(floor, slid, context);
    if (!plan || 'refusal' in plan) throw new Error('refused');
    const moved = plan.items.find((item) => item.id === 'door')!;
    expect(moved.position).toEqual({ x: 3, z: 0.5 });
    expect(moved.locked).toBe(true);
    expect(plan.items[1]).toBe(floor.items[1]);
  });

  it('keeps a door on the wall when the wall turns, turned with it', () => {
    const patch = [{ id: 'e', x1: 2, z1: -1, x2: 4, z2: 2 }];
    const plan = planWallMove(floor, patch, context);
    if (!plan || 'refusal' in plan) throw new Error('refused');
    const moved = plan.items[0]!;
    const onWall = Math.abs(-(moved.position!.x - 2) * 3 + (moved.position!.z + 1) * 2);
    expect(onWall).toBeLessThan(1e-6);
    expect(moved.rotation).toBeCloseTo(-Math.atan2(3, 2), 6);
  });

  it('refuses a move that leaves a door no wall', () => {
    const patch = [{ id: 'e', x1: 2, z1: 0.2, x2: 2, z2: 0.9 }];
    expect(planWallMove(floor, patch, context)).toEqual({ refusal: expect.stringContaining('Door') });
  });

  it('keeps a camera on its side of the wall', () => {
    const camera = makeItem({ id: 'cam', type: 'security-camera', name: 'Camera', width: 0.2, depth: 0.2, position: { x: 1.8, z: 0.5 }, rotation: -Math.PI / 2 });
    const plan = planWallMove(makeFloor({ interiorWalls: room, items: [camera] }), slid, context);
    if (!plan || 'refusal' in plan) throw new Error('refused');
    expect(plan.items[0]!.position!.x).toBeLessThan(3);
    expect(plan.items[0]!.position!.x).toBeGreaterThan(2.7);
  });

  it('is null when nothing moves', () => {
    expect(planWallMove(floor, [], context)).toBeNull();
    expect(planWallMove(floor, [{ id: 'e', x1: 2, z1: -1, x2: 2, z2: 2 }], context)).toBeNull();
  });

  it('refuses the porch back wall, and any wall through the porch', () => {
    const back = wall(ENTRANCE_WALL_ID, -1, -3, 1, -3);
    const onPorch = makeFloor({ interiorWalls: [back, wall('p', -3, -3.5, -3, 0)] });
    const porch: EntrancePlanOutline = { x0: -1, x1: 1, frontZ: -4, backZ: -3 } as EntrancePlanOutline;
    expect(planWallMove(onPorch, [{ id: ENTRANCE_WALL_ID, x1: -1, z1: -2, x2: 1, z2: -2 }], { ...ROOM, porch })).toEqual({ refusal: expect.any(String) });
    expect(planWallMove(onPorch, [{ id: 'p', x1: 0, z1: -3.5, x2: 0, z2: 0 }], { ...ROOM, porch })).toEqual({ refusal: expect.stringContaining('porch') });
  });

  it('refuses a wall on another wall or on the shell, unless it already was', () => {
    const walls = [wall('a', -2, 0, 2, 0), wall('b', -2, 1, 2, 1)];
    const f = makeFloor({ interiorWalls: walls });
    expect(planWallMove(f, [{ id: 'b', x1: -2, z1: 0, x2: 2, z2: 0 }], context)).toEqual({ refusal: expect.stringContaining('top') });
    expect(planWallMove(f, [{ id: 'b', x1: -2, z1: 4, x2: 2, z2: 4 }], context)).toEqual({ refusal: expect.stringContaining('top') });
    const already = makeFloor({ interiorWalls: [wall('a', -2, 0, 2, 0), wall('b', -2, 0, 2, 0)] });
    expect(planWallMove(already, [{ id: 'b', x1: -2, z1: 0, x2: 3, z2: 0 }], context)).not.toHaveProperty('refusal');
  });

  it('refuses a wall too short to stand', () => {
    expect(planWallMove(floor, [{ id: 'e', x1: 2, z1: 1, x2: 2, z2: 1.05 }], context)).toEqual({ refusal: expect.stringContaining('short') });
  });

  it('ignores the entrance door', () => {
    const entrance = makeItem({ id: ENTRANCE_DOOR_ID, type: 'door', width: 0.9, position: { x: 2, z: 0.5 } });
    const plan = planWallMove(makeFloor({ interiorWalls: room, items: [entrance] }), slid, context);
    if (!plan || 'refusal' in plan) throw new Error('refused');
    expect(plan.items[0]).toBe(entrance);
  });
});

describe('a slide keeps a wall square', () => {
  it('both ends land on one clean line, hosted or free', () => {
    const hosted: InteriorWall = { id: 'w', x1: -1, z1: -4, x2: -1, z2: 4 };
    const free: InteriorWall = { id: 'w', x1: -1, z1: -2, x2: -1, z2: 2 };
    for (const wall of [hosted, free]) {
      for (let step = 1; step < 40; step++) {
        const x = -1 + step * 0.13;
        const [moved] = dragWalls({ wallId: 'w', grip: 'body', at: { x: -1, z: 0 }, walls: [wall] }, { x, z: 0 }, { roomWidth: 10, roomDepth: 8 })!;
        expect(moved!.x1).toBe(moved!.x2);
        expect(moved!.x1).toBe(Math.round(moved!.x1 * 1e6) / 1e6);
      }
    }
  });
});
