// @vitest-environment jsdom
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CHUNK_RECOVERY_SCRIPT, NO_WATCHDOG_ATTRIBUTE } from './chunk-recovery';
import NotFound from './not-found';

// The head script's watchdog (#499): only a page that starts the editor reloads.

/** Runs the head script with a stand-in for `location`, whose reload jsdom can't spy on. */
function runScript(): { reload: ReturnType<typeof vi.fn> } {
  const location = { reload: vi.fn() };
  new Function('location', CHUNK_RECOVERY_SCRIPT)(location);
  return location;
}

beforeEach(() => {
  vi.useFakeTimers();
  window.sessionStorage.clear();
  delete (window as { __pcReady?: boolean }).__pcReady;
});

afterEach(() => {
  document.body.replaceChildren();
  vi.useRealTimers();
});

describe('the head watchdog', () => {
  it('reloads the editor page once when it never signals ready', () => {
    const { reload } = runScript();
    vi.advanceTimersByTime(20_000);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('leaves the 404 page alone, and keeps the reload guard unspent', () => {
    document.body.innerHTML = renderToStaticMarkup(createElement(NotFound));
    expect(document.querySelector(`[${NO_WATCHDOG_ATTRIBUTE}]`)).not.toBeNull();
    const { reload } = runScript();
    vi.advanceTimersByTime(120_000);
    expect(reload).not.toHaveBeenCalled();
    expect(window.sessionStorage.length).toBe(0);
  });
});
