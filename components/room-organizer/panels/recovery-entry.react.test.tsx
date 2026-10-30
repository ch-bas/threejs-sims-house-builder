// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { autoAnswerConfirms, type AutoAnswer } from '../lib/__testfixtures__/confirm';
import { makeItem, makeFloor, makeLayout } from '../lib/__testfixtures__/fixtures';
import { RECOVERY_STORAGE_KEY } from '../lib/persistence';
import { RecoveryEntry } from './recovery-entry';
import type { RoomLayout } from '../lib/types';

vi.mock('./plan-thumb', () => ({ PlanThumb: () => null }));

const busyHouse = makeLayout({ name: 'Busy', floors: [makeFloor({ items: [makeItem({ id: 'sofa' })] })] });

describe('RecoveryEntry (#336)', () => {
  let confirms: AutoAnswer | null = null;
  const answer = (ok: boolean) => {
    confirms = autoAnswerConfirms(ok);
    return confirms;
  };
  beforeEach(() => {
    window.localStorage.clear();
  });
  afterEach(() => {
    confirms?.stop();
    confirms = null;
    cleanup();
    vi.restoreAllMocks();
  });

  it('renders nothing when there is no recovery copy', () => {
    const { container } = render(<RecoveryEntry currentLayout={busyHouse} onLoad={() => {}} />);
    expect(container.innerHTML).toBe('');
  });

  it('restores a valid copy through the schema after confirming in the app (#649)', async () => {
    const kept = makeLayout({ name: 'Kept house', width: 9 });
    window.localStorage.setItem(RECOVERY_STORAGE_KEY, JSON.stringify(kept));
    const onLoad = vi.fn<(layout: RoomLayout) => void>();
    const native = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const confirm = answer(true);
    render(<RecoveryEntry currentLayout={busyHouse} onLoad={onLoad} />);
    expect(screen.getByText(/Kept house/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Restore/ }));
    await waitFor(() => expect(onLoad).toHaveBeenCalledWith(kept));
    expect(confirm.asked).toHaveLength(1);
    expect(native).not.toHaveBeenCalled();
    expect(screen.getByRole('status').textContent).toMatch(/Undo brings back/);
  });

  it('lists every kept copy, newest first, and restores the one clicked', async () => {
    const older = makeLayout({ name: 'Older house' });
    const newer = makeLayout({ name: 'Newer house' });
    window.localStorage.setItem(`${RECOVERY_STORAGE_KEY}-1000`, JSON.stringify(older));
    window.localStorage.setItem(`${RECOVERY_STORAGE_KEY}-2000`, JSON.stringify(newer));
    const onLoad = vi.fn<(layout: RoomLayout) => void>();
    answer(true);
    render(<RecoveryEntry currentLayout={busyHouse} onLoad={onLoad} />);
    const names = screen.getAllByText(/house ·/).map((node) => node.textContent);
    expect(names).toEqual(['Newer house · 0 items', 'Older house · 0 items']);
    fireEvent.click(screen.getAllByRole('button', { name: /Restore/ })[1]!);
    await waitFor(() => expect(onLoad).toHaveBeenCalledWith(older));
  });

  it('refreshes and asks again when the copy changed since it was shown', () => {
    const key = `${RECOVERY_STORAGE_KEY}-1000`;
    window.localStorage.setItem(key, JSON.stringify(makeLayout({ name: 'Shown house' })));
    const onLoad = vi.fn<(layout: RoomLayout) => void>();
    const confirm = answer(true);
    render(<RecoveryEntry currentLayout={busyHouse} onLoad={onLoad} />);
    window.localStorage.setItem(key, JSON.stringify(makeLayout({ name: 'Swapped house' })));
    fireEvent.click(screen.getByRole('button', { name: /Restore/ }));
    expect(confirm.asked).toEqual([]);
    expect(onLoad).not.toHaveBeenCalled();
    expect(screen.getByRole('status').textContent).toMatch(/changed since it was shown/);
    expect(screen.getByText(/Swapped house/)).toBeTruthy();
  });

  it('offers only download and delete for a copy that is not a house', async () => {
    window.localStorage.setItem(RECOVERY_STORAGE_KEY, '{not json');
    answer(true);
    render(<RecoveryEntry currentLayout={busyHouse} onLoad={() => {}} />);
    expect(screen.queryByRole('button', { name: /Restore/ })).toBeNull();
    expect(screen.getByRole('button', { name: 'Download' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Delete the recovered copy/ }));
    await waitFor(() => expect(window.localStorage.getItem(RECOVERY_STORAGE_KEY)).toBeNull());
    expect(screen.queryByText('Recovered copy')).toBeNull();
  });

  it('keeps the copy when the delete question is cancelled', async () => {
    window.localStorage.setItem(RECOVERY_STORAGE_KEY, '{not json');
    const confirm = answer(false);
    render(<RecoveryEntry currentLayout={busyHouse} onLoad={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /Delete the recovered copy/ }));
    await waitFor(() => expect(confirm.asked.map((question) => question.title)).toEqual(['Delete this recovered copy for good?']));
    expect(window.localStorage.getItem(RECOVERY_STORAGE_KEY)).toBe('{not json');
  });

  it('does not apply a copy another tab replaced while the question was open', async () => {
    const key = `${RECOVERY_STORAGE_KEY}-1000`;
    window.localStorage.setItem(key, JSON.stringify(makeLayout({ name: 'Shown house' })));
    const onLoad = vi.fn<(layout: RoomLayout) => void>();
    confirms = autoAnswerConfirms(() => {
      window.localStorage.setItem(key, JSON.stringify(makeLayout({ name: 'Swapped house' })));
      return true;
    });
    render(<RecoveryEntry currentLayout={busyHouse} onLoad={onLoad} />);
    fireEvent.click(screen.getByRole('button', { name: /Restore/ }));
    await waitFor(() => expect(screen.getByRole('status').textContent).toMatch(/changed since it was shown/));
    expect(onLoad).not.toHaveBeenCalled();
  });
});
