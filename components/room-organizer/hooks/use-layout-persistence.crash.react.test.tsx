// @vitest-environment jsdom
import { act, cleanup, render } from '@testing-library/react';
import { Component, useEffect, useState, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeLayout } from '../lib/__testfixtures__/fixtures';
import { loadLayout, noteEditorCrashed } from '../lib/persistence';
import { listSnapshots } from '../lib/version-history';
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

// Mobile browsers discard a background tab without firing pagehide: the
// last reliable signal is visibilitychange to hidden (#554).
describe('useLayoutPersistence: a tab going to the background saves the pending edit (#554)', () => {
  let visibility: DocumentVisibilityState = 'visible';

  function setVisibility(state: DocumentVisibilityState): void {
    visibility = state;
    document.dispatchEvent(new Event('visibilitychange'));
  }

  beforeEach(() => {
    window.localStorage.clear();
    vi.useFakeTimers();
    visibility = 'visible';
    vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility);
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  // One house throughout: restore points are gated per house (#479).
  const house = (overrides: Partial<RoomLayout>): RoomLayout => makeLayout({ id: 'house-554', ...overrides });

  function Plain({ layout }: { layout: RoomLayout }): JSX.Element {
    useLayoutPersistence({ layout, onHydrate: () => {}, debounceMs: DEBOUNCE });
    return <span />;
  }

  function edited(): ReturnType<typeof render> {
    const view = render(<Plain layout={house({ name: 'House' })} />);
    act(() => {
      vi.advanceTimersByTime(DEBOUNCE);
    });
    act(() => {
      view.rerender(<Plain layout={house({ name: 'House, edited' })} />);
    });
    return view;
  }

  it('hidden inside the debounce window writes the edit at once', () => {
    edited();
    expect(loadLayout()?.name).toBe('House');
    setVisibility('hidden');
    expect(loadLayout()?.name).toBe('House, edited');
  });

  it('hidden takes a restore point on the ring\'s cadence, so a discarded tab still leaves one', () => {
    const view = render(<Plain layout={house({ name: 'House' })} />);
    act(() => {
      view.rerender(<Plain layout={house({ name: 'House, edited' })} />);
    });
    expect(listSnapshots()).toHaveLength(0);
    setVisibility('hidden');
    expect(listSnapshots().map(({ name }) => name)).toEqual(['House, edited']);
  });

  it('turning visible flushes nothing early', () => {
    edited();
    setVisibility('visible');
    expect(loadLayout()?.name).toBe('House');
    act(() => {
      vi.advanceTimersByTime(DEBOUNCE);
    });
    expect(loadLayout()?.name).toBe('House, edited');
  });

  it('a pagehide after hidden still takes the page-away restore point, once', () => {
    edited();
    setVisibility('hidden');
    const points = listSnapshots().length;
    window.dispatchEvent(new Event('pagehide'));
    window.dispatchEvent(new Event('pagehide'));
    expect(listSnapshots()).toHaveLength(points + 1);
    expect(listSnapshots()[0]?.name).toBe('House, edited');
  });

  it('switching tabs after every edit does not churn the restore points', () => {
    const view = edited();
    const points = listSnapshots().length;
    for (let n = 1; n <= 12; n++) {
      setVisibility('hidden');
      setVisibility('visible');
      act(() => {
        view.rerender(<Plain layout={house({ name: `House, edit ${n}` })} />);
      });
    }
    expect(listSnapshots()).toHaveLength(points);
  });

  it('every trip to the background saves the edits made since the last one', () => {
    const view = edited();
    setVisibility('hidden');
    setVisibility('visible');
    act(() => {
      view.rerender(<Plain layout={house({ name: 'House, edited twice' })} />);
    });
    setVisibility('hidden');
    expect(loadLayout()?.name).toBe('House, edited twice');
  });

  it('after a crash, going to the background never writes the crashing layout', () => {
    const view = render(
      <Boundary>
        <Editor layout={makeLayout({ name: 'House' })} crash="render" />
      </Boundary>
    );
    act(() => {
      vi.advanceTimersByTime(DEBOUNCE);
    });
    act(() => {
      view.rerender(
        <Boundary>
          <Editor layout={makeLayout({ name: 'Poison' })} crash="render" />
        </Boundary>
      );
    });
    expect(view.container.textContent).toBe('crashed');
    setVisibility('hidden');
    expect(loadLayout()?.name).toBe('House');
  });
});
