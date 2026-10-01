// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeItem, makeFloor, makeLayout } from '../lib/__testfixtures__/fixtures';
import { RECOVERY_STORAGE_KEY } from '../lib/persistence';
import { RecoveryEntry } from './recovery-entry';
import type { RoomLayout } from '../lib/types';

vi.mock('./plan-thumb', () => ({ PlanThumb: () => null }));

const busyHouse = makeLayout({ name: 'Busy', floors: [makeFloor({ items: [makeItem({ id: 'sofa' })] })] });

describe('RecoveryEntry (#336)', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('renders nothing when there is no recovery copy', () => {
    const { container } = render(<RecoveryEntry currentLayout={busyHouse} onLoad={() => {}} />);
    expect(container.innerHTML).toBe('');
  });

  it('restores a valid copy through the schema after confirming', () => {
    const kept = makeLayout({ name: 'Kept house', width: 9 });
    window.localStorage.setItem(RECOVERY_STORAGE_KEY, JSON.stringify(kept));
    const onLoad = vi.fn<(layout: RoomLayout) => void>();
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<RecoveryEntry currentLayout={busyHouse} onLoad={onLoad} />);
    expect(screen.getByText(/Kept house/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Restore/ }));
    expect(confirm).toHaveBeenCalledOnce();
    expect(onLoad).toHaveBeenCalledWith(kept);
    expect(screen.getByRole('status').textContent).toMatch(/Undo brings back/);
  });

  it('offers only download and delete for a copy that is not a house', () => {
    window.localStorage.setItem(RECOVERY_STORAGE_KEY, '{not json');
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<RecoveryEntry currentLayout={busyHouse} onLoad={() => {}} />);
    expect(screen.queryByRole('button', { name: /Restore/ })).toBeNull();
    expect(screen.getByRole('button', { name: 'Download' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Delete the recovered copy/ }));
    expect(window.localStorage.getItem(RECOVERY_STORAGE_KEY)).toBeNull();
    expect(screen.queryByText('Recovered copy')).toBeNull();
  });
});
