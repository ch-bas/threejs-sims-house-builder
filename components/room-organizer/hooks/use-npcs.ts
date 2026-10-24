import { useEffect, useMemo, useRef } from 'react';
import {
  MAX_PATH_POINTS,
  NPC_RADIUS,
  type NpcNav,
  buildNpcNav,
  cellAt,
  cellX,
  cellZ,
  findNpcPath,
  isFreeAt,
  nearestFreeCell,
  pickDestination,
  randomFreeCell,
} from '../lib/npc-path';
import { type WalkerPosition, resolveWalkerStep } from '../lib/walk-collision';
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
import type { KeepOutRect } from '../lib/geometry';
import type { FurnitureItem, InteriorWall } from '../lib/types';
import type * as ThreeNS from 'three';

type ThreeModule = typeof import('../three/three-runtime');

const NPC_TAG = 'npc';

export interface NpcState {
  group: ThreeNS.Group;
  position: { x: number; z: number };
  speed: number;
  /** Walk-cycle phase driving the procedural limb swing. */
  phase: number;
  /** Seconds left standing at the current waypoint before walking on. */
  pause: number;
  /**
   * Rigged figure only: seconds the shadow keeps following the pose after a
   * stop, so it settles from the stride into the standing pose (#400).
   */
  shadowSettle: number;
  /** Procedural figure only. */
  rig: HumanFigureRig | null;
  /** Rigged figure only: the mixer and its walk / standing clips. */
  anim: NpcAnimation | null;
  /** The route to the current destination, as x, z pairs (#452). */
  path: Float32Array;
  pathLength: number;
  /** The waypoint being walked to. */
  pathIndex: number;
  /** Heading that faces the furniture at the destination; NaN for open floor. */
  arrivalHeading: number;
  /** Heading to turn to while standing at a stop (the last arrival's); NaN keeps the current one. */
  standHeading: number;
  /** Seconds spent walking without getting anywhere; past `STUCK_SECONDS` it gives up. */
  stuck: number;
}

export interface NpcAnimation {
  mixer: ThreeNS.AnimationMixer;
  walk: ThreeNS.AnimationAction;
  stand: ThreeNS.AnimationAction[];
  current: ThreeNS.AnimationAction;
}

const FADE_SECONDS = 0.35;
/** Close enough to a waypoint to head for the next one. */
const WAYPOINT_REACHED = 0.15;
/** How fast a walker turns (radians per second): it rounds corners, never snaps. */
const TURN_RATE = 7;
/** Under this fraction of the intended stride counts as not getting anywhere. */
const STUCK_PROGRESS = 0.25;
const STUCK_SECONDS = 2;
/** Walkers don't pick a stop closer than this to another's. */
const PERSONAL_SPACE = 0.9;
const EMPTY_WALLS: readonly InteriorWall[] = [];

/** What `stepNpcs` found changed this frame. */
export const NPC_STILL = 0;
/** A pose changed: repaint. */
export const NPC_REPAINT = 1;
/** A caster moved: repaint and recompute the shadow map. */
export const NPC_SHADOW = 2;
type NpcChange = typeof NPC_STILL | typeof NPC_REPAINT | typeof NPC_SHADOW;

export interface UseNpcsOptions {
  enabled: boolean;
  count?: number;
  threeModuleRef: React.MutableRefObject<ThreeModule | null>;
  sceneRef: React.MutableRefObject<ThreeNS.Scene | null>;
  roomWidth: number;
  roomDepth: number;
  /** The active floor's items and partitions: what the walkers walk around. */
  items: readonly FurnitureItem[];
  interiorWalls?: readonly InteriorWall[] | undefined;
  /** The active floor's porch and stairwell keep-out (`useFloorKeepOut`). */
  keepOut: readonly KeepOutRect[];
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
 * Sprinkles a few human figures into the scene and walks them around the
 * active floor's furniture, partitions, stairs and keep-out between spots
 * worth stopping at (#452). The walkers are spawned once per floor; editing
 * the floor re-routes them (and steps any the edit landed on into free
 * space) without respawning.
 */
export function useNpcs(options: UseNpcsOptions): void {
  const {
    enabled, count = 3, threeModuleRef, sceneRef, roomWidth, roomDepth, items, interiorWalls = EMPTY_WALLS, keepOut,
    floorY, riggedModelReady = false, invalidate, requestShadowUpdate,
  } = options;
  const stateRef = useRef<NpcState[]>([]);
  const navRef = useRef<NpcNav | null>(null);

  // Rebuilt only on the fields it reads, and not at all while walkers are off.
  const nav = useMemo(
    () => (enabled ? buildNpcNav({ items, interiorWalls, keepOut, roomWidth, roomDepth }) : null),
    [enabled, items, interiorWalls, keepOut, roomWidth, roomDepth]
  );

  // A floor with no free cell spawns nobody; clearing it lets them in.
  const hasRoom = (nav?.freeCount ?? 0) > 0;

  // Declared before the spawn effect so a spawn always sees the current nav.
  useEffect(() => {
    navRef.current = nav;
    if (!nav || stateRef.current.length === 0) return;
    rehomeNpcs(stateRef.current, nav, floorY);
    requestShadowUpdate?.();
    invalidate?.();
    // floorY is read for the rehome only; a floor change respawns below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nav]);

  useEffect(() => {
    if (!enabled) return undefined;
    const THREE = threeModuleRef.current;
    const scene = sceneRef.current;
    const startNav = navRef.current;
    if (!THREE || !scene || !startNav || !hasRoom) return undefined;

    const people = riggedModelReady ? getPeopleModel() : null;
    const npcs: NpcState[] = [];
    for (let i = 0; i < count; i++) {
      npcs.push(createNpc(THREE, scene, startNav, floorY, i, people, npcs));
    }
    stateRef.current = npcs;

    let rafId = 0;
    let lastTime = performance.now();
    const tick = () => {
      rafId = requestAnimationFrame(tick);
      const now = performance.now();
      const delta = Math.min(0.1, (now - lastTime) / 1000);
      lastTime = now;
      const currentNav = navRef.current;
      if (!currentNav) return;
      // Repaint only when a pose changed, and recompute the 2048² shadow map
      // only when a walker moved: a rigged figure idles (breathes) every
      // frame, and re-rendering every caster for that pinned the GPU (#400).
      const change = stepNpcs(stateRef.current, delta, currentNav, floorY);
      if (change === NPC_SHADOW) requestShadowUpdate?.();
      if (change !== NPC_STILL) invalidate?.();
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
  }, [enabled, hasRoom, count, riggedModelReady, invalidate, requestShadowUpdate, threeModuleRef, sceneRef, roomWidth, roomDepth, floorY]);
}

function createNpc(
  THREE: ThreeModule,
  scene: ThreeNS.Scene,
  nav: NpcNav,
  floorY: number,
  index: number,
  people: PeopleModel | null,
  others: readonly NpcState[]
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

  // Spawn in free space (never inside the sofa or the stair flight).
  const spawn = randomFreeCell(nav, Math.random);
  const position = { x: cellX(nav, spawn), z: cellZ(nav, spawn) };
  group.position.set(position.x, floorY, position.z);
  group.rotation.y = Math.random() * Math.PI * 2;
  scene.add(group);

  const speed = 0.6 + Math.random() * 0.5;
  if (anim) anim.walk.timeScale = speed / WALK_CLIP_SPEED;

  const npc: NpcState = {
    group,
    position,
    speed,
    phase: Math.random() * Math.PI * 2,
    pause: 0,
    shadowSettle: 0,
    rig,
    anim,
    path: new Float32Array(MAX_PATH_POINTS * 2),
    pathLength: 0,
    pathIndex: 0,
    arrivalHeading: Number.NaN,
    standHeading: Number.NaN,
    stuck: 0,
  };
  planRoute(npc, nav, Math.random, others);
  return npc;
}

/**
 * Give a walker a new destination it can reach and the route there. Leaves
 * it with an empty route when its patch of floor has nowhere else to go.
 */
export function planRoute(npc: NpcState, nav: NpcNav, random: () => number, others: readonly NpcState[] = []): void {
  npc.pathLength = 0;
  npc.pathIndex = 0;
  npc.stuck = 0;
  npc.arrivalHeading = Number.NaN;
  const under = cellAt(nav, npc.position.x, npc.position.z);
  const from = nav.walkable[under] === 1 ? under : nearestFreeCell(nav, npc.position.x, npc.position.z);
  if (from < 0) return;
  const destination = pickDestination(nav, from, random, (x, z) => others.some((other) => other !== npc && claims(other, x, z)));
  if (destination < 0) return;
  // Route from the cell's centre when the walker stands just off the grid's
  // free cells (pushed against a face); its first waypoint is in reach.
  const startX = from === under ? npc.position.x : cellX(nav, from);
  const startZ = from === under ? npc.position.z : cellZ(nav, from);
  npc.pathLength = findNpcPath(nav, startX, startZ, destination, npc.path);
  npc.arrivalHeading = nav.heading[destination] ?? Number.NaN;
}

/** Whether a walker stands at, or is heading for, a spot within arm's reach of (x, z). */
function claims(npc: NpcState, x: number, z: number): boolean {
  const last = npc.pathLength - 1;
  const atX = last >= 0 ? npc.path[last * 2]! : npc.position.x;
  const atZ = last >= 0 ? npc.path[last * 2 + 1]! : npc.position.z;
  return Math.hypot(atX - x, atZ - z) < PERSONAL_SPACE;
}

/**
 * The floor changed under the walkers: step any that now stand in
 * something into the nearest free space, and re-route every one, since its
 * route may run through the new sofa.
 */
export function rehomeNpcs(npcs: readonly NpcState[], nav: NpcNav, floorY: number, random: () => number = Math.random): void {
  for (const npc of npcs) {
    if (!isFreeAt(nav, npc.position.x, npc.position.z)) {
      const cell = nearestFreeCell(nav, npc.position.x, npc.position.z);
      if (cell >= 0) {
        npc.position.x = cellX(nav, cell);
        npc.position.z = cellZ(nav, cell);
        npc.group.position.set(npc.position.x, floorY, npc.position.z);
      }
    }
    planRoute(npc, nav, random, npcs);
  }
}

function crossFadeTo(anim: NpcAnimation, next: ThreeNS.AnimationAction): void {
  if (anim.current === next) return;
  next.reset().play();
  anim.current.crossFadeTo(next, FADE_SECONDS, false);
  anim.current = next;
}

/** Turn a walker toward a heading at `TURN_RATE`; true when it turned. */
function turnToward(group: ThreeNS.Group, heading: number, delta: number): boolean {
  const current = group.rotation.y;
  const diff = Math.atan2(Math.sin(heading - current), Math.cos(heading - current));
  if (Math.abs(diff) < 1e-3) return false;
  const maxTurn = TURN_RATE * delta;
  group.rotation.y = current + Math.max(-maxTurn, Math.min(maxTurn, diff));
  return true;
}

const stepScratch: WalkerPosition = { x: 0, z: 0 };
const targetScratch: WalkerPosition = { x: 0, z: 0 };

/**
 * Advances every NPC one frame and reports the biggest change: a walker that
 * moved needs the shadow map recomputed, a rigged one idling needs only a
 * repaint, and procedural walkers standing still need nothing.
 * Allocation-free: routes are planned into each walker's own buffer.
 */
export function stepNpcs(
  npcs: readonly NpcState[],
  delta: number,
  nav: NpcNav,
  floorY: number,
  random: () => number = Math.random
): NpcChange {
  let change: NpcChange = NPC_STILL;
  for (const npc of npcs) {
    // A rigged figure breathes and shifts its weight even while standing, so
    // it needs frames whenever it exists; the procedural one only when moving.
    if (npc.anim) {
      npc.anim.mixer.update(delta);
      if (change === NPC_STILL) change = NPC_REPAINT;
    }

    if (npc.pause > 0) {
      npc.pause -= delta;
      if (npc.shadowSettle > 0) {
        npc.shadowSettle -= delta;
        change = NPC_SHADOW;
      }
      // Turn to look at whatever it stopped by.
      if (!Number.isNaN(npc.standHeading) && turnToward(npc.group, npc.standHeading, delta)) change = NPC_SHADOW;
      if (npc.pause <= 0 && npc.anim && npc.pathIndex < npc.pathLength) crossFadeTo(npc.anim, npc.anim.walk);
      continue;
    }

    while (npc.pathIndex < npc.pathLength) {
      const wx = npc.path[npc.pathIndex * 2]!;
      const wz = npc.path[npc.pathIndex * 2 + 1]!;
      if (Math.hypot(wx - npc.position.x, wz - npc.position.z) >= WAYPOINT_REACHED) break;
      npc.pathIndex += 1;
    }

    if (npc.pathIndex >= npc.pathLength) {
      // Arrived: face whatever it came to see while it stands for a moment,
      // then head somewhere new (planned now; it sets off after the pause).
      npc.standHeading = npc.arrivalHeading;
      planRoute(npc, nav, random, npcs);
      npc.pause = 1.5 + random() * 3;
      if (npc.anim) {
        const stand = npc.anim.stand[Math.floor(random() * npc.anim.stand.length)] ?? npc.anim.stand[0]!;
        crossFadeTo(npc.anim, stand);
        npc.shadowSettle = FADE_SECONDS;
      } else if (npc.rig) {
        poseWalk(npc.rig, 0, 0);
        npc.group.position.y = floorY;
      }
      change = NPC_SHADOW;
      continue;
    }

    change = NPC_SHADOW;

    const wx = npc.path[npc.pathIndex * 2]!;
    const wz = npc.path[npc.pathIndex * 2 + 1]!;
    const dx = wx - npc.position.x;
    const dz = wz - npc.position.z;
    const distance = Math.hypot(dx, dz);
    const stride = Math.min(npc.speed * delta, distance);
    targetScratch.x = npc.position.x + (dx / distance) * stride;
    targetScratch.z = npc.position.z + (dz / distance) * stride;
    // The route keeps clear of everything; the resolver is the guarantee
    // (a corner brushed between grid cells slides instead of clipping).
    resolveWalkerStep(nav.colliders, npc.position, targetScratch, NPC_RADIUS, stepScratch, nav.collisionOptions);
    const nx = Math.max(-nav.halfW, Math.min(nav.halfW, stepScratch.x));
    const nz = Math.max(-nav.halfD, Math.min(nav.halfD, stepScratch.z));
    const moved = Math.hypot(nx - npc.position.x, nz - npc.position.z);
    npc.position.x = nx;
    npc.position.z = nz;
    npc.stuck = moved < stride * STUCK_PROGRESS ? npc.stuck + delta : 0;
    if (npc.stuck > STUCK_SECONDS) planRoute(npc, nav, random, npcs);

    turnToward(npc.group, Math.atan2(dx, dz), delta);
    npc.group.position.x = npc.position.x;
    npc.group.position.z = npc.position.z;

    if (npc.rig) {
      // Swing limbs about hips/shoulders; a small bob at each footfall.
      npc.phase += delta * npc.speed * 7;
      poseWalk(npc.rig, npc.phase);
      npc.group.position.y = floorY + Math.abs(Math.cos(npc.phase)) * 0.025;
    }
  }
  return change;
}
