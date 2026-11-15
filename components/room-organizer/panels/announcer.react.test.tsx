// @vitest-environment jsdom
import { act, cleanup, render, renderHook, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useHistory } from '../hooks/use-history';
import { makeItem } from '../lib/__testfixtures__/fixtures';
import { announce, announceSettled, ANNOUNCE_SETTLE_MS, describeHistoryStep, describePlacement, resetAnnouncements } from '../lib/announce';
import { Announcer } from './announcer';

afterEach(() => {
  cleanup();
  resetAnnouncements();
  vi.useRealTimers();
});

describe('Announcer (#929)', () => {
  it('is one polite status line, empty at first', () => {
    render(<Announcer />);
    expect(screen.getByRole('status').textContent).toBe('');
  });

  it('says what an undo took back', () => {
    vi.useFakeTimers();
    render(<Announcer />);
    const { result, rerender } = renderHook(
      ({ value }) =>
        useHistory<{ name: string }>(value, vi.fn(), {
          debounceMs: 10,
          describe: () => 'move Sofa',
          onStep: (kind, label) => announce(describeHistoryStep(kind, label)),
        }),
      { initialProps: { value: { name: 'a' } } }
    );
    rerender({ value: { name: 'b' } });
    act(() => void vi.advanceTimersByTime(20));
    act(() => result.current.undo());
    expect(screen.getByRole('status').textContent).toBe('Undone: move Sofa.');
  });

  it('says where a run of nudges ended, once', () => {
    vi.useFakeTimers();
    render(<Announcer />);
    let sofa = makeItem({ name: 'Sofa', position: { x: 0, z: 0 } });
    act(() => {
      for (let step = 1; step <= 3; step += 1) {
        sofa = { ...sofa, position: { x: -step, z: 0 } };
        announceSettled(() => describePlacement(sofa, { width: 8, height: 6 }));
      }
    });
    expect(screen.getByRole('status').textContent).toBe('');
    act(() => void vi.advanceTimersByTime(ANNOUNCE_SETTLE_MS));
    expect(screen.getByRole('status').textContent).toBe('Sofa, 0.5 m from the west wall, 2.5 m from the north wall.');
  });
});
