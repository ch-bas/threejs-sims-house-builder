import { type ContactClearing, type ContactPlan, rectCorners } from '../lib/contact-shadow';
import { removeAndDispose, type ThreeModule } from './builder-utils';
import { drawsForPhone } from './texture-settings';
import type * as ThreeNS from 'three';

export const CONTACT_SHADOW_TAG = 'contact-shadow';

/**
 * Lift over the floor. It clears the rug, whose top is 17 mm up, so a sofa on
 * a rug still grounds, and zone patches, which stack to 8 mm; a plane under
 * either would be hidden, one flush with them would z-fight (#276).
 */
export const CONTACT_PLANE_GAP = 0.018;

/**
 * How finely a map is painted, and the most it may cost: a big storey gets
 * fewer pixels a metre rather than a bigger canvas. A phone's map is at most
 * 2 MB of canvas and texture, a desktop's 8 MB, per storey.
 */
export interface ContactDensity {
  pixelsPerMetre: number;
  maxSide: number;
  maxPixels: number;
}

export const DESKTOP_DENSITY: ContactDensity = { pixelsPerMetre: 64, maxSide: 2048, maxPixels: 2048 * 1024 };
export const PHONE_DENSITY: ContactDensity = { pixelsPerMetre: 32, maxSide: 1024, maxPixels: 1024 * 512 };

/** A soft layer of a patch: how far it blurs, in metres, and how dark it gets. */
interface Layer {
  blur: number;
  alpha: number;
}

const SOLID_LAYERS: readonly Layer[] = [{ blur: 0.5, alpha: 0.42 }, { blur: 0.16, alpha: 0.6 }];
const RAISED_LAYERS: readonly Layer[] = [{ blur: 0.4, alpha: 0.34 }];
const WALL_BAND = { width: 0.12, blur: 0.3, alpha: 0.5 };

/** Canvas shadows are drawn from a shape this far off the canvas, so only the blur lands on it. */
const OFFSCREEN = 16384;

export interface ContactCanvas {
  width: number;
  height: number;
  scale: number;
}

/** Canvas size for a footprint: the wanted density, capped for a big house. */
export function contactCanvasSize(width: number, depth: number, density: ContactDensity): ContactCanvas {
  const scale = Math.min(
    density.pixelsPerMetre,
    density.maxSide / Math.max(width, depth),
    Math.sqrt(density.maxPixels / (width * depth))
  );
  return { width: Math.max(1, Math.ceil(width * scale)), height: Math.max(1, Math.ceil(depth * scale)), scale };
}

type PaintContext = Pick<
  CanvasRenderingContext2D,
  | 'beginPath' | 'moveTo' | 'lineTo' | 'closePath' | 'fill' | 'stroke' | 'globalCompositeOperation' | 'fillStyle'
  | 'strokeStyle' | 'lineWidth' | 'shadowBlur' | 'shadowColor' | 'shadowOffsetX'
>;

/** Paint the plan on a canvas whose origin is the house centre, in pixels per `scale`. */
export function paintContactPlan(ctx: PaintContext, plan: ContactPlan, { width, height, scale }: ContactCanvas): void {
  const px = (x: number): number => x * scale + width / 2;
  const pz = (z: number): number => z * scale + height / 2;
  const shade = (layer: Layer): void => {
    ctx.shadowBlur = layer.blur * scale;
    ctx.shadowColor = `rgba(0,0,0,${layer.alpha})`;
  };
  const trace = (corners: ReadonlyArray<[number, number]>, shift = 0): void => {
    ctx.beginPath();
    corners.forEach(([x, z], i) => {
      if (i === 0) ctx.moveTo(px(x) + shift, pz(z));
      else ctx.lineTo(px(x) + shift, pz(z));
    });
    ctx.closePath();
  };
  const wipe = (clearings: readonly ContactClearing[]): void => {
    ctx.globalCompositeOperation = 'destination-out';
    ctx.fillStyle = '#000';
    ctx.shadowOffsetX = 0;
    ctx.shadowColor = 'transparent';
    for (const clearing of clearings) {
      trace(rectCorners(clearing));
      ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';
  };

  // Everything drawn past the canvas edge; shadowOffset, which no transform
  // touches, brings the blur back in place.
  ctx.fillStyle = '#000';
  ctx.strokeStyle = '#000';
  ctx.shadowOffsetX = OFFSCREEN;

  ctx.lineWidth = WALL_BAND.width * scale;
  shade(WALL_BAND);
  for (const wall of plan.walls) {
    ctx.beginPath();
    ctx.moveTo(px(wall.x1) - OFFSCREEN, pz(wall.z1));
    ctx.lineTo(px(wall.x2) - OFFSCREEN, pz(wall.z2));
    ctx.stroke();
  }
  wipe(plan.doors);

  ctx.shadowOffsetX = OFFSCREEN;
  for (const blob of plan.blobs) {
    for (const layer of blob.raised ? RAISED_LAYERS : SOLID_LAYERS) {
      shade(layer);
      trace(rectCorners(blob), -OFFSCREEN);
      ctx.fill();
    }
  }
  wipe(plan.holes);
}

/** What each map on screen was painted from, to repaint it without a held item. */
const paintedPlans = new WeakMap<ThreeNS.Object3D, { plan: ContactPlan; size: ContactCanvas }>();

/**
 * One storey's contact map: a single textured quad over the footprint. Black
 * with alpha, which darkens what's under it exactly as a multiply would.
 */
export function buildContactShadow(THREE: ThreeModule, plan: ContactPlan): ThreeNS.Mesh | null {
  const size = contactCanvasSize(plan.width, plan.depth, drawsForPhone() ? PHONE_DENSITY : DESKTOP_DENSITY);
  const canvas = document.createElement('canvas');
  canvas.width = size.width;
  canvas.height = size.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  paintContactPlan(ctx, plan, size);

  const texture = new THREE.CanvasTexture(canvas);
  // Soft by construction: mipmaps would add a third for nothing visible.
  texture.generateMipmaps = false;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(plan.width, plan.depth),
    new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false, toneMapped: false, fog: false })
  );
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = plan.floorY + CONTACT_PLANE_GAP;
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  // Never in the way of a pointer ray.
  mesh.raycast = () => {};
  mesh.userData.type = CONTACT_SHADOW_TAG;
  paintedPlans.set(mesh, { plan, size });
  return mesh;
}

/**
 * Repaint a storey's map without the items in `lifted`, once as a drag opens:
 * a held item leaves no dark patch behind it. An empty set puts them back as a
 * drag ends, at `moves` for the items that were dropped elsewhere, so a drop
 * the reducer leaves unchanged doesn't keep them lifted. The caller
 * invalidates.
 */
export function liftContactPatches(
  scene: ThreeNS.Scene,
  storey: number,
  lifted: ReadonlySet<string>,
  moves?: ReadonlyMap<string, { x: number; z: number }>
): void {
  for (const obj of scene.children) {
    const painted = paintedPlans.get(obj);
    if (!painted || painted.plan.storey !== storey) continue;
    const texture = ((obj as ThreeNS.Mesh).material as ThreeNS.MeshBasicMaterial).map;
    const ctx = (texture?.image as HTMLCanvasElement | undefined)?.getContext('2d');
    if (!texture || !ctx) continue;
    ctx.clearRect(0, 0, painted.size.width, painted.size.height);
    const blobs = painted.plan.blobs.flatMap((blob) => {
      if (lifted.has(blob.id)) return [];
      const moved = moves?.get(blob.id);
      return [moved ? { ...blob, x: moved.x, z: moved.z } : blob];
    });
    paintContactPlan(ctx, { ...painted.plan, blobs }, painted.size);
    texture.needsUpdate = true;
  }
}

export function removeContactShadows(scene: ThreeNS.Scene): void {
  for (const obj of scene.children.filter((child) => child.userData.type === CONTACT_SHADOW_TAG)) {
    removeAndDispose(scene, obj);
  }
}
