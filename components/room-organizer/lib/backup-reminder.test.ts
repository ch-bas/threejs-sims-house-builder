import { describe, expect, it, vi } from 'vitest';
import {
  BACKUP_REMINDER_EVERY_MS,
  BACKUP_STALE_AFTER_MS,
  PERSIST_ASK_AGAIN_MS,
  STORAGE_CARE_KEY,
  backupReminderDue,
  dayKey,
  noteEditDay,
  persistPrompts,
  queryPersistence,
  readStorageCare,
  recordBackup,
  recordPersistAnswer,
  requestPersistence,
  shouldAskToPersist,
  subscribeStorageCare,
  type StorageCare,
} from './backup-reminder';

const DAY = 24 * 60 * 60 * 1000;

function memoryStorage(initial: Record<string, string> = {}): Storage {
  const data = new Map(Object.entries(initial));
  return {
    get length() {
      return data.size;
    },
    clear: () => data.clear(),
    getItem: (key) => data.get(key) ?? null,
    key: (index) => [...data.keys()][index] ?? null,
    removeItem: (key) => void data.delete(key),
    setItem: (key, value) => void data.set(key, value),
  };
}

describe('storage care record', () => {
  it('reads empty when nothing is stored, or the value is not ours', () => {
    expect(readStorageCare(memoryStorage())).toEqual({ persist: null, persistDeniedAt: null, lastBackupAt: null });
    for (const raw of ['nope', '[]', 'null', '{"persist":"maybe","lastBackupAt":"soon"}', '{"lastBackupAt":Infinity}']) {
      expect(readStorageCare(memoryStorage({ [STORAGE_CARE_KEY]: raw }))).toEqual({ persist: null, persistDeniedAt: null, lastBackupAt: null });
    }
  });

  it('records the last backup and the persist answer side by side', () => {
    const storage = memoryStorage();
    recordBackup(1_000, storage);
    recordPersistAnswer('denied', 1_500, storage);
    expect(readStorageCare(storage)).toEqual({ persist: null, persistDeniedAt: 1_500, lastBackupAt: 1_000 });
    recordBackup(2_000, storage);
    expect(readStorageCare(storage)).toEqual({ persist: null, persistDeniedAt: 1_500, lastBackupAt: 2_000 });
    recordPersistAnswer('granted', 3_000, storage);
    expect(readStorageCare(storage)).toEqual({ persist: 'granted', persistDeniedAt: null, lastBackupAt: 2_000 });
  });

  it('tells listeners about a change', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeStorageCare(listener);
    recordBackup(5, memoryStorage());
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
    recordBackup(6, memoryStorage());
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('never throws on blocked storage', () => {
    const blocked = memoryStorage();
    blocked.getItem = () => {
      throw new DOMException('blocked', 'SecurityError');
    };
    blocked.setItem = () => {
      throw new DOMException('blocked', 'SecurityError');
    };
    expect(readStorageCare(blocked)).toEqual({ persist: null, persistDeniedAt: null, lastBackupAt: null });
    expect(() => recordBackup(1, blocked)).not.toThrow();
  });
});

describe('asking the browser to keep the houses', () => {
  const care = (over: Partial<StorageCare>): StorageCare => ({ persist: null, persistDeniedAt: null, lastBackupAt: null, ...over });
  const now = 100 * DAY;

  it('asks until a yes, and never after one', () => {
    for (const prompts of [true, false]) {
      expect(shouldAskToPersist(care({}), { now, prompts })).toBe(true);
      expect(shouldAskToPersist(care({ persist: 'granted' }), { now, prompts })).toBe(false);
    }
  });

  it('after a no, a silent browser is asked again next session; a prompting one waits a week', () => {
    const denied = care({ persistDeniedAt: now - DAY });
    expect(shouldAskToPersist(denied, { now, prompts: false })).toBe(true);
    expect(shouldAskToPersist(denied, { now, prompts: true })).toBe(false);
    expect(shouldAskToPersist(care({ persistDeniedAt: now - PERSIST_ASK_AGAIN_MS }), { now, prompts: true })).toBe(true);
    // A no dated ahead of the clock can't hold the question off for good.
    expect(shouldAskToPersist(care({ persistDeniedAt: now + 30 * DAY }), { now, prompts: true })).toBe(true);
  });

  it('reads an older stored "denied" as never asked', () => {
    const storage = memoryStorage({ [STORAGE_CARE_KEY]: '{"persist":"denied"}' });
    expect(readStorageCare(storage)).toEqual(care({}));
  });

  it('only Firefox prompts', () => {
    expect(persistPrompts('Mozilla/5.0 (X11; Linux x86_64; rv:128.0) Gecko/20100101 Firefox/128.0')).toBe(true);
    expect(persistPrompts('Mozilla/5.0 (Macintosh) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36')).toBe(false);
    expect(persistPrompts('Mozilla/5.0 (iPhone) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1')).toBe(false);
  });

  it('maps the Storage API answer, and says null where there is none', async () => {
    await expect(requestPersistence({ persist: () => Promise.resolve(true) })).resolves.toBe('granted');
    await expect(requestPersistence({ persist: () => Promise.resolve(false) })).resolves.toBe('denied');
    await expect(requestPersistence({ persist: () => Promise.reject(new Error('no')) })).resolves.toBeNull();
    await expect(requestPersistence(undefined)).resolves.toBeNull();
    await expect(requestPersistence({})).resolves.toBeNull();
    await expect(queryPersistence({ persisted: () => Promise.resolve(true) })).resolves.toBe(true);
    await expect(queryPersistence({ persisted: () => Promise.reject(new Error('no')) })).resolves.toBeNull();
    await expect(queryPersistence(undefined)).resolves.toBeNull();
  });
});

describe('edit days', () => {
  it('keys a moment by its local calendar day', () => {
    const at = new Date(2026, 10, 15, 23, 59).getTime();
    expect(dayKey(at)).toBe('2026-11-15');
    expect(dayKey(at + 60_000)).toBe('2026-11-16');
  });

  it('adds a day once and keeps the list short', () => {
    const at = new Date(2026, 0, 1, 12).getTime();
    const one = noteEditDay([], at);
    expect(one).toEqual(['2026-01-01']);
    expect(noteEditDay(one, at + 1_000)).toBe(one);
    let days: readonly string[] = [];
    for (let n = 0; n < 40; n++) days = noteEditDay(days, at + n * DAY);
    expect(days).toHaveLength(31);
    expect(days[days.length - 1]).toBe(dayKey(at + 39 * DAY));
  });
});

describe('backupReminderDue', () => {
  const now = new Date(2026, 10, 15, 12).getTime();
  const base = { now, lastBackupAt: null, editDays: [], lastRemindedAt: null, exploring: false };

  it('with no backup, waits for edits on three separate days', () => {
    expect(backupReminderDue({ ...base, editDays: ['2026-11-13', '2026-11-14'] })).toBe(false);
    expect(backupReminderDue({ ...base, editDays: ['2026-11-13', '2026-11-14', '2026-11-15'] })).toBe(true);
  });

  it('with a backup, comes due once it is over two weeks old and there were edits since', () => {
    const edits = ['2026-11-15'];
    expect(backupReminderDue({ ...base, lastBackupAt: now - BACKUP_STALE_AFTER_MS, editDays: edits })).toBe(false);
    expect(backupReminderDue({ ...base, lastBackupAt: now - BACKUP_STALE_AFTER_MS - 1, editDays: edits })).toBe(true);
    expect(backupReminderDue({ ...base, lastBackupAt: now - 40 * DAY, editDays: [] })).toBe(false);
  });

  it('a backup taken from a clock ahead of this one is not stale', () => {
    expect(backupReminderDue({ ...base, lastBackupAt: now + 30 * DAY, editDays: ['2026-11-15'] })).toBe(false);
  });

  it('shows at most once a week', () => {
    const due = { ...base, editDays: ['2026-11-13', '2026-11-14', '2026-11-15'] };
    expect(backupReminderDue({ ...due, lastRemindedAt: now - 3 * DAY })).toBe(false);
    expect(backupReminderDue({ ...due, lastRemindedAt: now - BACKUP_REMINDER_EVERY_MS })).toBe(true);
    // A clock set back counts the week as gone rather than silencing it for good.
    expect(backupReminderDue({ ...due, lastRemindedAt: now + 90 * DAY })).toBe(true);
  });

  it('never shows during EXPLORE', () => {
    expect(backupReminderDue({ ...base, editDays: ['a', 'b', 'c'], exploring: true })).toBe(false);
  });
});
