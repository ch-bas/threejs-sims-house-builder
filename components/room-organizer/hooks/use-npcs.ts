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
  npcNavSignature,
  pickDestination,
  randomFreeCell,
} from '../lib/npc-path';
import { type NpcSeat, findNpcSeats } from '../lib/npc-seats';
import { type WalkerPosition, resolveWalkerStep } from '../lib/walk-collision';
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
import { useReducedMotion } from './use-reduced-motion';
import type { KeepOutRect } from '../lib/geometry';
import type { FurnitureItem, InteriorWall } from '../lib/types';
import type * as ThreeNS from 'three';

type ThreeModule = typeof import('../three/three-runtime');

const NPC_TAG = 'npc';

/**
 * What a walker is doing. `walk` follows its route and stops when the way
 * ahead is blocked; the seat modes walk the last stretch into a seat
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
  /** The spot the seat modes walk straight to (into the seat and back out). */
  target: { x: number; z: number };
  /** How far the root is lifted while sitting (seats higher than the clip's). */
  lift: number;
  /** Procedural figure only. */
  rig: HumanFigureRig | null;
  /** Rigged figure only: the mixer and its walk / standing clips. */
  anim: NpcAnimation | null;
  /** The route to the current destination, as x, z pairs (#452). */
  path: Float32Array;
  pathLength: number;
  /** The waypoint being walked to. */
  pathIndex: number;
  /**
   * The nav cell the route leads to, -1 for none. A route longer than the
   * path buffer stops short of it, and is continued from there.
   */
  destination: number;
  /** Where the destination cell's centre is. */
  goal: { x: number; z: number };
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
  /** Played now and then at a stop: dance, reach, pick something up. */
  activities?: ThreeNS.AnimationAction[];
  sit?: NpcSitAnimation | null;
  current: ThreeNS.AnimationAction;
}

export interface NpcSitAnimation {
  down: ThreeNS.AnimationAction;
  idle: ThreeNS.AnimationAction[];
  up: ThreeNS.AnimationAction;
}

/** The active floor's seats by `NpcSeat.key`. */
export type NpcSeats = ReadonlyMap<string, NpcSeat>;
const EMPTY_SEATS: NpcSeats = new Map();

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
/** Another walker this close and roughly ahead stops this one. */
const BLOCKING_GAP = 0.85;
/** cos of the half-angle of the cone a walker watches for other people. */
const NPC_VIEW_COS = 0.6;
const BLOCKED_SECONDS = [0.7, 1.4] as const;
const ACTIVITY_CHANCE = 0.4;
const SEAT_CHANCE = 0.35;
const SEATED_SECONDS = [5, 11] as const;
/** Re-plans tried, after a wait, for a way that isn't blocked. */
const UNBLOCK_TRIES = 12;
/** Close enough to the spot inside a seat (or back out of it). */
const SEAT_SPOT_REACHED = 0.01;

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
  const reducedMotion = useReducedMotion();
  const stateRef = useRef<NpcState[]>([]);
  const navRef = useRef<NpcNav | null>(null);
  const seatsRef = useRef<NpcSeats>(EMPTY_SEATS);

  // Rebuilt only when what it reads changes (not on a recolour or a lock,
  // which still hand over new arrays), and not at all while walkers are off.
  const signature = useMemo(
    () => (enabled ? npcNavSignature({ items, interiorWalls, keepOut }) : null),
    [enabled, items, interiorWalls, keepOut]
  );
  const nav = useMemo(
    () => (signature === null ? null : buildNpcNav({ items, interiorWalls, keepOut, roomWidth, roomDepth })),
    // The signature stands for items, walls and keep-out.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [signature, roomWidth, roomDepth]
  );

  // Cheap to rebuild, and a rebuild disturbs nobody (a sitter whose seat
  // moved stands up), so this keys on the items themselves.
  const seats = useMemo(() => (enabled ? seatMap(items) : EMPTY_SEATS), [enabled, items]);
  useEffect(() => {
    seatsRef.current = seats;
  }, [seats]);

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
      // Reduced motion (#436): one frame poses the walkers where they
      // spawned, and then they stand still — no loop, no wandering.
      if (!reducedMotion) rafId = requestAnimationFrame(tick);
      const now = performance.now();
      const delta = reducedMotion ? 0 : Math.min(0.1, (now - lastTime) / 1000);
      lastTime = now;
      const currentNav = navRef.current;
      if (!currentNav) return;
      // Repaint only when a pose changed, and recompute the 2048² shadow map
      // only when a walker moved: a rigged figure idles (breathes) every
      // frame, and re-rendering every caster for that pinned the GPU (#400).
      const change = stepNpcs(stateRef.current, delta, currentNav, floorY, Math.random, seatsRef.current);
      if (change === NPC_SHADOW || reducedMotion) requestShadowUpdate?.();
      if (change !== NPC_STILL || reducedMotion) invalidate?.();
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
  }, [enabled, hasRoom, count, riggedModelReady, invalidate, requestShadowUpdate, threeModuleRef, sceneRef, roomWidth, roomDepth, floorY, reducedMotion]);
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
    const walk = mixer.clipAction(walkClip);
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
    scale: heightScale,
    mode: 'walk',
    phase: Math.random() * Math.PI * 2,
    pause: 0,
    shadowSettle: 0,
    seat: null,
    target: { x: 0, z: 0 },
    lift: 0,
    rig,
    anim,
    path: new Float32Array(MAX_PATH_POINTS * 2),
    pathLength: 0,
    pathIndex: 0,
    destination: -1,
    goal: { x: 0, z: 0 },
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
  npc.destination = -1;
  npc.stuck = 0;
  npc.arrivalHeading = Number.NaN;
  const from = standingCell(npc, nav);
  if (from < 0) return;
  const destination = pickDestination(nav, from, random, (x, z) => others.some((other) => other !== npc && claims(other, x, z)));
  if (destination < 0) return;
  routeTo(npc, nav, from, destination);
  if (npc.pathLength === 0) return;
  npc.destination = destination;
  npc.goal.x = cellX(nav, destination);
  npc.goal.z = cellZ(nav, destination);
  npc.arrivalHeading = nav.heading[destination] ?? Number.NaN;
}

/**
 * At the end of its route but short of its destination (the route was
 * longer than the path buffer): route on from here. False when it is there,
 * or the rest can't be routed.
 */
function continueRoute(npc: NpcState, nav: NpcNav): boolean {
  if (npc.destination < 0) return false;
  if (Math.hypot(npc.goal.x - npc.position.x, npc.goal.z - npc.position.z) < WAYPOINT_REACHED) return false;
  const from = standingCell(npc, nav);
  if (from < 0) return false;
  routeTo(npc, nav, from, npc.destination);
  return npc.pathLength > 0;
}

/** The free cell a walker routes from: its own, or the nearest when a face pushed it just off the free cells. */
function standingCell(npc: NpcState, nav: NpcNav): number {
  const under = cellAt(nav, npc.position.x, npc.position.z);
  return nav.walkable[under] === 1 ? under : nearestFreeCell(nav, npc.position.x, npc.position.z);
}

/** Fill the walker's route from `from` (its standing cell) to `destination`. */
function routeTo(npc: NpcState, nav: NpcNav, from: number, destination: number): void {
  // Off its own cell, route from the free cell's centre; the first waypoint is in reach.
  const own = from === cellAt(nav, npc.position.x, npc.position.z);
  npc.pathIndex = 0;
  npc.pathLength = findNpcPath(
    nav,
    own ? npc.position.x : cellX(nav, from),
    own ? npc.position.z : cellZ(nav, from),
    destination,
    npc.path
  );
}

/** Whether a walker stands at, or is heading for, a spot within arm's reach of (x, z). */
function claims(npc: NpcState, x: number, z: number): boolean {
  const atX = npc.destination >= 0 ? npc.goal.x : npc.position.x;
  const atZ = npc.destination >= 0 ? npc.goal.z : npc.position.z;
  return Math.hypot(atX - x, atZ - z) < PERSONAL_SPACE;
}

/**
 * The floor changed under the walkers: step any that now stand in
 * something into the nearest free space, and re-route every one, since its
 * route may run through the new sofa.
 */
export function rehomeNpcs(npcs: readonly NpcState[], nav: NpcNav, floorY: number, random: () => number = Math.random): void {
  for (const npc of npcs) {
    // Stepping into, sitting in or stepping out of a seat: it stands inside
    // the seat's footprint on purpose. A seat that moved stands its sitter
    // up (stepNpcs), and the walker carries on from wherever that leaves it.
    if (inSeat(npc)) continue;
    // Heading for a seat: the route may run through the new furniture, so
    // it gives the seat up and heads somewhere afresh.
    npc.seat = null;
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

/** True from stepping into a seat until stepping back out of it. */
function inSeat(npc: NpcState): boolean {
  return npc.mode !== 'walk' && npc.mode !== 'pause' && npc.mode !== 'blocked';
}

function seatMap(items: readonly FurnitureItem[]): NpcSeats {
  const seats = new Map<string, NpcSeat>();
  for (const seat of findNpcSeats(items)) seats.set(seat.key, seat);
  return seats;
}

/**
 * Head for a free seat the walker can reach: true when it has one and a
 * route to its approach point. One seat per person; a seat whose approach
 * isn't free floor (a chair tucked under the table) is skipped.
 */
export function planSeat(
  npc: NpcState,
  nav: NpcNav,
  seats: NpcSeats,
  random: () => number,
  others: readonly NpcState[] = []
): boolean {
  const from = standingCell(npc, nav);
  if (from < 0) return false;
  const region = nav.region[from];
  // Reservoir pick: a uniformly random eligible seat, without building a list.
  let chosen: NpcSeat | null = null;
  let eligible = 0;
  for (const seat of seats.values()) {
    if (!isFreeAt(nav, seat.approachX, seat.approachZ)) continue;
    const cell = cellAt(nav, seat.approachX, seat.approachZ);
    if (nav.region[cell] !== region) continue;
    if (others.some((other) => other !== npc && other.seat?.key === seat.key)) continue;
    eligible += 1;
    if (random() * eligible < 1) chosen = seat;
  }
  if (!chosen) return false;
  const cell = cellAt(nav, chosen.approachX, chosen.approachZ);
  routeTo(npc, nav, from, cell);
  if (npc.pathLength === 0) return false;
  npc.stuck = 0;
  npc.seat = chosen;
  npc.destination = cell;
  npc.goal.x = cellX(nav, cell);
  npc.goal.z = cellZ(nav, cell);
  npc.arrivalHeading = Number.NaN;
  return true;
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
  random: () => number = Math.random,
  seats: NpcSeats = EMPTY_SEATS
): NpcChange {
  let change: NpcChange = NPC_STILL;
  for (const npc of npcs) {
    // A rigged figure breathes and shifts its weight even while standing, so
    // it needs frames whenever it exists; the procedural one only when moving.
    if (npc.anim) {
      npc.anim.mixer.update(delta);
      if (change === NPC_STILL) change = NPC_REPAINT;
    }
    dropVanishedSeat(npc, seats, floorY, nav);

    switch (npc.mode) {
      case 'pause':
      case 'blocked':
      case 'seated': {
        npc.pause -= delta;
        if (npc.shadowSettle > 0) {
          npc.shadowSettle -= delta;
          change = NPC_SHADOW;
        }
        // Turn to look at whatever it stopped by.
        if (npc.mode === 'pause' && !Number.isNaN(npc.standHeading) && turnToward(npc.group, npc.standHeading, delta)) {
          change = NPC_SHADOW;
        }
        if (npc.pause > 0) break;
        if (npc.mode === 'seated') standUp(npc);
        else {
          if (npc.mode === 'blocked' && wayAheadBlocked(npc, npcs)) {
            // Still in the way: head somewhere else, preferably not straight
            // back at whatever stopped it.
            npc.seat = null;
            planRoute(npc, nav, random, npcs);
            for (let retry = 0; retry < UNBLOCK_TRIES && wayAheadBlocked(npc, npcs); retry++) {
              planRoute(npc, nav, random, npcs);
            }
          }
          startWalking(npc);
        }
        change = NPC_SHADOW;
        break;
      }
      case 'sitDown':
      case 'standUp': {
        npc.pause -= delta;
        const seat = npc.seat;
        const goal = seat ? sitLift(npc, seat) : 0;
        const sit = npc.anim?.sit;
        const total = sit ? (npc.mode === 'sitDown' ? sit.down : sit.up).getClip().duration : 0;
        const progress = total > 0 ? clamp(1 - npc.pause / total, 0, 1) : 1;
        npc.lift = npc.mode === 'sitDown' ? goal * progress : goal * (1 - progress);
        npc.group.position.y = floorY + npc.lift;
        change = NPC_SHADOW;
        if (npc.pause > 0) break;
        if (npc.mode === 'sitDown' && npc.anim && sit) {
          npc.mode = 'seated';
          npc.pause = between(random, SEATED_SECONDS[0], SEATED_SECONDS[1]);
          crossFadeTo(npc.anim, randomOf(sit.idle, random));
          npc.shadowSettle = FADE_SECONDS;
        } else {
          leaveSeat(npc, floorY, nav);
        }
        break;
      }
      case 'turn': {
        const seat = npc.seat;
        change = NPC_SHADOW;
        if (!seat) {
          npc.mode = 'pause';
          npc.pause = 0;
          break;
        }
        if (turnToward(npc.group, seat.rotation, delta)) break;
        npc.group.rotation.y = seat.rotation;
        if (npc.anim?.sit) {
          npc.mode = 'sitDown';
          npc.pause = npc.anim.sit.down.getClip().duration;
          crossFadeTo(npc.anim, npc.anim.sit.down);
        } else {
          leaveSeat(npc, floorY, nav);
        }
        break;
      }
      case 'settle':
      case 'leaveSeat': {
        // The last stretch into a seat and back out crosses its footprint, so
        // it is walked straight, not routed. The spot matters: stopping short
        // leaves the feet off the mark, or the walker still inside the chair.
        change = NPC_SHADOW;
        const dx = npc.target.x - npc.position.x;
        const dz = npc.target.z - npc.position.z;
        const distance = Math.hypot(dx, dz);
        if (distance < SEAT_SPOT_REACHED) {
          if (npc.mode === 'settle' && npc.seat) {
            npc.mode = 'turn';
            standStill(npc, floorY, npc.anim?.stand[0]);
          } else {
            // Up from a seat: walk somewhere before sitting again.
            npc.seat = null;
            arriveAtStop(npc, nav, floorY, random, npcs, null);
          }
          break;
        }
        const stride = Math.min(distance, npc.speed * delta);
        npc.position.x += (dx / distance) * stride;
        npc.position.z += (dz / distance) * stride;
        turnToward(npc.group, Math.atan2(dx, dz), delta);
        npc.group.position.x = npc.position.x;
        npc.group.position.z = npc.position.z;
        break;
      }
      case 'walk': {
        while (npc.pathIndex < npc.pathLength) {
          const wx = npc.path[npc.pathIndex * 2]!;
          const wz = npc.path[npc.pathIndex * 2 + 1]!;
          if (Math.hypot(wx - npc.position.x, wz - npc.position.z) >= WAYPOINT_REACHED) break;
          npc.pathIndex += 1;
        }

        if (npc.pathIndex >= npc.pathLength && !continueRoute(npc, nav)) {
          if (npc.seat) {
            // At the seat's approach point: shuffle in to where the feet go.
            npc.mode = 'settle';
            sitFeet(npc, npc.seat, npc.target);
          } else arriveAtStop(npc, nav, floorY, random, npcs, seats);
          change = NPC_SHADOW;
          break;
        }

        if (wayAheadBlocked(npc, npcs)) {
          // Someone is in the way: stop, wait, try again.
          npc.mode = 'blocked';
          npc.pause = between(random, BLOCKED_SECONDS[0], BLOCKED_SECONDS[1]);
          npc.stuck = 0;
          standStill(npc, floorY, npc.anim?.stand[0]);
          change = NPC_SHADOW;
          break;
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
        if (npc.stuck > STUCK_SECONDS) {
          npc.seat = null;
          planRoute(npc, nav, random, npcs);
        }

        turnToward(npc.group, Math.atan2(dx, dz), delta);
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
      default: {
        const unreachable: never = npc.mode;
        throw new Error(`Unknown walker mode ${String(unreachable)}`);
      }
    }
  }
  return change;
}

/**
 * Arrived at a stop: face whatever it came to see while it stands for a
 * moment (now and then dancing or reaching for something instead), and
 * plan where it goes next: sometimes one of `seats` (null: not a seat). It
 * sets off after the pause.
 */
function arriveAtStop(
  npc: NpcState,
  nav: NpcNav,
  floorY: number,
  random: () => number,
  npcs: readonly NpcState[],
  seats: NpcSeats | null
): void {
  npc.standHeading = npc.arrivalHeading;
  const toSeat =
    Boolean(npc.anim?.sit) && seats !== null && seats.size > 0 && random() < SEAT_CHANCE && planSeat(npc, nav, seats, random, npcs);
  if (!toSeat) planRoute(npc, nav, random, npcs);
  npc.mode = 'pause';
  const activities = npc.anim?.activities ?? [];
  if (activities.length > 0 && random() < ACTIVITY_CHANCE) {
    const activity = randomOf(activities, random);
    // Only the one-shot clips are clamped (see createNpc): play those once.
    npc.pause = activity.clampWhenFinished ? activity.getClip().duration + 0.3 : between(random, 3, 6);
    standStill(npc, floorY, activity);
    // The whole body moves: keep the shadow with it.
    npc.shadowSettle = npc.pause;
  } else {
    npc.pause = 1.5 + random() * 3;
    standStill(npc, floorY, npc.anim ? randomOf(npc.anim.stand, random) : undefined);
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
  npc.stuck = 0;
  if (npc.anim && npc.pathIndex < npc.pathLength) crossFadeTo(npc.anim, npc.anim.walk);
}

function standUp(npc: NpcState): void {
  npc.mode = 'standUp';
  npc.pause = 0;
  if (!npc.anim?.sit) return;
  npc.pause = npc.anim.sit.up.getClip().duration;
  crossFadeTo(npc.anim, npc.anim.sit.up);
}

/**
 * On its feet in front of the seat: step straight back out to the approach
 * point, or, when that isn't free floor any more (the seat was moved onto
 * it, or something put there) or the seat was given up, to the nearest spot
 * that is.
 */
function leaveSeat(npc: NpcState, floorY: number, nav: NpcNav): void {
  npc.mode = 'leaveSeat';
  npc.lift = 0;
  npc.group.position.y = floorY;
  const seat = npc.seat;
  if (seat && isFreeAt(nav, seat.approachX, seat.approachZ)) {
    npc.target.x = seat.approachX;
    npc.target.z = seat.approachZ;
  } else {
    const cell = nearestFreeCell(nav, npc.position.x, npc.position.z);
    npc.target.x = cell >= 0 ? cellX(nav, cell) : npc.position.x;
    npc.target.z = cell >= 0 ? cellZ(nav, cell) : npc.position.z;
  }
  if (npc.anim) crossFadeTo(npc.anim, npc.anim.walk);
}

/** The seat was moved or deleted: give it up, standing first if sat on it. */
function dropVanishedSeat(npc: NpcState, seats: NpcSeats, floorY: number, nav: NpcNav): void {
  const seat = npc.seat;
  if (!seat) return;
  const current = seats.get(seat.key);
  if (current && current.x === seat.x && current.z === seat.z && current.rotation === seat.rotation) return;
  if (npc.mode === 'seated') standUp(npc);
  else if (npc.mode === 'walk') {
    // Still on its way, on free floor: stop where it is and pick somewhere else.
    npc.seat = null;
    npc.pathLength = 0;
    npc.pathIndex = 0;
    npc.destination = -1;
  } else if (npc.mode === 'settle' || npc.mode === 'turn') {
    // Stepping in, inside the seat's old footprint, which the moved seat may
    // still cover (turned in place): step out to the nearest free floor.
    npc.seat = null;
    leaveSeat(npc, floorY, nav);
  }
  // Mid sit-down, stand-up or leaving: finish with the old seat's numbers.
}

/**
 * The look-ahead along the route: another person close by and roughly in
 * front. Furniture, partitions and placed people need no look-ahead: the
 * route already keeps clear of them, and a change to the floor re-routes
 * every walker (`rehomeNpcs`). Allocation-free.
 */
export function wayAheadBlocked(npc: NpcState, npcs: readonly NpcState[]): boolean {
  if (npc.pathIndex >= npc.pathLength) return false;
  const dx = npc.path[npc.pathIndex * 2]! - npc.position.x;
  const dz = npc.path[npc.pathIndex * 2 + 1]! - npc.position.z;
  const distance = Math.hypot(dx, dz);
  if (distance < 1e-6) return false;
  const ux = dx / distance;
  const uz = dz / distance;
  for (const other of npcs) {
    if (other === npc) continue;
    const ox = other.position.x - npc.position.x;
    const oz = other.position.z - npc.position.z;
    const gap = Math.hypot(ox, oz);
    if (gap < 1e-6 || gap > BLOCKING_GAP) continue;
    if ((ox * ux + oz * uz) / gap > NPC_VIEW_COS) return true;
  }
  return false;
}

/** Where the feet stand so the sitting clip lands the hips on the seat, into `out`. */
function sitFeet(npc: NpcState, seat: NpcSeat, out: { x: number; z: number }): void {
  const back = SIT_HIP_BACK * npc.scale;
  out.x = seat.x + Math.sin(seat.rotation) * back;
  out.z = seat.z + Math.cos(seat.rotation) * back;
}

/** Lift the root so the hips meet a seat higher (or lower) than the clip's. */
function sitLift(npc: NpcState, seat: NpcSeat): number {
  return clamp(seat.seatHeight - SIT_SURFACE_HEIGHT * npc.scale, -0.05, 0.2);
}

function randomOf<T>(list: readonly T[], random: () => number): T {
  return list[Math.floor(random() * list.length)] ?? list[0]!;
}

function between(random: () => number, min: number, max: number): number {
  return min + random() * (max - min);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
