// @vitest-environment jsdom
import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAmbience, type UseAmbienceOptions } from './use-ambience';
import type { DecorativeStep } from '../three/frame-budget';

const audio = vi.hoisted(() => {
  const engine = { setRain: vi.fn(), footstep: vi.fn(), setMuted: vi.fn(), dispose: vi.fn() };
  const ctx = { state: 'running', resume: vi.fn(() => Promise.resolve()), suspend: vi.fn(() => Promise.resolve()) };
  return { engine, ctx };
});

vi.mock('../lib/sounds', () => ({ sharedAudioContext: () => audio.ctx }));
vi.mock('../lib/ambience', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/ambience')>()),
  createAmbience: () => audio.engine,
}));

let steps: DecorativeStep[] = [];
let walked = 0;
let reduced = false;

beforeEach(() => {
  steps = [];
  walked = 0;
  reduced = false;
  vi.clearAllMocks();
  window.matchMedia = ((query: string) => ({ media: query, matches: reduced })) as unknown as typeof window.matchMedia;
});

afterEach(() => vi.restoreAllMocks());

function setup(extra: Partial<UseAmbienceOptions> = {}) {
  const props: UseAmbienceOptions = {
    enabled: true,
    weather: 'rain',
    indoors: true,
    walkedDistance: () => walked,
    addDecorativeStep: (step) => {
      steps.push(step);
      return () => {
        steps = steps.filter((s) => s !== step);
      };
    },
    ...extra,
  };
  return { ...renderHook((p: UseAmbienceOptions) => useAmbience(p), { initialProps: props }), props };
}

function walk(metres: number, frames: number): void {
  for (let i = 0; i < frames; i++) {
    walked += metres / frames;
    for (const step of steps) expect(step(1 / 30)).toBe(false);
  }
}

describe('useAmbience (#911)', () => {
  it('plays muffled rain indoors and opens it up outside', () => {
    const hook = setup();
    expect(audio.engine.setRain).toHaveBeenLastCalledWith({ gain: 0.07, cutoffHz: 900 });
    hook.rerender({ ...hook.props, indoors: false });
    expect(audio.engine.setRain).toHaveBeenLastCalledWith({ gain: 0.16, cutoffHz: 5200 });
  });

  it('steps by distance walked, on the frame budget', () => {
    setup();
    expect(steps).toHaveLength(1);
    walk(0, 10);
    expect(audio.engine.footstep).not.toHaveBeenCalled();
    walk(3.2, 32);
    expect(audio.engine.footstep).toHaveBeenCalledTimes(4);
    expect(audio.engine.footstep).toHaveBeenLastCalledWith(true);
  });

  it('keeps the rain but drops the footsteps with reduced motion', () => {
    reduced = true;
    setup();
    walk(3, 30);
    expect(audio.engine.footstep).not.toHaveBeenCalled();
    expect(audio.engine.setRain).toHaveBeenCalled();
  });

  it('mutes the ambience while the page is hidden, never the shared context, and tears down when switched off', () => {
    const hook = setup();
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

  it('makes no sound while off', () => {
    setup({ enabled: false });
    expect(audio.engine.setRain).not.toHaveBeenCalled();
    expect(steps).toHaveLength(0);
  });
});
