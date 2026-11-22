import { describe, expect, it } from 'vitest';
import { advanceStride, doorSoundGain, doorSoundOf, nextCallDelay, rainSound, STRIDE_METRES, wildlifeSound } from './ambience';

describe('rainSound: weather and indoors to gain (#911)', () => {
  it('is silent under a clear sky and in snow', () => {
    for (const indoors of [false, true]) {
      expect(rainSound('clear', indoors).gain).toBe(0);
      expect(rainSound('snow', indoors).gain).toBe(0);
    }
  });

  it('is loud and bright outside, quieter and muffled under the roof', () => {
    const out = rainSound('rain', false);
    const inside = rainSound('rain', true);
    expect(out.gain).toBeGreaterThan(0);
    expect(inside.gain).toBeGreaterThan(0);
    expect(inside.gain).toBeLessThan(out.gain);
    expect(inside.cutoffHz).toBeLessThan(out.cutoffHz);
  });

  it('keeps the cutoff when the rain stops, so the fade never sweeps the filter', () => {
    expect(rainSound('clear', true).cutoffHz).toBe(rainSound('rain', true).cutoffHz);
    expect(rainSound('clear', false).cutoffHz).toBe(rainSound('rain', false).cutoffHz);
  });
});

describe('advanceStride: footsteps by distance (#911)', () => {
  it('steps once a stride is walked, and carries the rest', () => {
    let carry = 0;
    let steps = 0;
    // 3.2 m in 0.1 m frames: four strides.
    for (let i = 0; i < 32; i++) {
      const next = advanceStride(carry, 0.1);
      carry = next.carry;
      steps += next.steps;
    }
    expect(steps).toBe(Math.floor(3.2 / STRIDE_METRES));
  });

  it('is silent standing still, and never steps backwards', () => {
    expect(advanceStride(0, 0)).toEqual({ carry: 0, steps: 0 });
    expect(advanceStride(0.5, -1)).toEqual({ carry: 0.5, steps: 0 });
  });

  it('plays at most one step for a long frame', () => {
    expect(advanceStride(0, 5).steps).toBe(1);
  });
});

describe('wildlifeSound: the hour, the weather and indoors to gain (#911)', () => {
  it('has birds by day, loudest at dawn, and crickets only at night', () => {
    const at = (hour: number) => wildlifeSound(hour, 'clear', false);
    expect(at(3)).toEqual({ birds: 0, crickets: at(23).crickets });
    expect(at(23).crickets).toBeGreaterThan(0);
    expect(at(23).birds).toBe(0);
    expect(at(7).birds).toBeGreaterThan(at(14).birds);
    expect(at(14).birds).toBeGreaterThan(0);
    expect(at(14).crickets).toBe(0);
    // Not before 21:00 at full voice; gone by dawn.
    expect(at(20).crickets).toBe(0);
    expect(at(21).crickets).toBeLessThan(at(22).crickets);
    expect(at(5.5).crickets).toBe(0);
    expect(at(21).birds).toBe(0);
  });

  it('fades at the edges rather than switching', () => {
    const at = (hour: number) => wildlifeSound(hour, 'clear', false);
    for (const [from, to] of [[4.9, 5.1], [20.4, 20.6], [19.9, 20.1], [4.4, 4.6]] as const) {
      expect(Math.abs(at(from).birds - at(to).birds)).toBeLessThan(0.02);
      expect(Math.abs(at(from).crickets - at(to).crickets)).toBeLessThan(0.01);
    }
  });

  it('is silenced by rain, thinned by snow, and quieter indoors', () => {
    expect(wildlifeSound(7, 'rain', false)).toEqual({ birds: 0, crickets: 0 });
    expect(wildlifeSound(23, 'rain', false)).toEqual({ birds: 0, crickets: 0 });
    expect(wildlifeSound(23, 'snow', false).crickets).toBe(0);
    const snow = wildlifeSound(7, 'snow', false).birds;
    expect(snow).toBeGreaterThan(0);
    expect(snow).toBeLessThan(wildlifeSound(7, 'clear', false).birds);
    const inside = wildlifeSound(7, 'clear', true);
    const outside = wildlifeSound(7, 'clear', false);
    expect(inside.birds).toBeGreaterThan(0);
    expect(inside.birds).toBeLessThan(outside.birds / 2);
    expect(wildlifeSound(23, 'clear', true).crickets).toBeLessThan(wildlifeSound(23, 'clear', false).crickets);
  });

  it('wraps the hour', () => {
    expect(wildlifeSound(31, 'clear', false)).toEqual(wildlifeSound(7, 'clear', false));
    expect(wildlifeSound(-1, 'clear', false)).toEqual(wildlifeSound(23, 'clear', false));
  });
});

describe('nextCallDelay (#911)', () => {
  it('never calls at no gain', () => {
    expect(nextCallDelay('birds', 0, 0.5)).toBe(Infinity);
    expect(nextCallDelay('crickets', 0, 0.5)).toBe(Infinity);
  });

  it('spaces the calls by the draw, crickets closer than birds', () => {
    const birds = wildlifeSound(14, 'clear', false).birds;
    const crickets = wildlifeSound(23, 'clear', false).crickets;
    expect(nextCallDelay('birds', birds, 0)).toBeLessThan(nextCallDelay('birds', birds, 1));
    expect(nextCallDelay('crickets', crickets, 1)).toBeLessThan(nextCallDelay('birds', birds, 0.5));
    expect(nextCallDelay('crickets', crickets, 0)).toBeGreaterThan(0.3);
  });

  it('calls more often in the dawn chorus than at midday', () => {
    expect(nextCallDelay('birds', wildlifeSound(7, 'clear', false).birds, 0.5)).toBeLessThan(
      nextCallDelay('birds', wildlifeSound(14, 'clear', false).birds, 0.5)
    );
  });
});

describe('door sounds (#911)', () => {
  it('is loudest at the door, falls with distance, and is silent across the house', () => {
    expect(doorSoundGain(0.5, true)).toBe(doorSoundGain(1, true));
    expect(doorSoundGain(3, true)).toBeLessThan(doorSoundGain(1, true));
    expect(doorSoundGain(8, true)).toBeLessThan(doorSoundGain(3, true));
    expect(doorSoundGain(8, true)).toBeGreaterThan(0);
    expect(doorSoundGain(12, true)).toBe(0);
    expect(doorSoundGain(Infinity, true)).toBe(0);
    expect(doorSoundGain(Number.NaN, true)).toBe(0);
  });

  it('comes faintly through the floor from another storey', () => {
    expect(doorSoundGain(2, false)).toBeGreaterThan(0);
    expect(doorSoundGain(2, false)).toBeLessThan(doorSoundGain(2, true) / 2);
  });

  it('creaks as the leaf starts to open, knocks as it shuts, and is quiet between', () => {
    expect(doorSoundOf(0, 0.05)).toBe('open');
    expect(doorSoundOf(0.05, 0)).toBe('shut');
    expect(doorSoundOf(0.3, 0.5)).toBeNull();
    expect(doorSoundOf(0.5, 0.3)).toBeNull();
    expect(doorSoundOf(0, 0)).toBeNull();
  });
});

describe('the per-frame mappings write into a reused object (#911)', () => {
  it('fills the object it is given, and returns it', () => {
    const out = { birds: -1, crickets: -1 };
    expect(wildlifeSound(7, 'clear', false, out)).toBe(out);
    expect(out).toEqual(wildlifeSound(7, 'clear', false));
    const stride = { carry: -1, steps: -1 };
    expect(advanceStride(0.5, 0.5, STRIDE_METRES, stride)).toBe(stride);
    expect(stride).toEqual(advanceStride(0.5, 0.5));
  });
});
