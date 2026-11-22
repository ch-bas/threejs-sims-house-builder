import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { makeFloor, makeItem, makeLayout } from '../lib/__testfixtures__/fixtures';
import { floorKeepOut } from '../lib/floor-keep-out';
import { createNpcBody } from '../lib/npc-bodies';
import { findGardenSpots, gardenNavInput, indoorOnly } from '../lib/npc-garden';
import { findNeedSpots } from '../lib/npc-needs';
import { MAX_PATH_POINTS, NPC_RADIUS, type NpcNav, buildNpcNav, isFreeAt } from '../lib/npc-path';
import { findNpcSeats } from '../lib/npc-seats';
import { type NpcState, rehomeNpcs, stepNpcs } from './use-npcs';
import type { FurnitureItem, RoomLayout } from '../lib/types';

const FRAME = 1 / 60;

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

/** A rigged walker that can sit, standing at (x, z) with these needs and nowhere to go yet. */
function sitter(x: number, z: number, needs: NpcState['needs']): NpcState {
  const group = new THREE.Group();
  const mixer = new THREE.AnimationMixer(group);
  const clip = (name: string) => mixer.clipAction(new THREE.AnimationClip(name, 1, []));
  const once = (name: string) => {
    const action = clip(name);
    action.setLoop(THREE.LoopOnce, 1);
    action.clampWhenFinished = true;
    return action;
  };
  const walk = clip('walk');
  walk.play();
  return {
    group,
    position: { x, z },
    speed: 1,
    scale: 1,
    mode: 'walk',
    phase: 0,
    pause: 0,
    shadowSettle: 0,
    seat: null,
    target: { x: 0, z: 0 },
    lift: 0,
    rig: null,
    anim: { mixer, walk, stand: [clip('idle')], current: walk, sit: { down: once('sit-down'), up: once('stand-up'), idle: [clip('sit-idle')] } },
    path: new Float32Array(MAX_PATH_POINTS * 2),
    pathLength: 0,
    pathIndex: 0,
    destination: -1,
    goal: { x: 0, z: 0 },
    arrivalHeading: Number.NaN,
    standHeading: Number.NaN,
    stuck: 0,
    body: createNpcBody(x, z, 0, 0),
    needs,
    seeking: null,
    using: null,
    asleep: false,
  };
}

const ITEMS: FurnitureItem[] = [
  makeItem({ id: 'back', type: 'door', name: 'Door', width: 0.9, depth: 0.12, height: 2.05, position: { x: 0, z: 4 } }),
  makeItem({ id: 'bench', type: 'garden-bench', name: 'Garden Bench', category: 'outdoor', width: 1.5, depth: 0.5, height: 0.85, position: { x: 1.5, z: 7.5 } }),
  makeItem({ id: 'table', type: 'table', name: 'Table', width: 1.2, depth: 0.8, height: 0.75, position: { x: -2, z: 0 } }),
];

function garden(layout: RoomLayout) {
  const floor = layout.floors[0]!;
  const nav = buildNpcNav({
    items: floor.items,
    interiorWalls: [],
    keepOut: floorKeepOut(layout, 0),
    roomWidth: layout.width,
    roomDepth: layout.height,
    outdoor: gardenNavInput(layout, 0),
  }) as NpcNav;
  const seatList = findNpcSeats(floor.items, { isFree: (x, z) => isFreeAt(nav, x, z), blockers: nav.colliders });
  const seats = new Map(seatList.map((seat) => [seat.key, seat]));
  const spots = [...findNeedSpots(floor.items, seatList), ...findGardenSpots(seatList)];
  return { nav, seats, spots, indoor: indoorOnly(nav, seats, spots) };
}

describe('walkers in the garden (#913)', () => {
  const layout = makeLayout({ width: 8, height: 8, floors: [makeFloor({ items: ITEMS })], terrain: { frontY: 0, backY: 0.3 } });
  const { nav, seats, spots, indoor } = garden(layout);

  it('a tired walker goes out of the back door, sits on the bench at the lawn’s height, and is rested', () => {
    expect(nav.outdoor).not.toBeNull();
    const npc = sitter(-1, -2, { hunger: 1, energy: 0.05, fun: 1, hygiene: 1 });
    const random = seeded(913);
    let sat = false;
    let seatedY = 0;
    for (let t = 0; t < 40 && !(sat && npc.mode === 'leaveSeat'); t += FRAME) {
      stepNpcs([npc], FRAME, nav, 0, random, seats, null, spots, 12);
      if (npc.mode === 'seated' && npc.seat?.itemId === 'bench') {
        sat = true;
        seatedY = npc.group.position.y;
      }
      // Never through a wall: on free floor, in the doorway, or stepping into the seat.
      if (npc.mode === 'walk') {
        const inDoorway = Math.abs(npc.position.z - 4) < 0.7 && Math.abs(npc.position.x) < 0.45 - NPC_RADIUS + 0.1;
        expect(isFreeAt(nav, npc.position.x, npc.position.z) || inDoorway || npc.stuck > 0).toBe(true);
      }
    }
    expect(sat).toBe(true);
    expect(npc.needs.energy).toBeGreaterThan(0.5);
    // The ground behind the house is 0.3 m up: the sitter is lifted with it.
    expect(seatedY).toBeGreaterThan(0.25);
  });

  it('when it starts to rain, a sitter on the bench gets up and comes back in', () => {
    const npc = sitter(-1, -2, { hunger: 1, energy: 0.05, fun: 1, hygiene: 1 });
    const random = seeded(7);
    for (let t = 0; t < 40 && npc.mode !== 'seated'; t += FRAME) stepNpcs([npc], FRAME, nav, 0, random, seats, null, spots, 12);
    expect(npc.seat?.itemId).toBe('bench');
    // Rain: the garden closes, as the hook does it.
    nav.outdoorOpen = false;
    let inside = false;
    for (let t = 0; t < 40 && !inside; t += FRAME) {
      stepNpcs([npc], FRAME, nav, 0, random, indoor.seats, null, indoor.spots, 12);
      inside = Math.abs(npc.position.z) < 3.5 && Math.abs(npc.position.x) < 3.5;
    }
    nav.outdoorOpen = true;
    expect(inside).toBe(true);
    expect(npc.group.position.y).toBeCloseTo(0, 5);
  });
});

describe('walkers cut off outside (#913 review)', () => {
  const bench = ITEMS[1]!;
  const pen: FurnitureItem[] = [
    { x: 1.5, z: 6.3, r: 0, w: 3.2 },
    { x: 1.5, z: 8.7, r: 0, w: 3.2 },
    { x: -0.1, z: 7.5, r: Math.PI / 2, w: 2.6 },
    { x: 3.1, z: 7.5, r: Math.PI / 2, w: 2.6 },
  ].map(({ x, z, r, w }, i) => makeItem({ id: `pen${i}`, type: 'fence', name: 'Fence', category: 'outdoor', width: w, depth: 0.15, height: 1.2, position: { x, z }, rotation: r }));

  function seatedOnBench(nav: NpcNav, seats: ReadonlyMap<string, import('../lib/npc-seats').NpcSeat>): NpcState {
    const seat = [...seats.values()].find((candidate) => candidate.itemId === bench.id)!;
    const npc = sitter(seat.x, seat.z, { hunger: 1, energy: 0.5, fun: 1, hygiene: 1 });
    npc.seat = seat;
    npc.mode = 'seated';
    npc.pause = 10;
    npc.lift = 0.1;
    expect(nav).toBeTruthy();
    return npc;
  }

  it('a fence run between a walker and the door: it is brought in, standing, not left there', () => {
    const before = garden(makeLayout({ width: 8, height: 8, floors: [makeFloor({ items: ITEMS })] }));
    const npc = seatedOnBench(before.nav, before.seats);
    const after = garden(makeLayout({ width: 8, height: 8, floors: [makeFloor({ items: [...ITEMS, ...pen] })] }));
    rehomeNpcs([npc], after.nav, 0, seeded(1));
    expect(npc.seat).toBeNull();
    expect(npc.mode).toBe('pause');
    expect(Math.abs(npc.position.x)).toBeLessThan(4);
    expect(Math.abs(npc.position.z)).toBeLessThan(4);
    expect(npc.group.position.y).toBe(0);
  });

  it('the lot gone (the door removed) with a walker on the bench: it stands up indoors', () => {
    const before = garden(makeLayout({ width: 8, height: 8, floors: [makeFloor({ items: ITEMS })] }));
    const npc = seatedOnBench(before.nav, before.seats);
    const after = garden(makeLayout({ width: 8, height: 8, floors: [makeFloor({ items: ITEMS.slice(1) })] }));
    expect(after.nav.outdoor).toBeNull();
    rehomeNpcs([npc], after.nav, 0, seeded(2));
    expect(npc.mode).toBe('pause');
    expect(npc.seat).toBeNull();
    expect(Math.abs(npc.position.z)).toBeLessThan(4);
    // And it never walks back out through the wall.
    const random = seeded(3);
    for (let t = 0; t < 20; t += FRAME) {
      stepNpcs([npc], FRAME, after.nav, 0, random, after.seats, null, after.spots, 12);
      expect(Math.abs(npc.position.z)).toBeLessThan(4);
    }
  });
});
