// @vitest-environment jsdom
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { makeLayout } from '../lib/__testfixtures__/fixtures';
import { loadLayout } from '../lib/persistence';
import { useLayoutPersistence } from './use-layout-persistence';
import type { RoomLayout } from '../lib/types';

function Plain({ layout }: { layout: RoomLayout }): JSX.Element {
  useLayoutPersistence({ layout, onHydrate: () => {}, debounceMs: 50 });
  return <span />;
}
beforeEach(() => { window.localStorage.clear(); vi.useFakeTimers(); });
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });

it('a hidden flush that FAILS still lets pagehide retry once storage has room', () => {
  const view = render(<Plain layout={makeLayout({ name: 'House' })} />);
  act(() => { vi.advanceTimersByTime(50); });
  expect(loadLayout()?.name).toBe('House');
  let full = true;
  const original = Storage.prototype.setItem;
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, k: string, v: string) {
    if (full && k === 'standalone-room-organizer-layout') throw new DOMException('q', 'QuotaExceededError');
    original.call(this, k, v);
  });
  view.rerender(<Plain layout={makeLayout({ name: 'House, edited' })} />);
  act(() => { vi.advanceTimersByTime(1); });
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
  act(() => { document.dispatchEvent(new Event('visibilitychange')); });
  act(() => { vi.advanceTimersByTime(100); }); // debounce retry also fails
  full = false; // another tab freed space
  act(() => { window.dispatchEvent(new Event('pagehide')); });
  expect(loadLayout()?.name).toBe('House, edited');
});
