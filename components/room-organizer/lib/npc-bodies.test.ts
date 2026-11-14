import { describe, expect, it } from 'vitest';
import { makeFloor } from './__testfixtures__/fixtures';
import {
  type BodiesCache,
  SEAT_SHARE_GAP,
  createNpcBody,
  createNpcHandOff,
  moveNpcBody,
  seatTakenByPlayer,
  seatTakenByWalker,
  withNpcBodies,
} from './npc-bodies';
import { advanceWalker, boxCollider, type WalkerState } from './walk-collision';
import { buildWalkWorld } from './walk-world';

const PLAYER_RADIUS = 0.3;

describe('the player bumps into walkers (#585)', () => {
  const world = buildWalkWorld({ width: 8, depth: 8, floors: [makeFloor(), makeFloor({ id: 'upper' })] });

  function walkInto(bodyFloorY: number, bodyFloorIndex: number): WalkerState {
    const body = createNpcBody(1, 0, bodyFloorY, bodyFloorIndex);
    const solid = withNpcBodies([], [body], new WeakMap());
    const walker: WalkerState = { x: -1, z: 0, y: 0, kind: 'floor', floorIndex: 0 };
    for (let i = 0; i < 60; i++) advanceWalker(world, solid, walker, 0.05, 0, PLAYER_RADIUS);
    return walker;
  }

  it('stops at a walker on its storey', () => {
    expect(walkInto(0, 0).x).toBeLessThan(1 - 0.22 - PLAYER_RADIUS + 0.01);
  });

  it('walks under a walker on the storey above', () => {
    expect(walkInto(3, 1).x).toBeGreaterThan(1.5);
  });

  it('follows the walker as it moves', () => {
    const body = createNpcBody(1, 0, 0, 0);
    moveNpcBody(body, -2, 1, 3, 1);
    expect(body.collider).toMatchObject({ cx: -2, cz: 1, bottom: 3 });
    expect(body.collider.top).toBeGreaterThan(4.7);
    expect(body.floorIndex).toBe(1);
  });
});

describe('withNpcBodies', () => {
  const wall = boxCollider(0, 0, 1, 0.1, 0, false);
  const colliders = [wall];

  it('is the storey colliders alone with no walkers', () => {
    expect(withNpcBodies(colliders, [], new WeakMap())).toBe(colliders);
  });

  it('is built once per storey and set of walkers, not per frame', () => {
    const cache: BodiesCache = new WeakMap();
    const bodies = [createNpcBody(1, 1, 0, 0), createNpcBody(2, 2, 0, 0)];
    const all = withNpcBodies(colliders, bodies, cache);
    expect(all).toEqual([wall, bodies[0]!.collider, bodies[1]!.collider]);
    // The walkers walk: their boxes move in place, the array stands.
    moveNpcBody(bodies[0]!, 3, 3, 0, 0);
    expect(withNpcBodies(colliders, bodies, cache)).toBe(all);
    expect(all[1]!.cx).toBe(3);
    // A walker more: built again.
    expect(withNpcBodies(colliders, [...bodies, createNpcBody(0, 0, 0, 0)], cache)).toHaveLength(4);
  });
});

describe('one sitter per seat (#585)', () => {
  it('a walker in a seat takes it from the player, on its own storey only', () => {
    const body = createNpcBody(0, 0, 0, 0);
    expect(seatTakenByWalker([body], 0, 0, 0)).toBe(false);
    body.seatX = 0.2;
    body.seatZ = 0;
    expect(seatTakenByWalker([body], 0, 0, 0)).toBe(true);
    expect(seatTakenByWalker([body], 1, 0, 0)).toBe(false);
    // The other end of a three-seat sofa is still free.
    expect(seatTakenByWalker([body], 0, 0.2 + 0.67, 0)).toBe(false);
  });

  it('the seated player takes the slots under it, and only while there', () => {
    const { player } = createNpcHandOff();
    player.present = true;
    expect(seatTakenByPlayer(player, 0, 0, 0)).toBe(false);
    player.seatX = 0;
    player.seatZ = 0;
    // A two-seat sofa's slots, either side of the centre the player takes.
    expect(seatTakenByPlayer(player, 0, 0.5, 0)).toBe(true);
    expect(seatTakenByPlayer(player, 0, -0.5, 0)).toBe(true);
    expect(seatTakenByPlayer(player, 0, SEAT_SHARE_GAP + 0.01, 0)).toBe(false);
    expect(seatTakenByPlayer(player, 1, 0, 0)).toBe(false);
    player.present = false;
    expect(seatTakenByPlayer(player, 0, 0, 0)).toBe(false);
  });
});
