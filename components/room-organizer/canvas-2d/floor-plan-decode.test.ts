import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { addFloorPlanRepaintHandler, ensureFloorPlanImageDecoded } from './render';

/**
 * A stand-in for HTMLImageElement: `src` starts an async "decode" that
 * flips `complete` and fires `load` (or `error` for a URL containing
 * "broken") on the next macrotask, like a data-URL decode in a browser.
 */
class FakeImage {
  static instances: FakeImage[] = [];
  complete = false;
  naturalWidth = 0;
  onload: (() => void) | null = null;
  private listeners = new Map<string, Array<() => void>>();
  private srcValue = '';

  constructor() {
    FakeImage.instances.push(this);
  }

  addEventListener(type: string, listener: () => void): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  get src(): string {
    return this.srcValue;
  }

  set src(value: string) {
    this.srcValue = value;
    setTimeout(() => {
      this.complete = true;
      const failed = value.includes('broken');
      if (!failed) {
        this.naturalWidth = 10;
        this.onload?.();
      }
      for (const listener of this.listeners.get(failed ? 'error' : 'load') ?? []) listener();
    }, 0);
  }
}

describe('ensureFloorPlanImageDecoded (#288)', () => {
  beforeEach(() => {
    FakeImage.instances = [];
    vi.stubGlobal('Image', FakeImage);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('starts the decode on a cache miss and resolves only once the image has loaded', async () => {
    let resolved = false;
    const promise = ensureFloorPlanImageDecoded('data:image/png;base64,AAAA').then(() => {
      resolved = true;
    });
    expect(FakeImage.instances).toHaveLength(1);
    expect(resolved).toBe(false);
    await promise;
    expect(resolved).toBe(true);
    expect(FakeImage.instances[0]!.complete).toBe(true);
  });

  it('reuses the cached image for the same URL and resolves immediately', async () => {
    await ensureFloorPlanImageDecoded('data:image/png;base64,AAAA');
    const count = FakeImage.instances.length;
    let resolvedSynchronously = false;
    const promise = ensureFloorPlanImageDecoded('data:image/png;base64,AAAA').then(() => {
      resolvedSynchronously = true;
    });
    // Resolved in a microtask, with no new Image and no load round-trip.
    await Promise.resolve();
    expect(resolvedSynchronously).toBe(true);
    expect(FakeImage.instances).toHaveLength(count);
    await promise;
  });

  it('notifies the repaint handlers like a render-initiated decode does', async () => {
    const repaint = vi.fn();
    const dispose = addFloorPlanRepaintHandler(repaint);
    await ensureFloorPlanImageDecoded('data:image/png;base64,BBBB');
    expect(repaint).toHaveBeenCalledTimes(1);
    dispose();
  });

  it('resolves rather than rejects for a broken image', async () => {
    await expect(ensureFloorPlanImageDecoded('data:image/png;base64,broken')).resolves.toBeUndefined();
  });
});
