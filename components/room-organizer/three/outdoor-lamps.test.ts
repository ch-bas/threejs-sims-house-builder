import { ShaderChunk } from 'three';
import { describe, expect, it } from 'vitest';
import { LAMP_POOL_SIZE, planLampPool } from '../lib/night-lights';
import { applyOutdoorLampMask, maskedLightsChunk, shutOutIndoorLamps, shutOutIndoorLampsUnder } from './outdoor-lamps';
import * as THREE from './three-runtime';
import type * as ThreeNS from 'three';

function compile(material: ThreeNS.Material): { uniforms: Record<string, { value: unknown }>; fragmentShader: string } {
  const shader = { uniforms: {}, fragmentShader: '#include <lights_fragment_begin>', vertexShader: '' };
  material.onBeforeCompile(shader as never, null as never);
  return shader;
}

function patchedMaterial(): ThreeNS.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial();
  shutOutIndoorLamps(THREE, material);
  return material;
}

describe('indoor lamps on outdoor materials (#664)', () => {
  it('finds the point-light line in the chunk of the three we ship', () => {
    const patched = maskedLightsChunk(ShaderChunk.lights_fragment_begin);
    expect(patched).not.toBe(ShaderChunk.lights_fragment_begin);
    expect(patched).toContain('directLight.color *= lampReachesOutdoors[ i ];');
  });

  it('gives every patched material the same mask, one float per pool slot', () => {
    const a = compile(patchedMaterial());
    const b = compile(patchedMaterial());
    expect(a.fragmentShader).toContain(`uniform float lampReachesOutdoors[ ${LAMP_POOL_SIZE} ];`);
    expect(a.uniforms.lampReachesOutdoors).toBe(b.uniforms.lampReachesOutdoors);
  });

  it('marks only the outdoor lamps, in pool order', () => {
    const plan = planLampPool(
      [
        { x: 0, y: 1, z: 0, candela: 10, range: 7 },
        { x: 9, y: 3, z: 0, candela: 32, range: 12, outdoors: true },
      ],
      { x: 0, y: 1, z: 0 },
      1
    );
    applyOutdoorLampMask(plan);
    const { value } = compile(patchedMaterial()).uniforms.lampReachesOutdoors as { value: number[] };
    expect(value).toHaveLength(LAMP_POOL_SIZE);
    expect(value.slice(0, 3)).toEqual([0, 1, 0]);
  });

  it('shares one program between patched materials, apart from unpatched ones', () => {
    const patched = patchedMaterial();
    expect(patched.customProgramCacheKey()).toBe(patchedMaterial().customProgramCacheKey());
    expect(patched.customProgramCacheKey()).not.toBe(new THREE.MeshStandardMaterial().customProgramCacheKey());
  });

  it('reaches every material under a group, arrays included', () => {
    const group = new THREE.Group();
    const one = new THREE.MeshStandardMaterial();
    const two = new THREE.MeshStandardMaterial();
    group.add(new THREE.Mesh(new THREE.BoxGeometry(), one));
    group.add(new THREE.Mesh(new THREE.BoxGeometry(), [two]));
    shutOutIndoorLampsUnder(THREE, group);
    expect(one.userData.indoorLampsShut).toBe(true);
    expect(two.userData.indoorLampsShut).toBe(true);
  });
});
