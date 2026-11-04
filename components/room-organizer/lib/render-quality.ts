/**
 * Renderer quality per device class. Pure: the hook passes in what it reads
 * from `window`.
 *
 * A phone has a 3× display and a GPU a fraction of a laptop's; at the
 * desktop cap of 2 it shades as many pixels as a 1080p monitor, so every
 * orbit and drag frame costs the most where the GPU is weakest. So the
 * settings come in three tiers, picked from the device class, with a View menu
 * override (#760). Low shades less, holds less and leaves out the costly
 * scenery; high spends GPU memory on a sharper shadow, which only renders when
 * a caster or the sun moves. Auto keeps the shadow map and anisotropy every
 * device had before the tiers, so the default picture doesn't change; only an
 * explicit choice moves them.
 */

import { safeGetItem, safeSetItem } from './safe-storage';

export interface QualityInput {
  /** `matchMedia('(pointer: coarse)')`: a touch-first device. */
  coarsePointer: boolean;
  /** `Math.min(screen.width, screen.height)` in CSS pixels. */
  screenShortSide: number;
  devicePixelRatio: number;
}

export type QualityTier = 'low' | 'medium' | 'high';
/** The View menu's choice: `auto` goes by device class. */
export type QualityChoice = QualityTier | 'auto';

export const QUALITY_CHOICES: readonly QualityChoice[] = ['auto', 'low', 'medium', 'high'];

export interface QualityProfile {
  tier: QualityTier;
  /** The value for `renderer.setPixelRatio`. */
  pixelRatio: number;
  /** Width and height of the sun's shadow map. */
  shadowMapSize: number;
  /** The sun's `shadow.radius`, in shadow-map texels. */
  shadowRadius: number;
  /** Width and height of a ground tile. */
  groundTile: number;
  /** Most anisotropy a texture may ask for; the GPU's limit still applies. */
  maxAnisotropy: number;
  /**
   * Clouds, the fading ground and road past the lot, the kerb and the grass's
   * second lookup (#761). Off on low: on a phone they cost a millisecond a
   * frame and ten shader programs.
   */
  richScenery: boolean;
}

/** Phone cap: a 3× phone shades ~44% fewer pixels than at 2, and antialiasing hides the difference. */
const LOW_PIXEL_RATIO_CAP = 1.5;
/** Desktop and tablet cap: sharp on 2× displays, no more. */
const PIXEL_RATIO_CAP = 2;
/** Short sides at or under this are phones (the largest phones are ~480 CSS px; an iPad mini is 744). */
const PHONE_MAX_SHORT_SIDE = 500;

type TierSettings = Omit<QualityProfile, 'tier' | 'pixelRatio'> & { pixelRatioCap: number };

const TIERS: Record<QualityTier, TierSettings> = {
  low: { pixelRatioCap: LOW_PIXEL_RATIO_CAP, shadowMapSize: 1024, shadowRadius: 2, groundTile: 256, maxAnisotropy: 4, richScenery: false },
  medium: { pixelRatioCap: PIXEL_RATIO_CAP, shadowMapSize: 2048, shadowRadius: 3, groundTile: 512, maxAnisotropy: 8, richScenery: true },
  // Twice the texels, so a wider radius in texels keeps the edge soft.
  high: { pixelRatioCap: PIXEL_RATIO_CAP, shadowMapSize: 4096, shadowRadius: 4, groundTile: 512, maxAnisotropy: 16, richScenery: true },
};

/** What every device had before the tiers: a 2048² map at radius 3, the GPU's full anisotropy. */
const AUTO_SHADOW_MAP_SIZE = 2048;
const AUTO_SHADOW_RADIUS = 3;

export function isPhone(input: Pick<QualityInput, 'coarsePointer' | 'screenShortSide'>): boolean {
  return input.coarsePointer && input.screenShortSide > 0 && input.screenShortSide <= PHONE_MAX_SHORT_SIDE;
}

/** Phones low, other touch devices medium, everything with a mouse high. */
export function autoTier(input: Pick<QualityInput, 'coarsePointer' | 'screenShortSide'>): QualityTier {
  if (isPhone(input)) return 'low';
  return input.coarsePointer ? 'medium' : 'high';
}

/**
 * The settings for `choice` on this device. Auto takes the device's tier for
 * the pixel ratio, ground tiles and scenery, and the pre-tier shadow map and
 * anisotropy on every device.
 */
export function qualityProfile(input: QualityInput, choice: QualityChoice = 'auto'): QualityProfile {
  const tier = choice === 'auto' ? autoTier(input) : choice;
  const { pixelRatioCap, ...settings } = TIERS[tier];
  const dpr = input.devicePixelRatio > 0 ? input.devicePixelRatio : 1;
  const profile = { tier, pixelRatio: Math.min(dpr, pixelRatioCap), ...settings };
  if (choice !== 'auto') return profile;
  return { ...profile, shadowMapSize: AUTO_SHADOW_MAP_SIZE, shadowRadius: AUTO_SHADOW_RADIUS, maxAnisotropy: Infinity };
}

const CHOICE_KEY = 'render-quality';

/** The saved choice; anything unreadable is `auto`. */
export function loadQualityChoice(storage?: Storage): QualityChoice {
  const saved = safeGetItem(CHOICE_KEY, storage);
  return QUALITY_CHOICES.find((choice) => choice === saved) ?? 'auto';
}

export function saveQualityChoice(choice: QualityChoice, storage?: Storage): void {
  safeSetItem(CHOICE_KEY, choice, storage);
}
