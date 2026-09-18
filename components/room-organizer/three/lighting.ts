import { removeAndDispose } from './builder-utils';
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

/**
 * Base scene lights, tagged so `applyTimeOfDay` below can find and re-drive
 * them — this module owns both ends of the `light:*` tag protocol.
 */
export function addLights(THREE: ThreeModule, scene: ThreeNS.Scene): void {
  // Hemisphere fill gives the bright sky / warm ground bounce a suburban lot
  // reads with — without it everything in shadow goes flat-grey.
  const hemi = new THREE.HemisphereLight(0xbfe5ff, 0xa07a48, 0.55);
  hemi.userData.type = LIGHTING_TAGS.Hemisphere;
  scene.add(hemi);

  const ambient = new THREE.AmbientLight(0xffffff, 0.45);
  ambient.userData.type = LIGHTING_TAGS.Ambient;
  scene.add(ambient);

  const directional = new THREE.DirectionalLight(0xfff4d1, 1.05);
  directional.position.set(7, 14, 6);
  directional.castShadow = true;
  // Frustum large enough to cover the lot + the outdoor perimeter so trees
  // and the room walls all cast contact shadows on the grass.
  const shadowExtent = 24;
  directional.shadow.camera.left = -shadowExtent;
  directional.shadow.camera.right = shadowExtent;
  directional.shadow.camera.top = shadowExtent;
  directional.shadow.camera.bottom = -shadowExtent;
  directional.shadow.camera.near = 1;
  directional.shadow.camera.far = 60;
  directional.shadow.mapSize.set(2048, 2048);
  directional.shadow.bias = -0.0005;
  directional.userData.type = LIGHTING_TAGS.Directional;
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

export interface LampPosition {
  x: number;
  z: number;
  height: number;
}

/**
 * Apply a continuous time-of-day to the scene's lighting. Sun rises in the
 * east at hour 6, peaks at hour 12, sets in the west at hour 18; nighttime
 * (18..6) dims the sky and triggers warm point lights at every placed lamp.
 */
export function applyTimeOfDay(
  THREE: ThreeModule,
  scene: ThreeNS.Scene,
  hour: number,
  lampPositions: ReadonlyArray<LampPosition>
): void {
  const time = ((hour % 24) + 24) % 24;
  const profile = computeSkyProfile(time);

  // Vertical sky gradient (zenith → horizon) instead of a flat colour. The
  // texture is screen-space, so it reads as atmosphere without a sky dome.
  const previousBackground = scene.background;
  scene.background = makeSkyGradientTexture(THREE, profile.backgroundTop, profile.background);
  updateNightSky(THREE, scene, computeNightSky(time));
  if (previousBackground && (previousBackground as ThreeNS.Texture).isTexture) {
    (previousBackground as ThreeNS.Texture).dispose();
  }
  // Scale image-based lighting with the ambient profile so the environment
  // map brightens days without washing out nights (0.18 night .. 0.65 noon).
  scene.environmentIntensity = profile.ambient.intensity * 0.9;

  for (const obj of scene.children) {
    const tag = obj.userData.type as string | undefined;
    if (tag === LIGHTING_TAGS.Ambient) {
      const light = obj as ThreeNS.AmbientLight;
      light.color = new THREE.Color(profile.ambient.color);
      light.intensity = profile.ambient.intensity;
    } else if (tag === LIGHTING_TAGS.Directional) {
      const light = obj as ThreeNS.DirectionalLight;
      light.color = new THREE.Color(profile.sun.color);
      light.intensity = profile.sun.intensity;
      light.position.set(profile.sun.position[0], profile.sun.position[1], profile.sun.position[2]);
    }
  }

  // Replace any prior lamp point-lights with a fresh set for the current time.
  scene.children
    .filter((obj) => obj.userData.type === LIGHTING_TAGS.Lamp)
    .forEach((obj) => removeAndDispose(scene, obj));

  const nightFactor = nightIntensity(time);
  if (nightFactor > 0 && lampPositions.length > 0) {
    const color = 0xffd180;
    const baseIntensity = 1.6;
    const distance = 6;
    for (const lamp of lampPositions) {
      const point = new THREE.PointLight(color, baseIntensity * nightFactor, distance, 2);
      point.position.set(lamp.x, lamp.height, lamp.z);
      point.userData.type = LIGHTING_TAGS.Lamp;
      scene.add(point);
    }
  }
}

interface SkyProfile {
  ambient: { color: number; intensity: number };
  sun: { color: number; intensity: number; position: readonly [number, number, number] };
  /** Horizon colour (bottom of the sky gradient). */
  background: number;
  /** Zenith colour (top of the sky gradient). */
  backgroundTop: number;
}

/**
 * Smoothly interpolate sky colour, sun position, and intensities for a
 * given hour. The math is deliberately readable — it isn't physically
 * accurate, but the result reads as a coherent day/night cycle.
 */
export function computeSkyProfile(hour: number): SkyProfile {
  const dayFraction = clamp01((hour - 6) / 12); // 0 at 06:00, 1 at 18:00
  const sunAboveHorizon = hour >= 6 && hour <= 18;

  // Sun arcs across the sky from east (-x) to west (+x), peaking at y.
  const azimuth = (dayFraction - 0.5) * Math.PI; // -π/2..π/2
  const elevation = sunAboveHorizon ? Math.sin(dayFraction * Math.PI) : 0;
  const sunDistance = 10;
  const position: [number, number, number] = [
    Math.sin(azimuth) * sunDistance,
    elevation * sunDistance + 1,
    Math.cos(azimuth) * sunDistance * 0.5,
  ];

  // Warmth: high at sunrise/sunset, low at noon (white) and night (cool blue).
  const warmth = sunAboveHorizon
    ? Math.pow(1 - Math.abs(dayFraction - 0.5) * 2, 2) // peaks at 06 and 18
    : 0;
  const noonness = sunAboveHorizon ? Math.sin(dayFraction * Math.PI) : 0;

  const sunColor = mixHex(0xffffff, 0xff8a50, warmth * 0.7);
  const sunIntensity = sunAboveHorizon ? 0.2 + noonness * 0.7 : 0;

  const nightAmbient = mixHex(0x6a7fb7, 0x12172e, 1 - clamp01(elevation * 3));
  const dayAmbient = mixHex(0xffd29a, 0xffffff, noonness);
  const ambientColor = sunAboveHorizon ? dayAmbient : nightAmbient;
  const ambientIntensity = sunAboveHorizon ? 0.35 + noonness * 0.3 : 0.18;

  // Horizon (bottom) and zenith (top) pairs per phase. The zenith is always
  // deeper/more saturated than the horizon, which is what makes a sky read
  // as a sky instead of a flat backdrop.
  const horizonNight = 0x1a1f3a;
  const horizonDay = 0xdceefb;
  const horizonDusk = 0xfdd9b0;
  const zenithNight = 0x0a0e22;
  const zenithDay = 0x5d9fe2;
  const zenithDusk = 0x8478c0;
  let background = horizonNight;
  let backgroundTop = zenithNight;
  if (sunAboveHorizon) {
    background = mixHex(horizonDusk, horizonDay, noonness);
    backgroundTop = mixHex(zenithDusk, zenithDay, noonness);
  } else {
    // Twilight glow keyed on the distance to the NEAREST sun event: fades
    // out over 18..22, holds full night 22..02, lifts 02..06, and meets the
    // day branch's full-dusk colour exactly at 06:00/18:00 so there's no
    // snap at the horizon. The old expression used `hour` — time since
    // midnight, not distance to dawn — which made midnight the brightest
    // point of the night and skipped the post-dusk fade entirely (#145).
    const hoursFromSun = hour < 6 ? 6 - hour : hour - 18;
    const glow = clamp01(1 - hoursFromSun / 4);
    background = mixHex(horizonNight, horizonDusk, glow);
    backgroundTop = mixHex(zenithNight, zenithDusk, glow);
  }

  return {
    ambient: { color: ambientColor, intensity: ambientIntensity },
    sun: { color: sunColor, intensity: sunIntensity, position },
    background,
    backgroundTop,
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

function nightIntensity(hour: number): number {
  if (hour >= 6 && hour <= 18) return 0;
  if (hour < 6) return clamp01((6 - hour) / 6);
  return clamp01((hour - 18) / 6);
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
