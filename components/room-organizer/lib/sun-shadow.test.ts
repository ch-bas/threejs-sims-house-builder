import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { generateStreet } from './street-row';
import { fitSunShadow, shadowCasterBounds, type ShadowBox, type ShadowSite, type Vec3 } from './sun-shadow';

const DEFAULT_SITE: ShadowSite = { width: 10, depth: 8, eavesY: 3, storeys: 1 };

function corners(box: ShadowBox): Vec3[] {
  const out: Vec3[] = [];
  for (const x of [box.min[0], box.max[0]]) {
    for (const y of [box.min[1], box.max[1]]) {
      for (const z of [box.min[2], box.max[2]]) out.push([x, y, z]);
    }
  }
  return out;
}

/** Project points through the shadow camera three would actually build from the fit. */
function shadowNdc(sun: Vec3, box: ShadowBox, points: readonly Vec3[]): THREE.Vector3[] {
  const fit = fitSunShadow(sun, box);
  const camera = new THREE.OrthographicCamera(fit.left, fit.right, fit.top, fit.bottom, fit.near, fit.far);
  camera.position.set(...fit.position);
  camera.lookAt(new THREE.Vector3(...fit.target));
  camera.updateMatrixWorld();
  return points.map((p) => new THREE.Vector3(...p).project(camera));
}

/** Sun directions along the day arc the sky profile produces (three/lighting.ts). */
const SUN_ARC: Vec3[] = [6, 8, 10, 12, 14, 16, 18].map((hour) => {
  const dayFraction = (hour - 6) / 12;
  const azimuth = (dayFraction - 0.5) * Math.PI;
  return [Math.sin(azimuth) * 10, Math.sin(dayFraction * Math.PI) * 10 + 1, Math.cos(azimuth) * 5];
});

describe('fitSunShadow (#282)', () => {
  it('puts every corner of the caster box inside the frustum at every hour', () => {
    const box = shadowCasterBounds({ ...DEFAULT_SITE, eavesY: 24, storeys: 4, neighbours: { street: true, across: true } });
    for (const sun of [...SUN_ARC, [0, 1, 0] as Vec3, [1, 0.05, 0] as Vec3]) {
      for (const ndc of shadowNdc(sun, box, corners(box))) {
        expect(Math.abs(ndc.x)).toBeLessThanOrEqual(1);
        expect(Math.abs(ndc.y)).toBeLessThanOrEqual(1);
        expect(Math.abs(ndc.z)).toBeLessThanOrEqual(1);
      }
    }
  });

  it('keeps the light outside the box, along the sun direction', () => {
    const box = shadowCasterBounds(DEFAULT_SITE);
    for (const sun of SUN_ARC) {
      const fit = fitSunShadow(sun, box);
      expect(fit.near).toBeGreaterThan(0);
      const inside = fit.position.every((v, i) => v >= box.min[i]! && v <= box.max[i]!);
      expect(inside).toBe(false);
      const offset = fit.position.map((v, i) => v - fit.target[i]!);
      const cos =
        (offset[0]! * sun[0] + offset[1]! * sun[1] + offset[2]! * sun[2]) /
        (Math.hypot(...offset) * Math.hypot(...sun));
      expect(cos).toBeCloseTo(1, 10);
    }
  });

  it('frames the box tightly: the overhead fit is the box footprint plus padding', () => {
    const box: ShadowBox = { min: [-10, 0, -6], max: [10, 5, 6] };
    const fit = fitSunShadow([0, 1, 0], box);
    expect(fit.right - fit.left).toBeCloseTo(21, 2);
    expect(fit.top - fit.bottom).toBeCloseTo(13, 2);
    expect(fit.far - fit.near).toBeCloseTo(6, 2);
  });
});

describe('shadowCasterBounds (#282)', () => {
  it('reaches above a tall house and its roof', () => {
    const box = shadowCasterBounds({ ...DEFAULT_SITE, eavesY: 24, storeys: 4 });
    expect(box.max[1]).toBeGreaterThanOrEqual(24 + 3.25);
  });

  it('covers every generated street house, including the facing row', () => {
    for (const frontage of [undefined, 'pavement'] as const) {
      for (const seed of [1, 7, 42, 999]) {
        const site: ShadowSite = {
          ...DEFAULT_SITE,
          eavesY: 6,
          storeys: 2,
          terrain: { frontY: 0, backY: 2 },
          neighbours: { street: true, across: true, seed },
          ...(frontage ? { frontage } : {}),
        };
        const box = shadowCasterBounds(site);
        const houses = generateStreet({
          width: site.width,
          depth: site.depth,
          floorYs: [0, 3],
          eavesY: site.eavesY,
          roof: { style: 'gable' },
          terrain: { frontY: 0, backY: 2 },
          neighbours: { street: true, across: true, seed },
          ...(frontage ? { frontage } : {}),
        });
        expect(houses.length).toBeGreaterThan(0);
        for (const house of houses) {
          const z0 = house.frontZ;
          const z1 = house.frontZ - house.facing * house.depth;
          expect(Math.abs(house.x) + house.width / 2, house.id).toBeLessThanOrEqual(box.max[0]);
          expect(Math.min(z0, z1), house.id).toBeGreaterThanOrEqual(box.min[2]);
          expect(Math.max(z0, z1), house.id).toBeLessThanOrEqual(box.max[2]);
          expect(house.eavesY + 3.25, house.id).toBeLessThanOrEqual(box.max[1]);
        }
      }
    }
  });

  it('reaches down to the lowest ground on a slope', () => {
    expect(shadowCasterBounds({ ...DEFAULT_SITE, terrain: { frontY: -3, backY: 1 } }).min[1]).toBe(-3);
    expect(shadowCasterBounds(DEFAULT_SITE).min[1]).toBe(0);
  });
});
