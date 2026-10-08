import { fitSunShadow, type ShadowBox, type SunShadowFit, type Vec3 } from '../lib/sun-shadow';
import { removeAndDispose } from './builder-utils';
import { applyOutdoorWeather } from './outdoor';
import type { LampLight } from '../lib/night-lights';
import type { Weather } from '../lib/types';
import type * as ThreeNS from 'three';

type ThreeModule = typeof import('three');

export const LIGHTING_TAGS = {
  Ambient: 'light:ambient',
  Directional: 'light:directional',
  Hemisphere: 'light:hemi',
  Lamp: 'light:lamp',
  Stars: 'sky:stars',
  Moon: 'sky:moon',
} as const;

/** Shadow casters before the first layout-driven fit: the lot of the default house. */
const DEFAULT_SHADOW_BOX: ShadowBox = { min: [-24, 0, -24], max: [24, 12, 24] };

/**
 * Base scene lights, tagged so `applyTimeOfDay` below can find and re-drive
 * them — this module owns both ends of the `light:*` tag protocol.
 */
export function addLights(THREE: ThreeModule, scene: ThreeNS.Scene): void {
  // Hemisphere fill gives the bright sky / warm ground bounce a suburban lot
  // reads with — without it everything in shadow goes flat-grey.
  const hemi = new THREE.HemisphereLight(0xbfe5ff, 0xa07a48, HEMI_NOON_INTENSITY);
  hemi.userData.type = LIGHTING_TAGS.Hemisphere;
  scene.add(hemi);

  const ambient = new THREE.AmbientLight(0xffffff, 0.45);
  ambient.userData.type = LIGHTING_TAGS.Ambient;
  scene.add(ambient);

  const directional = new THREE.DirectionalLight(0xfff4d1, 1.05);
  directional.castShadow = true;
  directional.shadow.mapSize.set(2048, 2048);
  directional.shadow.bias = -0.0005;
  // PCFShadowMap blurs over `radius` shadow-map texels (#379).
  directional.shadow.radius = 3;
  directional.userData.type = LIGHTING_TAGS.Directional;
  // The target only feeds the light's direction and shadow camera; it never
  // renders, so it stays out of the scene graph and is updated by hand.
  placeSun(directional, fitSunShadow([7, 14, 6], DEFAULT_SHADOW_BOX));
  scene.add(directional);
}

/**
 * Hour-of-day presets, named for convenience. Continuous values are also
 * valid — the lighting helpers interpolate between dawn / noon / dusk /
 * midnight smoothly.
 */
export const TIME_PRESETS = {
  dawn: 6,
  noon: 12,
  dusk: 18,
  midnight: 22,
} as const;

export type TimePresetKey = keyof typeof TIME_PRESETS;

/**
 * Apply a continuous time-of-day to the scene's lighting. Sun rises in the
 * east at hour 6, peaks at hour 12, sets in the west at hour 18; the light
 * fades through twilight after it and the lamps come up as it goes. The
 * weather overcasts the same profile (#189), so rain and snow keep the sky,
 * sun, and ambient consistent along the whole hour ramp; 'clear' is the
 * profile untouched. `shadowBox` bounds the sun's shadow casters (#282).
 */
export function applyTimeOfDay(
  THREE: ThreeModule,
  scene: ThreeNS.Scene,
  hour: number,
  lamps: ReadonlyArray<LampLight>,
  weather: Weather = 'clear',
  shadowBox: ShadowBox = DEFAULT_SHADOW_BOX
): void {
  const time = ((hour % 24) + 24) % 24;
  const profile = computeSkyProfile(time, weather);
  applyOutdoorWeather(scene, weather);

  // Vertical sky gradient (zenith → horizon) instead of a flat colour. The
  // texture is screen-space, so it reads as atmosphere without a sky dome.
  const previousBackground = scene.background;
  scene.background = makeSkyGradientTexture(THREE, profile.backgroundTop, profile.background);
  updateNightSky(THREE, scene, computeNightSky(time));
  if (previousBackground && (previousBackground as ThreeNS.Texture).isTexture) {
    (previousBackground as ThreeNS.Texture).dispose();
  }
  scene.environmentIntensity = profile.environment;

  for (const obj of scene.children) {
    const tag = obj.userData.type as string | undefined;
    if (tag === LIGHTING_TAGS.Ambient) {
      const light = obj as ThreeNS.AmbientLight;
      light.color.setHex(profile.ambient.color);
      light.intensity = profile.ambient.intensity;
    } else if (tag === LIGHTING_TAGS.Hemisphere) {
      // Driven with the ambient, or it lit every night with a constant
      // sky-blue fill brighter than all the other lights together (#375).
      const light = obj as ThreeNS.HemisphereLight;
      light.color.setHex(profile.hemisphere.sky);
      light.groundColor.setHex(profile.hemisphere.ground);
      light.intensity = profile.hemisphere.intensity;
    } else if (tag === LIGHTING_TAGS.Directional) {
      const light = obj as ThreeNS.DirectionalLight;
      light.color.setHex(profile.sun.color);
      light.intensity = profile.sun.intensity;
      placeSun(light, fitSunShadow(profile.sun.position, shadowBox));
    }
  }

  syncLampLights(THREE, scene, lamps, profile.lamps);
}

/**
 * One PointLight per lamp, kept alive at intensity 0 by day (#393): three
 * keys its shader programs on the number of point lights, so creating them
 * at dusk recompiled every material variant on the first night frame. The
 * count only changes when a lamp is placed or removed.
 */
function syncLampLights(
  THREE: ThreeModule,
  scene: ThreeNS.Scene,
  lamps: ReadonlyArray<LampLight>,
  level: number
): void {
  const existing = scene.children.filter((obj) => obj.userData.type === LIGHTING_TAGS.Lamp) as ThreeNS.PointLight[];
  existing.slice(lamps.length).forEach((obj) => removeAndDispose(scene, obj));
  lamps.forEach((lamp, index) => {
    let point = existing[index];
    if (!point) {
      point = new THREE.PointLight(LAMP_COLOR, 0, lamp.range, 2);
      point.userData.type = LIGHTING_TAGS.Lamp;
      scene.add(point);
    }
    point.position.set(lamp.x, lamp.y, lamp.z);
    point.distance = lamp.range;
    point.intensity = lamp.candela * level;
  });
}

const LAMP_COLOR = 0xffd180;

function placeSun(light: ThreeNS.DirectionalLight, fit: SunShadowFit): void {
  light.position.set(fit.position[0], fit.position[1], fit.position[2]);
  light.target.position.set(fit.target[0], fit.target[1], fit.target[2]);
  light.target.updateMatrixWorld();
  const camera = light.shadow.camera;
  camera.left = fit.left;
  camera.right = fit.right;
  camera.top = fit.top;
  camera.bottom = fit.bottom;
  camera.near = fit.near;
  camera.far = fit.far;
  camera.updateProjectionMatrix();
}

export interface SkyProfile {
  ambient: { color: number; intensity: number };
  hemisphere: { sky: number; ground: number; intensity: number };
  /** `position` is a direction toward the sun; its length is meaningless. */
  sun: { color: number; intensity: number; position: Vec3 };
  /** `scene.environmentIntensity` for the neutral studio IBL. */
  environment: number;
  /** Horizon colour (bottom of the sky gradient). */
  background: number;
  /** Zenith colour (top of the sky gradient). */
  backgroundTop: number;
  /** 0..1 share of each lamp's full night intensity. */
  lamps: number;
}

/**
 * How each weather overcasts the clear-sky profile (#189). `grey` is how far
 * the sky colours pull toward their own luminance (a flat, washed sky), and
 * `lift` scales them after — under 1 for a dark rain sky, over 1 for the
 * bright white-out of a snow sky. Sun and ambient are plain multipliers:
 * cloud cover softens the sun most; rain also takes the ambient down a
 * touch, while fresh snow bounces enough light back to leave it alone.
 */
const OVERCAST: Record<Exclude<Weather, 'clear'>, { grey: number; lift: number; sun: number; ambient: number }> = {
  rain: { grey: 0.6, lift: 0.9, sun: 0.55, ambient: 0.85 },
  snow: { grey: 0.55, lift: 1.08, sun: 0.7, ambient: 1 },
};

/**
 * Smoothly interpolate sky colour, sun position, and intensities for a
 * given hour. The math is deliberately readable — it isn't physically
 * accurate, but the result reads as a coherent day/night cycle. With rain
 * or snow the same profile is overcast (see OVERCAST); 'clear' returns it
 * exactly as computed.
 */
export function computeSkyProfile(hour: number, weather: Weather = 'clear'): SkyProfile {
  const clear = computeClearSkyProfile(hour);
  if (weather === 'clear') return clear;
  const cast = OVERCAST[weather];
  return {
    ...clear,
    ambient: { color: clear.ambient.color, intensity: clear.ambient.intensity * cast.ambient },
    environment: clear.environment * cast.ambient,
    hemisphere: {
      sky: overcastHex(clear.hemisphere.sky, cast.grey, cast.lift),
      ground: clear.hemisphere.ground,
      intensity: clear.hemisphere.intensity * cast.ambient,
    },
    sun: { ...clear.sun, intensity: clear.sun.intensity * cast.sun },
    background: overcastHex(clear.background, cast.grey, cast.lift),
    backgroundTop: overcastHex(clear.backgroundTop, cast.grey, cast.lift),
  };
}

/** Pull a colour toward its own luminance by `grey`, then scale it by `lift`. */
function overcastHex(hex: number, grey: number, lift: number): number {
  const r = (hex >> 16) & 0xff;
  const g = (hex >> 8) & 0xff;
  const b = hex & 0xff;
  const luma = 0.3 * r + 0.59 * g + 0.11 * b;
  const channel = (value: number) => Math.max(0, Math.min(255, Math.round((value + (luma - value) * grey) * lift)));
  return (channel(r) << 16) | (channel(g) << 8) | channel(b);
}

/** Hours past sunset (and before sunrise) over which the light fades to full night (#215). */
const TWILIGHT_HOURS = 1.5;
const DUSK_SUN = 0.2;
const DUSK_AMBIENT = 0.35;
const NOON_AMBIENT = 0.65;
const NIGHT_AMBIENT = 0.14;
const HEMI_NOON_INTENSITY = 0.55;
const NIGHT_ENVIRONMENT_SHARE = 0.3;
/** Moonlit blues the night ambient and sky fill settle on. */
const NIGHT_AMBIENT_COLOR = 0x33447a;
const NIGHT_HEMI_SKY = 0x3a4a80;
const NIGHT_HEMI_GROUND = 0x241c14;

function computeClearSkyProfile(hour: number): SkyProfile {
  const dayFraction = clamp01((hour - 6) / 12); // 0 at 06:00, 1 at 18:00
  const sunAboveHorizon = hour >= 6 && hour <= 18;
  // Distance to the NEAREST sun event, 0 all day. Keyed on that rather than
  // on `hour`, so midnight is the darkest point of the night (#145).
  const hoursFromSun = sunAboveHorizon ? 0 : hour < 6 ? 6 - hour : hour - 18;
  // 1 while the sun is up, easing to 0 over twilight: the lights fade with
  // the sky instead of snapping at 06:00/18:00 (#215).
  const daylight = smoothstep01(1 - hoursFromSun / TWILIGHT_HOURS);
  // The slower sky glow: fades out over 18..22, lifts again 02..06.
  const glow = clamp01(1 - hoursFromSun / 4);

  // Sun arcs across the sky from east (-x) to west (+x), peaking at y.
  const azimuth = (dayFraction - 0.5) * Math.PI; // -π/2..π/2
  const elevation = sunAboveHorizon ? Math.sin(dayFraction * Math.PI) : 0;
  const position: Vec3 = [Math.sin(azimuth) * 10, elevation * 10 + 1, Math.cos(azimuth) * 5];

  // Warmth: high at sunrise/sunset, low at noon (white); the afterglow keeps it.
  const warmth = sunAboveHorizon ? Math.pow(1 - Math.abs(dayFraction - 0.5) * 2, 2) : 1;
  const noonness = sunAboveHorizon ? Math.sin(dayFraction * Math.PI) : 0;

  const sunColor = mixHex(0xffffff, 0xff8a50, warmth * 0.7);
  const sunIntensity = sunAboveHorizon ? DUSK_SUN + noonness * 0.7 : DUSK_SUN * daylight;

  const dayAmbient = mixHex(0xffd29a, 0xffffff, noonness);
  // Dusk blue deepening to moonlit navy as the glow goes.
  const nightAmbient = mixHex(NIGHT_AMBIENT_COLOR, 0x6a7fb7, glow);
  const ambientColor = sunAboveHorizon ? dayAmbient : mixHex(nightAmbient, 0xffd29a, daylight);
  const ambientIntensity = sunAboveHorizon
    ? DUSK_AMBIENT + noonness * (NOON_AMBIENT - DUSK_AMBIENT)
    : NIGHT_AMBIENT + (DUSK_AMBIENT - NIGHT_AMBIENT) * daylight;

  // Horizon (bottom) and zenith (top) pairs per phase. The zenith is always
  // deeper/more saturated than the horizon, which is what makes a sky read
  // as a sky instead of a flat backdrop.
  const horizonNight = 0x1a1f3a;
  const horizonDay = 0xdceefb;
  const horizonDusk = 0xfdd9b0;
  const zenithNight = 0x0a0e22;
  const zenithDay = 0x5d9fe2;
  const zenithDusk = 0x8478c0;
  let background: number;
  let backgroundTop: number;
  let hemiSky: number;
  if (sunAboveHorizon) {
    background = mixHex(horizonDusk, horizonDay, noonness);
    backgroundTop = mixHex(zenithDusk, zenithDay, noonness);
    hemiSky = mixHex(zenithDusk, 0xbfe5ff, noonness);
  } else {
    // Meets the day branch's full-dusk colours exactly at 06:00/18:00, so
    // there's no snap at the horizon (#145).
    background = mixHex(horizonNight, horizonDusk, glow);
    backgroundTop = mixHex(zenithNight, zenithDusk, glow);
    hemiSky = mixHex(NIGHT_HEMI_SKY, zenithDusk, glow);
  }

  return {
    ambient: { color: ambientColor, intensity: ambientIntensity },
    hemisphere: {
      sky: hemiSky,
      ground: mixHex(NIGHT_HEMI_GROUND, 0xa07a48, daylight),
      intensity: (HEMI_NOON_INTENSITY * ambientIntensity) / NOON_AMBIENT,
    },
    sun: { color: sunColor, intensity: sunIntensity, position },
    // The studio environment is white and bright: it follows the ambient by
    // day (0.585 at noon) and drops further through twilight, or it keeps
    // the night lot lit grey-green (#375).
    environment: ambientIntensity * 0.9 * (NIGHT_ENVIRONMENT_SHARE + (1 - NIGHT_ENVIRONMENT_SHARE) * daylight),
    background,
    backgroundTop,
    lamps: sunAboveHorizon ? 0 : 1 - daylight,
  };
}

export interface NightSky {
  /** 0..1 star visibility — 0 by day, ramping with darkness, full 22:00–02:00. */
  starAlpha: number;
  /** 0..1 moon visibility, slightly ahead of the stars so it leads the night. */
  moonAlpha: number;
  /** 0..1 progress along the night arc (rises ~19:00, peaks 00:00, sets ~05:00), or null when down. */
  moonT: number | null;
}

/**
 * Star/moon parameters for the sky backdrop (#182). Pure — the drawing lives
 * in makeSkyGradientTexture; this is the testable half. Keyed on the same
 * distance-to-sun-event ramp as the sky colours (#145) so stars fade exactly
 * as the twilight glow fades.
 */
export function computeNightSky(hour: number): NightSky {
  const time = ((hour % 24) + 24) % 24;
  const night = time < 6 || time > 18;
  if (!night) return { starAlpha: 0, moonAlpha: 0, moonT: null };
  const hoursFromSun = time < 6 ? 6 - time : time - 18;
  const starAlpha = clamp01(hoursFromSun / 4);
  const moonAlpha = clamp01(hoursFromSun / 2);
  // Night progress: 18:00 → 06:00 mapped to 0..1; the moon is up 19:00–05:00.
  const t = (time > 18 ? time - 18 : time + 6) / 12;
  const moonT = t > 1 / 12 && t < 11 / 12 ? (t - 1 / 12) / (10 / 12) : null;
  return { starAlpha, moonAlpha, moonT };
}

/**
 * 1×256 vertical-gradient CanvasTexture used as the screen-space scene
 * background. Rebuilt on every time-of-day change; the previous texture is
 * disposed by the caller.
 */
function makeSkyGradientTexture(
  THREE: ThreeModule,
  top: number,
  bottom: number
): ThreeNS.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 1;
  canvas.height = 256;
  const ctx = canvas.getContext('2d')!;
  const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
  gradient.addColorStop(0, hexToCss(top));
  // Bias the blend toward the horizon colour in the lower third so the
  // horizon glow sits where the ground line actually is on screen.
  gradient.addColorStop(0.65, hexToCss(mixHex(top, bottom, 0.7)));
  gradient.addColorStop(1, hexToCss(bottom));
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

const STAR_COUNT = 350;
const STAR_SEED = 20260918;
/** Radius of the star dome / moon arc — far beyond the lot, well inside the camera far plane. */
const SKY_RADIUS = 140;

/** Deterministic PRNG so the starfield is identical every session. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * World-space night sky (#182): a Points starfield on a distant upper dome
 * and a billboarded moon sprite arcing east→west across the night. Created
 * lazily once, then only opacity/position are driven per time change.
 *
 * These are real scene objects rather than pixels in the background texture:
 * the backdrop is screen-space and stretched to the viewport, which smeared
 * 1px stars into blurry rectangles and distorted the moon — and it pinned
 * the moon to a fixed screen band regardless of camera tilt. Points with
 * sizeAttenuation off stay pixel-crisp at any resolution and pick up real
 * parallax when the camera orbits.
 */
function updateNightSky(THREE: ThreeModule, scene: ThreeNS.Scene, night: NightSky): void {
  let stars = scene.children.find((obj) => obj.userData.type === LIGHTING_TAGS.Stars) as
    | ThreeNS.Points
    | undefined;
  if (!stars) {
    const rng = mulberry32(STAR_SEED);
    const positions = new Float32Array(STAR_COUNT * 3);
    for (let i = 0; i < STAR_COUNT; i++) {
      const azimuth = rng() * Math.PI * 2;
      // Upper dome only, kept a little above the horizon line.
      const elevation = Math.asin(0.06 + 0.94 * rng());
      positions[i * 3] = Math.cos(elevation) * Math.cos(azimuth) * SKY_RADIUS;
      positions[i * 3 + 1] = Math.sin(elevation) * SKY_RADIUS;
      positions[i * 3 + 2] = Math.cos(elevation) * Math.sin(azimuth) * SKY_RADIUS;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const material = new THREE.PointsMaterial({
      color: 0xdfe8ff,
      size: 2,
      sizeAttenuation: false,
      transparent: true,
      opacity: 0,
      depthWrite: false,
    });
    stars = new THREE.Points(geometry, material);
    stars.userData.type = LIGHTING_TAGS.Stars;
    // The dome surrounds the camera; its bounding sphere is centred far away
    // per-axis, so skip culling instead of fighting it.
    stars.frustumCulled = false;
    stars.renderOrder = -1;
    stars.matrixAutoUpdate = false;
    stars.updateMatrix();
    scene.add(stars);

    // A sparse second layer of larger, slightly warm stars gives the field
    // depth — one PointsMaterial has a single size, so brightness variety
    // needs a second draw call (still just two for the whole sky).
    const brightPositions = new Float32Array(60 * 3);
    for (let i = 0; i < 60; i++) {
      const azimuth = rng() * Math.PI * 2;
      const elevation = Math.asin(0.08 + 0.92 * rng());
      brightPositions[i * 3] = Math.cos(elevation) * Math.cos(azimuth) * SKY_RADIUS;
      brightPositions[i * 3 + 1] = Math.sin(elevation) * SKY_RADIUS;
      brightPositions[i * 3 + 2] = Math.cos(elevation) * Math.sin(azimuth) * SKY_RADIUS;
    }
    const brightGeometry = new THREE.BufferGeometry();
    brightGeometry.setAttribute('position', new THREE.BufferAttribute(brightPositions, 3));
    const bright = new THREE.Points(
      brightGeometry,
      new THREE.PointsMaterial({
        color: 0xfff4e0,
        size: 3.5,
        sizeAttenuation: false,
        transparent: true,
        opacity: 0,
        depthWrite: false,
      })
    );
    bright.userData.type = LIGHTING_TAGS.Stars;
    bright.frustumCulled = false;
    bright.renderOrder = -1;
    bright.matrixAutoUpdate = false;
    bright.updateMatrix();
    scene.add(bright);
  }
  for (const layer of scene.children.filter((obj) => obj.userData.type === LIGHTING_TAGS.Stars)) {
    ((layer as ThreeNS.Points).material as ThreeNS.PointsMaterial).opacity = night.starAlpha * 0.9;
    layer.visible = night.starAlpha > 0.01;
  }

  let moon = scene.children.find((obj) => obj.userData.type === LIGHTING_TAGS.Moon) as
    | ThreeNS.Sprite
    | undefined;
  if (!moon) {
    const material = new THREE.SpriteMaterial({
      map: makeMoonTexture(THREE),
      transparent: true,
      opacity: 0,
      depthWrite: false,
    });
    moon = new THREE.Sprite(material);
    // The disc occupies ~40% of the texture; 30 world units ≈ a 12-unit moon.
    moon.scale.set(26, 26, 1);
    moon.userData.type = LIGHTING_TAGS.Moon;
    moon.frustumCulled = false;
    moon.renderOrder = -1;
    scene.add(moon);
  }
  if (night.moonT === null || night.moonAlpha <= 0.01) {
    moon.visible = false;
  } else {
    moon.visible = true;
    (moon.material as ThreeNS.SpriteMaterial).opacity = night.moonAlpha;
    // Mirror the sun's east→west arc, but on the NORTH side (-z): the default
    // camera sits south of the lot looking north, so that's the visible sky.
    const azimuth = (night.moonT - 0.5) * Math.PI;
    const elevation = Math.sin(night.moonT * Math.PI);
    // Low, flat arc: the default iso camera looks slightly downward, so the
    // visible sky is a band just above the horizon — a high apex leaves the
    // frame entirely. Peak ≈ 40 world units at z −120 is ~13° up: prominent
    // in the default view and still natural when tilted or walking.
    // Hug the horizon: the iso camera's visible sky is a shallow band, so
    // even modest world heights project off the top of the frame (verified
    // empirically — y=30 at z=-50 hides behind the header bar). ~8° up at
    // ~110 units reads as a rising/hanging moon over the treeline.
    const arcRadius = 100;
    moon.position.set(
      Math.sin(azimuth) * arcRadius,
      8 + elevation * 16,
      -Math.cos(azimuth) * arcRadius - 10
    );
  }
}

/** 256px radial moon disc with soft glow and faint maria — rendered once. */
function makeMoonTexture(THREE: ThreeModule): ThreeNS.CanvasTexture {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const c = size / 2;
  const discRadius = size * 0.2;

  const glow = ctx.createRadialGradient(c, c, discRadius * 0.8, c, c, size * 0.5);
  glow.addColorStop(0, 'rgba(244, 241, 222, 0.45)');
  glow.addColorStop(1, 'rgba(244, 241, 222, 0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, size, size);

  ctx.fillStyle = '#f6f3e4';
  ctx.beginPath();
  ctx.arc(c, c, discRadius, 0, Math.PI * 2);
  ctx.fill();

  // Faint maria so the disc reads as a moon, not a lamp.
  ctx.fillStyle = 'rgba(118, 116, 98, 0.28)';
  for (const [dx, dy, r] of [[-16, -10, 12], [12, 8, 9], [-4, 20, 7], [18, -14, 5]] as const) {
    ctx.beginPath();
    ctx.arc(c + dx, c + dy, r, 0, Math.PI * 2);
    ctx.fill();
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function hexToCss(hex: number): string {
  return `#${hex.toString(16).padStart(6, '0')}`;
}

function smoothstep01(value: number): number {
  const t = clamp01(value);
  return t * t * (3 - 2 * t);
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function mixHex(a: number, b: number, t: number): number {
  const clamped = clamp01(t);
  const ar = (a >> 16) & 0xff;
  const ag = (a >> 8) & 0xff;
  const ab = a & 0xff;
  const br = (b >> 16) & 0xff;
  const bg = (b >> 8) & 0xff;
  const bb = b & 0xff;
  const r = Math.round(ar + (br - ar) * clamped);
  const g = Math.round(ag + (bg - ag) * clamped);
  const blue = Math.round(ab + (bb - ab) * clamped);
  return (r << 16) | (g << 8) | blue;
}
