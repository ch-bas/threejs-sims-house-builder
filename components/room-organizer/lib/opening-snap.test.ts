import { describe, expect, it } from 'vitest';
import {
  reseatWallMountedItem,
  settleWallMountedItem,
  snapOpeningToWall,
  snapWallMountedItem,
} from './opening-snap';

// 8×8 room throughout: walls at x = ±4, z = ±4.
const W = 8;
const D = 8;

describe('snapOpeningToWall — exterior walls (#123)', () => {
  it.each([
    ['north', { x: 1, z: -3 }, { x: 1, z: -4 }, 0],
    ['south', { x: -1, z: 3 }, { x: -1, z: 4 }, Math.PI],
    ['east', { x: 3, z: 1 }, { x: 4, z: 1 }, -Math.PI / 2],
    ['west', { x: -3, z: -1 }, { x: -4, z: -1 }, Math.PI / 2],
  ])('snaps to the %s wall on-plane with the wall-aligned rotation', (_wall, cursor, position, rotation) => {
    const snap = snapOpeningToWall({ position: cursor, itemWidth: 1, roomWidth: W, roomDepth: D });
    expect(snap.wallKind).toBe('exterior');
    expect(snap.position.x).toBeCloseTo(position.x, 10);
    expect(snap.position.z).toBeCloseTo(position.z, 10);
    expect(snap.rotation).toBeCloseTo(rotation, 10);
  });

  it('clamps the opening inside the wall ends', () => {
    const snap = snapOpeningToWall({ position: { x: 9, z: -3.8 }, itemWidth: 1.2, roomWidth: W, roomDepth: D });
    expect(snap.position.x).toBeCloseTo(4 - 0.6, 10);
    expect(snap.position.z).toBe(-4);
  });
});

describe('snapOpeningToWall — interior walls (#123)', () => {
  const wall = { id: 'iw', x1: -2, z1: 0, x2: 2, z2: 0 };

  it('prefers a nearby interior wall over a farther exterior wall', () => {
    const snap = snapOpeningToWall({
      position: { x: 0.5, z: 0.3 },
      itemWidth: 0.9,
      roomWidth: W,
      roomDepth: D,
      interiorWalls: [wall],
    });
    expect(snap.wallKind).toBe('interior');
    expect(snap.position.z).toBeCloseTo(0, 10);
    expect(snap.position.x).toBeCloseTo(0.5, 10);
    // Wall direction (+x): rotation = -atan2(0, 4) = 0.
    expect(snap.rotation).toBeCloseTo(0, 10);
    expect(snap.interiorWall).toMatchObject({ x1: -2, z1: 0, x2: 2, z2: 0 });
  });

  it('insets the snap point so the opening cannot overflow the segment ends', () => {
    const snap = snapOpeningToWall({
      position: { x: 2.4, z: 0.05 },
      itemWidth: 0.9,
      roomWidth: W,
      roomDepth: D,
      interiorWalls: [wall],
    });
    expect(snap.wallKind).toBe('interior');
    // Clamped to segment end minus the half-width inset: 2 − 0.45.
    expect(snap.position.x).toBeCloseTo(2 - 0.45, 10);
  });

  it('ignores segments too short to hold the opening', () => {
    const stub = { id: 's', x1: 0, z1: 0, x2: 0.5, z2: 0 };
    const snap = snapOpeningToWall({
      position: { x: 0.2, z: 0.1 },
      itemWidth: 0.9,
      roomWidth: W,
      roomDepth: D,
      interiorWalls: [stub],
    });
    expect(snap.wallKind).toBe('exterior');
  });
});

describe('snapWallMountedItem — interior seating side (#123)', () => {
  const wall = { id: 'iw', x1: -2, z1: 0, x2: 2, z2: 0 };

  it.each([
    ['cursor on +z side', 0.4, 1],
    ['cursor on -z side', -0.4, -1],
  ])('seats the camera on the side the cursor dropped (%s)', (_label, cursorZ, sideSign) => {
    const snap = snapWallMountedItem({
      position: { x: 0, z: cursorZ },
      itemWidth: 0.3,
      itemDepth: 0.2,
      roomWidth: W,
      roomDepth: D,
      interiorWalls: [wall],
    });
    expect(snap.wallKind).toBe('interior');
    // Inset = depth/2 + 0.02 + interior half-thickness (0.08) = 0.2.
    expect(snap.position.z).toBeCloseTo(sideSign * 0.2, 10);
  });
});

describe('reseatWallMountedItem (#123)', () => {
  it('stands a bracketed camera off the wall by the arm length', () => {
    const pos = reseatWallMountedItem({
      position: { x: 0, z: -3.8 },
      itemWidth: 0.3,
      itemDepth: 0.2,
      roomWidth: W,
      roomDepth: D,
      rotation: 0,
      bracketArm: 0.22,
    });
    // North wall inward normal is +z: base on the wall plane, body 0.22 in.
    expect(pos.z).toBeCloseTo(-4 + 0.22, 10);
    expect(pos.x).toBeCloseTo(0, 10);
  });

  it('flush camera seats on the side it faces — turned outward, it moves outside', () => {
    const inward = reseatWallMountedItem({
      position: { x: 0, z: -3.9 },
      itemWidth: 0.3,
      itemDepth: 0.2,
      roomWidth: W,
      roomDepth: D,
      rotation: 0, // faces +z = into the room
    });
    const outward = reseatWallMountedItem({
      position: { x: 0, z: -3.9 },
      itemWidth: 0.3,
      itemDepth: 0.2,
      roomWidth: W,
      roomDepth: D,
      rotation: Math.PI, // faces -z = out through the north wall
    });
    expect(inward.z).toBeCloseTo(-4 + 0.12, 10);
    expect(outward.z).toBeCloseTo(-4 - 0.12, 10);
  });
});

describe('settleWallMountedItem (#116)', () => {
  it('returns null for items that do not mount on walls', () => {
    expect(settleWallMountedItem({ type: 'sofa', width: 2, depth: 0.9, rotation: 0 }, { x: 1, z: 1 }, W, D)).toBeNull();
  });

  it('snaps a door back onto the nearest wall and re-aligns its rotation', () => {
    const settled = settleWallMountedItem(
      { type: 'door', width: 0.9, depth: 0.12, rotation: Math.PI / 2 },
      { x: 0.3, z: -3.2 },
      W,
      D
    );
    expect(settled).not.toBeNull();
    // North wall (z = -4) is nearest; its aligned rotation is 0.
    expect(settled!.position).toEqual({ x: 0.3, z: -4 });
    expect(settled!.rotation).toBe(0);
  });

  it('omits the rotation patch when the opening is already wall-aligned', () => {
    const settled = settleWallMountedItem(
      { type: 'window', width: 1.2, depth: 0.12, rotation: 0 },
      { x: -1, z: -3.5 },
      W,
      D
    );
    expect(settled!.position).toEqual({ x: -1, z: -4 });
    expect(settled!.rotation).toBeUndefined();
  });

  it('seats a flush camera against the nearest wall and records the wall rotation', () => {
    const settled = settleWallMountedItem(
      { type: 'security-camera', width: 0.3, depth: 0.2, rotation: 0 },
      { x: 3.5, z: 0.5 },
      W,
      D
    );
    // East wall (x = 4): inward normal rotation is -π/2; body inset by
    // depth/2 + 0.02 so the back face rests on the wall.
    expect(settled!.wallRotation).toBeCloseTo(-Math.PI / 2, 10);
    expect(settled!.position.x).toBeCloseTo(4 - 0.12, 10);
    expect(settled!.position.z).toBeCloseTo(0.5, 10);
    expect(settled!.rotation).toBeCloseTo(-Math.PI / 2, 10);
  });

  it('clamps the settled opening within the wall ends', () => {
    const settled = settleWallMountedItem(
      { type: 'door', width: 0.9, depth: 0.12, rotation: 0 },
      { x: 7.5, z: -3.9 },
      W,
      D
    );
    // x is clamped so the whole 0.9 m door stays on the 8 m wall.
    expect(settled!.position.x).toBeCloseTo(4 - 0.45, 10);
    expect(settled!.position.z).toBe(-4);
  });
});
