// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { makeLayout } from './__testfixtures__/fixtures';
import { listSavedLayouts, loadNamedLayout, saveNamedLayout, slugify } from './library';
import { listSnapshots, recordSnapshot } from './version-history';

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

describe('saveNamedLayout — restore points give way on a full quota (#295)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    window.localStorage.clear();
  });

  /** Reject any write that would push total usage past `capacity` characters. */
  function limitQuota(capacity: number): void {
    const original = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (
      this: Storage,
      key: string,
      value: string
    ) {
      let used = key.length + value.length;
      for (let i = 0; i < this.length; i++) {
        const other = this.key(i);
        if (other !== null && other !== key) used += other.length + (this.getItem(other) ?? '').length;
      }
      if (used > capacity) throw new Error('QuotaExceededError');
      original.call(this, key, value);
    });
  }

  function usage(): number {
    let used = 0;
    for (let i = 0; i < window.localStorage.length; i++) {
      const key = window.localStorage.key(i)!;
      used += key.length + (window.localStorage.getItem(key) ?? '').length;
    }
    return used;
  }

  it('evicts the ring and saves instead of reporting storage full', () => {
    expect(recordSnapshot(makeLayout({ name: 'Snapshotted' }))).toBe(true);
    expect(listSnapshots()).toHaveLength(1);
    limitQuota(usage() + 50);

    const result = saveNamedLayout(makeLayout(), 'Beach House');
    expect(result?.entry.id).toBe('beach-house');
    expect(loadNamedLayout('beach-house')?.name).toBe('Beach House');
    expect(listSavedLayouts()).toHaveLength(1);
    expect(listSnapshots()).toHaveLength(0);
  });

  it('still returns null when there is nothing left to evict', () => {
    limitQuota(20);
    expect(saveNamedLayout(makeLayout(), 'Beach House')).toBeNull();
    expect(listSavedLayouts()).toHaveLength(0);
  });
});
