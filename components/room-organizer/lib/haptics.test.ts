import { afterEach, describe, expect, it, vi } from 'vitest';
import { WALL_RELEASE, canVibrate, createSnapTicker, cueHaptic, haptic, loadHapticsChoice, saveHapticsChoice, wallContact, wallLineKey } from './haptics';

/** A device: `coarse` for a touch-first pointer, `reduce` for reduced motion, `vibrate` when it has the API. */
function device({ coarse = true, reduce = false, vibrate = true }: { coarse?: boolean; reduce?: boolean; vibrate?: boolean } = {}) {
  const buzz = vi.fn((_pattern: number | number[]) => true);
  vi.stubGlobal('window', {
    matchMedia: (query: string) => ({
      matches: (query === '(pointer: coarse)' && coarse) || (query === '(prefers-reduced-motion: reduce)' && reduce),
    }),
  });
  vi.stubGlobal('navigator', vibrate ? { vibrate: buzz } : {});
  return buzz;
}

function memoryStorage(): Storage {
  const data = new Map<string, string>();
  return {
    get length() {
      return data.size;
    },
    clear: () => data.clear(),
    getItem: (key) => data.get(key) ?? null,
    key: (index) => [...data.keys()][index] ?? null,
    removeItem: (key) => void data.delete(key),
    setItem: (key, value) => void data.set(key, value),
  };
}

describe('haptic (#687)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('buzzes a touch-first device with a short pattern per kind', () => {
    const buzz = device();
    expect(canVibrate()).toBe(true);
    expect(haptic('place')).toBe(true);
    expect(haptic('snap')).toBe(true);
    expect(haptic('refused')).toBe(true);
    expect(buzz.mock.calls.map(([pattern]) => pattern)).toEqual([10, 6, [12, 60, 12]]);
  });

  it('never buzzes for a mouse, under reduced motion, or without the API', () => {
    for (const setting of [{ coarse: false }, { reduce: true }, { vibrate: false }]) {
      const buzz = device(setting);
      expect(haptic('place')).toBe(false);
      expect(buzz).not.toHaveBeenCalled();
    }
    device({ vibrate: false });
    expect(canVibrate()).toBe(false);
    vi.unstubAllGlobals();
    expect(haptic('place')).toBe(false);
  });

  it('a throwing vibrate is a no-op', () => {
    vi.stubGlobal('window', { matchMedia: (query: string) => ({ matches: query === '(pointer: coarse)' }) });
    vi.stubGlobal('navigator', { vibrate: () => { throw new Error('blocked'); } });
    expect(haptic('place')).toBe(false);
  });

  it('only the place and refused cues buzz', () => {
    const buzz = device();
    expect(cueHaptic('place')).toBe(true);
    expect(cueHaptic('refused')).toBe(true);
    expect(cueHaptic('rotate')).toBe(false);
    expect(cueHaptic('remove')).toBe(false);
    expect(cueHaptic('success')).toBe(false);
    expect(buzz).toHaveBeenCalledTimes(2);
  });

  it('the switch is on until turned off on this device', () => {
    const storage = memoryStorage();
    expect(loadHapticsChoice(storage)).toBe(true);
    saveHapticsChoice(false, storage);
    expect(loadHapticsChoice(storage)).toBe(false);
    saveHapticsChoice(true, storage);
    expect(loadHapticsChoice(storage)).toBe(true);
  });
});

describe('createSnapTicker (#687)', () => {
  const on = (...touching: string[]) => ({ touching, near: touching });
  const near = (...walls: string[]) => ({ touching: [], near: walls });

  it('buzzes on entering a wall, never for the walls the drag starts on', () => {
    const ticker = createSnapTicker();
    expect(ticker.next(on('north'))).toBe(false);
    expect(ticker.next(on('north'))).toBe(false);
    expect(ticker.next(on('north', 'east'))).toBe(true);
    ticker.reset();
    expect(ticker.next(on('east'))).toBe(false);
  });

  it('sliding out of a corner back onto one of its walls is no new wall', () => {
    const ticker = createSnapTicker();
    expect(ticker.next(on())).toBe(false);
    expect(ticker.next(on('west'))).toBe(true);
    expect(ticker.next(on('west', 'north'))).toBe(true);
    // Out along the west wall, still within reach of the north one, and back.
    expect(ticker.next({ touching: ['west'], near: ['west', 'north'] })).toBe(false);
    expect(ticker.next(on('west', 'north'))).toBe(false);
  });

  it('a finger wavering at the snap distance buzzes once, until it goes past the release band', () => {
    const ticker = createSnapTicker();
    expect(ticker.next(near())).toBe(false);
    expect(ticker.next(on('south'))).toBe(true);
    for (let i = 0; i < 5; i++) {
      expect(ticker.next(near('south'))).toBe(false);
      expect(ticker.next(on('south'))).toBe(false);
    }
    // Well clear of it, then back: a fresh arrival.
    expect(ticker.next(near())).toBe(false);
    expect(ticker.next(on('south'))).toBe(true);
  });
});

describe('wallContact (#687)', () => {
  const box = { width: 1, depth: 1, rotation: 0, category: 'seating' } as const;
  const house = { width: 8, height: 8 };

  it('is flush on a face to within float error, and near it inside the release band', () => {
    expect(wallContact({ x: -3.5, z: 0 }, box, house)).toEqual({ touching: ['west'], near: ['west'] });
    expect(wallContact({ x: -3.5 + 1e-9, z: 0 }, box, house).touching).toEqual(['west']);
    expect(wallContact({ x: -3.2, z: 0 }, box, house)).toEqual({ touching: [], near: ['west'] });
    expect(wallContact({ x: -3.5 + WALL_RELEASE + 0.01, z: 0 }, box, house)).toEqual({ touching: [], near: [] });
  });

  it('an outdoor item meets the outside face', () => {
    expect(wallContact({ x: 4.5, z: 0 }, { ...box, category: 'outdoor' }, house).touching).toEqual(['east']);
    expect(wallContact({ x: 3.5, z: 0 }, { ...box, category: 'outdoor' }, house).touching).toEqual([]);
  });
});

describe('wallLineKey (#687)', () => {
  it('is one key along a wall and through a flip, another on a parallel or crossing wall', () => {
    const along = wallLineKey({ x: 1, z: -2 }, 0);
    expect(wallLineKey({ x: 3.5, z: -2 }, 0)).toBe(along);
    expect(wallLineKey({ x: 3.5, z: -2 }, Math.PI)).toBe(along);
    expect(wallLineKey({ x: 3.5, z: 2 }, 0)).not.toBe(along);
    const side = wallLineKey({ x: 4, z: 0 }, Math.PI / 2);
    expect(wallLineKey({ x: 4, z: 1.5 }, -Math.PI / 2)).toBe(side);
    expect(side).not.toBe(along);
    // A diagonal wall: sliding along its direction keeps the key.
    const theta = -Math.atan2(1, 1);
    expect(wallLineKey({ x: 1, z: 1 }, theta)).toBe(wallLineKey({ x: 2, z: 2 }, theta));
  });
});
