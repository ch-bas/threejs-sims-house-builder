// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { makeLayout } from './__testfixtures__/fixtures';
import {
  countUnreadableSavedLayouts,
  deleteNamedLayout,
  layoutSlugExists,
  listSavedLayouts,
  loadNamedLayout,
  parseLibraryIndex,
  parseSavedLayoutEntry,
  saveNamedLayout,
  slugify,
} from './library';
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
      if (used > capacity) throw new DOMException('QuotaExceededError', 'QuotaExceededError');
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

describe('library index — validated on read (#348)', () => {
  const INDEX_KEY = 'standalone-room-organizer-library:_index';
  const good = { id: 'beach-house', name: 'Beach House', savedAt: 2, itemCount: 3, floorCount: 1 };

  afterEach(() => {
    window.localStorage.clear();
  });

  function storedIndex(): Record<string, unknown> {
    return JSON.parse(window.localStorage.getItem(INDEX_KEY)!) as Record<string, unknown>;
  }

  it('parseSavedLayoutEntry rejects anything the panel could not render or sort', () => {
    expect(parseSavedLayoutEntry(good)).toEqual(good);
    expect(parseSavedLayoutEntry(null)).toBeNull();
    expect(parseSavedLayoutEntry([])).toBeNull();
    expect(parseSavedLayoutEntry({ ...good, id: '' })).toBeNull();
    expect(parseSavedLayoutEntry({ ...good, name: {} })).toBeNull();
    expect(parseSavedLayoutEntry({ ...good, savedAt: null })).toBeNull();
    expect(parseSavedLayoutEntry({ ...good, itemCount: Number.NaN })).toBeNull();
    const { floorCount: _missing, ...partial } = good;
    expect(parseSavedLayoutEntry(partial)).toBeNull();
  });

  it('parseLibraryIndex sets malformed entries and duplicate ids aside', () => {
    const index = parseLibraryIndex(
      JSON.stringify({ entries: [null, good, { id: 'x', name: {} }, { ...good, name: 'Dup' }] })
    );
    expect(index.entries).toEqual([good]);
    expect(index.unreadable).toEqual([null, { id: 'x', name: {} }, { ...good, name: 'Dup' }]);
  });

  it('parseLibraryIndex keeps a corrupt or wrong-shaped index as one unreadable value', () => {
    expect(parseLibraryIndex(null).unreadable).toEqual([]);
    expect(parseLibraryIndex('null').unreadable).toEqual([]);
    expect(parseLibraryIndex('{oops').unreadable).toEqual(['{oops']);
    expect(parseLibraryIndex('[null]').unreadable).toEqual([[null]]);
    expect(parseLibraryIndex('{"entries":"no"}').unreadable).toEqual([{ entries: 'no' }]);
  });

  it('lists only the valid entries, without throwing (the audit repro)', () => {
    window.localStorage.setItem(INDEX_KEY, JSON.stringify({ entries: [null, { id: 'x', name: {} }, good] }));
    expect(listSavedLayouts()).toEqual([good]);
    expect(countUnreadableSavedLayouts()).toBe(2);
  });

  it('caps a long save name like the schema does, so the saved house loads as it was listed', () => {
    const result = saveNamedLayout(makeLayout(), 'N'.repeat(300));
    expect(result).not.toBeNull();
    const [entry] = listSavedLayouts();
    expect(entry!.name).toBe('N'.repeat(200));
    expect(loadNamedLayout(entry!.id)!.name).toBe(entry!.name);
  });

  it('keeps unreadable entries and unknown fields through a save and a delete', () => {
    window.localStorage.setItem(
      INDEX_KEY,
      JSON.stringify({ format: 1, entries: [null, { id: 'x', name: {} }, good] })
    );
    expect(saveNamedLayout(makeLayout(), 'Cabin')).not.toBeNull();
    expect(listSavedLayouts().map((entry) => entry.id).sort()).toEqual(['beach-house', 'cabin']);
    expect(deleteNamedLayout('cabin')).toBe(true);
    expect(deleteNamedLayout('beach-house')).toBe(true);
    expect(storedIndex()).toEqual({ format: 1, entries: [null, { id: 'x', name: {} }] });
    expect(countUnreadableSavedLayouts()).toBe(2);
  });

  it('deleting a house drops a duplicate index entry for it too, so no unloadable row is left', () => {
    expect(saveNamedLayout(makeLayout(), 'Villa')).not.toBeNull();
    const index = storedIndex();
    const villa = (index.entries as unknown[])[0];
    window.localStorage.setItem(INDEX_KEY, JSON.stringify({ ...index, entries: [villa, villa] }));
    expect(deleteNamedLayout('villa')).toBe(true);
    expect(listSavedLayouts()).toEqual([]);
    expect(countUnreadableSavedLayouts()).toBe(0);
  });

  it('keeps fields of a listed entry it does not know through a rewrite', () => {
    window.localStorage.setItem(INDEX_KEY, JSON.stringify({ entries: [{ ...good, thumbnail: 'data:x' }] }));
    expect(saveNamedLayout(makeLayout(), 'Cabin')).not.toBeNull();
    expect(storedIndex().entries).toContainEqual({ ...good, thumbnail: 'data:x' });
  });

  it('keeps a corrupt index blob beside a new save', () => {
    window.localStorage.setItem(INDEX_KEY, '{oops');
    expect(saveNamedLayout(makeLayout(), 'Cabin')).not.toBeNull();
    expect(listSavedLayouts().map((entry) => entry.id)).toEqual(['cabin']);
    expect((storedIndex().entries as unknown[])[1]).toBe('{oops');
  });

  it('asks before overwriting the blob of an unreadable entry, and replaces that entry on save', () => {
    window.localStorage.setItem(INDEX_KEY, JSON.stringify({ entries: [{ id: 'cabin', name: 42 }] }));
    expect(layoutSlugExists('Cabin')).toBe(true);
    expect(saveNamedLayout(makeLayout(), 'Cabin')).not.toBeNull();
    expect(listSavedLayouts().map((entry) => entry.id)).toEqual(['cabin']);
    expect(countUnreadableSavedLayouts()).toBe(0);
  });
});
