import { removeAndDispose } from './builder-utils';
import type { SkyProfile } from './lighting';
import type { Weather } from '../lib/types';
import type * as ThreeNS from 'three';

type ThreeModule = typeof import('./three-runtime');

const SKY_TAGS = { Dome: 'sky:dome', Clouds: 'sky:clouds', Sun: 'sky:sun' } as const;

/** Radius of the sky around the camera: well inside the far plane. */
export const SKY_RADIUS = 140;

const DOME_SEGMENTS = 48;
const DOME_RINGS = 32;
/** The low tier's dome (#760): a quarter of the triangles, the sun's glow a little broader. */
const LEAN_DOME_SEGMENTS = 24;
const LEAN_DOME_RINGS = 12;
/** On the scene: whether the sky has its clouds and full dome, and what it was last painted with. */
const RICH_KEY = 'skyRich';
const PAINTED_KEY = 'skyPainted';
/** How fast the colour climbs from the horizon: under 1 keeps the pale band low. */
const HORIZON_FALLOFF = 0.55;
/** The sun's glow on the sky around it: tightness, and strength at full day. */
const SUN_GLOW_POWER = 10;
const SUN_GLOW = 0.35;
const CLOUD_SEED = 4177;
const SUN_DISTANCE = 120;
/** The sprite's texture holds the disc in its middle fifth, the rest is glare. */
const SUN_SPRITE_SIZE = 52;

/**
 * Keep a sky object centred on whichever camera draws it, however far out a
 * big house's framing stands: otherwise the dome ends up below the camera and
 * its stars draw over the lawn. Done per draw, on the object's world matrix, so
 * a camera move costs no rebuild and needs no invalidate of its own.
 */
export function followCamera(sky: ThreeNS.Object3D): void {
  sky.onBeforeRender = (_renderer, _scene, camera) => {
    const world = sky.matrixWorld.elements;
    world[12] = sky.position.x + camera.position.x;
    world[13] = sky.position.y + camera.position.y;
    world[14] = sky.position.z + camera.position.z;
  };
}

/** Parts a click and the shadow pass must never see, always drawn. */
function asSkyPart(part: ThreeNS.Object3D, tag: string, renderOrder: number): void {
  part.userData.type = tag;
  part.renderOrder = renderOrder;
  part.frustumCulled = false;
  part.raycast = () => undefined;
  followCamera(part);
}

function findTagged<T extends ThreeNS.Object3D>(scene: ThreeNS.Scene, tag: string): T | undefined {
  return scene.children.find((obj) => obj.userData.type === tag) as T | undefined;
}

function makeDome(THREE: ThreeModule, rich: boolean): ThreeNS.Mesh {
  const geometry = rich
    ? new THREE.SphereGeometry(SKY_RADIUS, DOME_SEGMENTS, DOME_RINGS)
    : new THREE.SphereGeometry(SKY_RADIUS, LEAN_DOME_SEGMENTS, LEAN_DOME_RINGS);
  const count = geometry.getAttribute('position').count;
  geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
  // Drawn first and behind everything; the colours are the swatches themselves.
  const material = new THREE.MeshBasicMaterial({
    vertexColors: true,
    side: THREE.BackSide,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  });
  const dome = new THREE.Mesh(geometry, material);
  asSkyPart(dome, SKY_TAGS.Dome, -10);
  return dome;
}

/**
 * Soft cumulus puffs on a transparent strip, low in the sky where the orbit
 * lens sees it. Blobs rather than noise: this runs on the main thread at the
 * first paint. The strip fades out before the horizon so no line shows.
 */
function makeCloudTexture(THREE: ThreeModule): ThreeNS.CanvasTexture | null {
  const width = 1536;
  const height = 384;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const random = mulberry32(CLOUD_SEED);
  const puff = (x: number, y: number, rx: number, ry: number, alpha: number) => {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(rx, ry);
    const blob = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
    blob.addColorStop(0, `rgba(255, 255, 255, ${alpha})`);
    blob.addColorStop(0.6, `rgba(255, 255, 255, ${alpha * 0.8})`);
    blob.addColorStop(1, 'rgba(255, 255, 255, 0)');
    ctx.fillStyle = blob;
    ctx.fillRect(-1, -1, 2, 2);
    ctx.restore();
  };
  for (let cloud = 0; cloud < 46; cloud += 1) {
    const x = random() * width;
    // Canvas y grows downward and the bottom row sits on the horizon.
    const y = height * (0.62 + random() * 0.32);
    const span = 50 + random() * 110;
    const puffs = 10 + Math.floor(random() * 9);
    for (let i = 0; i < puffs; i += 1) {
      const px = x + (random() - 0.5) * span;
      const py = y + (random() - 0.75) * span * 0.16;
      const r = span * (0.08 + random() * 0.1);
      // Wrapped, so the strip's seam never shows.
      for (const wrap of [-width, 0, width]) puff(px + wrap, py, r * 1.5, r * 0.7, 0.75);
    }
  }
  ctx.globalCompositeOperation = 'destination-out';
  const horizon = ctx.createLinearGradient(0, height * 0.88, 0, height);
  horizon.addColorStop(0, 'rgba(0, 0, 0, 0)');
  horizon.addColorStop(1, 'rgba(0, 0, 0, 1)');
  ctx.fillStyle = horizon;
  ctx.fillRect(0, height * 0.88, width, height * 0.12);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  return texture;
}

function makeClouds(THREE: ThreeModule): ThreeNS.Mesh {
  const geometry = new THREE.SphereGeometry(SKY_RADIUS * 0.96, DOME_SEGMENTS, 10, 0, Math.PI * 2, 0, Math.PI / 2);
  const material = new THREE.MeshBasicMaterial({
    map: makeCloudTexture(THREE),
    side: THREE.BackSide,
    transparent: true,
    depthWrite: false,
    toneMapped: false,
  });
  const clouds = new THREE.Mesh(geometry, material);
  // In front of the stars and moon, behind everything in the world.
  asSkyPart(clouds, SKY_TAGS.Clouds, -0.5);
  return clouds;
}

function makeSunDisc(THREE: ThreeModule): ThreeNS.Sprite {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const c = size / 2;
    const glare = ctx.createRadialGradient(c, c, 0, c, c, c);
    glare.addColorStop(0, 'rgba(255, 255, 255, 1)');
    glare.addColorStop(0.18, 'rgba(255, 255, 255, 1)');
    glare.addColorStop(0.24, 'rgba(255, 255, 255, 0.28)');
    glare.addColorStop(1, 'rgba(255, 255, 255, 0)');
    ctx.fillStyle = glare;
    ctx.fillRect(0, 0, size, size);
  }
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  const sun = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map,
      blending: THREE.AdditiveBlending,
      transparent: true,
      depthWrite: false,
      toneMapped: false,
    })
  );
  sun.scale.set(SUN_SPRITE_SIZE, SUN_SPRITE_SIZE, 1);
  asSkyPart(sun, SKY_TAGS.Sun, -1);
  return sun;
}

/**
 * The world-space sky (#761): a dome the camera can't leave, painted from the
 * profile, with clouds and a sun disc. It replaces a screen-space gradient that
 * put the horizon's colour at the bottom of the screen wherever the horizon
 * really was. Only colours are written per hour step, and nothing runs per
 * frame beyond the camera follow. All three stay out of the shadow pass.
 */
export function updateSky(THREE: ThreeModule, scene: ThreeNS.Scene, profile: SkyProfile, weather: Weather): void {
  scene.userData[PAINTED_KEY] = { profile, weather };
  const canDraw = typeof document !== 'undefined';
  const rich = scene.userData[RICH_KEY] !== false;
  let dome = findTagged<ThreeNS.Mesh>(scene, SKY_TAGS.Dome);
  if (!dome) {
    dome = makeDome(THREE, rich);
    scene.add(dome);
    if (canDraw) scene.add(makeSunDisc(THREE));
    if (canDraw && rich) scene.add(makeClouds(THREE));
  }
  paintDome(THREE, dome, profile);

  const daylight = 1 - profile.twilight;
  const overcast = weather !== 'clear';
  const clouds = findTagged<ThreeNS.Mesh>(scene, SKY_TAGS.Clouds);
  if (clouds) {
    const material = clouds.material as ThreeNS.MeshBasicMaterial;
    // White by day, borrowing the horizon as the light goes and greying under rain.
    material.color.setHex(profile.background).lerp(new THREE.Color(overcast ? 0xb4b9c0 : 0xffffff), 0.8 * daylight);
    material.opacity = (overcast ? 1 : 0.9) * (0.1 + 0.9 * daylight);
  }
  const sun = findTagged<ThreeNS.Sprite>(scene, SKY_TAGS.Sun);
  if (sun) {
    // Where the sun really is, not the raised light that rakes the lot.
    const [x, y, z] = profile.sunDisc;
    const length = Math.hypot(x, y, z) || 1;
    sun.position.set((x / length) * SUN_DISTANCE, (y / length) * SUN_DISTANCE, (z / length) * SUN_DISTANCE);
    sun.material.color.setHex(profile.sun.color);
    sun.material.opacity = overcast ? 0 : daylight;
    sun.visible = !overcast && daylight > 0.01;
  }
  // Under the dome, and what a PNG capture or a context restore clears to.
  if (scene.background && (scene.background as ThreeNS.Color).isColor) (scene.background as ThreeNS.Color).setHex(profile.background);
  else scene.background = new THREE.Color(profile.background);
}

/**
 * The quality tier's sky (#760): `rich` has the clouds and the full dome. A
 * change rebuilds the sky from what it was last painted with; nothing else
 * changes it.
 */
export function setSkyDetail(THREE: ThreeModule, scene: ThreeNS.Scene, rich: boolean): void {
  if (scene.userData[RICH_KEY] === rich) return;
  scene.userData[RICH_KEY] = rich;
  for (const tag of Object.values(SKY_TAGS)) {
    const part = findTagged(scene, tag);
    if (part) removeAndDispose(scene, part);
  }
  const painted = scene.userData[PAINTED_KEY] as { profile: SkyProfile; weather: Weather } | undefined;
  if (painted) updateSky(THREE, scene, painted.profile, painted.weather);
}

function paintDome(THREE: ThreeModule, dome: ThreeNS.Mesh, profile: SkyProfile): void {
  const position = dome.geometry.getAttribute('position');
  const color = dome.geometry.getAttribute('color') as ThreeNS.BufferAttribute;
  const horizon = new THREE.Color(profile.background);
  const zenith = new THREE.Color(profile.backgroundTop);
  const glow = new THREE.Color(profile.sun.color);
  const [sx, sy, sz] = profile.sunDisc;
  const sunLength = Math.hypot(sx, sy, sz) || 1;
  const glowStrength = SUN_GLOW * (1 - profile.twilight);
  const paint = new THREE.Color();
  for (let i = 0; i < position.count; i += 1) {
    const x = position.getX(i) / SKY_RADIUS;
    const y = position.getY(i) / SKY_RADIUS;
    const z = position.getZ(i) / SKY_RADIUS;
    // Everything under the horizon is the haze the ground fades into.
    paint.copy(horizon).lerp(zenith, Math.pow(Math.max(0, y), HORIZON_FALLOFF));
    const toSun = Math.max(0, (x * sx + y * sy + z * sz) / sunLength);
    paint.lerp(glow, Math.pow(toSun, SUN_GLOW_POWER) * glowStrength);
    color.setXYZ(i, paint.r, paint.g, paint.b);
  }
  color.needsUpdate = true;
}

/** Deterministic PRNG, so the sky is identical every session. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
