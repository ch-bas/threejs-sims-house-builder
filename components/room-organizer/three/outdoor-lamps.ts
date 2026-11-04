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

/** Point the shared mask at the lamps `plan` picked; the order is the pool's. */
export function applyOutdoorLampMask(plan: LampPoolPlan): void {
  plan.slots.forEach((slot, index) => {
    lampReachesOutdoors.value[index] = slot.outdoors ? 1 : 0;
  });
}

/** three's light chunk with each point light scaled by its slot of the mask. */
export function maskedLightsChunk(chunk: string): string {
  return chunk.replace(POINT_LIGHT_LINE, `${POINT_LIGHT_LINE}\n\t\tdirectLight.color *= lampReachesOutdoors[ i ];`);
}

/**
 * Keep indoor lamps off an outdoor surface (#664). Point lights cast no
 * shadow, so without this a lamp beside a wall lights the lawn through it.
 * A shader flag rather than a shorter range: clamping a lamp to its nearest
 * outside wall would also take the light out of its own room. Costs one float
 * multiply per light and no extra light; the array is the pool's fixed size,
 * so a lamp edit never recompiles this.
 */
export function shutOutIndoorLamps(THREE: ThreeModule, material: ThreeNS.Material): void {
  if (material.userData.indoorLampsShut === true) return;
  material.userData.indoorLampsShut = true;
  material.onBeforeCompile = (shader) => {
    shader.uniforms.lampReachesOutdoors = lampReachesOutdoors;
    shader.fragmentShader = `uniform float lampReachesOutdoors[ ${LAMP_POOL_SIZE} ];\n${shader.fragmentShader.replace(
      '#include <lights_fragment_begin>',
      maskedLightsChunk(THREE.ShaderChunk.lights_fragment_begin)
    )}`;
  };
  material.customProgramCacheKey = () => 'outdoor-lamps';
}

/** `shutOutIndoorLamps` for every material under `root`. */
export function shutOutIndoorLampsUnder(THREE: ThreeModule, root: ThreeNS.Object3D): void {
  root.traverse((node) => {
    const material = (node as ThreeNS.Mesh).material as ThreeNS.Material | ThreeNS.Material[] | undefined;
    if (!material) return;
    for (const m of Array.isArray(material) ? material : [material]) shutOutIndoorLamps(THREE, m);
  });
}
