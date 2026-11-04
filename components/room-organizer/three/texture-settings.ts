import { isPhone } from '../lib/render-quality';
import type * as ThreeNS from 'three';

/**
 * Renderer capabilities relevant to texture creation, captured at renderer
 * init so material builders (which have no renderer access) can apply them.
 * Without anisotropy, the procedural floor/wall CanvasTextures shimmer badly
 * at grazing angles in walkthrough mode.
 */
let maxAnisotropy = 1;

/**
 * Every texture that asked for the maximum, so a new cap (a quality tier
 * picked in the View menu, #760) reaches the ones already built, including
 * those module caches keep across rebuilds. Weak, so a texture nothing else
 * holds can still be collected.
 */
const anisotropic = new Set<WeakRef<ThreeNS.Texture>>();
const PRUNE_AT = 128;

/** Set the cap, and re-upload every tracked texture that it changes. */
export function setMaxAnisotropy(value: number): void {
  maxAnisotropy = Math.max(1, value);
  for (const texture of tracked()) {
    if (texture.anisotropy === maxAnisotropy) continue;
    texture.anisotropy = maxAnisotropy;
    // three applies anisotropy at upload only; one with no image yet picks
    // it up at its first.
    if (texture.image) texture.needsUpdate = true;
  }
}

/** The tracked textures still alive, dropping the rest. */
function tracked(): ThreeNS.Texture[] {
  const alive: ThreeNS.Texture[] = [];
  for (const ref of anisotropic) {
    const texture = ref.deref();
    if (texture) alive.push(texture);
    else anisotropic.delete(ref);
  }
  return alive;
}

export function getMaxAnisotropy(): number {
  return maxAnisotropy;
}

/** Give `texture` the current maximum, and follow later changes to it. */
export function withMaxAnisotropy<T extends ThreeNS.Texture>(texture: T): T {
  texture.anisotropy = maxAnisotropy;
  // A floor-plan map is made per rebuild: prune now and then.
  if (anisotropic.size >= PRUNE_AT) tracked();
  anisotropic.add(new WeakRef(texture));
  return texture;
}

/** Whether textures made at runtime should come in their phone size. */
export function drawsForPhone(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return isPhone({
    coarsePointer: window.matchMedia('(pointer: coarse)').matches,
    screenShortSide: Math.min(window.screen.width, window.screen.height),
  });
}

/** Pattern tile edge in pixels on phones, and their only detail (#757). */
export const PHONE_PATTERN_SIZE = 256;
/** Desktop and tablet: about 400 px a metre on a brick wall, 370 on a wood floor. */
export const PATTERN_SIZE = 512;

let patternSize: number | null = null;

/**
 * The floor and wall pattern tile size for this device, read once from the
 * same inputs as the renderer's quality tier (lib/render-quality): phones
 * keep 256 px tiles and no relief maps, so they draw no slower than before.
 */
export function getPatternSize(): number {
  if (patternSize === null) patternSize = drawsForPhone() ? PHONE_PATTERN_SIZE : PATTERN_SIZE;
  return patternSize;
}

/** Normal and roughness maps on the floor and wall patterns: not on phones. */
export function patternReliefEnabled(): boolean {
  return getPatternSize() > PHONE_PATTERN_SIZE;
}

/** Doors and windows set into reveals in the outer walls (#758): not on phones. */
export function revealsEnabled(): boolean {
  return getPatternSize() > PHONE_PATTERN_SIZE;
}
