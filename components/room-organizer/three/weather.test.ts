import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  SNOW_SWAY,
  WEATHER_TAG,
  buildWeatherMesh,
  createWeatherField,
  removeWeather,
  stepWeatherField,
  syncWeatherMesh,
} from './weather';

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

  it('rain falls straight and fast; snow falls slowly and sways', () => {
    const rain = createWeatherField({ kind: 'rain', ...LOT, count: 100, rng: seeded(1) });
    const snow = createWeatherField({ kind: 'snow', ...LOT, count: 100, rng: seeded(1) });
    const rainBefore = Float32Array.from(rain.positions);
    const snowBefore = Float32Array.from(snow.positions);
    stepWeatherField(rain, 0.1);
    stepWeatherField(snow, 0.1);
    for (let i = 0; i < 100; i++) {
      // x/z untouched for rain, y dropped by speed × dt (or wrapped).
      expect(rain.positions[i * 3]).toBe(rainBefore[i * 3]);
      expect(rain.positions[i * 3 + 2]).toBe(rainBefore[i * 3 + 2]);
      const rainDrop = rainBefore[i * 3 + 1]! - rain.positions[i * 3 + 1]!;
      const snowDrop = snowBefore[i * 3 + 1]! - snow.positions[i * 3 + 1]!;
      if (rainDrop > 0 && snowDrop > 0) expect(rainDrop).toBeGreaterThan(snowDrop * 4);
      // Snow sways about its resting x but never further than the clearance allows.
      expect(Math.abs(snow.positions[i * 3]! - snow.restX[i]!)).toBeLessThanOrEqual(SNOW_SWAY + 1e-6);
    }
  });

  it('wraps a particle that drops below the floor back up by the full field height', () => {
    const field = createWeatherField({ kind: 'rain', ...LOT, count: 1, rng: seeded(3), floorY: 0, ceilingY: 10 });
    field.positions[1] = 0.5;
    field.speeds[0] = 10;
    stepWeatherField(field, 0.1); // 0.5 − 1.0 = −0.5 → wraps to 9.5
    expect(field.positions[1]).toBeCloseTo(9.5, 5);
    // A big step never leaves a particle under the floor, however far it fell.
    stepWeatherField(field, 5);
    expect(field.positions[1]).toBeGreaterThanOrEqual(0);
    expect(field.positions[1]).toBeLessThanOrEqual(10);
  });

  it('keeps the column evenly filled: the set of heights only shifts, never bunches', () => {
    const field = createWeatherField({ kind: 'snow', ...LOT, count: 500, rng: seeded(11), floorY: 0, ceilingY: 20 });
    for (let i = 0; i < field.count; i++) field.speeds[i] = 1;
    const spread = () => {
      const buckets = new Array<number>(4).fill(0);
      for (let i = 0; i < field.count; i++) buckets[Math.min(3, Math.floor(field.positions[i * 3 + 1]! / 5))]! += 1;
      return buckets;
    };
    const before = spread();
    for (let step = 0; step < 300; step++) stepWeatherField(field, 0.1); // 30 m of fall, 1.5 wraps
    const after = spread();
    for (let b = 0; b < 4; b++) expect(Math.abs(after[b]! - before[b]!)).toBeLessThan(field.count * 0.15);
  });

  it('builds one non-shadow-casting InstancedMesh and syncs positions into it', () => {
    const field = createWeatherField({ kind: 'rain', ...LOT, count: 50, rng: seeded(5) });
    const mesh = buildWeatherMesh(THREE, field);
    expect(mesh.count).toBe(50);
    expect(mesh.castShadow).toBe(false);
    expect(mesh.receiveShadow).toBe(false);
    expect(mesh.frustumCulled).toBe(false);
    expect(mesh.userData.type).toBe(WEATHER_TAG);

    stepWeatherField(field, 0.05);
    syncWeatherMesh(mesh, field);
    const matrix = new THREE.Matrix4();
    const position = new THREE.Vector3();
    for (let i = 0; i < 50; i++) {
      mesh.getMatrixAt(i, matrix);
      position.setFromMatrixPosition(matrix);
      expect(position.x).toBeCloseTo(field.positions[i * 3]!, 5);
      expect(position.y).toBeCloseTo(field.positions[i * 3 + 1]!, 5);
      expect(position.z).toBeCloseTo(field.positions[i * 3 + 2]!, 5);
    }
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
