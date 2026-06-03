import type * as ThreeNS from 'three';
import type { FurnitureItem } from '../lib/types';
import { ROOM_OBJECT_TAGS } from './room-builder';

type ThreeModule = typeof import('three');

/**
 * Height (metres) at which the security camera body — and the apex of its
 * vision cone — sits above the floor. Shared with the camera builder so the
 * 3D light volume connects the lens to the floor wedge.
 */
export const CAMERA_MOUNT_HEIGHT = 2.3;

/** Desperados-style cyan glow, matching the PlotCraft accent. */
const CONE_COLOR = 0x38f0ff;

const FLOOR_Y = 0.02;
const EDGE_Y = 0.035;
const ARC_SEGMENTS = 40;
const WEDGE_BASE_OPACITY = 0.16;
const SCAN_FOV_RATIO = 0.1;
const SWEEP_SPEED = 1.6;

interface VisionConeUserData {
  /** The narrow sweeping sector, rotated each frame within the FOV. */
  scan: ThreeNS.Object3D;
  /** Max half-angle (radians) the scan sector swings either side of centre. */
  swing: number;
  /** Phase offset so multiple cameras don't sweep in lockstep. */
  phase: number;
  /** The flat floor wedge, whose opacity gently pulses. */
  wedge: ThreeNS.Mesh;
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
  yOffset = 0
): void {
  for (const item of items) {
    if (!item.position || !item.hasVisionCone) continue;
    const range = item.visionRange ?? 7;
    const fov = ((item.visionFov ?? 70) * Math.PI) / 180;
    const group = buildCone(THREE, range, fov);
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
  for (const child of scene.children) {
    if (child.userData.type !== ROOM_OBJECT_TAGS.CameraVision) continue;
    const data = child.userData.vision as VisionConeUserData | undefined;
    if (!data) continue;
    const t = elapsedSeconds * SWEEP_SPEED + data.phase;
    data.scan.rotation.y = Math.sin(t) * data.swing;
    const material = data.wedge.material as { opacity: number };
    material.opacity = WEDGE_BASE_OPACITY + Math.sin(t * 2) * 0.04;
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

function buildCone(THREE: ThreeModule, range: number, fov: number): ThreeNS.Group {
  const group = new THREE.Group();

  // Flat floor wedge — the primary "this is what the camera sees" footprint.
  const wedgeGeo = fanGeometry(THREE, [0, FLOOR_Y, 0], arcPoints(range, fov, FLOOR_Y));
  const wedgeMat = new THREE.MeshBasicMaterial({
    color: CONE_COLOR,
    transparent: true,
    opacity: WEDGE_BASE_OPACITY,
    side: THREE.DoubleSide,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const wedge = new THREE.Mesh(wedgeGeo, wedgeMat);
  wedge.renderOrder = 2;
  group.add(wedge);

  // Faint volumetric light from the lens down to the floor arc.
  const volumeGeo = fanGeometry(THREE, [0, CAMERA_MOUNT_HEIGHT, 0], arcPoints(range, fov, FLOOR_Y));
  const volumeMat = new THREE.MeshBasicMaterial({
    color: CONE_COLOR,
    transparent: true,
    opacity: 0.05,
    side: THREE.DoubleSide,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const volume = new THREE.Mesh(volumeGeo, volumeMat);
  volume.renderOrder = 1;
  group.add(volume);

  // Bright outline tracing the two edges and the far arc.
  const arc = arcPoints(range, fov, EDGE_Y);
  const outlinePositions = [0, EDGE_Y, 0, ...arc, 0, EDGE_Y, 0];
  const outlineGeo = new THREE.BufferGeometry();
  outlineGeo.setAttribute('position', new THREE.Float32BufferAttribute(outlinePositions, 3));
  const outline = new THREE.Line(
    outlineGeo,
    new THREE.LineBasicMaterial({ color: CONE_COLOR, transparent: true, opacity: 0.7, depthWrite: false })
  );
  outline.renderOrder = 3;
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
    blending: THREE.AdditiveBlending,
  });
  const scan = new THREE.Mesh(scanGeo, scanMat);
  scan.renderOrder = 4;
  group.add(scan);

  const userData: VisionConeUserData = {
    scan,
    swing: Math.max(fov / 2 - scanFov / 2, 0),
    phase: Math.random() * Math.PI * 2,
    wedge,
  };
  group.userData.vision = userData;

  return group;
}
