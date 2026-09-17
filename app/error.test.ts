// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ErrorBoundaryPage from './error';

const renderBoundary = (error: Error & { digest?: string }) =>
  render(createElement(ErrorBoundaryPage, { error, reset: () => {} }));

function chunkError(): Error & { digest?: string } {
  const error = new Error('Loading chunk 805 failed.') as Error & { digest?: string };
  error.name = 'ChunkLoadError';
  return error;
}

describe('app/error.tsx — chunk-failure recovery (#143)', () => {
  let reload: ReturnType<typeof vi.fn>;

  afterEach(cleanup);

  beforeEach(() => {
    window.sessionStorage.clear();
    reload = vi.fn();
    Object.defineProperty(window, 'location', {
      value: { ...window.location, reload },
      writable: true,
    });
  });

  it('reloads once for a chunk error when the guard is unspent', () => {
    renderBoundary(chunkError());
    expect(reload).toHaveBeenCalledTimes(1);
    expect(window.sessionStorage.getItem('pc-chunk-reload')).toBe('1');
  });

  it('does NOT reload again once the guard is spent — shows the safe retry UI instead', () => {
    window.sessionStorage.setItem('pc-chunk-reload', '1');
    renderBoundary(chunkError());
    expect(reload).not.toHaveBeenCalled();
    expect(screen.getByText(/couldn’t load the app/i)).toBeDefined();
    expect(screen.getByRole('button', { name: 'Reload' })).toBeDefined();
    // A deploy problem must never offer to delete the user's saved house.
    expect(screen.queryByRole('button', { name: /reset saved layout/i })).toBeNull();
  });

  it('keeps the reset-layout recovery for non-chunk errors, without auto-reloading', () => {
    renderBoundary(new Error('boom') as Error & { digest?: string });
    expect(reload).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /reset saved layout/i })).toBeDefined();
  });
});
