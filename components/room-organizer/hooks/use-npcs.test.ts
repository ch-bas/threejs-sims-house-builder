import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { NPC_REPAINT, NPC_SHADOW, NPC_STILL, type NpcState, stepNpcs } from './use-npcs';

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
    phase: 0,
    pause: 0,
    shadowSettle: 0,
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
