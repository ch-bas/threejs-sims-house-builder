import { describe, expect, it, vi } from 'vitest';
import { createAmbience } from './ambience-engine';

/** An audio param that takes any schedule. */
const param = () => ({ value: 0, setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn(), cancelScheduledValues: vi.fn() });

/** A node that connects anywhere and returns what it connects to, as Web Audio's does. */
function node(extra: Record<string, unknown> = {}) {
  return {
    connect: vi.fn((to: unknown) => to),
    disconnect: vi.fn(),
    addEventListener: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(),
    onended: null,
    ...extra,
  };
}

/** Just enough of an AudioContext to build the graph and count what plays. */
function fakeContext(state: AudioContextState) {
  const ctx = {
    state,
    currentTime: 3,
    sampleRate: 100,
    destination: node(),
    createGain: vi.fn(() => node({ gain: param() })),
    createBiquadFilter: vi.fn(() => node({ frequency: param(), Q: param(), type: 'lowpass' })),
    createOscillator: vi.fn(() => node({ frequency: param(), type: 'sine' })),
    createBufferSource: vi.fn(() => node({ buffer: null, loop: false })),
    createBuffer: vi.fn((_channels: number, length: number) => ({ duration: 2, getChannelData: () => new Float32Array(length) })),
  };
  return ctx;
}

describe('the ambience engine (#911)', () => {
  it('plays calls, steps and doors on a running context', () => {
    const ctx = fakeContext('running');
    const ambience = createAmbience(ctx as unknown as AudioContext);
    const sources = ctx.createBufferSource.mock.calls.length;
    ambience.call('birds', 0.05);
    ambience.call('crickets', 0.02);
    ambience.door('open', 0.1);
    expect(ctx.createOscillator).toHaveBeenCalledTimes(4);
    ambience.footstep(true);
    ambience.door('shut', 0.1);
    expect(ctx.createBufferSource.mock.calls.length).toBe(sources + 2);
  });

  it('queues nothing on a suspended context, so a resume bursts nothing out', () => {
    const ctx = fakeContext('suspended');
    const ambience = createAmbience(ctx as unknown as AudioContext);
    const sources = ctx.createBufferSource.mock.calls.length;
    ambience.call('birds', 0.05);
    ambience.call('crickets', 0.02);
    ambience.door('open', 0.1);
    ambience.door('shut', 0.1);
    ambience.footstep(false);
    expect(ctx.createOscillator).not.toHaveBeenCalled();
    expect(ctx.createBufferSource.mock.calls.length).toBe(sources);
    // The rain is a ramp on a running loop, not a stack: it still follows.
    expect(() => ambience.setRain({ gain: 0.1, cutoffHz: 900 })).not.toThrow();
    ctx.state = 'running';
    ambience.call('birds', 0.05);
    expect(ctx.createOscillator).toHaveBeenCalledTimes(1);
  });
});
