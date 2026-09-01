/**
 * Tiny LRU cache for procedural texture masters (floor/wall/roof/label
 * CanvasTextures). The caches are keyed partly on user-pickable colours, so
 * without a cap, dragging a colour input leaks one permanent 256px canvas +
 * GPU texture per unique colour for the whole session. On insert beyond the
 * cap the least-recently-used master is evicted and `.dispose()`d.
 *
 * Evicting a master is safe for meshes already on screen: callers receive
 * `.clone()`s, and in three.js the GL texture behind a shared `Source` is
 * refcounted per user (`WebGLTextures.deallocateTexture` decrements
 * `usedTimes` and only deletes at zero), so disposing the evicted master
 * never frees an image a live clone still renders.
 */

/** Default cap per texture cache — comfortably above the handful of
 * pattern/colour combos a real layout uses at once. */
export const TEXTURE_CACHE_CAPACITY = 32;

export class DisposableLruCache<T extends { dispose(): void }> {
  /** Map iteration order doubles as recency order: oldest entry first. */
  private readonly entries = new Map<string, T>();

  constructor(private readonly capacity: number = TEXTURE_CACHE_CAPACITY) {
    if (capacity < 1) throw new Error('DisposableLruCache capacity must be >= 1');
  }

  /** Returns the cached value (marking it most-recently-used) or undefined. */
  get(key: string): T | undefined {
    const value = this.entries.get(key);
    if (value !== undefined) {
      this.entries.delete(key);
      this.entries.set(key, value);
    }
    return value;
  }

  /** Inserts as most-recently-used; evicts + disposes the LRU entry beyond capacity. */
  set(key: string, value: T): void {
    this.entries.delete(key);
    this.entries.set(key, value);
    while (this.entries.size > this.capacity) {
      const oldestKey = this.entries.keys().next().value as string;
      const oldest = this.entries.get(oldestKey);
      this.entries.delete(oldestKey);
      oldest?.dispose();
    }
  }

  get size(): number {
    return this.entries.size;
  }
}
