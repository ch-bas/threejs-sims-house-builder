import { useEffect, useRef } from 'react';
import { disposeObject } from '../three/builder-utils';
import { type HumanFigureRig, buildHumanFigure, poseWalk } from '../three/builders/human-figure';
import type * as ThreeNS from 'three';

type ThreeModule = typeof import('three');

const NPC_TAG = 'npc';

interface NpcState {
  group: ThreeNS.Group;
  position: { x: number; z: number };
  target: { x: number; z: number };
  speed: number;
  /** Walk-cycle phase driving the limb swing. */
  phase: number;
  rig: HumanFigureRig;
}

export interface UseNpcsOptions {
  enabled: boolean;
  count?: number;
  threeModuleRef: React.MutableRefObject<ThreeModule | null>;
  sceneRef: React.MutableRefObject<ThreeNS.Scene | null>;
  roomWidth: number;
  roomDepth: number;
  /** Y-offset to plant the NPCs on the active floor. */
  floorY: number;
  /** Request a render on the next animation frame (render-on-demand). */
  invalidate?: () => void;
  /**
   * Recompute the static shadow map. NPCs cast shadows, so while they're
   * actually walking their shadows must keep updating — but only then.
   */
  requestShadowUpdate?: () => void;
}

/**
 * Sprinkles a few procedurally-built human figures into the scene and
 * walks them between random waypoints inside the room. Cleanup tears
 * down all NPC meshes and the RAF loop on every dependency change.
 */
export function useNpcs(options: UseNpcsOptions): void {
  const { enabled, count = 3, threeModuleRef, sceneRef, roomWidth, roomDepth, floorY, invalidate, requestShadowUpdate } = options;
  const stateRef = useRef<NpcState[]>([]);

  useEffect(() => {
    if (!enabled) return undefined;
    const THREE = threeModuleRef.current;
    const scene = sceneRef.current;
    if (!THREE || !scene) return undefined;

    const halfW = roomWidth / 2 - 0.4;
    const halfD = roomDepth / 2 - 0.4;
    if (halfW <= 0.2 || halfD <= 0.2) return undefined;

    const npcs: NpcState[] = [];
    for (let i = 0; i < count; i++) {
      const npc = createNpc(THREE, scene, halfW, halfD, floorY, i);
      npcs.push(npc);
    }
    stateRef.current = npcs;

    let rafId = 0;
    let lastTime = performance.now();
    const tick = () => {
      rafId = requestAnimationFrame(tick);
      const now = performance.now();
      const delta = Math.min(0.1, (now - lastTime) / 1000);
      lastTime = now;
      // Only request a repaint (and a shadow-map recompute) when an NPC
      // actually moved this frame. When every NPC is idling at its target the
      // render loop stays parked instead of pinning the GPU at refresh rate.
      const moved = stepNpcs(stateRef.current, delta, halfW, halfD, floorY);
      if (moved) {
        requestShadowUpdate?.();
        invalidate?.();
      }
    };
    rafId = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(rafId);
      for (const npc of stateRef.current) {
        scene.remove(npc.group);
        disposeObject(npc.group);
      }
      stateRef.current = [];
      // Nothing else consumes showNpcs, so without an explicit repaint (and a
      // shadow-map refresh — walkers cast) the removed NPCs stay painted in
      // the last frame until something unrelated invalidates (#119).
      requestShadowUpdate?.();
      invalidate?.();
    };
  }, [enabled, count, invalidate, requestShadowUpdate, threeModuleRef, sceneRef, roomWidth, roomDepth, floorY]);
}

function createNpc(
  THREE: ThreeModule,
  scene: ThreeNS.Scene,
  halfW: number,
  halfD: number,
  floorY: number,
  index: number
): NpcState {
  const palette = [0xc62828, 0x2e7d32, 0x1565c0, 0xf9a825, 0x6a1b9a];
  const hairPalette = [0x2b1d14, 0x5a3825, 0x1a1a1a, 0x8d6e4a, 0x3b2a20];
  const skinPalette = [0xe0ac8a, 0xc68863, 0x8d5a3b, 0xf1c7a5, 0xa8714f];
  const pick = (list: number[]) => list[index % list.length] ?? list[0]!;

  const { group, rig } = buildHumanFigure(THREE, {
    top: new THREE.MeshStandardMaterial({ color: pick(palette), roughness: 0.8 }),
    skin: new THREE.MeshStandardMaterial({ color: skinPalette[(index * 2) % skinPalette.length] ?? 0xe0ac8a, roughness: 0.65 }),
    bottom: new THREE.MeshStandardMaterial({ color: 0x37474f, roughness: 0.85 }),
    shoes: new THREE.MeshStandardMaterial({ color: 0x1c1c1c, roughness: 0.6 }),
    hair: new THREE.MeshStandardMaterial({ color: pick(hairPalette), roughness: 0.9 }),
  });
  group.userData.type = NPC_TAG;
  // Slight height variety so a group of walkers doesn't look cloned.
  group.scale.setScalar(0.94 + ((index * 37) % 11) / 100);

  const position = { x: rand(-halfW, halfW), z: rand(-halfD, halfD) };
  group.position.set(position.x, floorY, position.z);
  scene.add(group);

  return {
    group,
    position,
    target: { x: rand(-halfW, halfW), z: rand(-halfD, halfD) },
    speed: 0.6 + Math.random() * 0.5,
    phase: Math.random() * Math.PI * 2,
    rig,
  };
}

/**
 * Advances every NPC one frame. Returns true when at least one NPC actually
 * moved (or its limbs swung) this frame, so the caller can skip the repaint /
 * shadow recompute when they're all momentarily idling at their targets.
 */
function stepNpcs(
  npcs: NpcState[],
  delta: number,
  halfW: number,
  halfD: number,
  floorY: number
): boolean {
  let moved = false;
  for (const npc of npcs) {
    const dx = npc.target.x - npc.position.x;
    const dz = npc.target.z - npc.position.z;
    const distance = Math.hypot(dx, dz);

    if (distance < 0.15) {
      // Reached the waypoint: pick a new one but produce no visible motion
      // this frame (position/pose unchanged).
      npc.target = { x: rand(-halfW, halfW), z: rand(-halfD, halfD) };
      continue;
    }

    moved = true;

    const step = npc.speed * delta;
    const nx = npc.position.x + (dx / distance) * step;
    const nz = npc.position.z + (dz / distance) * step;
    npc.position.x = clamp(nx, -halfW, halfW);
    npc.position.z = clamp(nz, -halfD, halfD);

    // Face the direction of travel.
    npc.group.rotation.y = Math.atan2(dx, dz);
    npc.group.position.x = npc.position.x;
    npc.group.position.z = npc.position.z;

    // Swing limbs about hips/shoulders; a small bob at each footfall.
    npc.phase += delta * npc.speed * 7;
    poseWalk(npc.rig, npc.phase);
    npc.group.position.y = floorY + Math.abs(Math.cos(npc.phase)) * 0.025;
  }
  return moved;
}

function rand(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
