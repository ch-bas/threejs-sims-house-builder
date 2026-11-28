// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeFloor, makeItem, makeLayout } from '../lib/__testfixtures__/fixtures';
import { STORAGE_CARE_KEY, dayKey, readStorageCare, recordBackup } from '../lib/backup-reminder';
import { askConfirm, cancelPendingConfirms } from '../lib/confirm-dialog';
import { subscribeNotices, type Notice } from '../lib/editor-notices';
import { resetTourPhaseForTests, setTourPhase } from '../lib/tour-session';
import { markLayoutLoaded } from './use-achievements';
import { REMINDER_WATCH_MS, REMIND_AFTER_EDIT_MS, useBackupReminder } from './use-backup-reminder';
import { layoutStore } from './use-layout-store';
import type { RoomLayout } from '../lib/types';

// The backup reminder (#928): when it looks, and what it never does.

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date(2026, 10, 20, 12).getTime();

const furnished = (count: number): RoomLayout =>
  makeLayout({ floors: [makeFloor({ items: Array.from({ length: count }, (_, i) => makeItem({ id: `i${i}` })) })] });

const load = (layout: RoomLayout): RoomLayout => {
  layoutStore.setState({ layout });
  markLayoutLoaded();
  return layout;
};

/** Two earlier edit days and no backup: today's edit makes the third. */
function seedTwoEditDays(extra: Record<string, unknown> = {}): void {
  window.localStorage.setItem(STORAGE_CARE_KEY, JSON.stringify({ editDays: [dayKey(NOW - 3 * DAY), dayKey(NOW - DAY)], ...extra }));
}

let notices: Notice[];
let unsubscribe: () => void;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
  vi.setSystemTime(NOW);
  window.localStorage.clear();
  resetTourPhaseForTests();
  notices = [];
  unsubscribe = subscribeNotices((notice) => notices.push(notice));
});

afterEach(() => {
  unsubscribe();
  vi.useRealTimers();
});

const mount = (blocked = false) =>
  renderHook(({ layout, blocked: held }) => useBackupReminder(layout, held), { initialProps: { layout: furnished(0), blocked } });

describe('useBackupReminder (#928)', () => {
  it('counts an edit’s day, not the opening house or a load, and reminds once the player pauses', () => {
    seedTwoEditDays();
    const { rerender } = mount();
    rerender({ layout: load(furnished(2)), blocked: false });
    expect(readStorageCare().editDays).toHaveLength(2);
    rerender({ layout: furnished(3), blocked: false });
    expect(readStorageCare().editDays).toHaveLength(3);
    // Edits keep coming: the reminder waits for a pause.
    act(() => {
      vi.advanceTimersByTime(REMIND_AFTER_EDIT_MS - 1);
    });
    rerender({ layout: furnished(4), blocked: false });
    act(() => {
      vi.advanceTimersByTime(REMIND_AFTER_EDIT_MS - 1);
    });
    expect(notices).toHaveLength(0);
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(notices).toHaveLength(1);
    expect(notices[0]?.message).toMatch(/^Your houses are only in this browser/);
    expect(notices[0]?.action?.label).toBe('Back up');
    expect(readStorageCare().remindedAt).toBe(NOW + 2 * REMIND_AFTER_EDIT_MS - 1);
    // Once a session, and the stored time holds the next one back a week.
    rerender({ layout: furnished(5), blocked: false });
    act(() => {
      vi.advanceTimersByTime(REMIND_AFTER_EDIT_MS);
    });
    expect(notices).toHaveLength(1);
  });

  it('waits out EXPLORE, photo mode or the open drawer, then shows', () => {
    seedTwoEditDays();
    const { rerender } = mount(true);
    rerender({ layout: furnished(1), blocked: true });
    act(() => {
      vi.advanceTimersByTime(3 * REMIND_AFTER_EDIT_MS);
    });
    expect(notices).toHaveLength(0);
    const layout = furnished(1);
    rerender({ layout, blocked: false });
    act(() => {
      vi.advanceTimersByTime(REMIND_AFTER_EDIT_MS);
    });
    expect(notices).toHaveLength(1);
  });

  it('waits while a question or another modal is open', async () => {
    seedTwoEditDays();
    const { rerender } = mount();
    rerender({ layout: furnished(1), blocked: false });
    let answer: Promise<boolean> | null = null;
    act(() => {
      answer = askConfirm({ title: 'Delete?', confirmLabel: 'Delete' });
    });
    act(() => {
      vi.advanceTimersByTime(2 * REMIND_AFTER_EDIT_MS);
    });
    expect(notices).toHaveLength(0);
    act(() => cancelPendingConfirms());
    await answer;
    const modal = document.createElement('div');
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    document.body.append(modal);
    act(() => {
      vi.advanceTimersByTime(2 * REMIND_AFTER_EDIT_MS);
    });
    expect(notices).toHaveLength(0);
    modal.remove();
    act(() => {
      vi.advanceTimersByTime(REMIND_AFTER_EDIT_MS);
    });
    expect(notices).toHaveLength(1);
  });

  describe('a modal over the shown reminder (the ? overlay)', () => {
    /** The notice host's toast for the reminder, as status-toast marks it. */
    const toast = (): HTMLElement => {
      const element = document.createElement('div');
      element.dataset['noticeSlot'] = 'backup-reminder';
      document.body.append(element);
      return element;
    };
    const overlay = (): HTMLElement => {
      const element = document.createElement('div');
      element.setAttribute('role', 'dialog');
      element.setAttribute('aria-modal', 'true');
      document.body.append(element);
      return element;
    };
    const showReminder = () => {
      seedTwoEditDays();
      const view = mount();
      view.rerender({ layout: furnished(1), blocked: false });
      act(() => {
        vi.advanceTimersByTime(REMIND_AFTER_EDIT_MS);
      });
      expect(notices).toHaveLength(1);
      return view;
    };
    const advance = (ms: number): void =>
      act(() => {
        vi.advanceTimersByTime(ms);
      });

    it('shows it again, once, when it timed out underneath', () => {
      showReminder();
      const shown = toast();
      advance(REMINDER_WATCH_MS);
      const modal = overlay();
      advance(REMINDER_WATCH_MS);
      // It times out while the overlay is up.
      shown.remove();
      advance(10 * REMINDER_WATCH_MS);
      expect(notices).toHaveLength(1);
      modal.remove();
      advance(REMINDER_WATCH_MS);
      expect(notices).toHaveLength(2);
      expect(notices[1]?.message).toBe(notices[0]?.message);
      expect(notices[1]?.action?.label).toBe('Back up');
      // Once: the second one isn't watched.
      advance(20 * REMINDER_WATCH_MS);
      expect(notices).toHaveLength(2);
    });

    it('the open drawer counts as covering it too', () => {
      const { rerender } = showReminder();
      const shown = toast();
      advance(REMINDER_WATCH_MS);
      rerender({ layout: furnished(1), blocked: true });
      advance(REMINDER_WATCH_MS);
      shown.remove();
      advance(REMINDER_WATCH_MS);
      rerender({ layout: furnished(1), blocked: false });
      advance(REMINDER_WATCH_MS);
      expect(notices).toHaveLength(2);
    });

    it('not when it was still showing once the overlay closed, nor when the player closed it first', () => {
      showReminder();
      const shown = toast();
      advance(REMINDER_WATCH_MS);
      let modal = overlay();
      advance(2 * REMINDER_WATCH_MS);
      modal.remove();
      advance(REMINDER_WATCH_MS);
      // Seen again; then the player closes it, and opens the overlay.
      shown.remove();
      advance(REMINDER_WATCH_MS);
      modal = overlay();
      advance(4 * REMINDER_WATCH_MS);
      modal.remove();
      advance(4 * REMINDER_WATCH_MS);
      expect(notices).toHaveLength(1);
    });
  });

  it('a tab left open looks again on a new day', () => {
    window.localStorage.setItem(STORAGE_CARE_KEY, JSON.stringify({ editDays: [dayKey(NOW - DAY)] }));
    const { rerender } = mount();
    rerender({ layout: furnished(1), blocked: false });
    act(() => {
      vi.advanceTimersByTime(REMIND_AFTER_EDIT_MS);
    });
    // Two days only: nothing due yet, and today's look is spent.
    expect(notices).toHaveLength(0);
    vi.setSystemTime(NOW + DAY);
    rerender({ layout: furnished(2), blocked: false });
    act(() => {
      vi.advanceTimersByTime(REMIND_AFTER_EDIT_MS);
    });
    expect(notices).toHaveLength(1);
  });

  it('counts an edit made after a backup on the same day', () => {
    const { rerender } = mount();
    rerender({ layout: furnished(1), blocked: false });
    expect(readStorageCare().editDays).toEqual([dayKey(NOW)]);
    recordBackup(NOW + 1);
    expect(readStorageCare().editDays).toEqual([]);
    rerender({ layout: furnished(2), blocked: false });
    expect(readStorageCare().editDays).toEqual([dayKey(NOW)]);
  });

  it('writes nothing and says nothing in a shared-link tour', () => {
    seedTwoEditDays();
    setTourPhase('touring');
    const before = window.localStorage.getItem(STORAGE_CARE_KEY);
    const { rerender } = mount();
    rerender({ layout: furnished(1), blocked: false });
    act(() => {
      vi.advanceTimersByTime(REMIND_AFTER_EDIT_MS);
    });
    expect(window.localStorage.getItem(STORAGE_CARE_KEY)).toBe(before);
    expect(notices).toHaveLength(0);
  });

  it('stays quiet when turned off, or when nothing is due', () => {
    seedTwoEditDays({ remindersOff: true });
    const off = mount();
    off.rerender({ layout: furnished(1), blocked: false });
    act(() => {
      vi.advanceTimersByTime(REMIND_AFTER_EDIT_MS);
    });
    off.unmount();
    window.localStorage.clear();
    const fresh = mount();
    fresh.rerender({ layout: furnished(1), blocked: false });
    act(() => {
      vi.advanceTimersByTime(REMIND_AFTER_EDIT_MS);
    });
    expect(notices).toHaveLength(0);
    expect(readStorageCare().editDays).toEqual([dayKey(NOW)]);
  });
});
