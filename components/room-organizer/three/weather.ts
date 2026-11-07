import { groundHeightAt } from '../lib/site';
import { removeAndDispose } from './builder-utils';
import type { DryBox } from '../lib/street-row';
import type { TerrainSpec, Weather } from '../lib/types';
import type * as ThreeNS from 'three';

type ThreeModule = typeof import('./three-runtime');

export const WEATHER_TAG = 'weather';

export type Precipitation = Exclude<Weather, 'clear'>;

/**
 * One falling-particle field over the lot (#189): rain as thin fast streaks,
 * snow as slow swaying flakes. The pure half (`createWeatherField`) scatters
 * the particles; each one's motion is then a pure function of time
 * (`weatherPositionAt`). The scene half (`buildWeatherMesh`) uploads the
 * field once into a single InstancedMesh, one draw call for the whole sky,
 * whose vertex shader runs that same function: a frame costs one uniform
 * write (`setWeatherTime`), not a buffer upload (#669).
 */
export interface WeatherField {
  kind: Precipitation;
  count: number;
  /** xyz per particle at time 0, world space. */
  positions: Float32Array;
  /** Metres per second, downward. */
  speeds: Float32Array;
  /** Snow only: the flake's resting x (it sways around it) and its sway phase. */
  restX: Float32Array;
  phases: Float32Array;
  /** Half the side of the square field, centred on the house. */
  halfExtent: number;
  /** Where the ground is level at 0, particles wrap from `floorY` back up to `ceilingY`. */
  floorY: number;
  /** Each particle's own wrap height: `floorY` over the ground under it (#595). */
  floors: Float32Array;
  ceilingY: number;
  /** Half-size of the house footprint the field keeps clear, so nothing falls indoors. */
  clearHalfW: number;
  clearHalfD: number;
}

const WEATHER_PARTICLE_COUNT: Record<Precipitation, number> = { rain: 6000, snow: 4500 };
/** Particles wrap between these heights: just under the ground line, well over a 4-storey roof. */
const WEATHER_FLOOR_Y = -0.5;
const WEATHER_CEILING_Y = 22;
/** Snow sways this far either side of its resting x; the footprint clearance grows by it. */
export const SNOW_SWAY = 0.35;

/**
 * The whole field repeats after this many seconds, so the shader's clock
 * wraps there with no jump, and `speed × time` stays precise in float32:
 * every particle falls a whole number of its own columns per period, and the
 * snow sway turns a whole number of times.
 */
export const WEATHER_TIME_WRAP = 600;
/** Snow sway, radians per second: about 0.9, a whole number of turns per period. */
const SNOW_SWAY_RATE = (2 * Math.PI * Math.round((0.9 * WEATHER_TIME_WRAP) / (2 * Math.PI))) / WEATHER_TIME_WRAP;

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
  /** Height of the wrap over level ground; the terrain under each particle moves it (#595). */
  floorY?: number;
  ceilingY?: number;
  /** The lot's slope: rain falls to the ground under it, however low the lot sits (#595). */
  terrain?: TerrainSpec | undefined;
  /** Kept clear beyond the footprint on every side: the eaves' overhang, so nothing falls through the soffit (#660). */
  clearance?: number;
  /** World boxes kept clear as well: the neighbours' houses (#660). */
  dryBoxes?: readonly DryBox[];
  /** Uniform [0, 1) source; injectable so tests are deterministic. */
  rng?: () => number;
}

function inDryBox(boxes: readonly DryBox[], x: number, z: number, margin: number): boolean {
  return boxes.some((box) => x > box.x0 - margin && x < box.x1 + margin && z > box.z0 - margin && z < box.z1 + margin);
}

/**
 * Scatter the particles uniformly through the field's box, except for the
 * columns of the house and its neighbours: a particle never starts indoors,
 * and since nothing moves horizontally beyond the snow sway (included in the
 * clearance) none ever drifts in either.
 */
export function createWeatherField(options: WeatherFieldOptions): WeatherField {
  const {
    kind, groundSize, roomWidth, roomDepth,
    count = WEATHER_PARTICLE_COUNT[kind],
    floorY = WEATHER_FLOOR_Y,
    ceilingY = WEATHER_CEILING_Y,
    clearance = 0,
    dryBoxes = [],
    terrain,
    rng = Math.random,
  } = options;
  const halfExtent = groundSize / 2;
  const sway = kind === 'snow' ? SNOW_SWAY : 0;
  const clearHalfW = roomWidth / 2 + clearance + sway;
  const clearHalfD = roomDepth / 2 + clearance + sway;
  const [minSpeed, maxSpeed] = kind === 'rain' ? RAIN_SPEED : SNOW_SPEED;

  const positions = new Float32Array(count * 3);
  const speeds = new Float32Array(count);
  const restX = new Float32Array(count);
  const phases = new Float32Array(count);
  const floors = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    let x = 0;
    let z = 0;
    // Rejection-sample the footprint out; the house is a small fraction of
    // the lot so this settles in a draw or two.
    do {
      x = (rng() * 2 - 1) * halfExtent;
      z = (rng() * 2 - 1) * halfExtent;
    } while ((Math.abs(x) < clearHalfW && Math.abs(z) < clearHalfD) || inDryBox(dryBoxes, x, z, sway));
    const floor = floorY + groundHeightAt(terrain, z, roomDepth / 2);
    floors[i] = floor;
    positions[i * 3] = x;
    positions[i * 3 + 1] = floor + rng() * (ceilingY - floor);
    positions[i * 3 + 2] = z;
    // Rounded to a whole number of columns per period: at most a few cm/s off.
    const span = ceilingY - floor;
    const speed = minSpeed + rng() * (maxSpeed - minSpeed);
    speeds[i] = (Math.max(1, Math.round((speed * WEATHER_TIME_WRAP) / span)) * span) / WEATHER_TIME_WRAP;
    restX[i] = x;
    phases[i] = rng() * Math.PI * 2;
  }
  return {
    kind, count, positions, speeds, restX, phases, halfExtent, floorY, floors, ceilingY, clearHalfW, clearHalfD,
  };
}

/**
 * Where particle `i` is `time` seconds in, into `out`: the CPU twin of the
 * vertex shader in `buildWeatherMesh`. Rain falls straight; snow falls
 * slowly and sways sideways on a per-flake sine. A particle that drops below
 * its floor wraps back up by its column's full height, so the vertical
 * spacing of the column is preserved and the field never thins out.
 */
export function weatherPositionAt(field: WeatherField, i: number, time: number, out: { x: number; y: number; z: number }): void {
  const floor = field.floors[i]!;
  const span = field.ceilingY - floor;
  const fallen = field.positions[i * 3 + 1]! - floor - field.speeds[i]! * time;
  // GLSL's mod(): always in [0, span), however far it fell.
  out.y = floor + (fallen - span * Math.floor(fallen / span));
  const sway = field.kind === 'snow' ? Math.sin(time * SNOW_SWAY_RATE + field.phases[i]!) * SNOW_SWAY : 0;
  out.x = field.restX[i]! + sway;
  out.z = field.positions[i * 3 + 2]!;
}

const WEATHER_VERTEX_HEAD = /* glsl */ `
attribute vec3 weatherMotion; // speed (m/s down), floor y, sway phase
uniform float uWeatherTime;
uniform float uWeatherCeiling;
uniform float uWeatherSway;
`;

/**
 * three's project_vertex chunk with the fall added after the instance
 * matrix, in world units: the weatherPositionAt maths. The matrix's
 * translation is the particle's time-0 position.
 */
const WEATHER_PROJECT_VERTEX = /* glsl */ `
vec4 mvPosition = vec4( transformed, 1.0 );
#ifdef USE_INSTANCING
  mvPosition = instanceMatrix * mvPosition;
  float weatherStartY = instanceMatrix[3].y;
  float weatherSpan = uWeatherCeiling - weatherMotion.y;
  float weatherY = weatherMotion.y + mod( weatherStartY - weatherMotion.y - weatherMotion.x * uWeatherTime, weatherSpan );
  mvPosition.y += weatherY - weatherStartY;
  mvPosition.x += sin( uWeatherTime * ${SNOW_SWAY_RATE.toFixed(8)} + weatherMotion.z ) * uWeatherSway;
#endif
mvPosition = modelViewMatrix * mvPosition;
gl_Position = projectionMatrix * mvPosition;
`;

/**
 * The field's InstancedMesh. The instance matrices (rotation, scale and the
 * time-0 position) and each particle's speed, floor and sway phase are
 * uploaded once here; the vertex shader moves the particles from the
 * `uWeatherTime` uniform, which `setWeatherTime` writes (#669).
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
  const motion = new Float32Array(field.count * 3);
  for (let i = 0; i < field.count; i++) {
    motion[i * 3] = field.speeds[i]!;
    motion[i * 3 + 1] = field.floors[i]!;
    motion[i * 3 + 2] = field.phases[i]!;
  }
  geometry.setAttribute('weatherMotion', new THREE.InstancedBufferAttribute(motion, 3));
  const uniforms = {
    uWeatherTime: { value: 0 },
    uWeatherCeiling: { value: field.ceilingY },
    uWeatherSway: { value: rain ? 0 : SNOW_SWAY },
  };
  material.userData.weatherUniforms = uniforms;
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${WEATHER_VERTEX_HEAD}`)
      .replace('#include <project_vertex>', WEATHER_PROJECT_VERTEX);
  };
  material.customProgramCacheKey = () => 'weather-field';
  const mesh = new THREE.InstancedMesh(geometry, material, field.count);
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

/** Move the field to `seconds` in: one uniform write, nothing uploaded (#669). */
export function setWeatherTime(mesh: ThreeNS.InstancedMesh, seconds: number): void {
  const uniforms = (mesh.material as ThreeNS.Material).userData.weatherUniforms as { uWeatherTime: { value: number } } | undefined;
  if (uniforms) uniforms.uWeatherTime.value = seconds % WEATHER_TIME_WRAP;
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
