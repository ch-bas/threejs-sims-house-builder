import { useEffect, useRef } from 'react';
import { floorKeepOut, type KeepOutBuilding } from '../lib/floor-keep-out';
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
import { floorElevation } from '../lib/storeys';
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
import type { FurnitureItem, InteriorWall } from '../lib/types';
import type { FrameBudget } from '../three/frame-budget';
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

/** A storey's seats by `NpcSeat.key`. */
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

/**
 * Walkers refresh the shadow map at most this often (#668): about 0.12 m of
 * walking between passes, instead of a 2048² pass at display rate.
 */
export const NPC_SHADOW_INTERVAL_MS = 100;
/** Frames arrive with jitter: a pass this close to the interval is on time. */
const NPC_SHADOW_SLACK_MS = 8;

/**
 * Paces the walkers' shadow passes: call it every frame with whether a caster
 * moved; true when this frame should recompute the shadow map. A move inside
 * the interval stays owed, so the last pose always gets its shadow.
 */
export function npcShadowPacer(intervalMs = NPC_SHADOW_INTERVAL_MS): (now: number, moved: boolean) => boolean {
  let owed = false;
  let last = Number.NEGATIVE_INFINITY;
  return (now, moved) => {
    if (moved) owed = true;
    if (!owed || now - last < intervalMs - NPC_SHADOW_SLACK_MS) return false;
    owed = false;
    last = now;
    return true;
  };
}

export interface UseNpcsOptions {
  enabled: boolean;
  /** Walkers per storey. */
  count?: number;
  threeModuleRef: React.MutableRefObject<ThreeModule | null>;
  sceneRef: React.MutableRefObject<ThreeNS.Scene | null>;
  /**
   * The building: its storeys' items, partitions and keep-out (porch,
   * stairwells, the corner cut) are what the walkers walk around.
   */
  building: KeepOutBuilding;
  /**
   * The storeys drawn now, as an inclusive range of indices (#580). Their
   * walkers are shown and walk; a storey drawn for the first time gets its
   * walkers then. The others' walkers are parked, hidden, where they stood.
   */
  shownFrom: number;
  shownTo: number;
  /**
   * True once people.glb has loaded. Flipping it re-spawns the walkers as
   * rigged figures; until then (or if it never loads) they're procedural.
   */
  riggedModelReady?: boolean;
  /** Request a render on the next animation frame (render-on-demand). */
  invalidate?: () => void;
  /** The scene's frame budget the walk runs on (#671). */
  addDecorativeStep: FrameBudget['add'];
  /**
   * Recompute the static shadow map. NPCs cast shadows, so while they're
   * actually walking their shadows must keep updating — but only then.
   */
  requestShadowUpdate?: () => void;
}

/**
 * One storey's walkers (#580), keyed by the floor's id: a floor switch, a
 * climb in EXPLORE or a storey-height edit keeps them, and only a storey
 * that is deleted (or walkers turned off) loses them.
 */
interface StoreyWalkers {
  npcs: NpcState[];
  nav: NpcNav | null;
  /** `npcNavSignature` plus the footprint: equal ones build the same nav. */
  signature: string | null;
  seats: NpcSeats;
  /** The items the seats were found in, so a new array rebuilds them. */
  seatItems: readonly FurnitureItem[] | null;
  floorY: number;
  shown: boolean;
}

/** What the walkers need from the scene while they exist. */
interface NpcStage {
  THREE: ThreeModule;
  scene: ThreeNS.Scene;
  people: PeopleModel | null;
}

/**
 * Sprinkles a few human figures onto each storey that is drawn and walks
 * them around its furniture, partitions, stairs and keep-out between spots
 * worth stopping at (#452). Each storey's walkers are spawned once, the
 * first time it is drawn (#580); editing the floor re-routes them (and steps
 * any the edit landed on into free space) without respawning, and a storey
 * that stops being drawn parks its walkers, hidden, until it is drawn again.
 */
export function useNpcs(options: UseNpcsOptions): void {
  const {
    enabled, count = 3, threeModuleRef, sceneRef, building, shownFrom, shownTo,
    riggedModelReady = false, invalidate, requestShadowUpdate, addDecorativeStep,
  } = options;
  const reducedMotion = useReducedMotion();
  const storeysRef = useRef(new Map<string, StoreyWalkers>());
  const stageRef = useRef<NpcStage | null>(null);
  // Read by `sync`, which runs from both effects below.
  const inputsRef = useRef({ building, shownFrom, shownTo, count, invalidate, requestShadowUpdate });
  inputsRef.current = { building, shownFrom, shownTo, count, invalidate, requestShadowUpdate };

  // Brings the storeys' walkers in line with the building and the storeys
  // drawn: spawn, re-route, re-seat, lift or lower, show or park, remove.
  const syncRef = useRef<() => void>(() => {});
  syncRef.current = () => {
    const stage = stageRef.current;
    if (!stage) return;
    const inputs = inputsRef.current;
    if (syncNpcStoreys(storeysRef.current, stage, inputs.building, inputs.shownFrom, inputs.shownTo, inputs.count)) {
      inputs.requestShadowUpdate?.();
      inputs.invalidate?.();
    }
  };

  useEffect(() => {
    if (!enabled) return undefined;
    const THREE = threeModuleRef.current;
    const scene = sceneRef.current;
    if (!THREE || !scene) return undefined;
    const storeys = storeysRef.current;
    stageRef.current = { THREE, scene, people: riggedModelReady ? getPeopleModel() : null };
    // Spawns, and poses, the walkers of the storeys drawn now, outside the
    // budget: a paused one (a hidden tab adopting another tab's house) would
    // leave them unposed and shadowless until it runs.
    syncRef.current();

    const shadowDue = npcShadowPacer();
    // One step of the walk, on the scene's frame budget (#671); true asks for
    // a repaint. Parked storeys don't step.
    const step = (delta: number): boolean => {
      let change: NpcChange = NPC_STILL;
      for (const storey of storeys.values()) {
        if (!storey.shown || !storey.nav || storey.npcs.length === 0) continue;
        // Repaint only when a pose changed, and recompute the 2048² shadow map
        // only when a walker moved: a rigged figure idles (breathes) every
        // frame, and re-rendering every caster for that pinned the GPU (#400).
        // A moving walker's shadow follows at NPC_SHADOW_INTERVAL_MS (#668).
        change = Math.max(change, stepNpcs(storey.npcs, delta, storey.nav, storey.floorY, Math.random, storey.seats)) as NpcChange;
      }
      if (shadowDue(performance.now(), change === NPC_SHADOW)) inputsRef.current.requestShadowUpdate?.();
      return change !== NPC_STILL;
    };
    // Reduced motion (#436): the spawn pose is all; they stand where they
    // spawned, with no loop and no wandering.
    const removeStep = reducedMotion ? () => {} : addDecorativeStep(step);

    return () => {
      removeStep();
      for (const storey of storeys.values()) removeNpcs(scene, storey.npcs);
      storeys.clear();
      stageRef.current = null;
      // Nothing else consumes showNpcs, so without an explicit repaint (and a
      // shadow-map refresh — walkers cast) the removed NPCs stay painted in
      // the last frame until something unrelated invalidates (#119).
      requestShadowUpdate?.();
      invalidate?.();
    };
  }, [enabled, riggedModelReady, invalidate, requestShadowUpdate, addDecorativeStep, threeModuleRef, sceneRef, reducedMotion]);

  // Declared after the lifecycle effect: a re-spawn (the rigged model
  // arriving) has already happened when this runs.
  useEffect(() => {
    syncRef.current();
  }, [building, shownFrom, shownTo, count]);
}

/**
 * Bring each storey's walkers in line with the building (#580). A storey
 * gets walkers the first time it is drawn; a nav change re-routes them, an
 * elevation change lifts them with the floor, and a storey that is no longer
 * drawn hides its walkers where they stand. Walkers of a deleted storey,
 * or of one with no free floor left, are removed. True when anything changed.
 */
function syncNpcStoreys(
  storeys: Map<string, StoreyWalkers>,
  stage: NpcStage,
  building: KeepOutBuilding,
  shownFrom: number,
  shownTo: number,
  count: number
): boolean {
  let changed = false;
  const { floors } = building;
  const present = new Set<string>();
  floors.forEach((floor, index) => {
    present.add(floor.id);
    const shown = index >= shownFrom && index <= shownTo;
    let storey = storeys.get(floor.id);
    if (!storey) {
      if (!shown) return;
      storey = { npcs: [], nav: null, signature: null, seats: EMPTY_SEATS, seatItems: null, floorY: 0, shown: false };
      storeys.set(floor.id, storey);
    }
    const floorY = floorElevation(floors, index);
    if (storey.npcs.length > 0 && floorY !== storey.floorY) {
      for (const npc of storey.npcs) npc.group.position.y += floorY - storey.floorY;
      changed = true;
    }
    storey.floorY = floorY;

    const keepOut = floorKeepOut(building, index);
    const interiorWalls = floor.interiorWalls ?? EMPTY_WALLS;
    // Rebuilt only when what it reads changes (not on a recolour or a lock,
    // which still hand over new arrays).
    const signature = `${building.width}:${building.height}|${npcNavSignature({ items: floor.items, interiorWalls, keepOut })}`;
    if (signature !== storey.signature) {
      storey.signature = signature;
      storey.nav = buildNpcNav({ items: floor.items, interiorWalls, keepOut, roomWidth: building.width, roomDepth: building.height });
      if (storey.nav && storey.nav.freeCount > 0 && storey.npcs.length > 0) {
        rehomeNpcs(storey.npcs, storey.nav, floorY);
        changed = true;
      }
    }
    // Cheap to rebuild, and a rebuild disturbs nobody (a sitter whose seat
    // moved stands up), so this keys on the items themselves.
    if (floor.items !== storey.seatItems) {
      storey.seatItems = floor.items;
      storey.seats = seatMap(floor.items);
    }

    const nav = storey.nav;
    if (!nav || nav.freeCount === 0) {
      // A floor with no free cell holds nobody; clearing it lets them in.
      if (storey.npcs.length > 0) {
        removeNpcs(stage.scene, storey.npcs);
        storey.npcs = [];
        changed = true;
      }
    } else if (shown && storey.npcs.length === 0) {
      const npcs: NpcState[] = [];
      // Seeded per storey too, so two storeys don't hold the same people.
      for (let i = 0; i < count; i++) npcs.push(createNpc(stage.THREE, stage.scene, nav, floorY, i + index * count, stage.people, npcs));
      storey.npcs = npcs;
      stepNpcs(npcs, 0, nav, floorY, Math.random, storey.seats);
      changed = true;
    }
    storey.shown = shown;
    for (const npc of storey.npcs) {
      if (npc.group.visible === shown) continue;
      npc.group.visible = shown;
      changed = true;
    }
  });
  for (const [id, storey] of storeys) {
    if (present.has(id)) continue;
    if (storey.npcs.length > 0) changed = true;
    removeNpcs(stage.scene, storey.npcs);
    storeys.delete(id);
  }
  return changed;
}

function removeNpcs(scene: ThreeNS.Scene, npcs: readonly NpcState[]): void {
  for (const npc of npcs) {
    npc.anim?.mixer.stopAllAction();
    scene.remove(npc.group);
    disposeObject(npc.group);
  }
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
