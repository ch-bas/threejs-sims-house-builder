import { describe, expect, it } from 'vitest';
import { STORAGE_KEY } from './constants';
import { CUSTOM_SETS_STORAGE_KEY } from './custom-sets';
import { LIBRARY_KEY_PREFIX } from './library';
import { PASTEBOARD_STORAGE_KEY } from './pasteboard';
import { RECOVERY_STORAGE_KEY } from './persistence';
import {
  formatStorageSize,
  measureStorage,
  tenantOfKey,
  type MeteredStore,
} from './storage-meter';
import { VERSION_HISTORY_META_KEY, VERSION_HISTORY_STORAGE_KEY } from './version-history';

function storeOf(entries: Record<string, string>): MeteredStore {
  const keys = Object.keys(entries);
  return {
    get length() {
      return keys.length;
    },
    key: (index: number) => keys[index] ?? null,
    getItem: (key: string) => entries[key] ?? null,
  };
}

describe('storage meter (#615)', () => {
  it('puts every key with its tenant', () => {
    expect(tenantOfKey(STORAGE_KEY)).toBe('main');
    expect(tenantOfKey(`${LIBRARY_KEY_PREFIX}_index`)).toBe('library');
    expect(tenantOfKey(`${LIBRARY_KEY_PREFIX}cottage`)).toBe('library');
    expect(tenantOfKey(VERSION_HISTORY_STORAGE_KEY)).toBe('restorePoints');
    expect(tenantOfKey(VERSION_HISTORY_META_KEY)).toBe('restorePoints');
    expect(tenantOfKey(RECOVERY_STORAGE_KEY)).toBe('recovery');
    expect(tenantOfKey(`${RECOVERY_STORAGE_KEY}-1700000000000-ab12cd`)).toBe('recovery');
    expect(tenantOfKey(PASTEBOARD_STORAGE_KEY)).toBe('pasteboard');
    expect(tenantOfKey(CUSTOM_SETS_STORAGE_KEY)).toBe('customSets');
    expect(tenantOfKey('standalone-room-organizer-achievements')).toBe('settings');
    expect(tenantOfKey('another-project')).toBe('other');
  });

  it('sizes each tenant from key plus value, and lists library houses biggest first', () => {
    const usage = measureStorage(
      storeOf({
        [STORAGE_KEY]: 'x'.repeat(100),
        [`${LIBRARY_KEY_PREFIX}_index`]: 'i'.repeat(10),
        [`${LIBRARY_KEY_PREFIX}small`]: 's'.repeat(5),
        [`${LIBRARY_KEY_PREFIX}big`]: 'b'.repeat(500),
        // A room probe caught mid-save is the library's, but no house.
        [`${LIBRARY_KEY_PREFIX}_probe`]: 'p'.repeat(4),
        'another-project': 'o'.repeat(7),
      })
    );
    expect(usage.byTenant.main).toBe(STORAGE_KEY.length + 100);
    expect(usage.byTenant.library).toBe(
      4 * LIBRARY_KEY_PREFIX.length + '_index'.length + 10 + 5 + 5 + 3 + 500 + '_probe'.length + 4
    );
    expect(usage.byTenant.other).toBe('another-project'.length + 7);
    expect(usage.byTenant.restorePoints).toBe(0);
    expect(usage.libraryHouses.map((row) => row.slot)).toEqual(['big', 'small']);
    expect(usage.total).toBe(Object.values(usage.byTenant).reduce((sum, chars) => sum + chars, 0));
  });

  it('measures blocked storage as empty instead of throwing', () => {
    const blocked: MeteredStore = {
      length: 1,
      key: () => {
        throw new DOMException('denied', 'SecurityError');
      },
      getItem: () => null,
    };
    expect(measureStorage(blocked).total).toBe(0);
    expect(measureStorage(null).total).toBe(0);
  });

  it('formats sizes', () => {
    expect(formatStorageSize(512)).toBe('512 B');
    expect(formatStorageSize(2048)).toBe('2.0 KB');
    expect(formatStorageSize(300 * 1024)).toBe('300 KB');
    expect(formatStorageSize(5 * 1024 * 1024)).toBe('5.0 MB');
  });
});
