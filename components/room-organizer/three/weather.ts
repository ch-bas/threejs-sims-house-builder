import { removeAndDispose } from './builder-utils';
import type { Weather } from '../lib/types';
import type * as ThreeNS from 'three';

type ThreeModule = typeof import('three');

export const WEATHER_TAG = 'weather';

export type Precipitation = Exclude<Weather, 'clear'>;

/**
 * One falling-particle field over the lot (#189): rain as thin fast streaks,
 * snow as slow swaying flakes. The pure half (`createWeatherField` /
 * `stepWeatherField`) owns the particle positions and their wrap; the scene
 * half (`buildWeatherMesh` / `syncWeatherMesh`) copies them into a single
 * InstancedMesh, one draw call for the whole sky.
 */
export interface WeatherField {
  kind: Precipitation;
  count: number;
  /** xyz per particle, world space. */
  positions: Float32Array;
  /** Metres per second, downward. */
  speeds: Float32Array;
  /** Snow only: the flake's resting x (it sways around it) and its sway phase. */
  restX: Float32Array;
  phases: Float32Array;
  /** Half the side of the square field, centred on the house. */
  halfExtent: number;
  /** Particles wrap from `floorY` back up to `ceilingY`. */
  floorY: number;
  ceilingY: number;
  /** Half-size of the house footprint the field keeps clear, so nothing falls indoors. */
  clearHalfW: number;
  clearHalfD: number;
  /** Elapsed seconds; drives the snow sway. */
  time: number;
}

export const WEATHER_PARTICLE_COUNT: Record<Precipitation, number> = { rain: 6000, snow: 4500 };
/** Particles wrap between these heights: just under the ground line, well over a 4-storey roof. */
export const WEATHER_FLOOR_Y = -0.5;
export const WEATHER_CEILING_Y = 22;
/** Snow sways this far either side of its resting x; the footprint clearance grows by it. */
export const SNOW_SWAY = 0.35;

const RAIN_SPEED: readonly [number, number] = [11, 15];
const SNOW_SPEED: readonly [number, number] = [0.9, 1.7];

export interface WeatherFieldOptions {
  kind: Precipitation;
  /** Side of the square field (`outdoorGroundSize`). */
  groundSize: number;
  /** House footprint kept clear of particles. */
  roomWidth: number;
  roomDepth: number;
  count?: number;
  floorY?: number;
  ceilingY?: number;
  /** Uniform [0, 1) source; injectable so tests are deterministic. */
  rng?: () => number;
}

/**
 * Scatter the particles uniformly through the field's box, except for the
 * house's column: a particle never starts indoors, and since nothing moves
 * horizontally beyond the snow sway (included in the clearance) none ever
 * drifts in either.
 */
export function createWeatherField(options: WeatherFieldOptions): WeatherField {
  const {
    kind, groundSize, roomWidth, roomDepth,
    count = WEATHER_PARTICLE_COUNT[kind],
    floorY = WEATHER_FLOOR_Y,
    ceilingY = WEATHER_CEILING_Y,
    rng = Math.random,
  } = options;
  const halfExtent = groundSize / 2;
  const sway = kind === 'snow' ? SNOW_SWAY : 0;
  const clearHalfW = roomWidth / 2 + sway;
  const clearHalfD = roomDepth / 2 + sway;
  const [minSpeed, maxSpeed] = kind === 'rain' ? RAIN_SPEED : SNOW_SPEED;

  const positions = new Float32Array(count * 3);
  const speeds = new Float32Array(count);
  const restX = new Float32Array(count);
  const phases = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    let x = 0;
    let z = 0;
    // Rejection-sample the footprint out; the house is a small fraction of
    // the lot so this settles in a draw or two.
    do {
      x = (rng() * 2 - 1) * halfExtent;
      z = (rng() * 2 - 1) * halfExtent;
    } while (Math.abs(x) < clearHalfW && Math.abs(z) < clearHalfD);
    positions[i * 3] = x;
    positions[i * 3 + 1] = floorY + rng() * (ceilingY - floorY);
    positions[i * 3 + 2] = z;
    speeds[i] = minSpeed + rng() * (maxSpeed - minSpeed);
    restX[i] = x;
    phases[i] = rng() * Math.PI * 2;
  }
  return {
    kind, count, positions, speeds, restX, phases, halfExtent, floorY, ceilingY, clearHalfW, clearHalfD, time: 0,
  };
}

/**
 * Advance every particle by `delta` seconds. Rain falls straight; snow falls
 * slowly and sways sideways on a per-flake sine. A particle that drops below
 * the floor wraps back up by the field's full height, so the vertical
 * spacing of the column is preserved and the field never thins out.
 */
export function stepWeatherField(field: WeatherField, delta: number): void {
  const { positions, speeds, count, floorY, ceilingY } = field;
  const span = ceilingY - floorY;
  field.time += delta;
  for (let i = 0; i < count; i++) {
    let y = positions[i * 3 + 1]! - speeds[i]! * delta;
    while (y < floorY) y += span;
    positions[i * 3 + 1] = y;
  }
  if (field.kind === 'snow') {
    const { restX, phases, time } = field;
    for (let i = 0; i < count; i++) {
      positions[i * 3] = restX[i]! + Math.sin(time * 0.9 + phases[i]!) * SNOW_SWAY;
    }
  }
}

/**
 * The field's InstancedMesh. Per-instance rotation/scale are baked once
 * here; `syncWeatherMesh` only rewrites the translation column per frame.
 * Never a shadow caster — the shadow map is static and a caster that moves
 * every frame would force it to re-render every frame (#189).
 */
export function buildWeatherMesh(THREE: ThreeModule, field: WeatherField): ThreeNS.InstancedMesh {
  const rain = field.kind === 'rain';
  // A streak is a thin tall box so it reads from any camera angle; a flake is
  // a low-poly octahedron (8 triangles) — 3200 of them is still trivial.
  const geometry = rain
    ? new THREE.BoxGeometry(0.018, 0.42, 0.018)
    : new THREE.OctahedronGeometry(0.04, 0);
  // Lit (so night rain and moonlit snow follow the sky) with a faint emissive
  // floor so the particles never vanish completely at midnight.
  const material = new THREE.MeshLambertMaterial({
    color: rain ? 0xbcd3ea : 0xf4f7fb,
    emissive: rain ? 0x2c3846 : 0x4a4f58,
    transparent: true,
    opacity: rain ? 0.55 : 0.95,
    depthWrite: false,
  });
  const mesh = new THREE.InstancedMesh(geometry, material, field.count);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  const dummy = new THREE.Object3D();
  for (let i = 0; i < field.count; i++) {
    dummy.position.set(field.positions[i * 3]!, field.positions[i * 3 + 1]!, field.positions[i * 3 + 2]!);
    if (rain) {
      // Streaks lean a few degrees, like rain in a light wind.
      dummy.rotation.set(0, 0, 0.12);
      dummy.scale.set(1, 0.7 + (i % 7) * 0.1, 1);
    } else {
      dummy.rotation.set(field.phases[i]!, field.phases[i]! * 0.7, 0);
      const s = 0.6 + (i % 5) * 0.15;
      dummy.scale.set(s, s, s);
    }
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
  }
  mesh.instanceMatrix.needsUpdate = true;
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  // The instances fill the whole lot and wrap every frame; the base geometry's
  // bounding sphere at the origin would cull the lot, so skip the test.
  mesh.frustumCulled = false;
  mesh.matrixAutoUpdate = false;
  mesh.updateMatrix();
  mesh.userData.type = WEATHER_TAG;
  return mesh;
}

/** Copy the field's positions into the instance matrices' translation column. */
export function syncWeatherMesh(mesh: ThreeNS.InstancedMesh, field: WeatherField): void {
  const matrices = mesh.instanceMatrix.array as Float32Array;
  const { positions, count } = field;
  for (let i = 0; i < count; i++) {
    const m = i * 16;
    matrices[m + 12] = positions[i * 3]!;
    matrices[m + 13] = positions[i * 3 + 1]!;
    matrices[m + 14] = positions[i * 3 + 2]!;
  }
  mesh.instanceMatrix.needsUpdate = true;
}

/** Remove every weather mesh, freeing its geometry, material, and instance buffers. */
export function removeWeather(scene: ThreeNS.Scene): void {
  for (const obj of scene.children.filter((child) => child.userData.type === WEATHER_TAG)) {
    // InstancedMesh owns per-instance GPU buffers the generic disposer
    // doesn't free — release them explicitly before the shared teardown.
    const inst = obj as ThreeNS.InstancedMesh;
    if (inst.isInstancedMesh) inst.dispose();
    removeAndDispose(scene, obj);
  }
}
