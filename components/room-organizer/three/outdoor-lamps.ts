import { LAMP_POOL_SIZE, type LampPoolPlan } from '../lib/night-lights';
import type * as ThreeNS from 'three';

type ThreeModule = typeof import('./three-runtime');

/** The line of three's lighting chunk that fills in one point light's contribution. */
const POINT_LIGHT_LINE = 'getPointLightInfo( pointLight, geometryPosition, directLight );';

/**
 * Per pool slot: 1 when the lamp stands outdoors, 0 when a wall stands between
 * it and the garden (#664). One array shared by every outdoor material, so a
 * lamp assignment writes it once and recompiles nothing.
 */
const lampReachesOutdoors = { value: new Array<number>(LAMP_POOL_SIZE).fill(0) };

/**
 * Whether the pool's point lights are in the scene. Without them the mask has
 * nothing to scale, so an outdoor material compiles exactly as an indoor one
 * and shares its program: by day the mask costs no shader at all. Flips with
 * the pool's visibility, which changes the light count, so three looks the
 * program up again at the same moment.
 */
let maskLive = false;

/** Point the shared mask at the lamps `plan` picked; the order is the pool's. */
export function applyOutdoorLampMask(plan: LampPoolPlan): void {
  maskLive = plan.lit;
  plan.slots.forEach((slot, index) => {
    lampReachesOutdoors.value[index] = slot.outdoors ? 1 : 0;
  });
}

/** For a compile with the pool shown ahead of time (`prewarmLampPool`). */
export function setOutdoorLampMaskLive(live: boolean): void {
  maskLive = live;
}

/**
 * three's light chunk with each point light scaled by its slot of the mask:
 * everywhere, or (`perFace`) on the outside face only.
 */
export function maskedLightsChunk(chunk: string, perFace = false): string {
  const scale = perFace ? 'mix( 1.0, lampReachesOutdoors[ i ], vOutsideFace )' : 'lampReachesOutdoors[ i ]';
  return chunk.replace(POINT_LIGHT_LINE, `${POINT_LIGHT_LINE}\n\t\tdirectLight.color *= ${scale};`);
}

/**
 * Keep indoor lamps off an outdoor surface (#664). Point lights cast no
 * shadow, so without this a lamp beside a wall lights the lawn through it.
 * A shader flag rather than a shorter range: clamping a lamp to its nearest
 * outside wall would also take the light out of its own room. Costs one float
 * multiply per light and no extra light; the array is the pool's fixed size,
 * so a lamp edit never recompiles this. Only while the lamps are on: by day
 * the material is left as it was (see `maskLive`).
 */
export function shutOutIndoorLamps(THREE: ThreeModule, material: ThreeNS.Material): void {
  maskLamps(THREE, material, false);
}

/**
 * Per-vertex attribute: 1 on the outside face of a shell wall or dormer, 0 on
 * the inside one (`withOutsideFace`). Geometry without it reads 0: indoors.
 */
export const OUTSIDE_FACE_ATTRIBUTE = 'outsideFace';

/**
 * `shutOutIndoorLamps` for the outside face only (#814): a shell wall is one
 * mesh and one material for both its faces, so an L's notch wall lit the
 * lamp in the other wing through itself. The faces are told apart by
 * `OUTSIDE_FACE_ATTRIBUTE`, so the inside keeps every lamp and the wall
 * stays one draw.
 */
export function shutOutIndoorLampsOutside(THREE: ThreeModule, material: ThreeNS.Material): void {
  maskLamps(THREE, material, true);
}

function maskLamps(THREE: ThreeModule, material: ThreeNS.Material, perFace: boolean): void {
  if (material.userData.indoorLampsShut === true) return;
  material.userData.indoorLampsShut = true;
  // On top of what the material already patches (ground surfaces, #761).
  const previous = material.onBeforeCompile;
  const previousKey = material.customProgramCacheKey();
  material.onBeforeCompile = (shader, renderer) => {
    previous.call(material, shader, renderer);
    if (!maskLive) return;
    shader.uniforms.lampReachesOutdoors = lampReachesOutdoors;
    const lights = maskedLightsChunk(THREE.ShaderChunk.lights_fragment_begin, perFace);
    shader.fragmentShader = `uniform float lampReachesOutdoors[ ${LAMP_POOL_SIZE} ];\n${perFace ? 'varying float vOutsideFace;\n' : ''}${shader.fragmentShader.replace(
      '#include <lights_fragment_begin>',
      lights
    )}`;
    if (perFace) {
      shader.vertexShader = `attribute float ${OUTSIDE_FACE_ATTRIBUTE};\nvarying float vOutsideFace;\n${shader.vertexShader.replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>\n\tvOutsideFace = ${OUTSIDE_FACE_ATTRIBUTE};`
      )}`;
    }
  };
  const tag = perFace ? '|outdoor-lamps-outside' : '|outdoor-lamps';
  material.customProgramCacheKey = () => (maskLive ? `${previousKey}${tag}` : previousKey);
}

/** `shutOutIndoorLamps` for every material under `root`. */
export function shutOutIndoorLampsUnder(THREE: ThreeModule, root: ThreeNS.Object3D): void {
  root.traverse((node) => {
    const material = (node as ThreeNS.Mesh).material as ThreeNS.Material | ThreeNS.Material[] | undefined;
    if (!material) return;
    for (const m of Array.isArray(material) ? material : [material]) shutOutIndoorLamps(THREE, m);
  });
}
