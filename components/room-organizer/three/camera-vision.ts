import { ROOM_OBJECT_TAGS } from './room-builder';
import type { FurnitureItem } from '../lib/types';
import type * as ThreeNS from 'three';

type ThreeModule = typeof import('three');

/**
 * Height (metres) at which the security camera body — and the apex of its
 * vision cone — sits above the floor. Shared with the camera builder so the
 * 3D light volume connects the lens to the floor wedge.
 */
export const CAMERA_MOUNT_HEIGHT = 2.3;

/** Desperados-style cyan glow, matching the PlotCraft accent. */
const CONE_COLOR = 0x38f0ff;
/** Alert red when something is inside the field of view. */
const ALERT_COLOR = 0xff5252;

const FLOOR_Y = 0.02;
const EDGE_Y = 0.035;
const ARC_SEGMENTS = 40;
const WEDGE_BASE_OPACITY = 0.16;
const WEDGE_ALERT_OPACITY = 0.28;
const SCAN_FOV_RATIO = 0.1;
const SWEEP_SPEED = 1.6;
/** How fast the cone colour eases between idle and alert (per frame factor). */
const COLOR_LERP = 0.15;
/** Extra reach beyond the item's centre so fat items at the edge still trip. */
const TARGET_RADIUS = 0.35;
/** Item types a camera should not alert on. */
const UNDETECTABLE_TYPES: ReadonlySet<string> = new Set([
  'security-camera',
  'door',
  'window',
  'rug',
]);
/** Tag used by use-npcs for wandering pedestrians. */
const NPC_TAG = 'npc';

interface VisionConeUserData {
  /** The narrow sweeping sector, rotated each frame within the FOV. */
  scan: ThreeNS.Object3D;
  /** Max half-angle (radians) the scan sector swings either side of centre. */
  swing: number;
  /** Phase offset so multiple cameras don't sweep in lockstep. */
  phase: number;
  /** The flat floor wedge, whose opacity gently pulses. */
  wedge: ThreeNS.Mesh;
  /** Cone geometry parameters, used for the in-FOV target test. */
  range: number;
  fov: number;
  scanFov: number;
  /** Owning camera item id — excluded from its own detection. */
  ownerId: string;
  /** Floor the cone lives on; only furniture on this floor can trip it. */
  floorIndex: number;
  /** Item ids this cone is allowed to detect (same floor, detectable type). */
  detectableIds: ReadonlySet<string>;
  /** Every material tinted on alert, plus the idle/alert colour endpoints. */
  materials: ReadonlyArray<ThreeNS.MeshBasicMaterial | ThreeNS.LineBasicMaterial>;
  idleColor: ThreeNS.Color;
  alertColor: ThreeNS.Color;
  scanMaterial: ThreeNS.MeshBasicMaterial;
}

/**
 * Build the floor-wedge / light-volume / scan-line group for every item that
 * projects a vision cone, and add it to the scene. The group is positioned at
 * the item and rotated so its local +Z (the camera's forward axis) fans into
 * the room. Tagged with `ROOM_OBJECT_TAGS.CameraVision` so `removeTagged`
 * tears it down on rebuild, mirroring the signal-overlay lifecycle.
 */
export function addVisionCones(
  THREE: ThreeModule,
  scene: ThreeNS.Scene,
  items: readonly FurnitureItem[],
  yOffset = 0,
  floorIndex = 0
): void {
  // Item ids on this floor a cone may alert on. Rebuilt with the cones on
  // every item add/remove, so it never goes stale; live positions are read
  // from the scene groups each frame (correct during fast-path drags too).
  const detectableIds = new Set<string>();
  for (const item of items) {
    if (item.position && !UNDETECTABLE_TYPES.has(item.type)) detectableIds.add(item.id);
  }

  for (const item of items) {
    if (!item.position || !item.hasVisionCone) continue;
    const range = item.visionRange ?? 7;
    const fov = ((item.visionFov ?? 70) * Math.PI) / 180;
    const group = buildCone(THREE, range, fov, item.id, floorIndex, detectableIds);
    group.position.set(item.position.x, yOffset, item.position.z);
    group.rotation.y = item.rotation ?? 0;
    group.userData.type = ROOM_OBJECT_TAGS.CameraVision;
    scene.add(group);
  }
}

/**
 * Advance every vision cone in the scene by the elapsed time: swing the scan
 * line back and forth across the field of view and pulse the wedge opacity.
 * Called once per animation frame; the shared render loop paints the result.
 */
export function stepVisionCones(scene: ThreeNS.Scene, elapsedSeconds: number): void {
  // Candidate targets, collected once per frame and shared by every cone:
  // furniture groups (live positions, valid mid-drag) and wandering NPCs.
  const furniture: ThreeNS.Object3D[] = [];
  const npcs: ThreeNS.Object3D[] = [];
  for (const obj of scene.children) {
    if (obj.userData.type === 'furniture') furniture.push(obj);
    else if (obj.userData.type === NPC_TAG) npcs.push(obj);
  }

  for (const child of scene.children) {
    if (child.userData.type !== ROOM_OBJECT_TAGS.CameraVision) continue;
    const data = child.userData.vision as VisionConeUserData | undefined;
    if (!data) continue;
    const t = elapsedSeconds * SWEEP_SPEED + data.phase;
    const scanAngle = Math.sin(t) * data.swing;
    data.scan.rotation.y = scanAngle;

    // --- Detection: anything inside the wedge flips the cone to alert. ---
    const yaw = child.rotation.y;
    const cosYaw = Math.cos(yaw);
    const sinYaw = Math.sin(yaw);
    let detected = false;
    let scanHit = false;

    const testTarget = (obj: ThreeNS.Object3D): void => {
      const dx = obj.position.x - child.position.x;
      const dz = obj.position.z - child.position.z;
      // World→cone-local rotation; the cone fans around local +Z.
      const localX = cosYaw * dx - sinYaw * dz;
      const localZ = sinYaw * dx + cosYaw * dz;
      if (localZ <= 0) return;
      const distance = Math.hypot(localX, localZ);
      if (distance > data.range + TARGET_RADIUS) return;
      const angle = Math.atan2(localX, localZ);
      // Angular slack widens for near targets so size still matters up close.
      const slack = Math.atan2(TARGET_RADIUS, Math.max(distance, 0.5));
      if (Math.abs(angle) > data.fov / 2 + slack) return;
      detected = true;
      if (Math.abs(angle - scanAngle) <= data.scanFov / 2 + slack) scanHit = true;
    };

    for (const obj of furniture) {
      if (obj.userData.floorIndex !== data.floorIndex) continue;
      const id = obj.userData.id as string | undefined;
      if (!id || id === data.ownerId || !data.detectableIds.has(id)) continue;
      testTarget(obj);
    }
    for (const npc of npcs) {
      // NPCs wander the active floor; match by height against the cone base.
      if (Math.abs(npc.position.y - child.position.y) < 1.5) testTarget(npc);
    }

    // --- Animate: ease colours toward idle/alert, pulse, and scan-blip. ---
    const targetColor = detected ? data.alertColor : data.idleColor;
    for (const material of data.materials) {
      material.color.lerp(targetColor, COLOR_LERP);
    }
    const wedgeMaterial = data.wedge.material as ThreeNS.MeshBasicMaterial;
    const base = detected ? WEDGE_ALERT_OPACITY : WEDGE_BASE_OPACITY;
    const pulse = detected ? Math.sin(t * 6) * 0.07 : Math.sin(t * 2) * 0.04;
    wedgeMaterial.opacity = base + pulse;
    // The sweep line flares when it passes over a detected object.
    data.scanMaterial.opacity = scanHit ? 0.95 : 0.5;
  }
}

/** Points along the cone's far arc, fanning symmetrically around local +Z. */
function arcPoints(range: number, fov: number, y: number): number[] {
  const points: number[] = [];
  for (let i = 0; i <= ARC_SEGMENTS; i++) {
    const angle = -fov / 2 + (fov * i) / ARC_SEGMENTS;
    points.push(Math.sin(angle) * range, y, Math.cos(angle) * range);
  }
  return points;
}

/** A triangle-fan geometry from an apex to the far arc (flat or volumetric). */
function fanGeometry(THREE: ThreeModule, apex: [number, number, number], arc: number[]): ThreeNS.BufferGeometry {
  const positions = [...apex, ...arc];
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  const indices: number[] = [];
  const arcCount = arc.length / 3;
  for (let i = 0; i < arcCount - 1; i++) {
    indices.push(0, i + 1, i + 2);
  }
  geometry.setIndex(indices);
  return geometry;
}

function buildCone(
  THREE: ThreeModule,
  range: number,
  fov: number,
  ownerId: string,
  floorIndex: number,
  detectableIds: ReadonlySet<string>
): ThreeNS.Group {
  const group = new THREE.Group();

  // All cone layers render as a Desperados-style overlay: depthTest is off so
  // walls, furniture, and floor coverings (rugs share the wedge's y) can never
  // occlude or z-fight the effect, and a high renderOrder paints it after the
  // world. depthWrite stays off so the cone never blocks anything else.

  // Flat floor wedge — the primary "this is what the camera sees" footprint.
  const wedgeGeo = fanGeometry(THREE, [0, FLOOR_Y, 0], arcPoints(range, fov, FLOOR_Y));
  const wedgeMat = new THREE.MeshBasicMaterial({
    color: CONE_COLOR,
    transparent: true,
    opacity: WEDGE_BASE_OPACITY,
    side: THREE.DoubleSide,
    depthWrite: false,
    depthTest: false,
    blending: THREE.AdditiveBlending,
  });
  const wedge = new THREE.Mesh(wedgeGeo, wedgeMat);
  wedge.renderOrder = 991;
  group.add(wedge);

  // Faint volumetric light from the lens down to the floor arc.
  const volumeGeo = fanGeometry(THREE, [0, CAMERA_MOUNT_HEIGHT, 0], arcPoints(range, fov, FLOOR_Y));
  const volumeMat = new THREE.MeshBasicMaterial({
    color: CONE_COLOR,
    transparent: true,
    opacity: 0.05,
    side: THREE.DoubleSide,
    depthWrite: false,
    depthTest: false,
    blending: THREE.AdditiveBlending,
  });
  const volume = new THREE.Mesh(volumeGeo, volumeMat);
  volume.renderOrder = 990;
  group.add(volume);

  // Bright outline tracing the two edges and the far arc.
  const arc = arcPoints(range, fov, EDGE_Y);
  const outlinePositions = [0, EDGE_Y, 0, ...arc, 0, EDGE_Y, 0];
  const outlineGeo = new THREE.BufferGeometry();
  outlineGeo.setAttribute('position', new THREE.Float32BufferAttribute(outlinePositions, 3));
  const outline = new THREE.Line(
    outlineGeo,
    new THREE.LineBasicMaterial({
      color: CONE_COLOR,
      transparent: true,
      opacity: 0.7,
      depthWrite: false,
      depthTest: false,
    })
  );
  outline.renderOrder = 992;
  group.add(outline);

  // Narrow sweeping scan line — the animated "radar" pass.
  const scanFov = Math.max(fov * SCAN_FOV_RATIO, 0.04);
  const scanGeo = fanGeometry(THREE, [0, EDGE_Y, 0], arcPoints(range, scanFov, EDGE_Y));
  const scanMat = new THREE.MeshBasicMaterial({
    color: CONE_COLOR,
    transparent: true,
    opacity: 0.5,
    side: THREE.DoubleSide,
    depthWrite: false,
    depthTest: false,
    blending: THREE.AdditiveBlending,
  });
  const scan = new THREE.Mesh(scanGeo, scanMat);
  scan.renderOrder = 993;
  group.add(scan);

  const userData: VisionConeUserData = {
    scan,
    swing: Math.max(fov / 2 - scanFov / 2, 0),
    phase: Math.random() * Math.PI * 2,
    wedge,
    range,
    fov,
    scanFov,
    ownerId,
    floorIndex,
    detectableIds,
    materials: [wedgeMat, volumeMat, outline.material as ThreeNS.LineBasicMaterial, scanMat],
    idleColor: new THREE.Color(CONE_COLOR),
    alertColor: new THREE.Color(ALERT_COLOR),
    scanMaterial: scanMat,
  };
  group.userData.vision = userData;

  return group;
}
