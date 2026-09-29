import { useEffect, useRef } from 'react';
import { disposeObject } from '../three/builder-utils';
import { type HumanFigureRig, buildHumanFigure, poseWalk } from '../three/builders/human-figure';
import {
  PEOPLE_CLIPS,
  WALK_CLIP_SPEED,
  type PeopleModel,
  clonePerson,
  findClip,
  getPeopleModel,
} from '../three/people-model';
import type * as ThreeNS from 'three';

type ThreeModule = typeof import('three');

const NPC_TAG = 'npc';

interface NpcState {
  group: ThreeNS.Group;
  position: { x: number; z: number };
  target: { x: number; z: number };
  speed: number;
  /** Walk-cycle phase driving the procedural limb swing. */
  phase: number;
  /** Seconds left standing at the current waypoint before walking on. */
  pause: number;
  /** Procedural figure only. */
  rig: HumanFigureRig | null;
  /** Rigged figure only: the mixer and its walk / standing clips. */
  anim: NpcAnimation | null;
}

interface NpcAnimation {
  mixer: ThreeNS.AnimationMixer;
  walk: ThreeNS.AnimationAction;
  stand: ThreeNS.AnimationAction[];
  current: ThreeNS.AnimationAction;
}

const FADE_SECONDS = 0.35;

export interface UseNpcsOptions {
  enabled: boolean;
  count?: number;
  threeModuleRef: React.MutableRefObject<ThreeModule | null>;
  sceneRef: React.MutableRefObject<ThreeNS.Scene | null>;
  roomWidth: number;
  roomDepth: number;
  /** Y-offset to plant the NPCs on the active floor. */
  floorY: number;
  /**
   * True once people.glb has loaded. Flipping it re-spawns the walkers as
   * rigged figures; until then (or if it never loads) they're procedural.
   */
  riggedModelReady?: boolean;
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
  const {
    enabled, count = 3, threeModuleRef, sceneRef, roomWidth, roomDepth, floorY, riggedModelReady = false, invalidate, requestShadowUpdate,
  } = options;
  const stateRef = useRef<NpcState[]>([]);

  useEffect(() => {
    if (!enabled) return undefined;
    const THREE = threeModuleRef.current;
    const scene = sceneRef.current;
    if (!THREE || !scene) return undefined;

    const halfW = roomWidth / 2 - 0.4;
    const halfD = roomDepth / 2 - 0.4;
    if (halfW <= 0.2 || halfD <= 0.2) return undefined;

    const people = riggedModelReady ? getPeopleModel() : null;
    const npcs: NpcState[] = [];
    for (let i = 0; i < count; i++) {
      const npc = createNpc(THREE, scene, halfW, halfD, floorY, i, people);
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
        npc.anim?.mixer.stopAllAction();
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
  }, [enabled, count, riggedModelReady, invalidate, requestShadowUpdate, threeModuleRef, sceneRef, roomWidth, roomDepth, floorY]);
}

function createNpc(
  THREE: ThreeModule,
  scene: ThreeNS.Scene,
  halfW: number,
  halfD: number,
  floorY: number,
  index: number,
  people: PeopleModel | null
): NpcState {
  const riggedBodies = [0x8a9bb0, 0xc9a27e, 0x9bb08a, 0xb0908a, 0xa39cc0];
  const palette = [0xc62828, 0x2e7d32, 0x1565c0, 0xf9a825, 0x6a1b9a];
  const hairPalette = [0x2b1d14, 0x5a3825, 0x1a1a1a, 0x8d6e4a, 0x3b2a20];
  const skinPalette = [0xe0ac8a, 0xc68863, 0x8d5a3b, 0xf1c7a5, 0xa8714f];
  const pick = (list: number[]) => list[index % list.length] ?? list[0]!;
  // Slight height variety so a group of walkers doesn't look cloned.
  const heightScale = 0.94 + ((index * 37) % 11) / 100;

  let group: ThreeNS.Group;
  let rig: HumanFigureRig | null = null;
  let anim: NpcAnimation | null = null;

  const riggedParts = people && {
    walk: findClip(people, PEOPLE_CLIPS.walk),
    idle: findClip(people, PEOPLE_CLIPS.idle),
    talk: findClip(people, PEOPLE_CLIPS.talk),
  };
  if (people && riggedParts?.walk && riggedParts.idle) {
    group = new THREE.Group();
    const person = clonePerson(THREE, people, { body: pick(riggedBodies), joints: 0x3a3f47 });
    person.scale.setScalar((1.75 / people.height) * heightScale);
    group.add(person);
    const mixer = new THREE.AnimationMixer(person);
    const walk = mixer.clipAction(riggedParts.walk);
    const stand = [mixer.clipAction(riggedParts.idle)];
    if (riggedParts.talk) stand.push(mixer.clipAction(riggedParts.talk));
    walk.play();
    // Desynchronise the walkers so their steps don't land in unison.
    walk.time = Math.random() * riggedParts.walk.duration;
    anim = { mixer, walk, stand, current: walk };
  } else {
    const figure = buildHumanFigure(THREE, {
      top: new THREE.MeshStandardMaterial({ color: pick(palette), roughness: 0.8 }),
      skin: new THREE.MeshStandardMaterial({ color: skinPalette[(index * 2) % skinPalette.length] ?? 0xe0ac8a, roughness: 0.65 }),
      bottom: new THREE.MeshStandardMaterial({ color: 0x37474f, roughness: 0.85 }),
      shoes: new THREE.MeshStandardMaterial({ color: 0x1c1c1c, roughness: 0.6 }),
      hair: new THREE.MeshStandardMaterial({ color: pick(hairPalette), roughness: 0.9 }),
    });
    group = figure.group;
    rig = figure.rig;
    group.scale.setScalar(heightScale);
  }
  group.userData.type = NPC_TAG;

  const position = { x: rand(-halfW, halfW), z: rand(-halfD, halfD) };
  group.position.set(position.x, floorY, position.z);
  scene.add(group);

  const speed = 0.6 + Math.random() * 0.5;
  if (anim) anim.walk.timeScale = speed / WALK_CLIP_SPEED;

  return {
    group,
    position,
    target: { x: rand(-halfW, halfW), z: rand(-halfD, halfD) },
    speed,
    phase: Math.random() * Math.PI * 2,
    pause: 0,
    rig,
    anim,
  };
}

function crossFadeTo(anim: NpcAnimation, next: ThreeNS.AnimationAction): void {
  if (anim.current === next) return;
  next.reset().play();
  anim.current.crossFadeTo(next, FADE_SECONDS, false);
  anim.current = next;
}

/**
 * Advances every NPC one frame. Returns true when anything visibly changed
 * this frame, so the caller can skip the repaint / shadow recompute while
 * procedural walkers all stand still at their waypoints.
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
    // A rigged figure breathes and shifts its weight even while standing, so
    // it needs frames whenever it exists; the procedural one only when moving.
    if (npc.anim) {
      npc.anim.mixer.update(delta);
      moved = true;
    }

    if (npc.pause > 0) {
      npc.pause -= delta;
      if (npc.pause <= 0 && npc.anim) crossFadeTo(npc.anim, npc.anim.walk);
      continue;
    }

    const dx = npc.target.x - npc.position.x;
    const dz = npc.target.z - npc.position.z;
    const distance = Math.hypot(dx, dz);

    if (distance < 0.15) {
      // Reached the waypoint: stand for a moment, then head somewhere new.
      npc.target = { x: rand(-halfW, halfW), z: rand(-halfD, halfD) };
      npc.pause = 1.5 + Math.random() * 3;
      if (npc.anim) {
        const stand = npc.anim.stand[Math.floor(Math.random() * npc.anim.stand.length)] ?? npc.anim.stand[0]!;
        crossFadeTo(npc.anim, stand);
      } else if (npc.rig) {
        poseWalk(npc.rig, 0, 0);
        npc.group.position.y = floorY;
        moved = true;
      }
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

    if (npc.rig) {
      // Swing limbs about hips/shoulders; a small bob at each footfall.
      npc.phase += delta * npc.speed * 7;
      poseWalk(npc.rig, npc.phase);
      npc.group.position.y = floorY + Math.abs(Math.cos(npc.phase)) * 0.025;
    }
  }
  return moved;
}

function rand(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
