import { STORAGE_KEY } from './constants';
import { CUSTOM_SETS_STORAGE_KEY } from './custom-sets';
import { LIBRARY_KEY_PREFIX, libraryHouseSlot } from './library';
import { PASTEBOARD_STORAGE_KEY } from './pasteboard';
import { isRecoveryKey } from './persistence';
import { MAX_STORAGE_ENTRY_CHARS, VERSION_HISTORY_META_KEY, VERSION_HISTORY_STORAGE_KEY } from './version-history';

/**
 * What each part of the editor holds in this browser's localStorage (#615):
 * the Manage tab's storage meter. Sized from what is actually stored — key
 * plus value, in characters, the unit browsers count the quota in — so the
 * meter matches what a failed save runs into. Pure: the store is passed in.
 */

/** Every key this app writes starts with this. */
export const APP_KEY_PREFIX = 'standalone-room-organizer-';

/**
 * Who a stored key belongs to. `settings` is any other key of this app
 * (achievements, recent colours, the open tab…); `other` is a key some other
 * page on this origin wrote — GitHub Pages serves many projects from one
 * origin, and they share the quota.
 */
export type StorageTenant =
  | 'main'
  | 'library'
  | 'restorePoints'
  | 'recovery'
  | 'pasteboard'
  | 'customSets'
  | 'settings'
  | 'other';

/** Display order, biggest worry first. */
export const STORAGE_TENANTS: readonly StorageTenant[] = [
  'main',
  'library',
  'restorePoints',
  'recovery',
  'pasteboard',
  'customSets',
  'settings',
  'other',
];

export const TENANT_LABELS: Record<StorageTenant, string> = {
  main: 'Open house',
  library: 'Saved layouts',
  restorePoints: 'Restore points',
  recovery: 'Recovery copies',
  pasteboard: 'Received houses',
  customSets: 'Custom sets',
  settings: 'Settings',
  other: 'Other sites on this address',
};

/**
 * The most localStorage any major browser gives one origin, in characters
 * (see `MAX_STORAGE_ENTRY_CHARS`): what the meter fills against.
 */
export const STORAGE_QUOTA_CHARS = MAX_STORAGE_ENTRY_CHARS;

export function tenantOfKey(key: string): StorageTenant {
  if (key === STORAGE_KEY) return 'main';
  if (key.startsWith(LIBRARY_KEY_PREFIX)) return 'library';
  if (key === VERSION_HISTORY_STORAGE_KEY || key === VERSION_HISTORY_META_KEY) return 'restorePoints';
  if (isRecoveryKey(key)) return 'recovery';
  if (key === PASTEBOARD_STORAGE_KEY) return 'pasteboard';
  if (key === CUSTOM_SETS_STORAGE_KEY) return 'customSets';
  if (key.startsWith(APP_KEY_PREFIX)) return 'settings';
  return 'other';
}

export interface StorageUsage {
  /** Characters per tenant, key plus value. */
  byTenant: Record<StorageTenant, number>;
  /** Everything on this origin, this app or not. */
  total: number;
  /** One row per stored library house, biggest first. */
  libraryHouses: { slot: string; chars: number }[];
}

export type MeteredStore = Pick<Storage, 'length' | 'key' | 'getItem'>;

function emptyTenants(): Record<StorageTenant, number> {
  return { main: 0, library: 0, restorePoints: 0, recovery: 0, pasteboard: 0, customSets: 0, settings: 0, other: 0 };
}

/** Tally what `store` holds. Never throws: unreadable storage measures as empty. */
export function measureStorage(store: MeteredStore | null): StorageUsage {
  const byTenant = emptyTenants();
  const libraryHouses: { slot: string; chars: number }[] = [];
  let total = 0;
  if (!store) return { byTenant, total, libraryHouses };
  try {
    for (let index = 0; index < store.length; index += 1) {
      const key = store.key(index);
      if (key === null) continue;
      const chars = key.length + (store.getItem(key)?.length ?? 0);
      byTenant[tenantOfKey(key)] += chars;
      total += chars;
      const slot = libraryHouseSlot(key);
      if (slot !== null) libraryHouses.push({ slot, chars });
    }
  } catch {
    return { byTenant: emptyTenants(), total: 0, libraryHouses: [] };
  }
  libraryHouses.sort((a, b) => b.chars - a.chars || a.slot.localeCompare(b.slot));
  return { byTenant, total, libraryHouses };
}

/**
 * A size for people: characters shown as bytes, which they are for the
 * plain-ASCII JSON the editor stores.
 */
export function formatStorageSize(chars: number): string {
  if (chars < 1024) return `${chars} B`;
  if (chars < 1024 * 1024) return `${(chars / 1024).toFixed(chars < 10 * 1024 ? 1 : 0)} KB`;
  return `${(chars / (1024 * 1024)).toFixed(1)} MB`;
}
