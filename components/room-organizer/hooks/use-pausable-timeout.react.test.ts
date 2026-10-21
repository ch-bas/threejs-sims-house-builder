// @vitest-environment jsdom
import { cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { usePausableTimeout } from './use-pausable-timeout';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function setup(initial: { key: string | null; running: boolean; duration: number | null }) {
  const onDone = vi.fn();
  const hook = renderHook(
    ({ key, running, duration }) => usePausableTimeout(key, running, duration, onDone),
    { initialProps: initial }
  );
  return { onDone, ...hook };
}

it('fires after the duration while running', () => {
  const { onDone } = setup({ key: 'a', running: true, duration: 1000 });
  vi.advanceTimersByTime(999);
  expect(onDone).not.toHaveBeenCalled();
  vi.advanceTimersByTime(1);
  expect(onDone).toHaveBeenCalledTimes(1);
});

it('resumes with the time left after a pause instead of starting over', () => {
  const { onDone, rerender } = setup({ key: 'a', running: true, duration: 1000 });
  vi.advanceTimersByTime(700);
  rerender({ key: 'a', running: false, duration: 1000 });
  vi.advanceTimersByTime(5000);
  expect(onDone).not.toHaveBeenCalled();
  rerender({ key: 'a', running: true, duration: 1000 });
  vi.advanceTimersByTime(299);
  expect(onDone).not.toHaveBeenCalled();
  vi.advanceTimersByTime(1);
  expect(onDone).toHaveBeenCalledTimes(1);
});

it('starts a fresh countdown for a new key', () => {
  const { onDone, rerender } = setup({ key: 'a', running: true, duration: 1000 });
  vi.advanceTimersByTime(700);
  rerender({ key: 'b', running: true, duration: 1000 });
  vi.advanceTimersByTime(700);
  expect(onDone).not.toHaveBeenCalled();
  vi.advanceTimersByTime(300);
  expect(onDone).toHaveBeenCalledTimes(1);
});

it('never fires without a duration', () => {
  const { onDone } = setup({ key: 'a', running: true, duration: null });
  vi.advanceTimersByTime(60_000);
  expect(onDone).not.toHaveBeenCalled();
});
