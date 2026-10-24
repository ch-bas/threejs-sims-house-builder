/**
 * Renderer quality per device class. Pure: the hook passes in what it reads
 * from `window`.
 *
 * A phone has a 3× display and a GPU a fraction of a laptop's; at the
 * desktop cap of 2 it shades as many pixels as a 1080p monitor, so every
 * orbit and drag frame costs the most where the GPU is weakest. Phones get
 * a lower pixel-ratio cap; everything else keeps the desktop settings.
 */

export interface QualityInput {
  /** `matchMedia('(pointer: coarse)')`: a touch-first device. */
  coarsePointer: boolean;
  /** `Math.min(screen.width, screen.height)` in CSS pixels. */
  screenShortSide: number;
  devicePixelRatio: number;
}

export interface QualityProfile {
  /** The value for `renderer.setPixelRatio`. */
  pixelRatio: number;
}

/** Desktop and tablet cap: sharp on 2× displays, no more. */
const DESKTOP_PIXEL_RATIO_CAP = 2;
/** Phone cap: a 3× phone shades ~44% fewer pixels than at 2, and antialiasing hides the difference. */
const PHONE_PIXEL_RATIO_CAP = 1.5;
/** Short sides at or under this are phones (the largest phones are ~480 CSS px; an iPad mini is 744). */
const PHONE_MAX_SHORT_SIDE = 500;

export function isPhone(input: Pick<QualityInput, 'coarsePointer' | 'screenShortSide'>): boolean {
  return input.coarsePointer && input.screenShortSide > 0 && input.screenShortSide <= PHONE_MAX_SHORT_SIDE;
}

export function qualityProfile(input: QualityInput): QualityProfile {
  const cap = isPhone(input) ? PHONE_PIXEL_RATIO_CAP : DESKTOP_PIXEL_RATIO_CAP;
  const dpr = input.devicePixelRatio > 0 ? input.devicePixelRatio : 1;
  return { pixelRatio: Math.min(dpr, cap) };
}
