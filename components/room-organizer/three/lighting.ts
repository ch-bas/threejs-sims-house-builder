import { LAMP_POOL_SIZE, type LampPoolPlan } from '../lib/night-lights';
import { fitSunShadow, type ShadowBox, type SunShadowFit, type Vec3 } from '../lib/sun-shadow';
import { disposeScene } from './builder-utils';
import { applyOutdoorWeather } from './outdoor';
import { applyOutdoorLampMask, setOutdoorLampMaskLive } from './outdoor-lamps';
import { SKY_RADIUS, followCamera, mulberry32, updateSky } from './sky';
import type { Weather } from '../lib/types';
import type * as ThreeNS from 'three';

type ThreeModule = typeof import('./three-runtime');

const LIGHTING_TAGS = {
  Ambient: 'light:ambient',
  Directional: 'light:directional',
  Hemisphere: 'light:hemi',
  LampPool: 'light:lamp-pool',
  Halos: 'light:halos',
  Stars: 'sky:stars',
  Moon: 'sky:moon',
} as const;

/** The scene's image-based light, which a lost GPU context takes with it (#663). */
export interface SceneEnvironment {
  /**
   * Bake it again, after a context restore: the old target's texels died
   * with the context. The old target is dropped, not disposed: its GL
   * objects went with the context, and deleting them on the new one only
   * logs INVALID_OPERATION.
   */
  rebake(): void;
  dispose(): void;
}

/**
 * Light `scene` from what `bake` renders, and keep the target to bake again.
 * A render target is drawn, not uploaded, so three can't restore it with the
 * context; without a fresh bake `scene.environment` points at an empty
 * texture and every material renders dark.
 */
export function installEnvironment(scene: ThreeNS.Scene, bake: () => ThreeNS.WebGLRenderTarget): SceneEnvironment {
  let target = bake();
  scene.environment = target.texture;
  return {
    rebake() {
      target = bake();
      scene.environment = target.texture;
    },
    dispose() {
      scene.environment = null;
      // The render target, not just its texture: its framebuffer is GPU memory too.
      target.dispose();
    },
  };
}

/** The neutral studio environment, prefiltered for `renderer`. */
export function bakeStudioEnvironment(
  THREE: ThreeModule,
  renderer: ThreeNS.WebGLRenderer,
  RoomEnvironment: new () => ThreeNS.Scene
): ThreeNS.WebGLRenderTarget {
  const pmrem = new THREE.PMREMGenerator(renderer);
  const studio = new RoomEnvironment();
  const target = pmrem.fromScene(studio, 0.04);
  pmrem.dispose();
  // The studio scene's own meshes are only needed for the bake (#213).
  disposeScene(studio);
  return target;
}

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

  const ambient = new THREE.AmbientLight(0xffffff, NOON_AMBIENT);
  ambient.userData.type = LIGHTING_TAGS.Ambient;
  scene.add(ambient);

  const directional = new THREE.DirectionalLight(0xfff4d1, NOON_SUN);
  directional.castShadow = true;
  directional.shadow.mapSize.set(2048, 2048);
  directional.shadow.bias = -0.0005;
  // `normalBias` offsets the lookup along the normal, set by `placeSun`: with
  // the fitted frustum and the PCF blur, walls otherwise speckle with
  // self-shadow acne (#379).
  // PCFShadowMap blurs over `radius` shadow-map texels (#379).
  directional.shadow.radius = 3;
  directional.userData.type = LIGHTING_TAGS.Directional;
  // The target only feeds the light's direction and shadow camera; it never
  // renders, so it stays out of the scene graph and is updated by hand.
  placeSun(directional, fitSunShadow([7, 14, 6], DEFAULT_SHADOW_BOX));
  scene.add(directional);

  // The lamps' fixed pool of point lights (#393), hidden until a lamp lights.
  const pool = new THREE.Group();
  pool.userData.type = LIGHTING_TAGS.LampPool;
  pool.visible = false;
  for (let i = 0; i < LAMP_POOL_SIZE; i++) pool.add(new THREE.PointLight(LAMP_COLOR, 0, 1, 2));
  // After the lights, whose order is the slots'. In the pool, so it shows and
  // pre-warms along with it.
  if (typeof document !== 'undefined') pool.add(makeLampHalos(THREE));
  scene.add(pool);
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
  weather: Weather = 'clear',
  shadowBox: ShadowBox = DEFAULT_SHADOW_BOX
): void {
  const time = ((hour % 24) + 24) % 24;
  const profile = computeSkyProfile(time, weather);
  applyOutdoorWeather(scene, weather);

  updateSky(THREE, scene, profile, weather);
  updateNightSky(THREE, scene, computeNightSky(time));
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
      obj.userData.sky = profile.hemisphere;
      applyIndoorFill(scene, (scene.userData[FILL_KEY] as number | undefined) ?? 0);
    } else if (tag === LIGHTING_TAGS.Directional) {
      const light = obj as ThreeNS.DirectionalLight;
      light.color.setHex(profile.sun.color);
      light.intensity = profile.sun.intensity;
      placeSun(light, fitSunShadow(profile.sun.position, shadowBox));
    }
  }
}

const LAMP_COLOR = 0xffd180;

function lampPool(scene: ThreeNS.Scene): ThreeNS.Group | undefined {
  return scene.children.find((obj) => obj.userData.type === LIGHTING_TAGS.LampPool) as ThreeNS.Group | undefined;
}

/**
 * Point the lamp pool at the lamps `plan` picked (#393). The pool is drawn
 * only while a lamp is lit, so by day the shaders carry no point lights at
 * all; its size never changes, so placing or deleting a lamp never
 * recompiles them. Point lights cast no shadows: the shadow map stays.
 */
export function applyLampPool(scene: ThreeNS.Scene, plan: LampPoolPlan): void {
  const pool = lampPool(scene);
  if (!pool) return;
  pool.visible = plan.lit;
  applyOutdoorLampMask(plan);
  pool.children.forEach((child, index) => {
    const light = child as ThreeNS.PointLight;
    const slot = plan.slots[index];
    if (!slot) return;
    light.position.set(slot.x, slot.y, slot.z);
    light.intensity = slot.intensity;
    light.distance = slot.distance;
  });
  placeLampHalos(pool, plan);
}

/** The halo's width per metre of the lamp's reach: a street lamp's is the wider. */
const HALO_SIZE_PER_RANGE = 0.17;
/** Additive, so this is about how far it lifts the air next to the bulb. */
const HALO_OPACITY = 0.55;

/** One soft sprite per pool slot, sharing a material and a texture (#759). */
function makeLampHalos(THREE: ThreeModule): ThreeNS.Group {
  const halos = new THREE.Group();
  halos.userData.type = LIGHTING_TAGS.Halos;
  const material = new THREE.SpriteMaterial({
    map: makeHaloTexture(THREE),
    color: LAMP_COLOR,
    blending: THREE.AdditiveBlending,
    transparent: true,
    opacity: 0,
    depthWrite: false,
  });
  for (let i = 0; i < LAMP_POOL_SIZE; i++) {
    const halo = new THREE.Sprite(material);
    halo.visible = false;
    halos.add(halo);
  }
  return halos;
}

function placeLampHalos(pool: ThreeNS.Group, plan: LampPoolPlan): void {
  const halos = pool.children.find((child) => child.userData.type === LIGHTING_TAGS.Halos);
  if (!halos) return;
  let brightest = 0;
  halos.children.forEach((child, index) => {
    const slot = plan.slots[index];
    child.visible = slot !== undefined && slot.intensity > 0;
    if (!slot || !child.visible) return;
    child.position.set(slot.x, slot.y, slot.z);
    child.scale.setScalar(slot.distance * HALO_SIZE_PER_RANGE);
    brightest = Math.max(brightest, slot.level);
  });
  const first = halos.children[0] as ThreeNS.Sprite | undefined;
  if (first) first.material.opacity = brightest * HALO_OPACITY;
}

function makeHaloTexture(THREE: ThreeModule): ThreeNS.CanvasTexture {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const glow = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  glow.addColorStop(0, 'rgba(255, 255, 255, 1)');
  glow.addColorStop(0.25, 'rgba(255, 255, 255, 0.4)');
  glow.addColorStop(1, 'rgba(255, 255, 255, 0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, size, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/** The warm bounce of a lit room, the colours its walls throw back. */
const ROOM_BOUNCE_SKY = 0xffdcb0;
const ROOM_BOUNCE_GROUND = 0xb08050;
/** Hemisphere intensity of a fully lit room. */
const ROOM_BOUNCE = 1.6;
const FILL_KEY = 'indoorFill';

/**
 * Bounce light for a walker inside a lit room (#759): with no bounce, anything
 * turned from a lamp was black beside a bright wall. 0 is the plain sky fill,
 * and the orbit view always stays there. No light added: it leans the
 * hemisphere over, and `applyTimeOfDay` keeps it through an hour step.
 */
export function applyIndoorFill(scene: ThreeNS.Scene, fill: number): void {
  scene.userData[FILL_KEY] = fill;
  const hemisphere = scene.children.find((obj) => obj.userData.type === LIGHTING_TAGS.Hemisphere) as ThreeNS.HemisphereLight | undefined;
  const sky = hemisphere?.userData.sky as SkyProfile['hemisphere'] | undefined;
  if (!hemisphere || !sky) return;
  hemisphere.color.setHex(mixHex(sky.sky, ROOM_BOUNCE_SKY, fill));
  hemisphere.groundColor.setHex(mixHex(sky.ground, ROOM_BOUNCE_GROUND, fill));
  hemisphere.intensity = sky.intensity + (ROOM_BOUNCE - sky.intensity) * fill;
}

/**
 * Compile the night (pool lit) shader variants ahead of dusk, so the first
 * lamp-lit frame doesn't stall on shader compilation (#393). Each material
 * keeps both variants, so switching between day and night afterwards only
 * swaps programs. A no-op while the pool is already drawn.
 */
export function prewarmLampPool(renderer: ThreeNS.WebGLRenderer, scene: ThreeNS.Scene, camera: ThreeNS.Camera): void {
  const pool = lampPool(scene);
  if (!pool || pool.visible) return;
  pool.visible = true;
  // The outdoor materials' night programs carry the lamp mask (#664).
  setOutdoorLampMaskLive(true);
  try {
    renderer.compile(scene, camera);
  } finally {
    pool.visible = false;
    setOutdoorLampMaskLive(false);
  }
}

/** Hours before the lamps start in which the lamp pool's shaders are compiled. */
const LAMP_PREWARM_HOURS = 3;

/** Whether `hour` is in the stretch of afternoon that pre-warms the lamps' shaders. */
export function isLampPrewarmHour(hour: number): boolean {
  const time = ((hour % 24) + 24) % 24;
  const lampsOn = 18 - LAMPS_EARLY_HOURS;
  return time >= lampsOn - LAMP_PREWARM_HOURS && time <= lampsOn;
}

/**
 * Size the sun's shadow map for the quality tier (#760). A new size frees the
 * old map, and three makes the next one on the next shadow pass, which the
 * caller requests. No-op when nothing changes.
 */
export function applyShadowQuality(scene: ThreeNS.Scene, mapSize: number, radius: number): boolean {
  const light = scene.children.find((obj) => obj.userData.type === LIGHTING_TAGS.Directional) as ThreeNS.DirectionalLight | undefined;
  if (!light) return false;
  const { shadow } = light;
  if (shadow.mapSize.width === mapSize && shadow.radius === radius) return false;
  shadow.radius = radius;
  shadow.mapSize.set(mapSize, mapSize);
  shadow.map?.dispose();
  shadow.map = null;
  shadow.normalBias = shadowNormalBias(shadow.camera.right - shadow.camera.left, mapSize);
  return true;
}

/** The normal offset of a shadow lookup, floored for small lots. */
const MIN_NORMAL_BIAS = 0.03;
/** ...and in shadow-map texels: a fitted frustum sets how coarse those are. */
const NORMAL_BIAS_TEXELS = 2.5;

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
  // The PCF blur reaches `radius` texels, and on a slope facing away from a
  // low sun or moon that is further than the fixed offset lifts it: acne.
  light.shadow.normalBias = shadowNormalBias(fit.right - fit.left, light.shadow.mapSize.width);
}

/** The normal offset for a shadow frustum `span` metres wide on a `mapSize` map. */
export function shadowNormalBias(span: number, mapSize: number): number {
  return Math.max(MIN_NORMAL_BIAS, (span / mapSize) * NORMAL_BIAS_TEXELS);
}

export interface SkyProfile {
  ambient: { color: number; intensity: number };
  hemisphere: { sky: number; ground: number; intensity: number };
  /**
   * The one directional light: the sun by day, the moon once twilight is over.
   * `position` is a direction toward it; its length is meaningless.
   */
  sun: { color: number; intensity: number; position: Vec3 };
  /**
   * Toward the sun itself, for the sky's disc and glow (#761): the light's
   * `position` is lifted so a low sun still rakes the lot, which would hang
   * the disc high in the sky at twilight. Under the horizon outside the day.
   */
  sunDisc: Vec3;
  /** `scene.environmentIntensity` for the neutral studio IBL. */
  environment: number;
  /** Horizon colour (bottom of the sky gradient). */
  background: number;
  /** Zenith colour (top of the sky gradient). */
  backgroundTop: number;
  /** 0..1 share of each lamp's full night intensity. */
  lamps: number;
  /** 0 while the sun is up, rising to 1 over twilight. */
  twilight: number;
}

/**
 * How each weather overcasts the clear-sky profile (#189). `grey` is how far
 * the sky colours pull toward their own luminance (a flat, washed sky), and
 * `lift` scales them after — under 1 for a dark rain sky, over 1 for the
 * bright white-out of a snow sky. Cloud cover softens shadows by taking the
 * sun down much further than the fill: `dayFill` holds the omnidirectional
 * light near its clear level, so the lot doesn't go dark. `nightFill` is the
 * same scale once twilight is over.
 */
const OVERCAST: Record<Exclude<Weather, 'clear'>, { grey: number; lift: number; sun: number; dayFill: number; nightFill: number }> = {
  rain: { grey: 0.6, lift: 0.9, sun: 0.35, dayFill: 0.95, nightFill: 0.85 },
  snow: { grey: 0.55, lift: 1.08, sun: 0.45, dayFill: 1, nightFill: 1 },
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
  const fillScale = cast.nightFill + (cast.dayFill - cast.nightFill) * (1 - clear.twilight);
  return {
    ...clear,
    ambient: { color: clear.ambient.color, intensity: clear.ambient.intensity * fillScale },
    environment: clear.environment * fillScale,
    hemisphere: {
      sky: overcastHex(clear.hemisphere.sky, cast.grey, cast.lift),
      ground: clear.hemisphere.ground,
      intensity: clear.hemisphere.intensity * fillScale,
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
/** Lamps start this many hours before sunset and stay on as long after sunrise. */
const LAMPS_EARLY_HOURS = 1;
const DUSK_SUN = 0.85;
const NOON_SUN = 1.7;
/** Full moonlight, held from three hours after sunset to three before sunrise. */
const MOONLIGHT = 0.6;
const MOON_COLOR = 0xa9b9e6;
/** Lifts the arc's ends off the horizon, so a low sun still rakes the ground. */
const SUN_LOW_HEIGHT = 4;
const NIGHT_AMBIENT = 0.26;
const DUSK_AMBIENT = 0.38;
const NOON_AMBIENT = 0.45;
const NIGHT_HEMI = 0.14;
const DUSK_HEMI = 0.42;
const HEMI_NOON_INTENSITY = 0.37;
const NIGHT_ENVIRONMENT = 0.06;
const DUSK_ENVIRONMENT = 0.33;
const NOON_ENVIRONMENT = 0.4;
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
  const position: Vec3 = [Math.sin(azimuth) * 10, elevation * 10 + SUN_LOW_HEIGHT, Math.cos(azimuth) * 5];
  // The same arc unclamped and unlifted: the lift is the light's alone. At the
  // top it meets the light's direction.
  const arc = (hour - 6) / 12;
  const discAzimuth = (arc - 0.5) * Math.PI;
  const sunDisc: Vec3 = [
    Math.sin(discAzimuth) * 10,
    Math.sin(arc * Math.PI) * (10 + SUN_LOW_HEIGHT),
    Math.cos(discAzimuth) * 5,
  ];

  // Warmth: high at sunrise/sunset, low at noon (white); the afterglow keeps it.
  const warmth = sunAboveHorizon ? Math.pow(Math.abs(dayFraction - 0.5) * 2, 2) : 1;
  const noonness = sunAboveHorizon ? Math.sin(dayFraction * Math.PI) : 0;

  const sunColor = mixHex(0xffffff, 0xffb27a, warmth * 0.75);
  const sunIntensity = sunAboveHorizon ? DUSK_SUN + noonness * (NOON_SUN - DUSK_SUN) : DUSK_SUN * daylight;
  // The moon takes the light over only after the sun has faded to nothing, so
  // the swap of direction and colour never shows.
  const moonUp = !sunAboveHorizon && hoursFromSun > TWILIGHT_HOURS;
  const moonlight = moonUp ? smoothstep01(hoursFromSun / TWILIGHT_HOURS - 1) : 0;

  const dayAmbient = mixHex(0xffd29a, 0xffffff, noonness);
  // Dusk blue deepening to moonlit navy as the glow goes.
  const nightAmbient = mixHex(NIGHT_AMBIENT_COLOR, 0x6a7fb7, glow);
  const ambientColor = sunAboveHorizon ? dayAmbient : mixHex(nightAmbient, 0xffd29a, daylight);
  // Each fill rests at its night level, reaches its dusk level at the sun
  // events and its noon level at the top of the arc. It fades twice as slowly
  // as the sun, past the moon's rise, so no hour is darker than midnight.
  const fillFade = smoothstep01(1 - hoursFromSun / (TWILIGHT_HOURS * 2));
  const fill = (night: number, dusk: number, noon: number): number =>
    sunAboveHorizon ? dusk + noonness * (noon - dusk) : night + (dusk - night) * fillFade;
  // Past sunset is positive; the lamps lead it, for a room the low sun has left.
  const hoursPastSunset = hour < 12 ? 6 - hour : hour - 18;

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
    ambient: { color: ambientColor, intensity: fill(NIGHT_AMBIENT, DUSK_AMBIENT, NOON_AMBIENT) },
    hemisphere: {
      sky: hemiSky,
      ground: mixHex(NIGHT_HEMI_GROUND, 0xa07a48, daylight),
      intensity: fill(NIGHT_HEMI, DUSK_HEMI, HEMI_NOON_INTENSITY),
    },
    sun: moonUp
      ? { color: MOON_COLOR, intensity: MOONLIGHT * moonlight, position: moonDirection(hour) }
      : { color: sunColor, intensity: sunIntensity, position },
    sunDisc,
    // The studio environment is white and bright: it drops to almost nothing
    // through twilight, or it keeps the night lot lit grey-green (#375).
    environment: fill(NIGHT_ENVIRONMENT, DUSK_ENVIRONMENT, NOON_ENVIRONMENT),
    background,
    backgroundTop,
    lamps: smoothstep01((hoursPastSunset + LAMPS_EARLY_HOURS) / (TWILIGHT_HOURS + LAMPS_EARLY_HOURS)),
    twilight: sunAboveHorizon ? 0 : 1 - daylight,
  };
}

/** Toward the moon: high enough to throw a shadow, on the sprite's north side. */
function moonDirection(hour: number): Vec3 {
  const t = computeNightSky(hour).moonT ?? 0.5;
  const azimuth = (t - 0.5) * Math.PI;
  return [Math.sin(azimuth) * 10, Math.sin(t * Math.PI) * 6 + 6, -Math.cos(azimuth) * 8];
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
 * Star/moon parameters for the sky (#182). Pure — the drawing lives in
 * updateNightSky; this is the testable half. Keyed on the same
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

const STAR_COUNT = 350;
const STAR_SEED = 20260918;

/**
 * World-space night sky (#182): a Points starfield on a distant upper dome
 * and a billboarded moon sprite arcing east→west across the night. Created
 * lazily once, then only opacity/position are driven per time change.
 *
 * These are real scene objects rather than pixels in the background texture:
 * the backdrop is screen-space and stretched to the viewport, which smeared
 * 1px stars into blurry rectangles and distorted the moon — and it pinned
 * the moon to a fixed screen band regardless of camera tilt. Points with
 * sizeAttenuation off stay pixel-crisp at any resolution, and the sky turns
 * with the camera while staying at infinity (`followCamera`).
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
    followCamera(stars);
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
    followCamera(bright);
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
    followCamera(moon);
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
    // Relative to the camera (`followCamera`). The orbit lens shows about 12°
    // above the horizon at its lowest tilt (ORBIT_MAX_POLAR), so the arc stays
    // 5° to 8° up, hanging over the treeline. A tilt above that leaves the
    // sky out of frame, as it does for any view looking down at the lot.
    const arcRadius = 100;
    moon.position.set(
      Math.sin(azimuth) * arcRadius,
      8 + elevation * 6,
      -Math.cos(azimuth) * arcRadius
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
