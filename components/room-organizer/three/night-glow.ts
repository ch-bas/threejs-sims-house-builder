import { markSharedTexture } from './builder-utils';
import { ROOF_TAG } from './roof';
import type { NightGlowPlan } from '../lib/night-lights';
import type * as ThreeNS from 'three';

type ThreeModule = typeof import('./three-runtime');

/** Warm tungsten, the colour a lit room shows through a net curtain. */
const LIT_GLASS_COLOR = 0xffb765;
/** Emissive of a pane with a lamp right behind it, at full night. */
const LIT_GLASS_INTENSITY = 1.35;
/** A lit pane hides what's behind it: at 0.4 the warm light went grey on the dark room. */
const LIT_GLASS_OPACITY = 0.85;
/** What a lamp's shade and bulb gain at full night, as a multiple of their daytime glow. */
const LAMP_GLOW_GAIN = 4.5;

/** Marks a pane that glows with the house (`buildWindow`, dormer glass by its own flag). */
export const LIT_GLASS_FLAG = 'litGlass';
/** The neighbours' panes with someone home; `three/neighbours.ts` places them. */
export const LIT_PANES_PART = 'litPanes';
/** The neighbours' panes pick their colour up here; the street is rebuilt at any hour. */
const NIGHT_LEVEL_KEY = 'nightLevel';

export function litPaneMaterialProps(
  THREE: ThreeModule,
  scene: ThreeNS.Scene
): { emissive: number; emissiveIntensity: number; emissiveMap: ThreeNS.Texture | null } {
  return {
    emissive: LIT_GLASS_COLOR,
    emissiveIntensity: LIT_GLASS_INTENSITY * sceneNightLevel(scene),
    emissiveMap: roomLightTexture(THREE),
  };
}

let roomLightCache: ThreeNS.CanvasTexture | null = null;

/**
 * What a lit room looks like through glass: brighter towards the ceiling, with
 * curtains drawn in at the sides. One small texture for every pane in the
 * street; a flat colour read as a sticker on the wall. Shared, so removing a
 * window or rebuilding the street leaves it on the GPU; freed at unmount.
 */
function roomLightTexture(THREE: ThreeModule): ThreeNS.CanvasTexture | null {
  if (roomLightCache) return roomLightCache;
  if (typeof document === 'undefined') return null;
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const room = ctx.createLinearGradient(0, 0, 0, size);
  room.addColorStop(0, '#ffffff');
  room.addColorStop(0.6, '#c9c9c9');
  room.addColorStop(1, '#7e7e7e');
  ctx.fillStyle = room;
  ctx.fillRect(0, 0, size, size);
  const curtains = ctx.createLinearGradient(0, 0, size, 0);
  curtains.addColorStop(0, 'rgba(0, 0, 0, 0.5)');
  curtains.addColorStop(0.16, 'rgba(0, 0, 0, 0.12)');
  curtains.addColorStop(0.3, 'rgba(0, 0, 0, 0)');
  curtains.addColorStop(0.7, 'rgba(0, 0, 0, 0)');
  curtains.addColorStop(0.84, 'rgba(0, 0, 0, 0.12)');
  curtains.addColorStop(1, 'rgba(0, 0, 0, 0.5)');
  ctx.fillStyle = curtains;
  ctx.fillRect(0, 0, size, size);
  roomLightCache = markSharedTexture(new THREE.CanvasTexture(canvas));
  roomLightCache.colorSpace = THREE.SRGBColorSpace;
  return roomLightCache;
}

/** Free the lit-window texture when the editor unmounts. */
export function releaseRoomLightTexture(): void {
  roomLightCache?.dispose();
  roomLightCache = null;
}

function sceneNightLevel(scene: ThreeNS.Scene): number {
  return (scene.userData[NIGHT_LEVEL_KEY] as number | undefined) ?? 0;
}

export interface NightGlowInput {
  plan: NightGlowPlan;
  /** 0..1 share of the lamps' night intensity. */
  level: number;
  /** The walker is inside: a pane shows the dark outside, not a lit room. */
  indoors: boolean;
}

/**
 * Lit windows and glowing lamps (#759): only material values, so nothing
 * recompiles and nothing runs per frame. Every value is written absolutely from
 * `input`, so a group kept across edits (#404) or newly built lands on the same
 * state, and by day the materials are back at what the builders made.
 */
export function applyNightGlow(THREE: ThreeModule, scene: ThreeNS.Scene, input: NightGlowInput): void {
  const { plan, level, indoors } = input;
  scene.userData[NIGHT_LEVEL_KEY] = level;
  const lamps = new Set(plan.lamps);
  for (const obj of scene.children) {
    const id = obj.userData.id as string | undefined;
    if (id !== undefined && lamps.has(id)) {
      forEachStandard(obj, (material) => glowLamp(material, level));
    } else if (obj.userData.part === LIT_PANES_PART) {
      ((obj as ThreeNS.Mesh).material as ThreeNS.MeshStandardMaterial).emissiveIntensity = LIT_GLASS_INTENSITY * level;
      continue;
    }
    const isWindow = id !== undefined && Object.hasOwn(plan.windows, id);
    if (!isWindow && obj.userData.type !== ROOF_TAG) continue;
    const pane = indoors ? 0 : (isWindow ? (plan.windows[id] ?? 0) : plan.dormers) * level;
    obj.traverse((node) => {
      if (node.userData[LIT_GLASS_FLAG] === true || node.userData.dormerGlass === true) {
        glowGlass(THREE, (node as ThreeNS.Mesh).material as ThreeNS.MeshStandardMaterial, pane);
      }
    });
  }
}

function forEachStandard(root: ThreeNS.Object3D, visit: (material: ThreeNS.MeshStandardMaterial) => void): void {
  root.traverse((node) => {
    const material = (node as ThreeNS.Mesh).material as ThreeNS.Material | ThreeNS.Material[] | undefined;
    if (!material) return;
    for (const m of Array.isArray(material) ? material : [material]) {
      if ((m as ThreeNS.MeshStandardMaterial).isMeshStandardMaterial) visit(m as ThreeNS.MeshStandardMaterial);
    }
  });
}

/** Whatever the builder made glow keeps glowing, stronger as the night comes. */
function glowLamp(material: ThreeNS.MeshStandardMaterial, level: number): void {
  const base = (material.userData.dayGlow as number | undefined) ?? material.emissiveIntensity;
  material.userData.dayGlow = base;
  if (material.emissive.getHex() !== 0) material.emissiveIntensity = base * (1 + level * LAMP_GLOW_GAIN);
}

function glowGlass(THREE: ThreeModule, material: ThreeNS.MeshStandardMaterial, strength: number): void {
  const base = (material.userData.dayOpacity as number | undefined) ?? material.opacity;
  material.userData.dayOpacity = base;
  material.emissive.setHex(LIT_GLASS_COLOR);
  // Set once, at the first lit pane: it adds a shader variant days never need.
  if (strength > 0 && !material.emissiveMap) {
    material.emissiveMap = roomLightTexture(THREE);
    material.needsUpdate = true;
  }
  material.emissiveIntensity = LIT_GLASS_INTENSITY * strength;
  // A ghosted storey stays a ghost.
  material.opacity = base < 0.4 ? base : base + (Math.max(base, LIT_GLASS_OPACITY) - base) * Math.min(1, strength * 1.5);
}
