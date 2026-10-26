// @vitest-environment jsdom
import { act, cleanup, render } from '@testing-library/react';
import { Component, useEffect, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeLayout } from '../lib/__testfixtures__/fixtures';
import { loadLayout } from '../lib/persistence';
import { useLayoutPersistence } from './use-layout-persistence';
import type { RoomLayout } from '../lib/types';

// A layout that crashes the editor must never reach the save, or every reload
// crashes again (#568). The route's error boundary unmounts the editor, and
// the unmount flush used to write whatever layout was last rendered.

class Boundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };
  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }
  override render(): ReactNode {
    return this.state.failed ? <p>crashed</p> : this.props.children;
  }
}

function ThrowsInRender({ layout }: { layout: RoomLayout }): JSX.Element {
  if (layout.name === 'Poison') throw new Error('builder crashed');
  return <span />;
}

function ThrowsInEffect({ layout }: { layout: RoomLayout }): JSX.Element {
  useEffect(() => {
    if (layout.name === 'Poison') throw new Error('scene build crashed');
  }, [layout]);
  return <span />;
}

const DEBOUNCE = 50;

function Editor({ layout, crash }: { layout: RoomLayout; crash: 'render' | 'effect' }): JSX.Element {
  useLayoutPersistence({ layout, onHydrate: () => {}, debounceMs: DEBOUNCE });
  return crash === 'render' ? <ThrowsInRender layout={layout} /> : <ThrowsInEffect layout={layout} />;
}

describe('useLayoutPersistence: a crashing layout is never flushed (#568)', () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.useFakeTimers();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it.each(['render', 'effect'] as const)('a crash in %s keeps the last good house in the save', (crash) => {
    const view = render(
      <Boundary>
        <Editor layout={makeLayout({ name: 'House' })} crash={crash} />
      </Boundary>
    );
    act(() => {
      vi.advanceTimersByTime(DEBOUNCE);
    });
    expect(loadLayout()?.name).toBe('House');

    // An edit inside the debounce window that rendered fine...
    view.rerender(
      <Boundary>
        <Editor layout={makeLayout({ name: 'House, edited' })} crash={crash} />
      </Boundary>
    );
    act(() => {
      vi.advanceTimersByTime(1);
    });
    // ...then an import that crashes the editor.
    act(() => {
      view.rerender(
        <Boundary>
          <Editor layout={makeLayout({ name: 'Poison' })} crash={crash} />
        </Boundary>
      );
    });
    expect(view.container.textContent).toBe('crashed');
    act(() => {
      vi.advanceTimersByTime(DEBOUNCE * 2);
    });
    expect(loadLayout()?.name).toBe('House, edited');
  });

  it('a clean unmount still flushes the pending edit', () => {
    const view = render(<Editor layout={makeLayout({ name: 'House' })} crash="render" />);
    act(() => {
      vi.advanceTimersByTime(DEBOUNCE);
    });
    view.rerender(<Editor layout={makeLayout({ name: 'House, edited' })} crash="render" />);
    act(() => {
      vi.advanceTimersByTime(1);
    });
    view.unmount();
    expect(loadLayout()?.name).toBe('House, edited');
  });
});
