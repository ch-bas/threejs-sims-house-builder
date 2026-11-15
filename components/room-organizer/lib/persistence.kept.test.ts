import { describe, expect, it } from 'vitest';
import { makeFloor, makeItem, makeLayout } from './__testfixtures__/fixtures';
import { STORAGE_KEY } from './constants';
import { subscribeNotices, type Notice } from './editor-notices';
import { saveLayout } from './persistence';
import { VERSION_KEPT_STORAGE_KEY, keepSnapshot, listKeptVersions, listSnapshots, recordSnapshot } from './version-history';
import type { VersionHistoryStore } from './version-history';

function quotaStore(): VersionHistoryStore & { data: Map<string, string>; capacity: number } {
  const data = new Map<string, string>();
  const store = {
    data,
    capacity: Infinity,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      let used = key.length + value.length;
      for (const [k, v] of data) if (k !== key) used += k.length + v.length;
      if (used > store.capacity) throw new DOMException('full', 'QuotaExceededError');
      data.set(key, value);
    },
    removeItem: (key: string) => void data.delete(key),
  };
  return store;
}

const house = (items: number) =>
  makeLayout({ id: 'h', name: 'Cottage', floors: [makeFloor({ items: Array.from({ length: items }, (_, i) => makeItem({ id: `i${i}` })) })] });

describe('the house always wins over kept versions (#935)', () => {
  it('a save that needs the room evicts kept versions, oldest kept first, and says which', () => {
    const storage = quotaStore();
    recordSnapshot(house(1), { storage, now: () => 1 });
    recordSnapshot(house(2), { storage, now: () => 400_000 });
    for (const summary of listSnapshots({ storage })) keepSnapshot(summary.id, { storage, label: `V${summary.itemCount}` });
    expect(saveLayout(house(3), storage).ok).toBe(true);
    const kept = storage.data.get(VERSION_KEPT_STORAGE_KEY)!.length;
    storage.capacity = [...storage.data].reduce((sum, [k, v]) => sum + k.length + v.length, 0);
    const notices: Notice[] = [];
    const stop = subscribeNotices((notice) => notices.push(notice));
    const grown = house(3 + Math.ceil(kept / 400));
    const result = saveLayout(grown, storage);
    stop();
    expect(result.ok).toBe(true);
    expect(storage.data.get(STORAGE_KEY)).toBe(JSON.stringify(grown));
    const removed = notices.map((notice) => notice.message);
    expect(removed[0]).toMatch(/^A kept version, “V\d”, was removed so your house could be saved\.$/);
    expect(listKeptVersions({ storage }).length).toBe(2 - removed.length);
  });
});
