// @vitest-environment jsdom
import { act, cleanup, render } from '@testing-library/react';
import { Component, useEffect, useState, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeLayout } from '../lib/__testfixtures__/fixtures';
import { loadLayout, noteEditorCrashed } from '../lib/persistence';
import { useLayoutPersistence } from './use-layout-persistence';
import type { RoomLayout } from '../lib/types';

// A layout that crashes the editor must never reach the save, or every reload
// crashes again (#568). The route's error boundary unmounts the editor, and
// the unmount flush used to write whatever layout was last rendered. The
// error screen says so as it renders, before the editor's cleanup runs.

class Boundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };
  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }
  override render(): ReactNode {
    return this.state.failed ? <ErrorScreen /> : this.props.children;
  }
}

/** Like app/error.tsx: it notes the crash while it renders. */
function ErrorScreen(): JSX.Element {
  useState(noteEditorCrashed);
  return <p>crashed</p>;
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

// A page going away, or an editor unmounted for any other reason than a
// crash, must still save the edit it is showing, even one made in the same
// task: a big edit's render and scene rebuild is one long task, and the
// browser runs pagehide before any timer queued in it.
describe('useLayoutPersistence: an edit made in the same task is still flushed (#568 review)', () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.useFakeTimers();
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  function Plain({ layout }: { layout: RoomLayout }): JSX.Element {
    useLayoutPersistence({ layout, onHydrate: () => {}, debounceMs: DEBOUNCE });
    return <span />;
  }

  it('unmount in the same task as the edit', () => {
    const view = render(<Plain layout={makeLayout({ name: 'House' })} />);
    act(() => {
      vi.advanceTimersByTime(DEBOUNCE);
    });
    view.rerender(<Plain layout={makeLayout({ name: 'House, edited' })} />);
    view.unmount();
    expect(loadLayout()?.name).toBe('House, edited');
  });

  it('pagehide in the same task as the edit', () => {
    const view = render(<Plain layout={makeLayout({ name: 'House' })} />);
    act(() => {
      vi.advanceTimersByTime(DEBOUNCE);
    });
    act(() => {
      view.rerender(<Plain layout={makeLayout({ name: 'House, edited' })} />);
    });
    window.dispatchEvent(new Event('pagehide'));
    expect(loadLayout()?.name).toBe('House, edited');
  });

  it('a pagehide that keeps the page (bfcache) leaves the edit saved afterwards too', () => {
    const view = render(<Plain layout={makeLayout({ name: 'House' })} />);
    act(() => {
      vi.advanceTimersByTime(DEBOUNCE);
    });
    act(() => {
      view.rerender(<Plain layout={makeLayout({ name: 'House, edited' })} />);
    });
    window.dispatchEvent(new Event('pagehide'));
    const afterHide = loadLayout()?.name;
    act(() => {
      vi.advanceTimersByTime(DEBOUNCE * 2);
    });
    expect({ afterHide, later: loadLayout()?.name }).toEqual({ afterHide: 'House, edited', later: 'House, edited' });
  });

  it('a first edit right after mount, before any timer, then unmount', () => {
    const view = render(<Plain layout={makeLayout({ name: 'House' })} />);
    view.rerender(<Plain layout={makeLayout({ name: 'House, edited' })} />);
    view.unmount();
    expect(loadLayout()?.name).toBe('House, edited');
  });
});
