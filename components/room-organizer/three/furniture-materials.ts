import { drawDetail, type DetailKind } from '../lib/detail-patterns';
import { type BuilderContext, type ThreeModule, markSharedTexture, material } from './builder-utils';
import { drawsForPhone, getMaxAnisotropy } from './texture-settings';
import type * as ThreeNS from 'three';

/**
 * The surfaces furniture is made of (#756). Non-metals are metalness 0 and
 * metals 1: a part-metal dielectric darkens the diffuse colour and tints the
 * highlight, which is why colours looked dull.
 */
export const MATERIAL_CLASSES = {
  fabric: { roughness: 0.9, metalness: 0, detail: 'fabric' },
  leather: { roughness: 0.45, metalness: 0, detail: 'leather' },
  woodOiled: { roughness: 0.5, metalness: 0, detail: 'wood' },
  woodLacquered: { roughness: 0.25, metalness: 0, detail: 'wood' },
  ceramic: { roughness: 0.15, metalness: 0 },
  painted: { roughness: 0.5, metalness: 0 },
  brushedMetal: { roughness: 0.35, metalness: 1 },
  plastic: { roughness: 0.4, metalness: 0 },
} as const satisfies Record<string, { roughness: number; metalness: number; detail?: DetailKind }>;

export type MaterialClass = keyof typeof MATERIAL_CLASSES;

/** Metres of surface one tile of each detail image covers. UVs are in metres (see softBox). */
const DETAIL_TILE: Record<DetailKind, number> = { wood: 1, fabric: 0.3, leather: 0.4 };

const DETAIL_SIZE = 512;
const PHONE_DETAIL_SIZE = 256;
const MAX_DETAIL_ANISOTROPY = 8;

const detailTextures = new Map<DetailKind, ThreeNS.DataTexture>();

/** One texture per kind, drawn on first use and shared by every item. */
function detailTexture(THREE: ThreeModule, kind: DetailKind): ThreeNS.DataTexture {
  const cached = detailTextures.get(kind);
  if (cached) return cached;
  const { size, data } = drawDetail(kind, drawsForPhone() ? PHONE_DETAIL_SIZE : DETAIL_SIZE);
  const texture = new THREE.DataTexture(data, size, size);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.anisotropy = Math.min(getMaxAnisotropy(), MAX_DETAIL_ANISOTROPY);
  texture.repeat.setScalar(1 / DETAIL_TILE[kind]);
  texture.needsUpdate = true;
  markSharedTexture(texture);
  detailTextures.set(kind, texture);
  return texture;
}

/** Free the shared detail textures when the editor unmounts; the next build redraws them. */
export function releaseDetailTextures(): void {
  for (const texture of detailTextures.values()) texture.dispose();
  detailTextures.clear();
}

type SurfaceContext = Pick<BuilderContext, 'THREE' | 'hasCollision' | 'opacity'>;

/**
 * A material of class `surface`. Detail needs UVs in metres, so a part gets it
 * only with `detailed: true`, on softBox geometry: a cylinder's 0-to-1 UVs
 * would stretch one tile round a leg.
 */
export function surfaceMaterial(
  { THREE, hasCollision, opacity }: SurfaceContext,
  color: ThreeNS.ColorRepresentation,
  surface: MaterialClass,
  { detailed = false }: { detailed?: boolean } = {}
): ThreeNS.MeshStandardMaterial {
  const spec: { roughness: number; metalness: number; detail?: DetailKind } = MATERIAL_CLASSES[surface];
  return material(THREE, color, hasCollision, opacity, {
    roughness: spec.roughness,
    metalness: spec.metalness,
    ...(detailed && spec.detail ? { map: detailTexture(THREE, spec.detail) } : {}),
  });
}

/**
 * Drop the detail maps from a built object. A GLB keeps its flat colours: the
 * tiled grey images would add about a megabyte and need KHR_texture_transform
 * in whatever opens the file.
 */
export function stripDetailMaps(root: ThreeNS.Object3D): void {
  const shared = new Set<ThreeNS.Texture>(detailTextures.values());
  root.traverse((node) => {
    const mat = (node as ThreeNS.Mesh).material as ThreeNS.Material | ThreeNS.Material[] | undefined;
    for (const m of Array.isArray(mat) ? mat : mat ? [mat] : []) {
      const standard = m as ThreeNS.MeshStandardMaterial;
      if (standard.map && shared.has(standard.map)) standard.map = null;
    }
  });
}
