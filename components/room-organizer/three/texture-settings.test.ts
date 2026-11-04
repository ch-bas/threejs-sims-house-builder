import * as THREE from 'three';
import { afterEach, describe, expect, it } from 'vitest';
import { getMaxAnisotropy, setMaxAnisotropy, withMaxAnisotropy } from './texture-settings';

describe('the anisotropy cap (#760)', () => {
  afterEach(() => setMaxAnisotropy(1));

  it('gives a new texture the cap set at renderer init', () => {
    setMaxAnisotropy(16);
    expect(withMaxAnisotropy(new THREE.Texture()).anisotropy).toBe(16);
  });

  it('reaches textures built before a new cap, cached ones included, and re-uploads them', () => {
    setMaxAnisotropy(16);
    const built = withMaxAnisotropy(new THREE.Texture({ width: 4, height: 4 } as never));
    const version = built.version;
    setMaxAnisotropy(4);
    expect(getMaxAnisotropy()).toBe(4);
    expect(built.anisotropy).toBe(4);
    expect(built.version).toBeGreaterThan(version);
    // A disposed cached texture comes back with the current cap too.
    built.dispose();
    setMaxAnisotropy(8);
    expect(built.anisotropy).toBe(8);
  });

  it('leaves a texture with no image yet for its first upload, and one already at the cap alone', () => {
    setMaxAnisotropy(16);
    const empty = withMaxAnisotropy(new THREE.Texture());
    const version = empty.version;
    setMaxAnisotropy(2);
    expect(empty.anisotropy).toBe(2);
    expect(empty.version).toBe(version);
    const same = withMaxAnisotropy(new THREE.Texture({ width: 4, height: 4 } as never));
    const sameVersion = same.version;
    setMaxAnisotropy(2);
    expect(same.version).toBe(sameVersion);
  });
});
