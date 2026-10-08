import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { LAMP_POOL_SIZE, planLampPool, type LampLight } from '../lib/night-lights';
import {
  addLights,
  applyLampPool,
  computeNightSky,
  computeSkyProfile,
  isLampPrewarmHour,
  prewarmLampPool,
} from './lighting';
import type * as ThreeNS from 'three';

function channels(hex: number): [number, number, number] {
  return [(hex >> 16) & 0xff, (hex >> 8) & 0xff, hex & 0xff];
}

function brightness(hex: number): number {
  const [r, g, b] = channels(hex);
  return r + g + b;
}

describe('computeSkyProfile — night ramp (#145)', () => {
  it('midnight is the darkest region of the night, not the brightest', () => {
    const midnight = brightness(computeSkyProfile(0).background);
    expect(midnight).toBeLessThan(brightness(computeSkyProfile(19).background));
    expect(midnight).toBeLessThan(brightness(computeSkyProfile(5.5).background));
  });

  it('darkens monotonically after dusk (18 → 22)', () => {
    let previous = Number.POSITIVE_INFINITY;
    for (const hour of [18.25, 19, 20, 21, 22]) {
      const value = brightness(computeSkyProfile(hour).background);
      expect(value, `hour ${hour}`).toBeLessThanOrEqual(previous);
      previous = value;
    }
  });

  it('lifts toward dawn (2 → 6) symmetrically', () => {
    let previous = 0;
    for (const hour of [2, 3, 4, 5, 5.75]) {
      const value = brightness(computeSkyProfile(hour).background);
      expect(value, `hour ${hour}`).toBeGreaterThanOrEqual(previous);
      previous = value;
    }
  });

  it('meets the day branch continuously at the 06:00 and 18:00 boundaries', () => {
    for (const [night, day] of [
      [5.99, 6.01],
      [17.99, 18.01],
    ] as const) {
      const a = channels(computeSkyProfile(night).background);
      const b = channels(computeSkyProfile(day).background);
      for (let i = 0; i < 3; i++) {
        expect(Math.abs(a[i]! - b[i]!), `hours ${night}/${day} channel ${i}`).toBeLessThanOrEqual(4);
      }
    }
  });
});

describe('computeNightSky (#182)', () => {
  it('day: no stars, no moon', () => {
    for (const hour of [6, 9, 12, 15, 18]) {
      const sky = computeNightSky(hour);
      expect(sky.starAlpha, `hour ${hour}`).toBe(0);
      expect(sky.moonT, `hour ${hour}`).toBeNull();
    }
  });

  it('midnight: full stars, moon at the top of its arc', () => {
    const sky = computeNightSky(0);
    expect(sky.starAlpha).toBe(1);
    expect(sky.moonAlpha).toBe(1);
    expect(sky.moonT).toBeCloseTo(0.5, 10);
  });

  it('stars fade in through dusk exactly as the twilight glow fades out', () => {
    expect(computeNightSky(18.5).starAlpha).toBeCloseTo(0.125, 10);
    expect(computeNightSky(20).starAlpha).toBeCloseTo(0.5, 10);
    expect(computeNightSky(22).starAlpha).toBe(1);
    // Symmetric on the dawn side.
    expect(computeNightSky(4).starAlpha).toBeCloseTo(0.5, 10);
  });

  it('the moon rises after dusk and sets before dawn', () => {
    expect(computeNightSky(18.5).moonT).toBeNull();
    expect(computeNightSky(19.5).moonT).toBeGreaterThan(0);
    expect(computeNightSky(4.5).moonT).toBeLessThan(1);
    expect(computeNightSky(5.5).moonT).toBeNull();
  });
});

describe('computeSkyProfile — weather overcast (#189)', () => {
  const HOURS = [0, 3, 6, 9, 12, 15, 18, 21];

  it("'clear' is the default and returns the untouched profile", () => {
    for (const hour of HOURS) {
      expect(computeSkyProfile(hour, 'clear')).toEqual(computeSkyProfile(hour));
    }
  });

  it('rain dims the sun and the ambient, snow dims only the sun, both by a constant factor', () => {
    for (const hour of HOURS) {
      const clear = computeSkyProfile(hour);
      const rain = computeSkyProfile(hour, 'rain');
      const snow = computeSkyProfile(hour, 'snow');
      expect(rain.ambient.intensity, `rain ambient ${hour}`).toBeCloseTo(clear.ambient.intensity * 0.85, 10);
      expect(rain.sun.intensity, `rain sun ${hour}`).toBeCloseTo(clear.sun.intensity * 0.55, 10);
      expect(snow.ambient.intensity, `snow ambient ${hour}`).toBeCloseTo(clear.ambient.intensity, 10);
      expect(snow.sun.intensity, `snow sun ${hour}`).toBeCloseTo(clear.sun.intensity * 0.7, 10);
      // Sun position and light colours ride along untouched: the arc is the same arc.
      expect(rain.sun.position).toEqual(clear.sun.position);
      expect(snow.sun.color).toBe(clear.sun.color);
      expect(rain.ambient.color).toBe(clear.ambient.color);
    }
  });

  it('flattens the sky toward grey: rain darker than clear, snow lighter', () => {
    const saturation = (hex: number) => Math.max(...channels(hex)) - Math.min(...channels(hex));
    for (const hour of [9, 12, 15]) {
      const clear = computeSkyProfile(hour);
      const rain = computeSkyProfile(hour, 'rain');
      const snow = computeSkyProfile(hour, 'snow');
      expect(saturation(rain.backgroundTop)).toBeLessThan(saturation(clear.backgroundTop));
      expect(saturation(snow.backgroundTop)).toBeLessThan(saturation(clear.backgroundTop));
      expect(brightness(rain.background)).toBeLessThan(brightness(clear.background));
      expect(brightness(snow.background)).toBeGreaterThan(brightness(clear.background));
    }
  });

  it('keeps the night ramp monotonic under weather (the overcast is hour-independent)', () => {
    for (const weather of ['rain', 'snow'] as const) {
      let previous = Number.POSITIVE_INFINITY;
      for (const hour of [18.25, 19, 20, 21, 22]) {
        const value = brightness(computeSkyProfile(hour, weather).background);
        expect(value, `${weather} hour ${hour}`).toBeLessThanOrEqual(previous);
        previous = value;
      }
    }
  });
});

describe('computeSkyProfile — twilight (#215, #375)', () => {
  const SAMPLES = Array.from({ length: 24 * 20 + 1 }, (_, i) => i / 20);

  it('has no jump anywhere in the day: lights fade through twilight instead of snapping', () => {
    for (let i = 1; i < SAMPLES.length; i++) {
      const a = computeSkyProfile(SAMPLES[i - 1]!);
      const b = computeSkyProfile(SAMPLES[i]!);
      const at = `hour ${SAMPLES[i]}`;
      expect(Math.abs(a.sun.intensity - b.sun.intensity), at).toBeLessThan(0.03);
      expect(Math.abs(a.ambient.intensity - b.ambient.intensity), at).toBeLessThan(0.03);
      expect(Math.abs(a.hemisphere.intensity - b.hemisphere.intensity), at).toBeLessThan(0.03);
      expect(Math.abs(a.lamps - b.lamps), at).toBeLessThan(0.06);
      for (const [x, y] of [
        [a.ambient.color, b.ambient.color],
        [a.hemisphere.sky, b.hemisphere.sky],
        [a.hemisphere.ground, b.hemisphere.ground],
      ] as const) {
        const ca = channels(x);
        const cb = channels(y);
        for (let c = 0; c < 3; c++) expect(Math.abs(ca[c]! - cb[c]!), at).toBeLessThanOrEqual(12);
      }
    }
  });

  it('ramps the ambient colour through dusk blue to the night colour', () => {
    const early = computeSkyProfile(19.5).ambient.color;
    const late = computeSkyProfile(23).ambient.color;
    expect(early).not.toBe(late);
    expect(brightness(early)).toBeGreaterThan(brightness(late));
  });

  it('dims the hemisphere fill at night instead of holding its noon sky-blue', () => {
    expect(computeSkyProfile(12).hemisphere.intensity).toBeCloseTo(0.55, 10);
    expect(computeSkyProfile(12).hemisphere.sky).toBe(0xbfe5ff);
    for (const hour of [21, 23, 0, 3]) {
      expect(computeSkyProfile(hour).hemisphere.intensity, `hour ${hour}`).toBeLessThan(0.15);
      expect(brightness(computeSkyProfile(hour).hemisphere.sky), `hour ${hour}`).toBeLessThan(brightness(0xbfe5ff) / 2);
    }
  });

  it('overcasts the hemisphere with the weather', () => {
    expect(computeSkyProfile(12, 'rain').hemisphere.intensity).toBeCloseTo(computeSkyProfile(12).hemisphere.intensity * 0.85, 10);
  });

  it('switches the lamps on through twilight and off by day', () => {
    for (const hour of [6, 9, 12, 15, 18]) expect(computeSkyProfile(hour).lamps, `hour ${hour}`).toBe(0);
    expect(computeSkyProfile(18.5).lamps).toBeGreaterThan(0);
    expect(computeSkyProfile(18.5).lamps).toBeLessThan(1);
    for (const hour of [20, 23, 0, 4]) expect(computeSkyProfile(hour).lamps, `hour ${hour}`).toBe(1);
  });
});

describe('lamp pool (#393)', () => {
  function pointLights(scene: ThreeNS.Scene): { total: number; drawn: number } {
    let total = 0;
    let drawn = 0;
    scene.traverse((obj) => {
      if ((obj as ThreeNS.PointLight).isPointLight) total++;
    });
    scene.traverseVisible((obj) => {
      if ((obj as ThreeNS.PointLight).isPointLight) drawn++;
    });
    return { total, drawn };
  }

  const lamps: LampLight[] = Array.from({ length: 30 }, (_, i) => ({ x: i, y: 1.35, z: 0, candela: 8, range: 7 }));
  const FOCUS = { x: 0, y: 0, z: 0 };

  it('keeps one fixed set of point lights across hours and lamp-set changes, drawn only at night', () => {
    const scene = new THREE.Scene();
    addLights(THREE, scene);
    for (const hour of [6, 12, 17, 18.5, 20, 0, 4, 12]) {
      for (const set of [[], lamps.slice(0, 3), lamps]) {
        const level = computeSkyProfile(hour).lamps;
        applyLampPool(scene, planLampPool(set, FOCUS, level));
        const { total, drawn } = pointLights(scene);
        expect(total, `hour ${hour}, ${set.length} lamps`).toBe(LAMP_POOL_SIZE);
        expect(drawn, `hour ${hour}, ${set.length} lamps`).toBe(level > 0 && set.length > 0 ? LAMP_POOL_SIZE : 0);
      }
    }
  });

  it('lights the nearest lamps at night and nothing by day', () => {
    const scene = new THREE.Scene();
    addLights(THREE, scene);
    applyLampPool(scene, planLampPool(lamps, { x: 10, y: 1, z: 0 }, 1));
    const lit: number[] = [];
    scene.traverse((obj) => {
      const light = obj as ThreeNS.PointLight;
      if (light.isPointLight && light.intensity > 0) lit.push(light.position.x);
    });
    expect(lit.sort((a, b) => a - b)).toEqual([6, 7, 8, 9, 10, 11, 12, 13]);
    applyLampPool(scene, planLampPool(lamps, FOCUS, 0));
    scene.traverse((obj) => {
      if ((obj as ThreeNS.PointLight).isPointLight) expect((obj as ThreeNS.PointLight).intensity).toBe(0);
    });
  });

  it('pre-warms the lit variant in the hours before dusk, leaving the pool hidden', () => {
    expect([14, 15, 17, 18].map(isLampPrewarmHour)).toEqual([false, true, true, true]);
    expect([12, 19, 0, 5].some(isLampPrewarmHour)).toBe(false);
    const scene = new THREE.Scene();
    addLights(THREE, scene);
    const seen: number[] = [];
    const renderer = {
      compile: (target: ThreeNS.Scene) => {
        seen.push(pointLights(target).drawn);
        return new Set();
      },
    } as unknown as ThreeNS.WebGLRenderer;
    prewarmLampPool(renderer, scene, new THREE.PerspectiveCamera());
    expect(seen).toEqual([LAMP_POOL_SIZE]);
    expect(pointLights(scene).drawn).toBe(0);
  });
});
