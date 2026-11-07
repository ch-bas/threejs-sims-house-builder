import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { holdForShaderWarmup } from './shader-warmup';

// The first frame waits for the first scene's shaders (#730), once, and
// never for longer than the limit.

function deferred(): { promise: Promise<void>; resolve: () => void; reject: (error: Error) => void } {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('holdForShaderWarmup', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('holds until the compile settles, then releases once', async () => {
    const compile = deferred();
    const release = vi.fn();
    holdForShaderWarmup(() => compile.promise, release, 4000);
    await vi.advanceTimersByTimeAsync(500);
    expect(release).not.toHaveBeenCalled();
    compile.resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(release).toHaveBeenCalledOnce();
    // The limit passing later changes nothing.
    await vi.advanceTimersByTimeAsync(5000);
    expect(release).toHaveBeenCalledOnce();
  });

  it('releases when the compile fails', async () => {
    const compile = deferred();
    const release = vi.fn();
    holdForShaderWarmup(() => compile.promise, release, 4000);
    compile.reject(new Error('context lost'));
    await vi.advanceTimersByTimeAsync(0);
    expect(release).toHaveBeenCalledOnce();
  });

  it('releases when the compile throws before returning a promise', () => {
    const release = vi.fn();
    holdForShaderWarmup(() => {
      throw new Error('no compileAsync');
    }, release, 4000);
    expect(release).toHaveBeenCalledOnce();
  });

  it('releases at the limit when the compile hangs, and not again when it settles', async () => {
    const compile = deferred();
    const release = vi.fn();
    holdForShaderWarmup(() => compile.promise, release, 4000);
    await vi.advanceTimersByTimeAsync(3999);
    expect(release).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(release).toHaveBeenCalledOnce();
    compile.resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(release).toHaveBeenCalledOnce();
  });

  it('releases on cleanup, and a later settle of that compile does nothing', async () => {
    const compile = deferred();
    const release = vi.fn();
    const cleanup = holdForShaderWarmup(() => compile.promise, release, 4000);
    cleanup();
    expect(release).toHaveBeenCalledOnce();
    compile.resolve();
    await vi.advanceTimersByTimeAsync(5000);
    expect(release).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });
});
