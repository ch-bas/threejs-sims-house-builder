import { useEffect, useRef } from 'react';
import { type NpcSeat, findNpcSeats } from '../lib/npc-seats';
import { type WalkCollider, buildWalkColliders, circleHitsColliders, resolveWalkerStep } from '../lib/walk-collision';
import { disposeObject } from '../three/builder-utils';
import { type HumanFigureRig, buildHumanFigure, poseWalk } from '../three/builders/human-figure';
import {
  PEOPLE_CLIPS,
  SIT_HIP_BACK,
  SIT_SURFACE_HEIGHT,
  WALK_CLIP_SPEED,
  type PeopleModel,
  clonePerson,
  findClip,
  getPeopleModel,
} from '../three/people-model';
import { lookForSeed } from '../three/people-outfits';
import type { FurnitureItem, InteriorWall } from '../lib/types';
import type * as ThreeNS from 'three';

type ThreeModule = typeof import('../three/three-runtime');

const NPC_TAG = 'npc';

/**
 * What a walker is doing. `walk` heads for `target` and stops when the way
 * ahead is blocked; the seat modes walk the last stretch into a chair
 * (ignoring its footprint), turn, sit, and later get up and step back out.
 */
export type NpcMode =
  | 'walk'
  | 'pause'
  | 'blocked'
  | 'settle'
  | 'turn'
  | 'sitDown'
  | 'seated'
  | 'standUp'
  | 'leaveSeat';

export interface NpcState {
  group: ThreeNS.Group;
  position: { x: number; z: number };
  target: { x: number; z: number };
  speed: number;
  /** Height relative to the 1.75 m figure. */
  scale: number;
  mode: NpcMode;
  /** Walk-cycle phase driving the procedural limb swing. */
  phase: number;
  /** Seconds left in the current timed mode (pause, blocked, sitting). */
  pause: number;
  /**
   * Rigged figure only: seconds the shadow keeps following the pose after a
   * stop, so it settles from the stride into the standing pose (#400).
   */
  shadowSettle: number;
  /** The seat this walker has claimed, from heading for it until it has left. */
  seat: NpcSeat | null;
  /** How far the root is lifted while sitting (seats higher than the clip's). */
  lift: number;
  /** Procedural figure only. */
  rig: HumanFigureRig | null;
  /** Rigged figure only: the mixer and its walk / standing clips. */
  anim: NpcAnimation | null;
}

export interface NpcAnimation {
  mixer: ThreeNS.AnimationMixer;
  walk: ThreeNS.AnimationAction;
  stand: ThreeNS.AnimationAction[];
  /** Played now and then at a waypoint: dance, reach, pick something up. */
  activities?: ThreeNS.AnimationAction[];
  sit?: NpcSitAnimation | null;
  current: ThreeNS.AnimationAction;
}

export interface NpcSitAnimation {
  down: ThreeNS.AnimationAction;
  idle: ThreeNS.AnimationAction[];
  up: ThreeNS.AnimationAction;
}

/** The floor as the walkers see it; rebuilt when the items or walls change. */
export interface NpcWorld {
  colliders: readonly WalkCollider[];
  seats: ReadonlyMap<string, NpcSeat>;
}

const EMPTY_WORLD: NpcWorld = { colliders: [], seats: new Map() };

const FADE_SECONDS = 0.35;
/** A walker is a circle this wide (metres) to furniture and walls. */
export const NPC_RADIUS = 0.22;
/** How far ahead (metres) a walker looks for something in its way. */
export const NPC_LOOKAHEAD = 0.45;
/** Another walker this close and roughly ahead stops this one. */
const NPC_PERSONAL_SPACE = 0.85;
/** cos of the half-angle of the cone a walker watches for other people. */
const NPC_VIEW_COS = 0.6;
const BLOCKED_SECONDS = [0.7, 1.4] as const;
const ACTIVITY_CHANCE = 0.4;
const SEAT_CHANCE = 0.35;
const SEATED_SECONDS = [5, 11] as const;
const TURN_SPEED = 5;
const WAYPOINT_TRIES = 12;

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
  /** Y-offset to plant the NPCs on the active floor. */
  floorY: number;
  /** The active floor's furniture and partitions: obstacles, and seats. */
  items?: readonly FurnitureItem[] | undefined;
  interiorWalls?: readonly InteriorWall[] | undefined;
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
 * Sprinkles a few human figures into the scene and walks them between random
 * waypoints inside the room. They stop for furniture, walls and each other,
 * and now and then sit down, dance or reach for something. Cleanup tears down
 * all NPC meshes and the RAF loop on every dependency change; a change to the
 * furniture only refreshes what they see, so moving a chair doesn't respawn them.
 */
export function useNpcs(options: UseNpcsOptions): void {
  const {
    enabled, count = 3, threeModuleRef, sceneRef, roomWidth, roomDepth, floorY, items, interiorWalls,
    riggedModelReady = false, invalidate, requestShadowUpdate,
  } = options;
  const stateRef = useRef<NpcState[]>([]);
  const worldRef = useRef<NpcWorld>(EMPTY_WORLD);

  useEffect(() => {
    worldRef.current = buildNpcWorld(items ?? [], interiorWalls ?? [], roomWidth, roomDepth);
  }, [items, interiorWalls, roomWidth, roomDepth]);

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
      const npc = createNpc(THREE, scene, halfW, halfD, floorY, i, people, worldRef.current);
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
      // Repaint only when a pose changed, and recompute the 2048² shadow map
      // only when a walker moved: a rigged figure idles (breathes) every
      // frame, and re-rendering every caster for that pinned the GPU (#400).
      const change = stepNpcs(stateRef.current, delta, halfW, halfD, floorY, worldRef.current);
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
  }, [enabled, count, riggedModelReady, invalidate, requestShadowUpdate, threeModuleRef, sceneRef, roomWidth, roomDepth, floorY]);
}

export function buildNpcWorld(
  items: readonly FurnitureItem[],
  interiorWalls: readonly InteriorWall[],
  roomWidth: number,
  roomDepth: number
): NpcWorld {
  // People placed as furniture are obstacles like any other item.
  const colliders = buildWalkColliders(items, interiorWalls, { roomWidth, roomDepth });
  const seats = new Map<string, NpcSeat>();
  for (const seat of findNpcSeats(items)) seats.set(seat.key, seat);
  return { colliders, seats };
}

function createNpc(
  THREE: ThreeModule,
  scene: ThreeNS.Scene,
  halfW: number,
  halfD: number,
  floorY: number,
  index: number,
  people: PeopleModel | null,
  world: NpcWorld
): NpcState {
  const palette = [0xc62828, 0x2e7d32, 0x1565c0, 0xf9a825, 0x6a1b9a];
  const hairPalette = [0x2b1d14, 0x5a3825, 0x1a1a1a, 0x8d6e4a, 0x3b2a20];
  const skinPalette = [0xe0ac8a, 0xc68863, 0x8d5a3b, 0xf1c7a5, 0xa8714f];
  const pick = (list: number[]) => list[index % list.length] ?? list[0]!;
  // Slight height variety so a group of walkers doesn't look cloned.
  const heightScale = 0.94 + ((index * 37) % 11) / 100;

  let group: ThreeNS.Group;
  let rig: HumanFigureRig | null = null;
  let anim: NpcAnimation | null = null;

  const clip = (name: string) => (people ? findClip(people, name) : null);
  const walkClip = clip(PEOPLE_CLIPS.walk);
  const idleClip = clip(PEOPLE_CLIPS.idle);
  if (people && walkClip && idleClip) {
    group = new THREE.Group();
    const person = clonePerson(THREE, people, lookForSeed(index));
    person.scale.setScalar((1.75 / people.height) * heightScale);
    group.add(person);
    const mixer = new THREE.AnimationMixer(person);
    const action = (source: ThreeNS.AnimationClip | null, once = false) => {
      if (!source) return null;
      const next = mixer.clipAction(source);
      if (once) {
        next.setLoop(THREE.LoopOnce, 1);
        next.clampWhenFinished = true;
      }
      return next;
    };
    const present = (list: Array<ThreeNS.AnimationAction | null>) =>
      list.filter((entry): entry is ThreeNS.AnimationAction => entry !== null);
    const walk = action(walkClip)!;
    const stand = present([action(idleClip), action(clip(PEOPLE_CLIPS.talk))]);
    const activities = present([
      action(clip(PEOPLE_CLIPS.dance)),
      action(clip(PEOPLE_CLIPS.interact), true),
      action(clip(PEOPLE_CLIPS.pickUp), true),
    ]);
    const down = action(clip(PEOPLE_CLIPS.sitDown), true);
    const up = action(clip(PEOPLE_CLIPS.standUp), true);
    const sitIdle = present([action(clip(PEOPLE_CLIPS.sitIdle)), action(clip(PEOPLE_CLIPS.sitTalk))]);
    const sit = down && up && sitIdle.length > 0 ? { down, up, idle: sitIdle } : null;
    walk.play();
    // Desynchronise the walkers so their steps don't land in unison.
    walk.time = Math.random() * walkClip.duration;
    anim = { mixer, walk, stand, activities, sit, current: walk };
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

  // Spawn clear of the furniture when there's room for it.
  const position = pickWaypoint(null, halfW, halfD, world);
  group.position.set(position.x, floorY, position.z);
  scene.add(group);

  const speed = 0.6 + Math.random() * 0.5;
  if (anim) anim.walk.timeScale = speed / WALK_CLIP_SPEED;

  return {
    group,
    position,
    target: pickWaypoint(position, halfW, halfD, world),
    speed,
    scale: heightScale,
    mode: 'walk',
    phase: Math.random() * Math.PI * 2,
    pause: 0,
    shadowSettle: 0,
    seat: null,
    lift: 0,
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
 * Advances every NPC one frame and reports the biggest change: a walker that
 * moved needs the shadow map recomputed, a rigged one idling needs only a
 * repaint, and procedural walkers standing still need nothing.
 */
export function stepNpcs(
  npcs: NpcState[],
  delta: number,
  halfW: number,
  halfD: number,
  floorY: number,
  world: NpcWorld = EMPTY_WORLD
): NpcChange {
  let change: NpcChange = NPC_STILL;
  const raise = (next: NpcChange) => {
    if (next > change) change = next;
  };
  for (const npc of npcs) {
    // A rigged figure breathes and shifts its weight even while standing, so
    // it needs frames whenever it exists; the procedural one only when moving.
    if (npc.anim) {
      npc.anim.mixer.update(delta);
      raise(NPC_REPAINT);
    }
    dropVanishedSeat(npc, world);

    switch (npc.mode) {
      case 'pause':
      case 'blocked':
      case 'seated': {
        npc.pause -= delta;
        if (npc.shadowSettle > 0) {
          npc.shadowSettle -= delta;
          raise(NPC_SHADOW);
        }
        if (npc.pause > 0) break;
        if (npc.mode === 'seated') standUp(npc);
        else if (npc.mode === 'blocked' && !wayAheadBlocked(npc, npcs, world)) startWalking(npc);
        else {
          // Done here, or still blocked: head somewhere else (or for a seat).
          const wasBlocked = npc.mode === 'blocked';
          if (wasBlocked) releaseSeat(npc);
          chooseDestination(npc, npcs, halfW, halfD, world);
          // Turn away from whatever stopped it, rather than straight back at it.
          for (let retry = 0; wasBlocked && retry < WAYPOINT_TRIES && wayAheadBlocked(npc, npcs, world); retry++) {
            npc.seat = null;
            npc.target = pickWaypoint(npc.position, halfW, halfD, world);
          }
          startWalking(npc);
        }
        raise(NPC_SHADOW);
        break;
      }
      case 'sitDown':
      case 'standUp': {
        npc.pause -= delta;
        const seat = npc.seat;
        const goal = seat ? sitLift(npc, seat) : 0;
        const total = npc.mode === 'sitDown' ? npc.anim?.sit?.down.getClip().duration : npc.anim?.sit?.up.getClip().duration;
        const progress = total ? clamp(1 - npc.pause / total, 0, 1) : 1;
        npc.lift = npc.mode === 'sitDown' ? goal * progress : goal * (1 - progress);
        npc.group.position.y = floorY + npc.lift;
        raise(NPC_SHADOW);
        if (npc.pause > 0) break;
        if (npc.mode === 'sitDown' && npc.anim?.sit) {
          npc.mode = 'seated';
          npc.pause = rand(SEATED_SECONDS[0], SEATED_SECONDS[1]);
          crossFadeTo(npc.anim, randomOf(npc.anim.sit.idle));
          npc.shadowSettle = FADE_SECONDS;
        } else {
          npc.mode = 'leaveSeat';
          npc.lift = 0;
          npc.group.position.y = floorY;
          if (seat) npc.target = { x: seat.approachX, z: seat.approachZ };
          if (npc.anim) crossFadeTo(npc.anim, npc.anim.walk);
        }
        break;
      }
      case 'turn': {
        const seat = npc.seat;
        if (!seat) {
          startWalking(npc);
          break;
        }
        const diff = wrapAngle(seat.rotation - npc.group.rotation.y);
        const turn = TURN_SPEED * delta;
        raise(NPC_SHADOW);
        if (Math.abs(diff) > turn) {
          npc.group.rotation.y += Math.sign(diff) * turn;
          break;
        }
        npc.group.rotation.y = seat.rotation;
        if (npc.anim?.sit) {
          npc.mode = 'sitDown';
          npc.pause = npc.anim.sit.down.getClip().duration;
          crossFadeTo(npc.anim, npc.anim.sit.down);
        } else {
          npc.mode = 'leaveSeat';
          npc.target = { x: seat.approachX, z: seat.approachZ };
        }
        break;
      }
      case 'walk':
      case 'settle':
      case 'leaveSeat': {
        // The last stretch into a seat and back out crosses its footprint.
        const free = npc.mode !== 'walk';
        if (!free && circleHitsColliders(world.colliders, npc.position.x, npc.position.z, NPC_RADIUS)) {
          // Something was dropped on this walker: step out of it first.
          const out = { x: npc.position.x, z: npc.position.z };
          resolveWalkerStep(world.colliders, npc.position, npc.position, NPC_RADIUS, out);
          npc.position.x = clamp(out.x, -halfW, halfW);
          npc.position.z = clamp(out.z, -halfD, halfD);
        }

        const dx = npc.target.x - npc.position.x;
        const dz = npc.target.z - npc.position.z;
        const distance = Math.hypot(dx, dz);

        // Into and out of a seat the spot matters: stopping short leaves the
        // feet off the mark, or the walker still inside the chair.
        if (distance < (free ? 0.01 : 0.15)) {
          arrive(npc, floorY);
          raise(NPC_SHADOW);
          break;
        }
        if (!free && wayAheadBlocked(npc, npcs, world)) {
          // Something's in the way: stop and wait, then try again.
          npc.mode = 'blocked';
          npc.pause = rand(BLOCKED_SECONDS[0], BLOCKED_SECONDS[1]);
          standStill(npc, floorY, npc.anim?.stand[0]);
          raise(NPC_SHADOW);
          break;
        }

        raise(NPC_SHADOW);
        const step = Math.min(distance, npc.speed * delta);
        npc.position.x = clamp(npc.position.x + (dx / distance) * step, -halfW, halfW);
        npc.position.z = clamp(npc.position.z + (dz / distance) * step, -halfD, halfD);

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
        break;
      }
    }
  }
  return change;
}

/** Reached `target`: what comes next depends on why the walker came here. */
function arrive(npc: NpcState, floorY: number): void {
  const seat = npc.seat;
  if (npc.mode === 'walk' && seat) {
    // At the seat's approach point: shuffle in to where the feet go.
    npc.mode = 'settle';
    npc.target = sitFeet(npc, seat);
    return;
  }
  if (npc.mode === 'settle' && seat) {
    npc.mode = 'turn';
    standStill(npc, floorY, npc.anim?.stand[0]);
    return;
  }
  if (npc.mode === 'leaveSeat') releaseSeat(npc);
  // A waypoint: stand around for a moment, or now and then do something.
  npc.mode = 'pause';
  const activities = npc.anim?.activities ?? [];
  if (activities.length > 0 && Math.random() < ACTIVITY_CHANCE) {
    const activity = randomOf(activities);
    // Only the one-shot clips are clamped (see createNpc): play those once.
    npc.pause = activity.clampWhenFinished ? activity.getClip().duration + 0.3 : rand(3, 6);
    standStill(npc, floorY, activity);
    // The whole body moves: keep the shadow with it.
    npc.shadowSettle = npc.pause;
  } else {
    npc.pause = 1.5 + Math.random() * 3;
    standStill(npc, floorY, npc.anim ? randomOf(npc.anim.stand) : undefined);
  }
}

function standStill(npc: NpcState, floorY: number, action: ThreeNS.AnimationAction | undefined): void {
  if (npc.anim && action) {
    crossFadeTo(npc.anim, action);
    npc.shadowSettle = FADE_SECONDS;
  } else if (npc.rig) {
    poseWalk(npc.rig, 0, 0);
    npc.group.position.y = floorY;
  }
}

function startWalking(npc: NpcState): void {
  npc.mode = 'walk';
  npc.pause = 0;
  if (npc.anim) crossFadeTo(npc.anim, npc.anim.walk);
}

function standUp(npc: NpcState): void {
  if (!npc.anim?.sit) {
    npc.mode = 'leaveSeat';
    return;
  }
  npc.mode = 'standUp';
  npc.pause = npc.anim.sit.up.getClip().duration;
  crossFadeTo(npc.anim, npc.anim.sit.up);
}

function releaseSeat(npc: NpcState): void {
  npc.seat = null;
}

/** The seat's chair was moved or deleted: give it up, standing if sat. */
function dropVanishedSeat(npc: NpcState, world: NpcWorld): void {
  const seat = npc.seat;
  if (!seat) return;
  const current = world.seats.get(seat.key);
  if (current && current.x === seat.x && current.z === seat.z && current.rotation === seat.rotation) return;
  if (npc.mode === 'seated') standUp(npc);
  else if (npc.mode === 'walk' || npc.mode === 'settle' || npc.mode === 'turn') {
    npc.seat = null;
    npc.target = { x: npc.position.x, z: npc.position.z };
    npc.mode = 'walk';
  }
  // Mid sit-down, stand-up or leaving: finish with the old seat's numbers.
}

/** Pick the next destination: now and then a free seat, else a waypoint. */
function chooseDestination(npc: NpcState, npcs: readonly NpcState[], halfW: number, halfD: number, world: NpcWorld): void {
  if (npc.anim?.sit && world.seats.size > 0 && Math.random() < SEAT_CHANCE) {
    const seat = pickSeat(npc, npcs, halfW, halfD, world);
    if (seat) {
      npc.seat = seat;
      npc.target = { x: seat.approachX, z: seat.approachZ };
      return;
    }
  }
  npc.target = pickWaypoint(npc.position, halfW, halfD, world);
}

function pickSeat(npc: NpcState, npcs: readonly NpcState[], halfW: number, halfD: number, world: NpcWorld): NpcSeat | null {
  const taken = new Set<string>();
  for (const other of npcs) if (other.seat) taken.add(other.seat.key);
  const candidates: NpcSeat[] = [];
  for (const seat of world.seats.values()) {
    if (taken.has(seat.key)) continue;
    if (Math.abs(seat.approachX) > halfW || Math.abs(seat.approachZ) > halfD) continue;
    // A dining chair tucked under the table has no room in front of it.
    if (circleHitsColliders(world.colliders, seat.approachX, seat.approachZ, NPC_RADIUS)) continue;
    if (!lineClear(world, npc.position, { x: seat.approachX, z: seat.approachZ })) continue;
    candidates.push(seat);
  }
  return candidates.length > 0 ? randomOf(candidates) : null;
}

/**
 * A random spot clear of the furniture, preferably one the walker can reach
 * in a straight line. With no `from` (spawning) any clear spot will do.
 */
export function pickWaypoint(
  from: { x: number; z: number } | null,
  halfW: number,
  halfD: number,
  world: NpcWorld
): { x: number; z: number } {
  let fallback: { x: number; z: number } | null = null;
  for (let attempt = 0; attempt < WAYPOINT_TRIES; attempt++) {
    const point = { x: rand(-halfW, halfW), z: rand(-halfD, halfD) };
    if (circleHitsColliders(world.colliders, point.x, point.z, NPC_RADIUS)) continue;
    if (!from || lineClear(world, from, point)) return point;
    fallback ??= point;
  }
  return fallback ?? { x: rand(-halfW, halfW), z: rand(-halfD, halfD) };
}

function lineClear(world: NpcWorld, from: { x: number; z: number }, to: { x: number; z: number }): boolean {
  const length = Math.hypot(to.x - from.x, to.z - from.z);
  const samples = Math.ceil(length / 0.2);
  for (let i = 1; i <= samples; i++) {
    const t = i / samples;
    const x = from.x + (to.x - from.x) * t;
    const z = from.z + (to.z - from.z) * t;
    if (circleHitsColliders(world.colliders, x, z, NPC_RADIUS)) return false;
  }
  return true;
}

/**
 * The look-ahead: furniture or a wall within NPC_LOOKAHEAD along the path, or
 * another person close by and roughly in front.
 */
export function wayAheadBlocked(npc: NpcState, npcs: readonly NpcState[], world: NpcWorld): boolean {
  const dx = npc.target.x - npc.position.x;
  const dz = npc.target.z - npc.position.z;
  const distance = Math.hypot(dx, dz);
  if (distance < 1e-6) return false;
  const ux = dx / distance;
  const uz = dz / distance;
  const reach = Math.min(NPC_LOOKAHEAD, distance);
  for (const probe of [reach / 2, reach]) {
    if (circleHitsColliders(world.colliders, npc.position.x + ux * probe, npc.position.z + uz * probe, NPC_RADIUS)) {
      return true;
    }
  }
  for (const other of npcs) {
    if (other === npc) continue;
    const ox = other.position.x - npc.position.x;
    const oz = other.position.z - npc.position.z;
    const gap = Math.hypot(ox, oz);
    if (gap < 1e-6 || gap > NPC_PERSONAL_SPACE) continue;
    if ((ox * ux + oz * uz) / gap > NPC_VIEW_COS) return true;
  }
  return false;
}

/** Where the feet stand so the sitting clip lands the hips on the seat. */
function sitFeet(npc: NpcState, seat: NpcSeat): { x: number; z: number } {
  const back = SIT_HIP_BACK * npc.scale;
  return { x: seat.x + Math.sin(seat.rotation) * back, z: seat.z + Math.cos(seat.rotation) * back };
}

/** Lift the root so the hips meet a seat higher (or lower) than the clip's. */
function sitLift(npc: NpcState, seat: NpcSeat): number {
  return clamp(seat.seatHeight - SIT_SURFACE_HEIGHT * npc.scale, -0.05, 0.2);
}

function wrapAngle(angle: number): number {
  return Math.atan2(Math.sin(angle), Math.cos(angle));
}

function randomOf<T>(list: readonly T[]): T {
  return list[Math.floor(Math.random() * list.length)] ?? list[0]!;
}

function rand(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
