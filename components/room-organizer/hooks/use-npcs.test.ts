import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { MAX_PATH_POINTS, NPC_RADIUS, type NpcNav, buildNpcNav, cellAt, cellX, cellZ, findNpcPath } from '../lib/npc-path';
import { findNpcSeats } from '../lib/npc-seats';
import {
  NPC_REPAINT,
  NPC_SHADOW,
  NPC_STILL,
  type NpcSeats,
  type NpcState,
  planRoute,
  planSeat,
  rehomeNpcs,
  stepNpcs,
  wayAheadBlocked,
} from './use-npcs';
import type { KeepOutRect } from '../lib/geometry';
import type { FurnitureItem, InteriorWall } from '../lib/types';

const FRAME = 1 / 60;

/** Deterministic PRNG (mulberry32). */
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeNav(items: FurnitureItem[] = [], walls: InteriorWall[] = [], keepOut: KeepOutRect[] = []): NpcNav {
  const nav = buildNpcNav({ items, interiorWalls: walls, keepOut, roomWidth: 8, roomDepth: 8 });
  if (!nav) throw new Error('no nav');
  return nav;
}

const OPEN = makeNav();

/** A procedural-less walker at the origin with a one-leg route to `to`. */
function walker(overrides: Partial<NpcState> = {}, to = { x: 2, z: 0 }): NpcState {
  const path = new Float32Array(MAX_PATH_POINTS * 2);
  path[0] = to.x;
  path[1] = to.z;
  return {
    group: new THREE.Group(),
    position: { x: 0, z: 0 },
    speed: 1,
    scale: 1,
    mode: overrides.pause ? 'pause' : 'walk',
    phase: 0,
    pause: 0,
    shadowSettle: 0,
    seat: null,
    target: { x: 0, z: 0 },
    lift: 0,
    rig: null,
    anim: null,
    path,
    pathLength: 1,
    pathIndex: 0,
    destination: -1,
    goal: { x: 0, z: 0 },
    arrivalHeading: Number.NaN,
    standHeading: Number.NaN,
    stuck: 0,
    ...overrides,
  };
}

function rigged(overrides: Partial<NpcState> = {}, to?: { x: number; z: number }): NpcState {
  const group = new THREE.Group();
  const mixer = new THREE.AnimationMixer(group);
  const clip = (name: string) => new THREE.AnimationClip(name, 1, []);
  const walk = mixer.clipAction(clip('walk'));
  const idle = mixer.clipAction(clip('idle'));
  walk.play();
  return walker({ group, anim: { mixer, walk, stand: [idle], current: walk }, ...overrides }, to);
}

describe('stepNpcs shadow requests (#400)', () => {
  it('a walking figure moves a caster: recompute the shadow map', () => {
    expect(stepNpcs([rigged()], FRAME, OPEN, 0)).toBe(NPC_SHADOW);
  });

  it('a rigged figure idling at its waypoint only needs a repaint', () => {
    expect(stepNpcs([rigged({ pause: 3 })], FRAME, OPEN, 0)).toBe(NPC_REPAINT);
  });

  it('keeps the shadow following the pose while a stopped figure settles, then lets it rest', () => {
    // Arrive at the waypoint this frame.
    const npc = rigged({}, { x: 0.05, z: 0 });
    expect(stepNpcs([npc], FRAME, OPEN, 0)).toBe(NPC_SHADOW);
    npc.pause = 10; // make sure it stays put for the rest of the test
    const changes: number[] = [];
    for (let frame = 0; frame < 60; frame += 1) changes.push(stepNpcs([npc], FRAME, OPEN, 0));
    const settled = changes.indexOf(NPC_REPAINT);
    // The 0.35 s crossfade into the standing pose, give or take a frame.
    expect(settled).toBeGreaterThanOrEqual(20);
    expect(settled).toBeLessThanOrEqual(22);
    expect(changes.slice(0, settled).every((c) => c === NPC_SHADOW)).toBe(true);
    expect(changes.slice(settled).every((c) => c === NPC_REPAINT)).toBe(true);
  });

  it('one walker on the move outweighs another idling', () => {
    expect(stepNpcs([rigged({ pause: 3 }), rigged()], FRAME, OPEN, 0)).toBe(NPC_SHADOW);
  });

  it('procedural walkers standing still need nothing', () => {
    expect(stepNpcs([walker({ pause: 3 })], FRAME, OPEN, 0)).toBe(NPC_STILL);
  });

  it('turning to face the furniture at a stop moves the shadow, then rests', () => {
    const npc = walker({ pause: 3, standHeading: Math.PI / 2 });
    expect(stepNpcs([npc], FRAME, OPEN, 0)).toBe(NPC_SHADOW);
    for (let frame = 0; frame < 30; frame += 1) stepNpcs([npc], FRAME, OPEN, 0);
    expect(npc.group.rotation.y).toBeCloseTo(Math.PI / 2, 2);
    expect(stepNpcs([npc], FRAME, OPEN, 0)).toBe(NPC_STILL);
  });
});

/** Distance from a point to an item's (rotated) footprint, in Three's rotY convention. */
function gapTo(item: FurnitureItem, x: number, z: number): number {
  const rotation = item.rotation ?? 0;
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  const dx = x - item.position!.x;
  const dz = z - item.position!.z;
  const lx = Math.abs(dx * cos - dz * sin) - item.width / 2;
  const lz = Math.abs(dx * sin + dz * cos) - item.depth / 2;
  return Math.hypot(Math.max(0, lx), Math.max(0, lz));
}

function furniture(id: string, type: string, x: number, z: number, width: number, depth: number, rotation = 0): FurnitureItem {
  return { id, type, name: id, width, depth, height: type === 'stairs' ? 3 : 0.8, color: '#000', icon: '', rotation, position: { x, z } };
}

describe('routes longer than the path buffer', () => {
  // A serpentine of partitions 1 m apart with the gap at alternate ends:
  // end to end takes far more than MAX_PATH_POINTS legs.
  const walls: InteriorWall[] = [];
  for (let i = 0; i < 17; i++) {
    const x = -8 + i;
    walls.push(i % 2 === 0 ? { id: `w${i}`, x1: x, z1: -4, x2: x, z2: 2.4 } : { id: `w${i}`, x1: x, z1: -2.4, x2: x, z2: 4 });
  }
  const nav = buildNpcNav({ items: [], interiorWalls: walls, keepOut: [], roomWidth: 20, roomDepth: 8 })!;

  it('carries on past the buffer and arrives at the destination it set out for', () => {
    const npc = walker({ position: { x: -9, z: 0 }, pathLength: 0 });
    const goal = cellAt(nav, 9, 0);
    npc.pathLength = findNpcPath(nav, -9, 0, goal, npc.path);
    expect(npc.pathLength).toBe(MAX_PATH_POINTS); // truncated
    npc.destination = goal;
    npc.goal = { x: cellX(nav, goal), z: cellZ(nav, goal) };
    const random = seeded(1);
    let frames = 0;
    while (npc.pause <= 0 && frames < 120 * 60) {
      stepNpcs([npc], FRAME, nav, 0, random);
      frames++;
    }
    expect(npc.pause).toBeGreaterThan(0);
    expect(Math.hypot(npc.position.x - cellX(nav, goal), npc.position.z - cellZ(nav, goal))).toBeLessThan(0.15);
  });
});

describe('walkers on a furnished floor (#452)', () => {
  // Two rooms split at x = 0 by a partition with a door at z = 2; a sofa,
  // a rotated table, a stair flight and a stairwell hole in the way.
  const wall: InteriorWall = { id: 'w', x1: 0, z1: -4, x2: 0, z2: 4 };
  const door = { ...furniture('door', 'door', 0, 2, 0.9, 0.12), height: 2.05 };
  const sofa = furniture('sofa', 'sofa', -2, -1, 2, 0.9);
  const table = furniture('table', 'table', 2, -1.5, 1.4, 0.8, Math.PI / 5);
  const stairs = furniture('stairs', 'stairs', 2.6, 1.6, 1.2, 2.4);
  const hole: KeepOutRect = { x0: -3, x1: -1.8, z0: 1.4, z1: 3.2, hole: true };
  const nav = makeNav([door, sofa, table, stairs], [wall], [hole]);

  function spawn(random: () => number, count: number): NpcState[] {
    const npcs: NpcState[] = [];
    for (let i = 0; i < count; i++) {
      const cell = nav.free[Math.floor(random() * nav.freeCount)]!;
      const x = nav.x0 + ((cell % nav.cols) + 0.5) * nav.cellW;
      const z = nav.z0 + (Math.floor(cell / nav.cols) + 0.5) * nav.cellD;
      const npc = walker({ position: { x, z }, pathLength: 0 });
      planRoute(npc, nav, random);
      npcs.push(npc);
    }
    return npcs;
  }

  it('never walks into furniture, the partition, the stairs or the stairwell, and gets around', () => {
    const random = seeded(452);
    const npcs = spawn(random, 4);
    const side = npcs.map((npc) => Math.sign(npc.position.x));
    let crossings = 0;
    const slack = 0.02;
    // Two simulated minutes at 60 fps.
    for (let frame = 0; frame < 120 * 60; frame++) {
      stepNpcs(npcs, FRAME, nav, 0, random);
      npcs.forEach((npc, index) => {
        const { x, z } = npc.position;
        for (const blocker of [sofa, table, stairs]) expect(gapTo(blocker, x, z)).toBeGreaterThan(NPC_RADIUS - slack);
        const holeGap = Math.hypot(
          Math.max(0, hole.x0 - x, x - hole.x1),
          Math.max(0, hole.z0 - z, z - hole.z1)
        );
        expect(holeGap).toBeGreaterThan(NPC_RADIUS - slack);
        // On the partition's line only through the door's gap.
        if (Math.abs(x) < 0.08 + NPC_RADIUS - slack) expect(Math.abs(z - 2)).toBeLessThan(0.45);
        const now = Math.sign(x);
        if (now !== 0 && now !== side[index]) {
          crossings += 1;
          side[index] = now;
        }
      });
    }
    // The door gets used: walkers wander between the rooms.
    expect(crossings).toBeGreaterThan(2);
  });

  it('is deterministic for a given random source', () => {
    const run = () => {
      const random = seeded(9);
      const npcs = spawn(random, 3);
      for (let frame = 0; frame < 600; frame++) stepNpcs(npcs, FRAME, nav, 0, random);
      return npcs.map((npc) => [npc.position.x, npc.position.z]);
    };
    expect(run()).toEqual(run());
  });

  it('steps a walker out of furniture dropped on it and re-routes it', () => {
    const npc = walker({ position: { x: -2, z: -1 } });
    rehomeNpcs([npc], nav, 0, seeded(3));
    expect(gapTo(sofa, npc.position.x, npc.position.z)).toBeGreaterThanOrEqual(NPC_RADIUS);
    expect(npc.group.position.x).toBe(npc.position.x);
    expect(npc.pathLength).toBeGreaterThan(0);
  });

  it("doesn't pick a stop another walker already claimed", () => {
    const random = seeded(11);
    for (let trial = 0; trial < 40; trial++) {
      const [first, second] = spawn(random, 2);
      planRoute(second!, nav, random, [first!, second!]);
      const end = (npc: NpcState) => [npc.goal.x, npc.goal.z] as const;
      const [ax, az] = end(first!);
      const [bx, bz] = end(second!);
      expect(Math.hypot(ax - bx, az - bz)).toBeGreaterThanOrEqual(0.9);
    }
  });

  it('gives up on a destination it cannot make progress toward', () => {
    // A stale route straight through the sofa.
    const npc = walker({ position: { x: -2, z: -2.2 } }, { x: -2, z: 0.5 });
    const random = seeded(5);
    for (let frame = 0; frame < 3 * 60; frame++) stepNpcs([npc], FRAME, nav, 0, random);
    expect(gapTo(sofa, npc.position.x, npc.position.z)).toBeGreaterThan(NPC_RADIUS - 0.02);
    expect(npc.path[0] === -2 && npc.path[1] === 0.5).toBe(false);
  });
});

/** One-second clips: the sit, stand and activity actions a full rig carries. */
function seatedRig(overrides: Partial<NpcState> = {}, to?: { x: number; z: number }): NpcState {
  const npc = rigged(overrides, to);
  const mixer = npc.anim!.mixer;
  const once = (name: string) => {
    const action = mixer.clipAction(new THREE.AnimationClip(name, 1, []));
    action.setLoop(THREE.LoopOnce, 1);
    action.clampWhenFinished = true;
    return action;
  };
  npc.anim!.sit = {
    down: once('sit-down'),
    up: once('stand-up'),
    idle: [mixer.clipAction(new THREE.AnimationClip('sit-idle', 1, []))],
  };
  return npc;
}

function seatsOf(items: FurnitureItem[]): NpcSeats {
  return new Map(findNpcSeats(items).map((seat) => [seat.key, seat]));
}

describe('walkers stop for each other', () => {
  it('sees another person ahead, but not one behind, to the side or far off', () => {
    const npc = walker({}, { x: 2, z: 0 });
    expect(wayAheadBlocked(npc, [npc, walker({ position: { x: 0.6, z: 0.1 } })])).toBe(true);
    expect(wayAheadBlocked(npc, [npc, walker({ position: { x: -0.6, z: 0 } })])).toBe(false);
    expect(wayAheadBlocked(npc, [npc, walker({ position: { x: 0, z: 0.6 } })])).toBe(false);
    expect(wayAheadBlocked(npc, [npc, walker({ position: { x: 1.5, z: 0 } })])).toBe(false);
  });

  it('two walkers heading at each other stop rather than pass through', () => {
    const a = walker({ position: { x: -1, z: 0 } }, { x: 2, z: 0 });
    const b = walker({ position: { x: 1, z: 0 } }, { x: -2, z: 0 });
    const random = seeded(1);
    for (let t = 0; t < 1.2; t += FRAME) stepNpcs([a, b], FRAME, OPEN, 0, random);
    expect(a.mode).toBe('blocked');
    expect(b.mode).toBe('blocked');
    expect(b.position.x - a.position.x).toBeGreaterThan(0.5);
  });

  it('after the wait, walks on (somewhere else when still blocked)', () => {
    const random = seeded(2);
    const a = walker({ position: { x: -1, z: 0 } }, { x: 2, z: 0 });
    const b = walker({ position: { x: 1, z: 0 } }, { x: -2, z: 0 });
    for (let t = 0; t < 1.2; t += FRAME) stepNpcs([a, b], FRAME, OPEN, 0, random);
    for (let t = 0; t < 2 && a.mode === 'blocked'; t += FRAME) stepNpcs([a, b], FRAME, OPEN, 0, random);
    expect(a.mode).not.toBe('blocked');
    expect(a.path[0] === 2 && a.path[1] === 0).toBe(false);
  });
});

describe('walkers sit down', () => {
  const chair = furniture('chair', 'chair', 0, 0, 0.5, 0.5);
  const nav = makeNav([chair]);
  const seats = seatsOf([chair]);
  const seat = seats.get('chair:0')!;

  function headingForChair(): NpcState {
    const npc = seatedRig({ position: { x: 0, z: 2 }, pathLength: 0 });
    expect(planSeat(npc, nav, seats, seeded(1))).toBe(true);
    return npc;
  }

  it('walks to the chair, turns to face its way, sits, then gets up and steps back out', () => {
    const npc = headingForChair();
    expect(npc.seat).toBe(seat);
    const modes = new Set<string>();
    const random = seeded(4);
    for (let t = 0; t < 8 && npc.mode !== 'seated'; t += FRAME) {
      stepNpcs([npc], FRAME, nav, 0, random, seats);
      modes.add(npc.mode);
    }
    expect([...modes]).toEqual(expect.arrayContaining(['walk', 'settle', 'turn', 'sitDown', 'seated']));
    expect(npc.group.rotation.y).toBeCloseTo(0);
    // Feet just in front of the seat, which faces +z.
    expect(npc.position.z).toBeGreaterThan(0);
    expect(npc.position.z).toBeLessThan(0.5);

    npc.pause = 0;
    for (let t = 0; t < 4 && npc.seat; t += FRAME) stepNpcs([npc], FRAME, nav, 0, random, seats);
    expect(npc.seat).toBeNull();
    // Back at the approach point, clear of the chair's footprint.
    expect(gapTo(chair, npc.position.x, npc.position.z)).toBeGreaterThan(NPC_RADIUS);
    expect(npc.lift).toBe(0);
    expect(npc.mode).toBe('pause');
  });

  it('gets up when its chair is moved away', () => {
    const npc = seatedRig({ seat, mode: 'seated', pause: 30 });
    stepNpcs([npc], FRAME, nav, 0, seeded(1), seatsOf([{ ...chair, position: { x: 2, z: 2 } }]));
    expect(npc.mode).toBe('standUp');
  });

  it('steps out to free floor when its chair is moved onto the way out', () => {
    // The chair slides forward over the approach point the sitter would leave by.
    const moved = { ...chair, position: { x: 0, z: 0.6 } };
    const movedNav = makeNav([moved]);
    const npc = seatedRig({ seat, mode: 'seated', pause: 30, position: { x: 0, z: 0.27 } });
    const random = seeded(3);
    for (let t = 0; t < 4 && npc.mode !== 'pause'; t += FRAME) stepNpcs([npc], FRAME, movedNav, 0, random, seatsOf([moved]));
    expect(npc.mode).toBe('pause');
    expect(npc.seat).toBeNull();
    expect(gapTo(moved, npc.position.x, npc.position.z)).toBeGreaterThan(NPC_RADIUS - 0.02);
  });

  it('steps out of a chair turned in place while it was stepping in', () => {
    // Turned a quarter in place: the seat's slot moves, and the chair's
    // footprint still covers the spot the walker turns on.
    const turned = { ...chair, rotation: Math.PI / 2 };
    const turnedNav = makeNav([turned]);
    const npc = seatedRig({ seat, mode: 'turn', position: { x: 0, z: 0.27 } });
    const random = seeded(6);
    let overlapping = 0;
    for (let t = 0; t < 3 && npc.mode !== 'pause'; t += FRAME) {
      stepNpcs([npc], FRAME, turnedNav, 0, random, seatsOf([turned]));
      if (gapTo(turned, npc.position.x, npc.position.z) < NPC_RADIUS - 0.02) overlapping += FRAME;
    }
    expect(npc.mode).toBe('pause');
    expect(npc.seat).toBeNull();
    expect(gapTo(turned, npc.position.x, npc.position.z)).toBeGreaterThan(NPC_RADIUS - 0.02);
    // Out within a stride or so, not after a whole stop.
    expect(overlapping).toBeLessThan(0.5);
  });

  it("gives up a seat it hasn't reached when the seat is deleted", () => {
    const npc = headingForChair();
    stepNpcs([npc], FRAME, nav, 0, seeded(1), seatsOf([]));
    expect(npc.seat).toBeNull();
  });

  it('one person per seat, and none in a seat with no room in front', () => {
    const sitter = seatedRig({ seat, mode: 'seated', pause: 30 });
    const npc = seatedRig({ position: { x: 0, z: 2 }, pathLength: 0 });
    expect(planSeat(npc, nav, seats, seeded(1), [sitter, npc])).toBe(false);
    // A chair tucked under a table: its approach point is inside the table.
    const tucked = furniture('tucked', 'chair', 0, 0, 0.5, 0.5);
    const table = furniture('table', 'table', 0, 0.8, 1.2, 0.8);
    const tableNav = makeNav([tucked, table]);
    expect(planSeat(npc, tableNav, seatsOf([tucked, table]), seeded(1))).toBe(false);
  });

  it('a floor edit leaves a seated walker in its seat', () => {
    const npc = seatedRig({ seat, mode: 'seated', pause: 30, position: { x: seat.x, z: seat.z + 0.2 } });
    rehomeNpcs([npc], nav, 0, seeded(1));
    expect(npc.mode).toBe('seated');
    expect(npc.seat).toBe(seat);
    expect(npc.position).toEqual({ x: seat.x, z: seat.z + 0.2 });
  });

  it('procedural walkers never sit', () => {
    const random = seeded(7);
    const npc = walker({ position: { x: 0, z: 2 }, pathLength: 0 });
    for (let t = 0; t < 60; t += FRAME) {
      stepNpcs([npc], FRAME, nav, 0, random, seats);
      expect(npc.seat).toBeNull();
    }
  });
});

describe('rigged walkers on a furnished floor', () => {
  const wall: InteriorWall = { id: 'w', x1: 0, z1: -4, x2: 0, z2: 4 };
  const door = { ...furniture('door', 'door', 0, 2, 0.9, 0.12), height: 2.05 };
  const sofa = furniture('sofa', 'sofa', -2, -1, 2, 0.9);
  const table = furniture('table', 'table', 2, -1.5, 1.4, 0.8, Math.PI / 5);
  const chair = furniture('chair', 'chair', 2.5, 0.2, 0.5, 0.5, Math.PI / 2);
  const stairs = furniture('stairs', 'stairs', 2.6, 2, 1.2, 2);
  const items = [door, sofa, table, chair, stairs];
  const nav = makeNav(items, [wall]);
  const seats = seatsOf(items);

  it('sit only in the seat they claimed, never in other furniture, and use the seats', () => {
    const random = seeded(533);
    const npcs: NpcState[] = [];
    for (let i = 0; i < 4; i++) {
      const cell = nav.free[Math.floor(random() * nav.freeCount)]!;
      const npc = seatedRig({ position: { x: cellX(nav, cell), z: cellZ(nav, cell) }, pathLength: 0 });
      planRoute(npc, nav, random, npcs);
      npcs.push(npc);
    }
    const sat = new Set<string>();
    const slack = 0.02;
    for (let frame = 0; frame < 180 * 60; frame++) {
      stepNpcs(npcs, FRAME, nav, 0, random, seats);
      for (const npc of npcs) {
        const { x, z } = npc.position;
        const seatedIn = npc.mode !== 'walk' && npc.mode !== 'pause' && npc.mode !== 'blocked' ? npc.seat?.itemId : undefined;
        if (npc.mode === 'seated') sat.add(npc.seat!.key);
        for (const blocker of [sofa, table, chair, stairs]) {
          if (blocker.id === seatedIn) continue;
          expect(gapTo(blocker, x, z)).toBeGreaterThan(NPC_RADIUS - slack);
        }
      }
      // One sitter per seat.
      const keys = npcs.filter((npc) => npc.mode === 'seated').map((npc) => npc.seat!.key);
      expect(new Set(keys).size).toBe(keys.length);
    }
    expect(sat.size).toBeGreaterThan(1);
  });
});
