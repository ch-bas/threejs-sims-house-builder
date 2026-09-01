import { describe, expect, it } from 'vitest';
import { slugify } from './library';

describe('slugify', () => {
  it('keeps short names unchanged (existing library saves keep their ids)', () => {
    expect(slugify('Beach House')).toBe('beach-house');
    expect(slugify('  My Cozy Loft!  ')).toBe('my-cozy-loft');
  });

  it('is stable for the same short name', () => {
    expect(slugify('Villa')).toBe(slugify('Villa'));
  });

  it('gives distinct slugs to two 60-char names sharing a 40-char prefix', () => {
    const prefix = 'a'.repeat(40);
    const nameA = `${prefix}${'b'.repeat(20)}`;
    const nameB = `${prefix}${'c'.repeat(20)}`;
    expect(nameA).toHaveLength(60);
    expect(nameB).toHaveLength(60);

    const slugA = slugify(nameA);
    const slugB = slugify(nameB);
    expect(slugA).not.toBe(slugB);
    // Both keep the readable truncated prefix and stay deterministic.
    expect(slugA.startsWith(prefix)).toBe(true);
    expect(slugB.startsWith(prefix)).toBe(true);
    expect(slugify(nameA)).toBe(slugA);
    expect(slugify(nameB)).toBe(slugB);
  });

  it('does not append a hash to a name exactly at the cap', () => {
    const name = 'a'.repeat(40);
    expect(slugify(name)).toBe(name);
  });

  it('falls back to a layout-* slug for names with no usable characters', () => {
    expect(slugify('!!!')).toMatch(/^layout-\d+$/);
  });
});
