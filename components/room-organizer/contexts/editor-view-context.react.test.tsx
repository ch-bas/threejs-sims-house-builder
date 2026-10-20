// @vitest-environment jsdom
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { useStore } from 'zustand';
import { useShallow } from 'zustand/react/shallow';
import { createEditorViewStore, viewExceptTime } from '../hooks/editor-view-store';
import { makeViewSettings } from '../lib/__testfixtures__/fixtures';
import { EditorViewProvider, useEditorView, useViewSettings } from './editor-view-context';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// #148: an auto-cycle tick changes only view.timeOfDay, and a catalog
// keystroke only catalogQuery. Before the store, both re-rendered every
// consumer of the one editor context.
function setup() {
  const store = createEditorViewStore(makeViewSettings());
  const renders = { orchestrator: 0, wallPill: 0, clock: 0, search: 0 };
  // Subscribes like RoomOrganizer, which owns the store.
  function Orchestrator(): null {
    renders.orchestrator += 1;
    useStore(store, useShallow(viewExceptTime));
    return null;
  }
  function WallPill(): null {
    renders.wallPill += 1;
    useViewSettings('wallDisplay');
    return null;
  }
  function Clock(): null {
    renders.clock += 1;
    useViewSettings('timeOfDay');
    return null;
  }
  function Search(): null {
    renders.search += 1;
    useEditorView((state) => state.catalogQuery);
    return null;
  }
  render(
    <EditorViewProvider store={store}>
      <Orchestrator />
      <WallPill />
      <Clock />
      <Search />
    </EditorViewProvider>
  );
  return { store, renders };
}

describe('editor view subscriptions (#148)', () => {
  afterEach(cleanup);

  it('a time-of-day tick re-renders only what shows the hour', () => {
    const { store, renders } = setup();
    const mounted = { ...renders };
    for (let tick = 0; tick < 4; tick++) {
      act(() => store.getState().actions.setView((view) => ({ ...view, timeOfDay: view.timeOfDay + 0.25 })));
    }
    expect(renders.clock).toBe(mounted.clock + 4);
    expect(renders.orchestrator).toBe(mounted.orchestrator);
    expect(renders.wallPill).toBe(mounted.wallPill);
    expect(renders.search).toBe(mounted.search);
  });

  it('a catalog keystroke re-renders only the search', () => {
    const { store, renders } = setup();
    const mounted = { ...renders };
    act(() => store.getState().actions.setCatalogQuery('s'));
    act(() => store.getState().actions.setCatalogQuery('so'));
    expect(renders.search).toBe(mounted.search + 2);
    expect(renders.orchestrator).toBe(mounted.orchestrator);
    expect(renders.clock).toBe(mounted.clock);
  });

  it('a view toggle re-renders the subscribers of that field', () => {
    const { store, renders } = setup();
    const mounted = { ...renders };
    act(() => store.getState().actions.setView((view) => ({ ...view, wallDisplay: 'up' })));
    expect(renders.orchestrator).toBe(mounted.orchestrator + 1);
    expect(renders.wallPill).toBe(mounted.wallPill + 1);
    expect(renders.clock).toBe(mounted.clock);
  });
});
