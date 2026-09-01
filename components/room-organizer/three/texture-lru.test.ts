import { describe, expect, it } from 'vitest';
import { DisposableLruCache, TEXTURE_CACHE_CAPACITY } from './texture-lru';

class FakeTexture {
  disposed = false;
  dispose(): void {
    this.disposed = true;
  }
}

describe('DisposableLruCache', () => {
  it('stores and retrieves values under capacity without disposing', () => {
    const cache = new DisposableLruCache<FakeTexture>(3);
    const a = new FakeTexture();
    const b = new FakeTexture();
    cache.set('a', a);
    cache.set('b', b);

    expect(cache.get('a')).toBe(a);
    expect(cache.get('b')).toBe(b);
    expect(cache.get('missing')).toBeUndefined();
    expect(cache.size).toBe(2);
    expect(a.disposed).toBe(false);
    expect(b.disposed).toBe(false);
  });

  it('evicts and disposes the least-recently-inserted entry beyond capacity', () => {
    const cache = new DisposableLruCache<FakeTexture>(2);
    const a = new FakeTexture();
    const b = new FakeTexture();
    const c = new FakeTexture();
    cache.set('a', a);
    cache.set('b', b);
    cache.set('c', c); // evicts 'a'

    expect(a.disposed).toBe(true);
    expect(cache.get('a')).toBeUndefined();
    expect(cache.get('b')).toBe(b);
    expect(cache.get('c')).toBe(c);
    expect(cache.size).toBe(2);
  });

  it('treats get() as a use: recently read entries survive eviction', () => {
    const cache = new DisposableLruCache<FakeTexture>(2);
    const a = new FakeTexture();
    const b = new FakeTexture();
    const c = new FakeTexture();
    cache.set('a', a);
    cache.set('b', b);
    cache.get('a'); // refresh 'a' → 'b' is now LRU
    cache.set('c', c); // evicts 'b'

    expect(b.disposed).toBe(true);
    expect(a.disposed).toBe(false);
    expect(cache.get('a')).toBe(a);
    expect(cache.get('b')).toBeUndefined();
    expect(cache.get('c')).toBe(c);
  });

  it('re-setting an existing key refreshes recency without disposing the old value', () => {
    const cache = new DisposableLruCache<FakeTexture>(2);
    const a1 = new FakeTexture();
    const a2 = new FakeTexture();
    const b = new FakeTexture();
    const c = new FakeTexture();
    cache.set('a', a1);
    cache.set('b', b);
    cache.set('a', a2); // overwrite: 'b' becomes LRU; a1 is NOT auto-disposed
    cache.set('c', c); // evicts 'b'

    expect(a1.disposed).toBe(false);
    expect(b.disposed).toBe(true);
    expect(cache.get('a')).toBe(a2);
    expect(cache.get('c')).toBe(c);
  });

  it('rejects a capacity below one', () => {
    expect(() => new DisposableLruCache(0)).toThrow();
  });

  it('exposes a default capacity suited to per-colour texture caches', () => {
    expect(TEXTURE_CACHE_CAPACITY).toBe(32);
    const cache = new DisposableLruCache<FakeTexture>();
    const textures: FakeTexture[] = [];
    for (let i = 0; i < TEXTURE_CACHE_CAPACITY + 1; i += 1) {
      const t = new FakeTexture();
      textures.push(t);
      cache.set(`#${i.toString(16).padStart(6, '0')}`, t);
    }
    expect(cache.size).toBe(TEXTURE_CACHE_CAPACITY);
    expect(textures[0]?.disposed).toBe(true);
    expect(textures[1]?.disposed).toBe(false);
  });
});
