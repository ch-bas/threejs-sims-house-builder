import { useEffect, useRef } from 'react';
import { floorKeepOut, type KeepOutBuilding } from '../lib/floor-keep-out';
import { type NpcBody, type NpcHandOff, type PlayerBody, createNpcBody, moveNpcBody, seatTakenByPlayer } from '../lib/npc-bodies';
import {
  type NeedKind,
  type NeedSpot,
  type NpcNeeds,
  decayNeeds,
  findNeedSpots,
  pickNeedSpot,
  randomNeeds,
  refillNeed,
} from '../lib/npc-needs';
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
  /** What the player bumps into and can't sit on (#585); moved with the walker every step. */
  body: NpcBody;
  /** Hunger, energy and fun, running down (#617). */
  needs: NpcNeeds;
  /** The need the trip under way (or the seat headed for) is to meet; null for a wander. */
  seeking: NeedKind | null;
  /** The need being met at this stop or in this seat, topped up while it lasts. */
  using: NeedKind | null;
}

export interface NpcAnimation {
  mixer: ThreeNS.AnimationMixer;
  walk: ThreeNS.AnimationAction;
  stand: ThreeNS.AnimationAction[];
  /** Played now and then at a stop: dance, reach, pick something up. */
  activities?: ThreeNS.AnimationAction[];
  /** One-shot clips for using things (#617): reaching into the fridge, taking a book. */
  interact?: ThreeNS.AnimationAction | null;
  pickUp?: ThreeNS.AnimationAction | null;
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
/** A walker and the player (0.3 m) never come closer than this, centre to centre (#585). */
const PLAYER_GAP = NPC_RADIUS + 0.3;
/** New walkers appear at least this far from the player (#585), in the tries it takes. */
const SPAWN_CLEARANCE = 1.2;
const SPAWN_TRIES = 24;
/** cos of the half-angle of the cone a walker watches for other people. */
const NPC_VIEW_COS = 0.6;
const BLOCKED_SECONDS = [0.7, 1.4] as const;
const ACTIVITY_CHANCE = 0.4;
const SEAT_CHANCE = 0.35;
const SEATED_SECONDS = [5, 11] as const;
/** A rest in the sofa or a programme on TV takes longer than a sit down (#617). */
const SEATED_USE_SECONDS = [8, 14] as const;
/** Standing at something that meets a need with no clip to play: the TV, or a procedural figure. */
const STAND_USE_SECONDS = [4, 7] as const;
const NO_SPOTS: readonly NeedSpot[] = [];
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
  /**
   * Shared with the walkthrough (#585): the walkers read where the player
   * stands and sits, and publish their own bodies for the player's resolve.
   */
  handOff?: NpcHandOff;
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
  /** What on the floor meets the walkers' needs (#617), rebuilt with the seats. */
  spots: readonly NeedSpot[];
  /** The items the seats were found in, so a new array rebuilds them. */
  seatItems: readonly FurnitureItem[] | null;
  floorY: number;
  /** The storey's index now: a floor added below moves it up. */
  index: number;
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
    riggedModelReady = false, invalidate, requestShadowUpdate, addDecorativeStep, handOff,
  } = options;
  const reducedMotion = useReducedMotion();
  const storeysRef = useRef(new Map<string, StoreyWalkers>());
  const stageRef = useRef<NpcStage | null>(null);
  // Read by `sync`, which runs from both effects below.
  const inputsRef = useRef({ building, shownFrom, shownTo, count, invalidate, requestShadowUpdate, handOff });
  inputsRef.current = { building, shownFrom, shownTo, count, invalidate, requestShadowUpdate, handOff };

  // Brings the storeys' walkers in line with the building and the storeys
  // drawn: spawn, re-route, re-seat, lift or lower, show or park, remove.
  const syncRef = useRef<() => void>(() => {});
  syncRef.current = () => {
    const stage = stageRef.current;
    if (!stage) return;
    const inputs = inputsRef.current;
    const player = inputs.handOff?.player.present ? inputs.handOff.player : null;
    if (syncNpcStoreys(storeysRef.current, stage, inputs.building, inputs.shownFrom, inputs.shownTo, inputs.count, player)) {
      inputs.requestShadowUpdate?.();
      inputs.invalidate?.();
    }
    if (inputs.handOff) publishBodies(inputs.handOff, storeysRef.current);
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
      const seen = inputsRef.current.handOff?.player;
      for (const storey of storeys.values()) {
        if (!storey.shown || !storey.nav || storey.npcs.length === 0) continue;
        // The player is one more person on its own storey (#585).
        const player = seen?.present && seen.floorIndex === storey.index ? seen : null;
        if (revealHeld(storey.npcs, player)) {
          change = NPC_SHADOW;
          const shared = inputsRef.current.handOff;
          if (shared) publishBodies(shared, storeys);
        }
        // Repaint only when a pose changed, and recompute the 2048² shadow map
        // only when a walker moved: a rigged figure idles (breathes) every
        // frame, and re-rendering every caster for that pinned the GPU (#400).
        // A moving walker's shadow follows at NPC_SHADOW_INTERVAL_MS (#668).
        change = Math.max(change, stepNpcs(storey.npcs, delta, storey.nav, storey.floorY, Math.random, storey.seats, player, storey.spots)) as NpcChange;
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
      const shared = inputsRef.current.handOff;
      if (shared) shared.bodies = [];
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

/** Hand the shown storeys' walkers to the player's resolve; a new array only when the set changed. */
function publishBodies(handOff: NpcHandOff, storeys: ReadonlyMap<string, StoreyWalkers>): void {
  const bodies: NpcBody[] = [];
  for (const storey of storeys.values()) {
    // A walker held back from appearing on the player (#585) isn't there yet.
    if (storey.shown) for (const npc of storey.npcs) if (npc.group.visible) bodies.push(npc.body);
  }
  const current = handOff.bodies;
  if (current.length === bodies.length && bodies.every((body, index) => current[index] === body)) return;
  handOff.bodies = bodies;
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
  count: number,
  player: PlayerBody | null = null
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
      storey = { npcs: [], nav: null, signature: null, seats: EMPTY_SEATS, spots: NO_SPOTS, seatItems: null, floorY: 0, index, shown: false };
      storeys.set(floor.id, storey);
    }
    const floorY = floorElevation(floors, index);
    if (storey.npcs.length > 0 && floorY !== storey.floorY) {
      for (const npc of storey.npcs) {
        npc.group.position.y += floorY - storey.floorY;
        moveNpcBody(npc.body, npc.position.x, npc.position.z, floorY, npc.body.floorIndex);
      }
      changed = true;
    }
    storey.floorY = floorY;
    if (storey.index !== index) {
      storey.index = index;
      for (const npc of storey.npcs) npc.body.floorIndex = index;
    }

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
      const seats = findNpcSeats(floor.items);
      storey.seats = new Map(seats.map((seat) => [seat.key, seat]));
      storey.spots = findNeedSpots(floor.items, seats);
    }

    const nav = storey.nav;
    const here = player && player.floorIndex === index ? player : null;
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
      for (let i = 0; i < count; i++) npcs.push(createNpc(stage.THREE, stage.scene, nav, floorY, index, i + index * count, stage.people, npcs, here));
      storey.npcs = npcs;
      stepNpcs(npcs, 0, nav, floorY, Math.random, storey.seats, null, storey.spots);
      changed = true;
    }
    storey.shown = shown;
    for (const npc of storey.npcs) {
      // A parked walker standing where the player is stays parked until it
      // moves off (`revealHeld`), rather than appearing around the camera.
      const visible = shown && (npc.group.visible || !here || !onPlayer(npc, here));
      if (npc.group.visible === visible) continue;
      npc.group.visible = visible;
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
  floorIndex: number,
  index: number,
  people: PeopleModel | null,
  others: readonly NpcState[],
  avoid: PlayerBody | null = null
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
    const interact = action(clip(PEOPLE_CLIPS.interact), true);
    const pickUp = action(clip(PEOPLE_CLIPS.pickUp), true);
    const activities = present([action(clip(PEOPLE_CLIPS.dance)), interact, pickUp]);
    const down = action(clip(PEOPLE_CLIPS.sitDown), true);
    const up = action(clip(PEOPLE_CLIPS.standUp), true);
    const sitIdle = present([action(clip(PEOPLE_CLIPS.sitIdle)), action(clip(PEOPLE_CLIPS.sitTalk))]);
    const sit = down && up && sitIdle.length > 0 ? { down, up, idle: sitIdle } : null;
    walk.play();
    // Desynchronise the walkers so their steps don't land in unison.
    walk.time = Math.random() * walkClip.duration;
    anim = { mixer, walk, stand, activities, interact, pickUp, sit, current: walk };
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

  // Spawn in free space (never inside the sofa or the stair flight), and
  // not on the player (#585) when there is room elsewhere.
  let spawn = randomFreeCell(nav, Math.random);
  for (let i = 0; avoid && i < SPAWN_TRIES && Math.hypot(cellX(nav, spawn) - avoid.x, cellZ(nav, spawn) - avoid.z) < SPAWN_CLEARANCE; i++) {
    spawn = randomFreeCell(nav, Math.random);
  }
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
    body: createNpcBody(position.x, position.z, floorY, floorIndex),
    needs: randomNeeds(Math.random),
    seeking: null,
    using: null,
  };
  planRoute(npc, nav, Math.random, others);
  return npc;
}

/**
 * Give a walker a new destination it can reach and the route there. Leaves
 * it with an empty route when its patch of floor has nowhere else to go.
 */
export function planRoute(
  npc: NpcState,
  nav: NpcNav,
  random: () => number,
  others: readonly NpcState[] = [],
  player: PlayerBody | null = null
): void {
  npc.pathLength = 0;
  npc.pathIndex = 0;
  npc.destination = -1;
  npc.stuck = 0;
  npc.arrivalHeading = Number.NaN;
  npc.seeking = null;
  const from = standingCell(npc, nav);
  if (from < 0) return;
  const destination = pickDestination(
    nav,
    from,
    random,
    (x, z) =>
      others.some((other) => other !== npc && claims(other, x, z)) ||
      (player !== null && Math.hypot(player.x - x, player.z - z) < PERSONAL_SPACE)
  );
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
        // Where the player bumps into it, even with no step to come (reduced motion).
        moveNpcBody(npc.body, npc.position.x, npc.position.z, floorY, npc.body.floorIndex);
      }
    }
    planRoute(npc, nav, random, npcs);
  }
}

/** True from stepping into a seat until stepping back out of it. */
function inSeat(npc: NpcState): boolean {
  return npc.mode !== 'walk' && npc.mode !== 'pause' && npc.mode !== 'blocked';
}

/** The item type of the standing spot for `need` nearest (x, z): what a walker that arrived there is using. */
function nearestSpotType(spots: readonly NeedSpot[], need: NeedKind, x: number, z: number): string | null {
  let best: NeedSpot | null = null;
  let bestGap = Number.POSITIVE_INFINITY;
  for (const spot of spots) {
    if (spot.need !== need || spot.seatKey !== null) continue;
    const gap = Math.hypot(spot.x - x, spot.z - z);
    if (gap < bestGap) {
      best = spot;
      bestGap = gap;
    }
  }
  return best?.itemType ?? null;
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
  others: readonly NpcState[] = [],
  player: PlayerBody | null = null
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
    // Nor where the player sits (#585).
    if (player && seatTakenByPlayer(player, player.floorIndex, seat.x, seat.z, bedOf(seat))) continue;
    eligible += 1;
    if (random() * eligible < 1) chosen = seat;
  }
  return chosen !== null && headForSeat(npc, nav, from, chosen);
}

/** Route from `from` to a seat's approach point and claim the seat; false when there is no way. */
function headForSeat(npc: NpcState, nav: NpcNav, from: number, seat: NpcSeat): boolean {
  const cell = cellAt(nav, seat.approachX, seat.approachZ);
  routeTo(npc, nav, from, cell);
  if (npc.pathLength === 0) return false;
  npc.stuck = 0;
  npc.seat = seat;
  npc.seeking = null;
  npc.destination = cell;
  npc.goal.x = cellX(nav, cell);
  npc.goal.z = cellZ(nav, cell);
  npc.arrivalHeading = Number.NaN;
  return true;
}

/**
 * Head for something that meets the walker's most pressing need (#617):
 * the fridge or the stove, the bed or the sofa, a seat facing the TV or the
 * bookshelf, picked by `pickNeedSpot` among the spots it can reach that
 * nobody (walker or player) holds. `skip` is the need being met right now.
 * True when it set off; false leaves it to wander.
 */
export function planNeed(
  npc: NpcState,
  nav: NpcNav,
  seats: NpcSeats,
  spots: readonly NeedSpot[],
  random: () => number,
  others: readonly NpcState[] = [],
  player: PlayerBody | null = null,
  skip: NeedKind | null = null
): boolean {
  if (spots.length === 0) return false;
  const from = standingCell(npc, nav);
  if (from < 0) return false;
  const region = nav.region[from];
  const reachable = (x: number, z: number): boolean => isFreeAt(nav, x, z) && nav.region[cellAt(nav, x, z)] === region;
  const usable = (spot: NeedSpot): boolean => {
    if (!reachable(spot.x, spot.z)) return false;
    if (spot.seatKey === null) {
      if (others.some((other) => other !== npc && claims(other, spot.x, spot.z))) return false;
      return player === null || Math.hypot(player.x - spot.x, player.z - spot.z) >= PERSONAL_SPACE;
    }
    // Only the rigged figure sits; one sitter per seat (#585).
    const seat = seats.get(spot.seatKey);
    if (!seat || !npc.anim?.sit) return false;
    if (others.some((other) => other !== npc && other.seat?.key === seat.key)) return false;
    return !(player && seatTakenByPlayer(player, player.floorIndex, seat.x, seat.z, bedOf(seat)));
  };
  const spot = pickNeedSpot(npc.needs, spots, npc.position.x, npc.position.z, usable, random, skip);
  if (!spot) return false;
  if (spot.seatKey !== null) {
    if (!headForSeat(npc, nav, from, seats.get(spot.seatKey)!)) return false;
  } else {
    const cell = cellAt(nav, spot.x, spot.z);
    routeTo(npc, nav, from, cell);
    if (npc.pathLength === 0) return false;
    npc.stuck = 0;
    npc.seat = null;
    npc.destination = cell;
    npc.goal.x = cellX(nav, cell);
    npc.goal.z = cellZ(nav, cell);
    npc.arrivalHeading = spot.heading;
  }
  npc.seeking = spot.need;
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
  seats: NpcSeats = EMPTY_SEATS,
  player: PlayerBody | null = null,
  spots: readonly NeedSpot[] = NO_SPOTS
): NpcChange {
  let change: NpcChange = NPC_STILL;
  for (const npc of npcs) {
    // Needs run down all the time and are met while using something (#617).
    decayNeeds(npc.needs, delta);
    if (npc.using && (npc.mode === 'pause' || npc.mode === 'seated')) refillNeed(npc.needs, npc.using, delta);
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
        // A use that ran its course meets the need (#617).
        if (npc.using) refillNeed(npc.needs, npc.using, Number.POSITIVE_INFINITY);
        if (npc.mode === 'seated') standUp(npc);
        else {
          if (npc.mode === 'blocked' && wayAheadBlocked(npc, npcs, player)) {
            // Still in the way: head somewhere else, preferably not straight
            // back at whatever stopped it.
            npc.seat = null;
            planRoute(npc, nav, random, npcs, player);
            for (let retry = 0; retry < UNBLOCK_TRIES && wayAheadBlocked(npc, npcs, player); retry++) {
              planRoute(npc, nav, random, npcs, player);
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
          // In the seat for a need: resting, or watching TV (#617).
          npc.using = npc.seeking;
          npc.seeking = null;
          const sitFor = npc.using ? SEATED_USE_SECONDS : SEATED_SECONDS;
          npc.pause = between(random, sitFor[0], sitFor[1]);
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
        const dx = npc.target.x - npc.position.x;
        const dz = npc.target.z - npc.position.z;
        const distance = Math.hypot(dx, dz);
        if (distance < SEAT_SPOT_REACHED) {
          change = NPC_SHADOW;
          if (npc.mode === 'settle' && npc.seat) {
            npc.stuck = 0;
            npc.mode = 'turn';
            standStill(npc, floorY, npc.anim?.stand[0]);
          } else {
            // Up from a seat: walk somewhere before sitting again.
            npc.seat = null;
            arriveAtStop(npc, nav, floorY, random, npcs, null, player, spots);
          }
          break;
        }
        const stride = Math.min(distance, npc.speed * delta);
        // The player stands in the way (#585): stand and wait; a player who
        // stays gets walked round, out to free floor clear of it.
        if (player && bumpsPlayer(npc, player, npc.position.x + (dx / distance) * stride, npc.position.z + (dz / distance) * stride)) {
          if (npc.stuck === 0) standStill(npc, floorY, npc.anim?.stand[0]);
          // The shadow follows the fade into standing, then rests.
          if (npc.stuck < FADE_SECONDS) change = NPC_SHADOW;
          npc.stuck += delta;
          if (npc.stuck > STUCK_SECONDS) stepAroundPlayer(npc, nav, player);
          break;
        }
        if (npc.stuck > 0) {
          npc.stuck = 0;
          if (npc.anim) crossFadeTo(npc.anim, npc.anim.walk);
        }
        change = NPC_SHADOW;
        npc.position.x += (dx / distance) * stride;
        npc.position.z += (dz / distance) * stride;
        turnToward(npc.group, Math.atan2(dx, dz), delta);
        npc.group.position.x = npc.position.x;
        npc.group.position.z = npc.position.z;
        break;
      }
      case 'walk': {
        // The player sat down in the seat it was heading for (#585): pick again.
        if (npc.seat && player && seatTakenByPlayer(player, player.floorIndex, npc.seat.x, npc.seat.z, bedOf(npc.seat))) {
          npc.seat = null;
          npc.seeking = null;
          npc.pathLength = 0;
          npc.pathIndex = 0;
          npc.destination = -1;
        }
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
            npc.stuck = 0;
            sitFeet(npc, npc.seat, npc.target);
          } else arriveAtStop(npc, nav, floorY, random, npcs, seats, player, spots);
          change = NPC_SHADOW;
          break;
        }

        if (wayAheadBlocked(npc, npcs, player)) {
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
        let nx = Math.max(-nav.halfW, Math.min(nav.halfW, stepScratch.x));
        let nz = Math.max(-nav.halfD, Math.min(nav.halfD, stepScratch.z));
        // Never into the player, who stepped in from the side or behind (#585):
        // it stays put, and a player who stays gets walked round (STUCK_SECONDS).
        if (player && bumpsPlayer(npc, player, nx, nz)) {
          nx = npc.position.x;
          nz = npc.position.z;
        }
        const moved = Math.hypot(nx - npc.position.x, nz - npc.position.z);
        npc.position.x = nx;
        npc.position.z = nz;
        npc.stuck = moved < stride * STUCK_PROGRESS ? npc.stuck + delta : 0;
        if (npc.stuck > STUCK_SECONDS) {
          npc.seat = null;
          planRoute(npc, nav, random, npcs, player);
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

    // Where the player's resolve and seat lookup find it (#585).
    moveNpcBody(npc.body, npc.position.x, npc.position.z, floorY, npc.body.floorIndex);
    const sitting = inSeat(npc) ? npc.seat : null;
    npc.body.seatX = sitting ? sitting.x : Number.NaN;
    npc.body.seatZ = sitting ? sitting.z : Number.NaN;
    npc.body.bedId = sitting ? bedOf(sitting) : null;
  }
  return change;
}

/**
 * Arrived at a stop: face whatever it came to see while it stands for a
 * moment (now and then dancing or reaching for something instead), and
 * plan where it goes next: what meets its most pressing need (#617), or
 * else sometimes one of `seats` (null: not a seat). At something that meets
 * a need it uses it instead: reaches into the fridge, takes a book, watches
 * the TV. It sets off after the pause.
 */
function arriveAtStop(
  npc: NpcState,
  nav: NpcNav,
  floorY: number,
  random: () => number,
  npcs: readonly NpcState[],
  seats: NpcSeats | null,
  player: PlayerBody | null,
  spots: readonly NeedSpot[]
): void {
  npc.standHeading = npc.arrivalHeading;
  // Arrived where it set out for (not dropped short of a seat it lost).
  npc.using = npc.destination >= 0 ? npc.seeking : null;
  npc.seeking = null;
  const using = npc.using;
  const toNeed = planNeed(npc, nav, seats ?? EMPTY_SEATS, spots, random, npcs, player, using);
  const toSeat =
    !toNeed &&
    Boolean(npc.anim?.sit) &&
    seats !== null &&
    seats.size > 0 &&
    random() < SEAT_CHANCE &&
    planSeat(npc, nav, seats, random, npcs, player);
  if (!toNeed && !toSeat) planRoute(npc, nav, random, npcs, player);
  // planNeed and planRoute leave what this stop is for alone.
  npc.using = using;
  npc.mode = 'pause';
  const activities = npc.anim?.activities ?? [];
  if (using) {
    // Reach into the fridge or the stove, take a book; the TV, watched
    // standing, has no clip: just a while in front of it.
    const itemType = nearestSpotType(spots, using, npc.position.x, npc.position.z);
    const use = itemType === 'bookshelf' ? npc.anim?.pickUp : using === 'hunger' ? npc.anim?.interact : null;
    if (use) {
      npc.pause = use.getClip().duration + 0.3;
      standStill(npc, floorY, use);
      npc.shadowSettle = npc.pause;
    } else {
      npc.pause = between(random, STAND_USE_SECONDS[0], STAND_USE_SECONDS[1]);
      standStill(npc, floorY, npc.anim?.stand[0]);
    }
  } else if (activities.length > 0 && random() < ACTIVITY_CHANCE) {
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
  npc.using = null;
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
  npc.stuck = 0;
  npc.using = null;
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
  // Whatever it was heading there for, it isn't getting it there.
  npc.seeking = null;
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
 * The look-ahead along the route: another person (a walker, or the
 * player) close by and roughly in front. Furniture, partitions and placed people need no look-ahead: the
 * route already keeps clear of them, and a change to the floor re-routes
 * every walker (`rehomeNpcs`). Allocation-free.
 */
export function wayAheadBlocked(npc: NpcState, npcs: readonly NpcState[], player: PlayerBody | null = null): boolean {
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
  // The player is a person too (#585).
  if (player) {
    const ox = player.x - npc.position.x;
    const oz = player.z - npc.position.z;
    const gap = Math.hypot(ox, oz);
    if (gap < 1e-6 || (gap <= BLOCKING_GAP && (ox * ux + oz * uz) / gap > NPC_VIEW_COS)) return true;
  }
  return false;
}

/**
 * Held too long by the player on the straight stretch into or out of a
 * seat (#585): give the seat up and step out to the nearest free floor
 * clear of the player instead.
 */
/** The bed a seat is on, null for any other seat: a bed seats one party (`lib/npc-bodies`). */
function bedOf(seat: NpcSeat): string | null {
  return seat.itemType === 'bed' ? seat.itemId : null;
}

function stepAroundPlayer(npc: NpcState, nav: NpcNav, player: PlayerBody): void {
  let best = -1;
  let bestGap = Number.POSITIVE_INFINITY;
  for (let i = 0; i < nav.freeCount; i++) {
    const cell = nav.free[i]!;
    const x = cellX(nav, cell);
    const z = cellZ(nav, cell);
    if (Math.hypot(player.x - x, player.z - z) < PLAYER_GAP + NPC_RADIUS) continue;
    const gap = Math.hypot(npc.position.x - x, npc.position.z - z);
    if (gap < bestGap) {
      best = cell;
      bestGap = gap;
    }
  }
  npc.seat = null;
  npc.seeking = null;
  npc.using = null;
  npc.mode = 'leaveSeat';
  npc.stuck = 0;
  if (best >= 0) {
    npc.target.x = cellX(nav, best);
    npc.target.z = cellZ(nav, best);
  }
  if (npc.anim) crossFadeTo(npc.anim, npc.anim.walk);
}

/** Whether a walker stands within reach of the player's body. */
function onPlayer(npc: NpcState, player: PlayerBody): boolean {
  return Math.hypot(player.x - npc.position.x, player.z - npc.position.z) < PLAYER_GAP;
}

/**
 * Show the walkers of a shown storey that were held back because they
 * stood on the player (#585), now that it has moved off. True when one
 * appeared.
 */
function revealHeld(npcs: readonly NpcState[], player: PlayerBody | null): boolean {
  let revealed = false;
  for (const npc of npcs) {
    if (npc.group.visible || (player && onPlayer(npc, player))) continue;
    npc.group.visible = true;
    revealed = true;
  }
  return revealed;
}

/** Whether moving to (x, z) takes the walker into the player, closer than it already is. */
function bumpsPlayer(npc: NpcState, player: PlayerBody, x: number, z: number): boolean {
  const after = Math.hypot(player.x - x, player.z - z);
  return after < PLAYER_GAP && after < Math.hypot(player.x - npc.position.x, player.z - npc.position.z);
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
