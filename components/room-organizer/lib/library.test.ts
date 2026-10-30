// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { makeFloor, makeItem, makeLayout } from './__testfixtures__/fixtures';
import {
  AUTOSAVE_HEADROOM_MIN_CHARS,
  countUnreadableSavedLayouts,
  deleteNamedLayout,
  layoutSlugExists,
  librarySaveFailureMessage,
  librarySlotId,
  listSavedLayouts,
  loadNamedLayout,
  parseLibraryIndex,
  parseSavedLayoutEntry,
  saveNamedLayout,
} from './library';
import { saveLayout } from './persistence';
import { listSnapshots, recordSnapshot } from './version-history';

describe('librarySlotId', () => {
  it('keeps short names unchanged (existing library saves keep their ids)', () => {
    expect(librarySlotId('Beach House')).toBe('beach-house');
    expect(librarySlotId('  My Cozy Loft!  ')).toBe('my-cozy-loft');
  });

  it('is stable for the same short name', () => {
    expect(librarySlotId('Villa')).toBe(librarySlotId('Villa'));
  });

  it('gives distinct slugs to two 60-char names sharing a 40-char prefix', () => {
    const prefix = 'a'.repeat(40);
    const nameA = `${prefix}${'b'.repeat(20)}`;
    const nameB = `${prefix}${'c'.repeat(20)}`;
    expect(nameA).toHaveLength(60);
    expect(nameB).toHaveLength(60);

    const slugA = librarySlotId(nameA);
    const slugB = librarySlotId(nameB);
    expect(slugA).not.toBe(slugB);
    // Both keep the readable truncated prefix and stay deterministic.
    expect(slugA.startsWith(prefix)).toBe(true);
    expect(slugB.startsWith(prefix)).toBe(true);
    expect(librarySlotId(nameA)).toBe(slugA);
    expect(librarySlotId(nameB)).toBe(slugB);
  });

  it('does not append a hash to a name exactly at the cap', () => {
    const name = 'a'.repeat(40);
    expect(librarySlotId(name)).toBe(name);
  });

  it('keys a name with no usable characters by a stable hash, not the time (#550)', () => {
    expect(librarySlotId('!!!')).toMatch(/^u_[0-9a-z]{6}$/);
    expect(librarySlotId('!!!')).toBe(librarySlotId('!!!'));
    expect(librarySlotId('!!!')).not.toBe(librarySlotId('???'));
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
    // A ring bigger than the copy plus the autosave's headroom (#565), which
    // counts as free room: the copy fits only once the ring gives way.
    const items = Array.from({ length: 800 }, (_, i) => makeItem({ id: `item-${i}` }));
    expect(recordSnapshot(makeLayout({ name: 'Snapshotted', floors: [makeFloor({ items })] }))).toBe(true);
    expect(listSnapshots()).toHaveLength(1);
    expect(window.localStorage.getItem('standalone-room-organizer-layout-versions')!.length).toBeGreaterThan(
      AUTOSAVE_HEADROOM_MIN_CHARS + 1_000
    );
    limitQuota(usage() + 50);

    const result = saveNamedLayout(makeLayout(), 'Beach House');
    expect(result).toMatchObject({ ok: true, entry: { id: 'beach-house' } });
    expect(loadNamedLayout('beach-house')?.name).toBe('Beach House');
    expect(listSavedLayouts()).toHaveLength(1);
    expect(listSnapshots()).toHaveLength(0);
  });

  it('still reports storage full when there is nothing left to evict', () => {
    limitQuota(20);
    expect(saveNamedLayout(makeLayout(), 'Beach House')).toEqual({ ok: false, reason: 'quota' });
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
    expect(result).toMatchObject({ ok: true });
    const [entry] = listSavedLayouts();
    expect(entry!.name).toBe('N'.repeat(200));
    expect(loadNamedLayout(entry!.id)!.name).toBe(entry!.name);
  });

  it('keeps unreadable entries and unknown fields through a save and a delete', () => {
    window.localStorage.setItem(
      INDEX_KEY,
      JSON.stringify({ format: 1, entries: [null, { id: 'x', name: {} }, good] })
    );
    expect(saveNamedLayout(makeLayout(), 'Cabin').ok).toBe(true);
    expect(listSavedLayouts().map((entry) => entry.id).sort()).toEqual(['beach-house', 'cabin']);
    expect(deleteNamedLayout('cabin')).toBe(true);
    expect(deleteNamedLayout('beach-house')).toBe(true);
    expect(storedIndex()).toEqual({ format: 1, entries: [null, { id: 'x', name: {} }] });
    expect(countUnreadableSavedLayouts()).toBe(2);
  });

  it('deleting a house drops a duplicate index entry for it too, so no unloadable row is left', () => {
    expect(saveNamedLayout(makeLayout(), 'Villa').ok).toBe(true);
    const index = storedIndex();
    const villa = (index.entries as unknown[])[0];
    window.localStorage.setItem(INDEX_KEY, JSON.stringify({ ...index, entries: [villa, villa] }));
    expect(deleteNamedLayout('villa')).toBe(true);
    expect(listSavedLayouts()).toEqual([]);
    expect(countUnreadableSavedLayouts()).toBe(0);
  });

  it('keeps fields of a listed entry it does not know through a rewrite', () => {
    window.localStorage.setItem(INDEX_KEY, JSON.stringify({ entries: [{ ...good, thumbnail: 'data:x' }] }));
    expect(saveNamedLayout(makeLayout(), 'Cabin').ok).toBe(true);
    expect(storedIndex().entries).toContainEqual({ ...good, thumbnail: 'data:x' });
  });

  it('keeps a corrupt index blob beside a new save', () => {
    window.localStorage.setItem(INDEX_KEY, '{oops');
    expect(saveNamedLayout(makeLayout(), 'Cabin').ok).toBe(true);
    expect(listSavedLayouts().map((entry) => entry.id)).toEqual(['cabin']);
    expect((storedIndex().entries as unknown[])[1]).toBe('{oops');
  });

  it('asks before overwriting the blob of an unreadable entry, and replaces that entry on save', () => {
    window.localStorage.setItem(INDEX_KEY, JSON.stringify({ entries: [{ id: 'cabin', name: 42 }] }));
    expect(layoutSlugExists('Cabin')).toBe(true);
    expect(saveNamedLayout(makeLayout(), 'Cabin').ok).toBe(true);
    expect(listSavedLayouts().map((entry) => entry.id)).toEqual(['cabin']);
    expect(countUnreadableSavedLayouts()).toBe(0);
  });
});

/** Reject any write that would push total usage past `capacity` characters. */
function limitStorageTo(capacity: number): void {
  const original = Storage.prototype.setItem;
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key: string, value: string) {
    let used = key.length + value.length;
    for (let i = 0; i < this.length; i++) {
      const other = this.key(i);
      if (other !== null && other !== key) used += other.length + (this.getItem(other) ?? '').length;
    }
    if (used > capacity) throw new DOMException('QuotaExceededError', 'QuotaExceededError');
    original.call(this, key, value);
  });
}

function storageUsage(): number {
  let used = 0;
  for (let i = 0; i < window.localStorage.length; i++) {
    const key = window.localStorage.key(i)!;
    used += key.length + (window.localStorage.getItem(key) ?? '').length;
  }
  return used;
}

describe('saveNamedLayout — the open house keeps room to autosave (#565)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    window.localStorage.clear();
  });

  const plan = `data:image/png;base64,${'A'.repeat(30_000)}`;

  it('refuses the library copy that would leave autosave no room (the issue repro)', () => {
    limitStorageTo(200_000);
    const house = makeLayout({ name: 'Traced', floorPlanImage: plan });
    expect(saveLayout(house).ok).toBe(true);

    let saved = 0;
    let refusal: unknown = null;
    for (let copy = 1; copy <= 10; copy++) {
      const result = saveNamedLayout(house, `Copy ${copy}`);
      if (!result.ok) {
        refusal = result.reason;
        break;
      }
      saved++;
    }
    expect(saved).toBeGreaterThan(0);
    expect(refusal).toBe('autosave-room');
    expect(listSavedLayouts()).toHaveLength(saved);

    const items = Array.from({ length: 150 }, (_, i) =>
      makeItem({ id: `item-${i}`, position: { x: i % 7, z: i % 5 } })
    );
    const grown = { ...house, floors: [makeFloor({ items })] };
    expect(saveLayout(grown)).toMatchObject({ ok: true });
  });

  it('says why: the refusal names autosave, not a generic full storage', () => {
    expect(librarySaveFailureMessage('autosave-room')).toMatch(/autosave/i);
    expect(librarySaveFailureMessage('quota')).toMatch(/full/i);
  });

  it('offers deleting saved layouts only when there are some', () => {
    expect(librarySaveFailureMessage('autosave-room')).not.toMatch(/Delete some saved layouts/);
    expect(saveNamedLayout(makeLayout(), 'One').ok).toBe(true);
    expect(librarySaveFailureMessage('autosave-room')).toMatch(/Delete some saved layouts/);
  });

  it('evicts no restore point while finding out a copy would not fit', () => {
    const house = makeLayout({ name: 'Ringed' });
    expect(saveLayout(house).ok).toBe(true);
    expect(recordSnapshot(makeLayout({ name: 'Snapshotted', floorPlanImage: plan }))).toBe(true);
    const ring = listSnapshots();
    expect(ring).toHaveLength(1);
    // Room for the copy itself, but not for the autosave's headroom.
    limitStorageTo(storageUsage() + 1_000);
    const result = saveNamedLayout(house, 'Copy');
    expect(result).toEqual({ ok: false, reason: 'autosave-room' });
    expect(listSavedLayouts()).toHaveLength(0);
    expect(listSnapshots()).toEqual(ring);
  });

  it('leaves the stored library untouched by a refused save', () => {
    const house = makeLayout({ name: 'Kept' });
    expect(saveNamedLayout(house, 'Kept').ok).toBe(true);
    const before = window.localStorage.getItem('standalone-room-organizer-library:kept');
    limitStorageTo(storageUsage() + 100);
    expect(saveNamedLayout({ ...house, floorPlanImage: plan }, 'Kept')).toMatchObject({ ok: false });
    expect(window.localStorage.getItem('standalone-room-organizer-library:kept')).toBe(before);
    expect(listSavedLayouts()).toHaveLength(1);
  });
});

describe('library slots for names outside ASCII (#550)', () => {
  const INDEX_KEY = 'standalone-room-organizer-library:_index';

  afterEach(() => {
    window.localStorage.clear();
  });

  it('keeps every ASCII slot byte-identical', () => {
    expect(librarySlotId('Beach House')).toBe('beach-house');
    expect(librarySlotId('🏠 Home')).toBe('home');
    expect(librarySlotId('Caf')).toBe('caf');
  });

  it('gives a non-Latin name one stable slot, so a second save overwrites it', () => {
    expect(librarySlotId('東京の家')).toBe(librarySlotId('東京の家'));
    expect(saveNamedLayout(makeLayout(), '東京の家')).toMatchObject({ ok: true, overwrote: false });
    expect(layoutSlugExists('東京の家')).toBe(true);
    expect(saveNamedLayout(makeLayout(), '東京の家')).toMatchObject({ ok: true, overwrote: true });
    expect(listSavedLayouts()).toHaveLength(1);
  });

  it('keeps "Café" and "Caf" apart, and "我的家", "Дом мечты", "بيت" each on their own slot', () => {
    const names = ['Café', 'Caf', '我的家', 'Дом мечты', 'بيت'];
    for (const name of names) expect(saveNamedLayout(makeLayout(), name).ok).toBe(true);
    expect(new Set(names.map(librarySlotId)).size).toBe(names.length);
    const listed = listSavedLayouts();
    expect(listed.map((entry) => entry.name).sort()).toEqual([...names].sort());
    for (const entry of listed) expect(loadNamedLayout(entry.id)?.name).toBe(entry.name);
  });

  it('gives a name with no letters at all one stable slot too', () => {
    expect(saveNamedLayout(makeLayout(), '!!!')).toMatchObject({ ok: true, overwrote: false });
    expect(saveNamedLayout(makeLayout(), '!!!')).toMatchObject({ ok: true, overwrote: true });
    expect(listSavedLayouts()).toHaveLength(1);
  });

  function storeLegacy(id: string, name: string, savedAt: number): void {
    const index = JSON.parse(window.localStorage.getItem(INDEX_KEY) ?? '{"entries":[]}') as { entries: unknown[] };
    index.entries.push({ id, name, savedAt, itemCount: 0, floorCount: 1 });
    window.localStorage.setItem(INDEX_KEY, JSON.stringify(index));
    window.localStorage.setItem(`standalone-room-organizer-library:${id}`, JSON.stringify(makeLayout({ name })));
  }

  it('still loads a "Café" saved under the old ASCII slot, and saving "Caf" moves it instead of overwriting it', () => {
    storeLegacy('caf', 'Café', 1);
    expect(loadNamedLayout('caf')?.name).toBe('Café');
    expect(layoutSlugExists('Caf')).toBe(false);
    expect(saveNamedLayout(makeLayout({ name: 'Caf' }), 'Caf')).toMatchObject({ ok: true, overwrote: false });
    const listed = listSavedLayouts();
    expect(listed.map((entry) => entry.name).sort()).toEqual(['Caf', 'Café']);
    for (const entry of listed) expect(loadNamedLayout(entry.id)?.name).toBe(entry.name);
    expect(listed.find((entry) => entry.name === 'Café')?.id).toBe(librarySlotId('Café'));
  });

  it('re-saving a name kept under an old slot replaces that entry instead of adding a duplicate', () => {
    storeLegacy('caf', 'Café', 1);
    storeLegacy('layout-1700000000000', '東京の家', 2);
    expect(layoutSlugExists('Café')).toBe(true);
    expect(layoutSlugExists('東京の家')).toBe(true);
    expect(saveNamedLayout(makeLayout(), 'Café')).toMatchObject({ ok: true, overwrote: true });
    expect(saveNamedLayout(makeLayout(), '東京の家')).toMatchObject({ ok: true, overwrote: true });
    expect(listSavedLayouts().map((entry) => entry.id).sort()).toEqual(
      [librarySlotId('Café'), librarySlotId('東京の家')].sort()
    );
    expect(window.localStorage.getItem('standalone-room-organizer-library:caf')).toBeNull();
    expect(window.localStorage.getItem('standalone-room-organizer-library:layout-1700000000000')).toBeNull();
  });

  it('keeps the older of two legacy duplicates of one name', () => {
    storeLegacy('layout-1', 'بيت', 1);
    storeLegacy('layout-2', 'بيت', 2);
    expect(saveNamedLayout(makeLayout(), 'بيت')).toMatchObject({ ok: true, overwrote: true });
    expect(listSavedLayouts().map((entry) => entry.id).sort()).toEqual(['layout-1', librarySlotId('بيت')].sort());
    expect(loadNamedLayout('layout-1')?.name).toBe('بيت');
  });
});
