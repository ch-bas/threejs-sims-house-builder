import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { groundHeightAt } from '../lib/site';
import {
  SNOW_SWAY,
  WEATHER_TAG,
  buildWeatherMesh,
  createWeatherField,
  WEATHER_TIME_WRAP,
  removeWeather,
  setWeatherTime,
  weatherPositionAt,
  type WeatherField,
} from './weather';

/** Every particle's position `time` seconds in, as xyz triples. */
function at(field: WeatherField, time: number): Float32Array {
  const out = new Float32Array(field.count * 3);
  const p = { x: 0, y: 0, z: 0 };
  for (let i = 0; i < field.count; i++) {
    weatherPositionAt(field, i, time, p);
    out[i * 3] = p.x;
    out[i * 3 + 1] = p.y;
    out[i * 3 + 2] = p.z;
  }
  return out;
}

/** Deterministic [0, 1) source so the scatter is the same on every run. */
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

const LOT = { groundSize: 60, roomWidth: 8, roomDepth: 6 } as const;

describe('weather particle field (#189)', () => {
  it('scatters every particle inside the field box and outside the house footprint', () => {
    for (const kind of ['rain', 'snow'] as const) {
      const field = createWeatherField({ kind, ...LOT, count: 2000, rng: seeded(7) });
      expect(field.count).toBe(2000);
      for (let i = 0; i < field.count; i++) {
        const x = field.positions[i * 3]!;
        const y = field.positions[i * 3 + 1]!;
        const z = field.positions[i * 3 + 2]!;
        expect(Math.abs(x)).toBeLessThanOrEqual(30);
        expect(Math.abs(z)).toBeLessThanOrEqual(30);
        expect(y).toBeGreaterThanOrEqual(field.floorY);
        expect(y).toBeLessThanOrEqual(field.ceilingY);
        const indoors = Math.abs(x) < field.clearHalfW && Math.abs(z) < field.clearHalfD;
        expect(indoors, `${kind} particle ${i} at ${x},${z}`).toBe(false);
      }
    }
  });

  it('keeps the eaves dry too: nothing spawns under the overhang (#660)', () => {
    const field = createWeatherField({ kind: 'rain', ...LOT, clearance: 0.35, count: 4000, rng: seeded(3) });
    expect(field.clearHalfW).toBeCloseTo(4.35);
    expect(field.clearHalfD).toBeCloseTo(3.35);
    for (let i = 0; i < field.count; i++) {
      const x = field.positions[i * 3]!;
      const z = field.positions[i * 3 + 2]!;
      expect(Math.abs(x) < 4.35 && Math.abs(z) < 3.35, `particle ${i} under the eaves at ${x},${z}`).toBe(false);
    }
  });

  it('rain falls straight and fast; snow falls slowly and sways', () => {
    const rain = createWeatherField({ kind: 'rain', ...LOT, count: 100, rng: seeded(1) });
    const snow = createWeatherField({ kind: 'snow', ...LOT, count: 100, rng: seeded(1) });
    const rainBefore = at(rain, 0);
    const snowBefore = at(snow, 0);
    const rainAfter = at(rain, 0.1);
    const snowAfter = at(snow, 0.1);
    for (let i = 0; i < 100; i++) {
      // x/z untouched for rain, y dropped by speed × dt (or wrapped).
      expect(rainAfter[i * 3]).toBe(rainBefore[i * 3]);
      expect(rainAfter[i * 3 + 2]).toBe(rainBefore[i * 3 + 2]);
      const rainDrop = rainBefore[i * 3 + 1]! - rainAfter[i * 3 + 1]!;
      const snowDrop = snowBefore[i * 3 + 1]! - snowAfter[i * 3 + 1]!;
      if (rainDrop > 0 && snowDrop > 0) expect(rainDrop).toBeGreaterThan(snowDrop * 4);
      // Snow sways about its resting x but never further than the clearance allows.
      expect(Math.abs(snowAfter[i * 3]! - snow.restX[i]!)).toBeLessThanOrEqual(SNOW_SWAY + 1e-6);
    }
  });

  it('wraps a particle that drops below the floor back up by the full field height', () => {
    const field = createWeatherField({ kind: 'rain', ...LOT, count: 1, rng: seeded(3), floorY: 0, ceilingY: 10 });
    field.positions[1] = 0.5;
    field.speeds[0] = 10;
    expect(at(field, 0)[1]).toBeCloseTo(0.5, 5);
    expect(at(field, 0.1)[1]).toBeCloseTo(9.5, 5); // 0.5 − 1.0 = −0.5 → wraps to 9.5
    // However far it fell, it is never under the floor.
    for (const time of [5.1, 123.4, WEATHER_TIME_WRAP - 0.01]) {
      expect(at(field, time)[1]).toBeGreaterThanOrEqual(0);
      expect(at(field, time)[1]).toBeLessThan(10);
    }
  });

  it('repeats exactly after one clock period, so the shader clock wraps without a jump', () => {
    for (const kind of ['rain', 'snow'] as const) {
      const field = createWeatherField({ kind, ...LOT, count: 300, rng: seeded(17), terrain: { frontY: -2, backY: 1 } });
      for (const time of [0, 7.3]) {
        const now = at(field, time);
        const later = at(field, time + WEATHER_TIME_WRAP);
        // Float32 speeds leave well under a millimetre.
        for (let i = 0; i < now.length; i++) expect(Math.abs(later[i]! - now[i]!)).toBeLessThan(1e-3);
      }
      // The rounding keeps each speed within a few cm/s of its range.
      for (let i = 0; i < field.count; i++) {
        expect(field.speeds[i]).toBeGreaterThan(kind === 'rain' ? 10.9 : 0.85);
        expect(field.speeds[i]).toBeLessThan(kind === 'rain' ? 15.1 : 1.75);
      }
    }
  });

  it('keeps the column evenly filled: the set of heights only shifts, never bunches', () => {
    const field = createWeatherField({ kind: 'snow', ...LOT, count: 500, rng: seeded(11), floorY: 0, ceilingY: 20 });
    for (let i = 0; i < field.count; i++) field.speeds[i] = 1;
    const spread = (time: number) => {
      const positions = at(field, time);
      const buckets = new Array<number>(4).fill(0);
      for (let i = 0; i < field.count; i++) buckets[Math.min(3, Math.floor(positions[i * 3 + 1]! / 5))]! += 1;
      return buckets;
    };
    const before = spread(0);
    const after = spread(30); // 30 m of fall, 1.5 wraps
    for (let b = 0; b < 4; b++) expect(Math.abs(after[b]! - before[b]!)).toBeLessThan(field.count * 0.15);
  });

  it('builds one non-shadow-casting InstancedMesh, uploaded once, that the clock moves (#669)', () => {
    const field = createWeatherField({ kind: 'rain', ...LOT, count: 50, rng: seeded(5) });
    const mesh = buildWeatherMesh(THREE, field);
    expect(mesh.count).toBe(50);
    expect(mesh.castShadow).toBe(false);
    expect(mesh.receiveShadow).toBe(false);
    expect(mesh.frustumCulled).toBe(false);
    expect(mesh.userData.type).toBe(WEATHER_TAG);

    // The matrices hold the time-0 positions; speed, floor and phase ride along per instance.
    const matrix = new THREE.Matrix4();
    const position = new THREE.Vector3();
    const motion = mesh.geometry.getAttribute('weatherMotion') as THREE.InstancedBufferAttribute;
    expect(motion.isInstancedBufferAttribute).toBe(true);
    for (let i = 0; i < 50; i++) {
      mesh.getMatrixAt(i, matrix);
      position.setFromMatrixPosition(matrix);
      expect(position.x).toBeCloseTo(field.positions[i * 3]!, 5);
      expect(position.y).toBeCloseTo(field.positions[i * 3 + 1]!, 5);
      expect(position.z).toBeCloseTo(field.positions[i * 3 + 2]!, 5);
      expect(motion.getX(i)).toBeCloseTo(field.speeds[i]!, 5);
      expect(motion.getY(i)).toBeCloseTo(field.floors[i]!, 5);
      expect(motion.getZ(i)).toBeCloseTo(field.phases[i]!, 5);
    }

    // A frame is one uniform write: the instance buffer is never flagged again.
    const version = mesh.instanceMatrix.version;
    setWeatherTime(mesh, 12.5);
    expect(mesh.instanceMatrix.version).toBe(version);
    const material = mesh.material as THREE.MeshLambertMaterial;
    const shader = { uniforms: {} as Record<string, THREE.IUniform>, vertexShader: THREE.ShaderLib.lambert.vertexShader };
    material.onBeforeCompile(shader as never, null as never);
    expect(shader.uniforms.uWeatherTime?.value).toBe(12.5);
    setWeatherTime(mesh, WEATHER_TIME_WRAP + 1);
    expect(shader.uniforms.uWeatherTime?.value).toBeCloseTo(1, 4);
    // Both hooks it patches exist in three's Lambert shader, and are replaced.
    expect(shader.vertexShader).toContain('attribute vec3 weatherMotion;');
    expect(shader.vertexShader).toContain('mod( weatherStartY');
    expect(shader.vertexShader).not.toContain('#include <project_vertex>');
  });

  it('removeWeather takes every weather mesh out of the scene and disposes it', () => {
    const scene = new THREE.Scene();
    const mesh = buildWeatherMesh(THREE, createWeatherField({ kind: 'snow', ...LOT, count: 10, rng: seeded(9) }));
    let disposed = 0;
    mesh.geometry.addEventListener('dispose', () => { disposed += 1; });
    (mesh.material as THREE.Material).addEventListener('dispose', () => { disposed += 1; });
    scene.add(mesh);
    scene.add(new THREE.Object3D());
    removeWeather(scene);
    expect(scene.children.some((obj) => obj.userData.type === WEATHER_TAG)).toBe(false);
    expect(scene.children).toHaveLength(1);
    expect(disposed).toBe(2);
  });
});

describe('the neighbours stay dry (#660)', () => {
  it('no particle starts in a neighbour\'s column', () => {
    const box = { x0: 10, x1: 20, z0: -5, z1: 5 };
    const field = createWeatherField({ kind: 'rain', groundSize: 60, roomWidth: 8, roomDepth: 8, count: 4000, dryBoxes: [box] });
    for (let i = 0; i < field.count; i++) {
      const x = field.positions[i * 3]!;
      const z = field.positions[i * 3 + 2]!;
      expect(x > box.x0 && x < box.x1 && z > box.z0 && z < box.z1).toBe(false);
    }
  });

  it('snow keeps its sway clear of it as well', () => {
    const box = { x0: 10, x1: 20, z0: -5, z1: 5 };
    const field = createWeatherField({ kind: 'snow', groundSize: 60, roomWidth: 8, roomDepth: 8, count: 4000, dryBoxes: [box] });
    for (let i = 0; i < field.count; i++) {
      const x = field.restX[i]!;
      const z = field.positions[i * 3 + 2]!;
      expect(x > box.x0 - SNOW_SWAY && x < box.x1 + SNOW_SWAY && z > box.z0 - SNOW_SWAY && z < box.z1 + SNOW_SWAY).toBe(false);
    }
  });
});

describe('the field follows the lot down and up (#595)', () => {
  it('falls to the ground under each particle on a sloping lot, front at -3 m', () => {
    const terrain = { frontY: -3, backY: 1 };
    const field = createWeatherField({ kind: 'rain', ...LOT, count: 3000, rng: seeded(21), terrain });
    let lowestFront = Infinity;
    for (let i = 0; i < field.count; i++) {
      const z = field.positions[i * 3 + 2]!;
      // Half a metre under the ground there, as over level ground.
      const ground = groundHeightAt(terrain, z, LOT.roomDepth / 2);
      expect(field.floors[i]).toBeCloseTo(ground - 0.5, 5);
      expect(field.positions[i * 3 + 1]).toBeGreaterThanOrEqual(field.floors[i]!);
    }
    // Ten seconds of fall: every rain particle wraps at least once.
    const p = { x: 0, y: 0, z: 0 };
    let underFloor = 0;
    for (let step = 1; step <= 100; step++) {
      for (let i = 0; i < field.count; i++) {
        weatherPositionAt(field, i, step * 0.1, p);
        if (p.y < field.floors[i]!) underFloor += 1;
        if (p.z < -LOT.roomDepth / 2) lowestFront = Math.min(lowestFront, p.y);
      }
    }
    expect(underFloor).toBe(0);
    // The streaks reach the front lawn at -3 m instead of stopping at -0.5 m.
    expect(lowestFront).toBeLessThan(-3);
  });

  it('keeps the level-lot field as it was', () => {
    const field = createWeatherField({ kind: 'snow', ...LOT, count: 200, rng: seeded(4) });
    expect(field.floorY).toBe(-0.5);
    for (let i = 0; i < field.count; i++) expect(field.floors[i]).toBe(-0.5);
  });
});
