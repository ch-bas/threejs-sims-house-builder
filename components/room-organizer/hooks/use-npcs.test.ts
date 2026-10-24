import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { NPC_REPAINT, NPC_SHADOW, NPC_STILL, type NpcState, buildNpcWorld, stepNpcs, wayAheadBlocked } from './use-npcs';
import type { FurnitureItem } from '../lib/types';

const HALF = 3;
const FRAME = 1 / 60;

function rigged(overrides: Partial<NpcState> = {}): NpcState {
  const group = new THREE.Group();
  const mixer = new THREE.AnimationMixer(group);
  const clip = (name: string) => new THREE.AnimationClip(name, 1, []);
  const walk = mixer.clipAction(clip('walk'));
  const idle = mixer.clipAction(clip('idle'));
  walk.play();
  return {
    group,
    position: { x: 0, z: 0 },
    target: { x: 2, z: 0 },
    speed: 1,
    scale: 1,
    mode: overrides.pause ? 'pause' : 'walk',
    phase: 0,
    pause: 0,
    shadowSettle: 0,
    seat: null,
    lift: 0,
    rig: null,
    anim: { mixer, walk, stand: [idle], current: walk },
    ...overrides,
  };
}

describe('stepNpcs shadow requests (#400)', () => {
  it('a walking figure moves a caster: recompute the shadow map', () => {
    expect(stepNpcs([rigged()], FRAME, HALF, HALF, 0)).toBe(NPC_SHADOW);
  });

  it('a rigged figure idling at its waypoint only needs a repaint', () => {
    expect(stepNpcs([rigged({ pause: 3 })], FRAME, HALF, HALF, 0)).toBe(NPC_REPAINT);
  });

  it('keeps the shadow following the pose while a stopped figure settles, then lets it rest', () => {
    // Arrive at the waypoint this frame.
    const npc = rigged({ target: { x: 0.05, z: 0 } });
    expect(stepNpcs([npc], FRAME, HALF, HALF, 0)).toBe(NPC_SHADOW);
    npc.pause = 10; // make sure it stays put for the rest of the test
    const changes: number[] = [];
    for (let frame = 0; frame < 60; frame += 1) changes.push(stepNpcs([npc], FRAME, HALF, HALF, 0));
    const settled = changes.indexOf(NPC_REPAINT);
    // The 0.35 s crossfade into the standing pose, give or take a frame.
    expect(settled).toBeGreaterThanOrEqual(20);
    expect(settled).toBeLessThanOrEqual(22);
    expect(changes.slice(0, settled).every((c) => c === NPC_SHADOW)).toBe(true);
    expect(changes.slice(settled).every((c) => c === NPC_REPAINT)).toBe(true);
  });

  it('one walker on the move outweighs another idling', () => {
    expect(stepNpcs([rigged({ pause: 3 }), rigged()], FRAME, HALF, HALF, 0)).toBe(NPC_SHADOW);
  });

  it('procedural walkers standing still need nothing', () => {
    expect(stepNpcs([rigged({ pause: 3, anim: null })], FRAME, HALF, HALF, 0)).toBe(NPC_STILL);
  });
});

function furniture(overrides: Partial<FurnitureItem> & { position: { x: number; z: number } }): FurnitureItem {
  return {
    id: 'table',
    type: 'table',
    name: 'Table',
    width: 1,
    depth: 1,
    height: 0.75,
    color: '#000',
    icon: '',
    rotation: 0,
    ...overrides,
  };
}

/** One-second clips: the sit, stand and activity actions a full rig carries. */
function seatedRig(overrides: Partial<NpcState> = {}): NpcState {
  const npc = rigged(overrides);
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

const run = (npcs: NpcState[], seconds: number, world: ReturnType<typeof buildNpcWorld>) => {
  for (let t = 0; t < seconds; t += FRAME) stepNpcs(npcs, FRAME, HALF, HALF, 0, world);
};

describe('walkers stop for obstacles', () => {
  it('stops in front of a table across its path instead of walking through it', () => {
    const world = buildNpcWorld([furniture({ position: { x: 1, z: 0 } })], [], 10, 10);
    const npc = rigged({ target: { x: 2.5, z: 0 } });
    for (let t = 0; t < 2 && npc.mode === 'walk'; t += FRAME) stepNpcs([npc], FRAME, HALF, HALF, 0, world);
    expect(npc.mode).toBe('blocked');
    // The table's near face is x = 0.5: the walker stops short of it.
    expect(npc.position.x).toBeLessThan(0.5 - 0.22);
    expect(npc.position.x).toBeGreaterThan(-0.2);
  });

  it('after waiting, heads somewhere it can reach', () => {
    const world = buildNpcWorld([furniture({ position: { x: 1, z: 0 } })], [], 10, 10);
    const npc = rigged({ target: { x: 2.5, z: 0 } });
    run([npc], 3.5, world);
    expect(npc.target).not.toEqual({ x: 2.5, z: 0 });
  });

  it('sees another person ahead, but not one behind or to the side', () => {
    const world = buildNpcWorld([], [], 10, 10);
    const npc = rigged({ target: { x: 2, z: 0 } });
    expect(wayAheadBlocked(npc, [npc, rigged({ position: { x: 0.6, z: 0.1 } })], world)).toBe(true);
    expect(wayAheadBlocked(npc, [npc, rigged({ position: { x: -0.6, z: 0 } })], world)).toBe(false);
    expect(wayAheadBlocked(npc, [npc, rigged({ position: { x: 0, z: 0.6 } })], world)).toBe(false);
    expect(wayAheadBlocked(npc, [npc, rigged({ position: { x: 1.5, z: 0 } })], world)).toBe(false);
  });

  it('two walkers heading at each other stop rather than pass through', () => {
    const world = buildNpcWorld([], [], 10, 10);
    const a = rigged({ position: { x: -1, z: 0 }, target: { x: 2, z: 0 } });
    const b = rigged({ position: { x: 1, z: 0 }, target: { x: -2, z: 0 } });
    run([a, b], 1.2, world);
    expect(a.mode).toBe('blocked');
    expect(b.mode).toBe('blocked');
    expect(b.position.x - a.position.x).toBeGreaterThan(0.5);
  });
});

describe('walkers sit down', () => {
  const chair = furniture({ id: 'chair', type: 'chair', width: 0.5, depth: 0.5, height: 0.8, position: { x: 0, z: 0 } });

  it('walks to the chair, turns to face its way, sits, then gets up and steps back out', () => {
    const world = buildNpcWorld([chair], [], 10, 10);
    const seat = world.seats.get('chair:0')!;
    const npc = seatedRig({ position: { x: 0, z: 2 }, target: { x: seat.approachX, z: seat.approachZ }, seat });
    const modes = new Set<string>();
    for (let t = 0; t < 6; t += FRAME) {
      stepNpcs([npc], FRAME, HALF, HALF, 0, world);
      modes.add(npc.mode);
      if (npc.mode === 'seated') break;
    }
    expect([...modes]).toEqual(expect.arrayContaining(['walk', 'settle', 'turn', 'sitDown', 'seated']));
    expect(npc.group.rotation.y).toBeCloseTo(0);
    // Feet just in front of the seat, which faces +z.
    expect(npc.position.z).toBeGreaterThan(0);
    expect(npc.position.z).toBeLessThan(0.5);

    npc.pause = 0;
    for (let t = 0; t < 4 && npc.seat; t += FRAME) stepNpcs([npc], FRAME, HALF, HALF, 0, world);
    expect(npc.seat).toBeNull();
    // Back at the approach point, clear of the chair's footprint.
    expect(npc.position.z).toBeGreaterThan(0.25 + 0.22);
    expect(npc.lift).toBe(0);
  });

  it('gets up when its chair is moved away', () => {
    const world = buildNpcWorld([chair], [], 10, 10);
    const seat = world.seats.get('chair:0')!;
    const npc = seatedRig({ seat, mode: 'seated', pause: 30 });
    const moved = buildNpcWorld([{ ...chair, position: { x: 2, z: 2 } }], [], 10, 10);
    stepNpcs([npc], FRAME, HALF, HALF, 0, moved);
    expect(npc.mode).toBe('standUp');
  });
});
