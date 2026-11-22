// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAmbience, type UseAmbienceOptions } from './use-ambience';
import type { DecorativeStep } from '../three/frame-budget';

const audio = vi.hoisted(() => {
  const engine = { setRain: vi.fn(), footstep: vi.fn(), call: vi.fn(), door: vi.fn(), setMuted: vi.fn(), dispose: vi.fn() };
  const ctx = { state: 'running', resume: vi.fn(() => Promise.resolve()), suspend: vi.fn(() => Promise.resolve()) };
  return { engine, ctx };
});

vi.mock('../lib/sounds', () => ({ sharedAudioContext: () => audio.ctx }));
vi.mock('../lib/ambience-engine', () => ({ createAmbience: () => audio.engine }));

let steps: DecorativeStep[] = [];
let walked = 0;
let reduced = false;
let hour = 12;
let listener: { x: number; z: number; floorIndex: number } | null = { x: 0, z: 0, floorIndex: 0 };

beforeEach(() => {
  steps = [];
  walked = 0;
  reduced = false;
  hour = 12;
  listener = { x: 0, z: 0, floorIndex: 0 };
  vi.clearAllMocks();
  window.matchMedia = ((query: string) => ({ media: query, matches: reduced })) as unknown as typeof window.matchMedia;
});

afterEach(() => vi.restoreAllMocks());

/** The engine's module loads on demand: let it arrive. */
async function engineLoaded(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function setup(extra: Partial<UseAmbienceOptions> = {}) {
  const props: UseAmbienceOptions = {
    enabled: true,
    weather: 'rain',
    indoors: true,
    walkedDistance: () => walked,
    hour: () => hour,
    listener: () => listener,
    addDecorativeStep: (step) => {
      steps.push(step);
      return () => {
        steps = steps.filter((s) => s !== step);
      };
    },
    ...extra,
  };
  const hook = { ...renderHook((p: UseAmbienceOptions) => useAmbience(p), { initialProps: props }), props };
  await engineLoaded();
  return hook;
}

function walk(metres: number, frames: number): void {
  for (let i = 0; i < frames; i++) {
    walked += metres / frames;
    for (const step of steps) expect(step(1 / 30)).toBe(false);
  }
}

describe('useAmbience (#911)', () => {
  it('plays muffled rain indoors and opens it up outside', async () => {
    const hook = await setup();
    expect(audio.engine.setRain).toHaveBeenLastCalledWith({ gain: 0.07, cutoffHz: 900 });
    hook.rerender({ ...hook.props, indoors: false });
    expect(audio.engine.setRain).toHaveBeenLastCalledWith({ gain: 0.16, cutoffHz: 5200 });
  });

  it('steps by distance walked, on the frame budget', async () => {
    await setup();
    expect(steps).toHaveLength(1);
    walk(0, 10);
    expect(audio.engine.footstep).not.toHaveBeenCalled();
    walk(3.2, 32);
    expect(audio.engine.footstep).toHaveBeenCalledTimes(4);
    expect(audio.engine.footstep).toHaveBeenLastCalledWith(true);
  });

  it('keeps the rain but drops the footsteps with reduced motion', async () => {
    reduced = true;
    await setup();
    walk(3, 30);
    expect(audio.engine.footstep).not.toHaveBeenCalled();
    expect(audio.engine.setRain).toHaveBeenCalled();
  });

  it('mutes the ambience while the page is hidden, never the shared context, and tears down when switched off', async () => {
    const hook = await setup();
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    document.dispatchEvent(new Event('visibilitychange'));
    expect(audio.engine.setMuted).toHaveBeenLastCalledWith(true);
    Object.defineProperty(document, 'hidden', { configurable: true, value: false });
    document.dispatchEvent(new Event('visibilitychange'));
    expect(audio.engine.setMuted).toHaveBeenLastCalledWith(false);
    expect(audio.ctx.suspend).not.toHaveBeenCalled();
    hook.unmount();
    expect(audio.engine.dispose).toHaveBeenCalled();
    expect(steps).toHaveLength(0);
  });

  it('loads the engine only when wanted, and drops it if the walk ends first', async () => {
    const hook = renderHook((p: UseAmbienceOptions) => useAmbience(p), {
      initialProps: { enabled: true, weather: 'rain', indoors: true, walkedDistance: () => 0, hour: () => 12, listener: () => null, addDecorativeStep: () => () => undefined } as UseAmbienceOptions,
    });
    hook.unmount();
    await engineLoaded();
    expect(audio.engine.setRain).not.toHaveBeenCalled();
    expect(audio.engine.dispose).not.toHaveBeenCalled();
  });

  it('fetches the engine ahead when preloading, and plays nothing until enabled', async () => {
    await setup({ enabled: false, preload: true });
    expect(audio.engine.setRain).not.toHaveBeenCalled();
    expect(steps).toHaveLength(0);
  });

  it('makes no sound while off', async () => {
    const hook = await setup({ enabled: false });
    expect(audio.engine.setRain).not.toHaveBeenCalled();
    expect(steps).toHaveLength(0);
    hook.result.current('open', 0, 0, 0);
    expect(audio.engine.door).not.toHaveBeenCalled();
  });
});

describe('useAmbience: birds, crickets and doors (#911)', () => {
  afterEach(() => {
    audio.ctx.state = 'running';
  });

  it('lets nothing fall due while the context is suspended', async () => {
    hour = 23;
    audio.ctx.state = 'suspended';
    await setup({ weather: 'clear', indoors: false });
    seconds(20);
    walk(3, 30);
    expect(audio.engine.call).not.toHaveBeenCalled();
    expect(audio.engine.footstep).not.toHaveBeenCalled();
    // Running again: no backlog, the next call is a fresh wait away.
    audio.ctx.state = 'running';
    for (let i = 0; i < 3; i++) for (const step of steps) step(1 / 30);
    expect(audio.engine.call).not.toHaveBeenCalled();
    seconds(5);
    expect(audio.engine.call).toHaveBeenCalled();
  });

  const seconds = (count: number) => {
    for (let i = 0; i < count * 30; i++) for (const step of steps) step(1 / 30);
  };

  it('has birds call by day and crickets by night, on the frame budget', async () => {
    hour = 8;
    await setup({ weather: 'clear', indoors: false });
    seconds(20);
    const kinds = new Set(audio.engine.call.mock.calls.map((call) => call[0]));
    expect([...kinds]).toEqual(['birds']);
    expect(audio.engine.call.mock.calls.length).toBeGreaterThan(3);
    audio.engine.call.mockClear();
    // The clock is read live: no render needed.
    hour = 23;
    seconds(20);
    expect(new Set(audio.engine.call.mock.calls.map((call) => call[0]))).toEqual(new Set(['crickets']));
    expect(audio.engine.call.mock.calls.length).toBeGreaterThan(10);
  });

  it('is silent in the rain, and calls with reduced motion too', async () => {
    hour = 8;
    const rainy = await setup({ weather: 'rain', indoors: false });
    seconds(20);
    expect(audio.engine.call).not.toHaveBeenCalled();
    rainy.unmount();
    reduced = true;
    await setup({ weather: 'clear', indoors: false });
    seconds(20);
    expect(audio.engine.call).toHaveBeenCalled();
  });

  it('plays a door by its distance from the listener and its storey', async () => {
    const hook = await setup();
    hook.result.current('open', 1, 0, 0);
    const near = audio.engine.door.mock.calls[0]![1] as number;
    expect(audio.engine.door.mock.calls[0]![0]).toBe('open');
    hook.result.current('shut', 6, 0, 0);
    const far = audio.engine.door.mock.calls[1]![1] as number;
    expect(far).toBeLessThan(near);
    hook.result.current('open', 1, 0, 1);
    expect(audio.engine.door.mock.calls[2]![1] as number).toBeLessThan(near);
    listener = null;
    hook.result.current('open', 1, 0, 0);
    expect(audio.engine.door).toHaveBeenCalledTimes(3);
  });
});
