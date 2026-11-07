import { ShaderChunk } from 'three';
import { beforeEach, describe, expect, it } from 'vitest';
import { LAMP_POOL_SIZE, planLampPool } from '../lib/night-lights';
import { withOutsideFace } from './builder-utils';
import {
  OUTSIDE_FACE_ATTRIBUTE,
  applyOutdoorLampMask,
  maskedLightsChunk,
  setOutdoorLampMaskLive,
  shutOutIndoorLamps,
  shutOutIndoorLampsOutside,
  shutOutIndoorLampsUnder,
} from './outdoor-lamps';
import { buildRoof } from './roof';
import { buildRoom } from './room-builder';
import * as THREE from './three-runtime';
import type * as ThreeNS from 'three';

function compile(material: ThreeNS.Material): { uniforms: Record<string, { value: unknown }>; fragmentShader: string; vertexShader: string } {
  const shader = { uniforms: {}, fragmentShader: '#include <lights_fragment_begin>', vertexShader: '#include <begin_vertex>' };
  material.onBeforeCompile(shader as never, null as never);
  return shader;
}

function patchedMaterial(): ThreeNS.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial();
  shutOutIndoorLamps(THREE, material);
  return material;
}

describe('indoor lamps on outdoor materials (#664)', () => {
  // The lamps are on unless a test says otherwise.
  beforeEach(() => setOutdoorLampMaskLive(true));

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

  it('by day, with no point light to mask, compiles and shares as an unpatched material', () => {
    applyOutdoorLampMask(planLampPool([{ x: 0, y: 1, z: 0, candela: 10, range: 7 }], { x: 0, y: 1, z: 0 }, 0));
    const patched = patchedMaterial();
    expect(patched.customProgramCacheKey()).toBe(new THREE.MeshStandardMaterial().customProgramCacheKey());
    expect(compile(patched).fragmentShader).toBe('#include <lights_fragment_begin>');
    // The lamps come on: the key changes with the light count, so three compiles the mask then.
    applyOutdoorLampMask(planLampPool([{ x: 0, y: 1, z: 0, candela: 10, range: 7 }], { x: 0, y: 1, z: 0 }, 1));
    expect(patched.customProgramCacheKey()).not.toBe(new THREE.MeshStandardMaterial().customProgramCacheKey());
    expect(compile(patched).fragmentShader).toContain('lampReachesOutdoors');
  });
});

describe('indoor lamps on the outside of the house (#814)', () => {
  beforeEach(() => setOutdoorLampMaskLive(true));

  it('marks the outside face of a wall sheet, and only it', () => {
    const both = withOutsideFace(THREE, new THREE.PlaneGeometry(2, 2));
    const outside = both.getAttribute(OUTSIDE_FACE_ATTRIBUTE);
    const half = outside.count / 2;
    expect(Array.from({ length: outside.count }, (_, i) => outside.getX(i))).toEqual([
      ...new Array<number>(half).fill(0),
      ...new Array<number>(half).fill(1),
    ]);
    // The outside half is the one whose normals point out of the sheet's back.
    const normals = both.getAttribute('normal');
    expect(normals.getZ(0)).toBe(1);
    expect(normals.getZ(half)).toBe(-1);
  });

  it('masks the lamps on the outside face only, in a program of its own', () => {
    const material = new THREE.MeshStandardMaterial();
    shutOutIndoorLampsOutside(THREE, material);
    const shader = compile(material);
    expect(shader.fragmentShader).toContain('directLight.color *= mix( 1.0, lampReachesOutdoors[ i ], vOutsideFace );');
    expect(shader.vertexShader).toContain(`attribute float ${OUTSIDE_FACE_ATTRIBUTE};`);
    expect(shader.vertexShader).toContain(`vOutsideFace = ${OUTSIDE_FACE_ATTRIBUTE};`);
    const other = new THREE.MeshStandardMaterial();
    shutOutIndoorLampsOutside(THREE, other);
    expect(material.customProgramCacheKey()).toBe(other.customProgramCacheKey());
    expect(material.customProgramCacheKey()).not.toBe(patchedMaterial().customProgramCacheKey());
    // By day it is the plain material.
    setOutdoorLampMaskLive(false);
    expect(material.customProgramCacheKey()).toBe(new THREE.MeshStandardMaterial().customProgramCacheKey());
  });

  it('gives every shell wall the face mask, one material and one draw each', () => {
    const scene = new THREE.Scene();
    buildRoom(THREE, {
      scene, width: 10, depth: 8, floorColor: '#ccc', floorPlanImage: null, floorPlanOpacity: 1, floorPlanFitMode: 'stretch',
      floorPlan3DEffect: false, cutout: { corner: 'ne', width: 4, depth: 3 },
    });
    const walls = scene.children.filter((child): child is ThreeNS.Mesh => child.name.startsWith('Wall '));
    expect(walls).toHaveLength(6);
    for (const wall of walls) {
      expect(Array.isArray(wall.material)).toBe(false);
      expect(compile(wall.material as ThreeNS.Material).fragmentShader).toContain('vOutsideFace');
      expect(wall.geometry.getAttribute(OUTSIDE_FACE_ATTRIBUTE)).toBeDefined();
    }
  });

  it('shuts the indoor lamps out of the roof body, the dormer top whole and its face and cheeks by face', () => {
    const scene = new THREE.Scene();
    buildRoof(THREE, {
      scene, width: 8, depth: 6, baseY: 3,
      spec: { style: 'gable', color: '#7a4b3a', dormers: [{ id: 'd', side: 'south', width: 1.6, window: true }] },
    });
    const shut = (mesh: ThreeNS.Mesh) =>
      (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).every((m) => m.userData.indoorLampsShut === true);
    const meshes = (root: ThreeNS.Object3D) => {
      const found: ThreeNS.Mesh[] = [];
      root.traverse((node) => {
        if ((node as ThreeNS.Mesh).isMesh) found.push(node as ThreeNS.Mesh);
      });
      return found;
    };
    const dormer = scene.children.find((child) => child.userData.dormerId !== undefined)!;
    for (const part of scene.children.filter((child) => child !== dormer)) expect(meshes(part).every(shut)).toBe(true);
    const parts = meshes(dormer);
    const sheets = parts.filter((mesh) => mesh.geometry.getAttribute(OUTSIDE_FACE_ATTRIBUTE) !== undefined);
    expect(sheets).toHaveLength(3);
    expect(sheets.every(shut)).toBe(true);
    const boxes = parts.filter((mesh) => mesh.geometry.type === 'BoxGeometry');
    const top = boxes.reduce((high, mesh) => (mesh.position.y > high.position.y ? mesh : high));
    expect(shut(top)).toBe(true);
    // Frames and glass, seen from the attic, keep their lamps.
    expect(parts.filter((mesh) => !sheets.includes(mesh) && mesh !== top).some(shut)).toBe(false);
  });
});
