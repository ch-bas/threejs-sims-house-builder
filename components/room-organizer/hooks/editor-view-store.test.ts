import { describe, expect, it } from 'vitest';
import { makeItem, makeViewSettings } from '../lib/__testfixtures__/fixtures';
import { catalogHighlightKey, createEditorViewStore, highlightIdsFromKey, viewExceptTime } from './editor-view-store';

describe('editor view store (#3, #148)', () => {
  it('applies values and updaters, and toggles a view flag', () => {
    const store = createEditorViewStore(makeViewSettings());
    const { setView, toggle, setCatalogQuery, setGameMode, setAutoCycleLighting } = store.getState().actions;
    setView((view) => ({ ...view, timeOfDay: 18 }));
    toggle('view2D');
    setCatalogQuery('sofa');
    setGameMode('buy');
    setAutoCycleLighting((on) => !on);
    const state = store.getState();
    expect(state.view.timeOfDay).toBe(18);
    expect(state.view.view2D).toBe(true);
    expect(state.catalogQuery).toBe('sofa');
    expect(state.gameMode).toBe('buy');
    expect(state.autoCycleLighting).toBe(true);
  });

  it('an unchanged value keeps the state object and notifies nobody', () => {
    const store = createEditorViewStore(makeViewSettings());
    let notified = 0;
    store.subscribe(() => {
      notified += 1;
    });
    const before = store.getState();
    const { setView, setCatalogQuery, setGameMode, setAutoCycleLighting } = before.actions;
    setView((view) => view);
    setCatalogQuery('');
    setGameMode('build');
    setAutoCycleLighting(false);
    expect(store.getState()).toBe(before);
    expect(notified).toBe(0);
  });

  it('keeps the actions identity across updates', () => {
    const store = createEditorViewStore(makeViewSettings());
    const { actions } = store.getState();
    actions.setCatalogQuery('bed');
    actions.toggle('showMinimap');
    expect(store.getState().actions).toBe(actions);
  });

  it('viewExceptTime drops only the time of day', () => {
    const store = createEditorViewStore(makeViewSettings({ timeOfDay: 7 }));
    const rest = viewExceptTime(store.getState());
    expect(rest).not.toHaveProperty('timeOfDay');
    expect(Object.keys(rest).length).toBe(Object.keys(store.getState().view).length - 1);
  });
});

describe('catalogHighlightKey', () => {
  const items = [
    makeItem({ id: 'a', name: 'Corner Sofa', type: 'sofa' }),
    makeItem({ id: 'b', name: 'Dining Chair', type: 'chair' }),
    makeItem({ id: 'c', name: 'Armchair', type: 'chair' }),
  ];

  it('is empty for a blank query and matches name or type, case-insensitively', () => {
    expect(catalogHighlightKey('  ', items)).toBe('');
    expect([...highlightIdsFromKey(catalogHighlightKey('CHAIR', items))]).toEqual(['b', 'c']);
    expect([...highlightIdsFromKey(catalogHighlightKey('corner', items))]).toEqual(['a']);
    expect(highlightIdsFromKey('').size).toBe(0);
  });

  it('is the same key for keystrokes that match the same items', () => {
    // So the subscriber, and the furniture outline it feeds, stays put.
    expect(catalogHighlightKey('s', items)).toBe(catalogHighlightKey('so', items));
    expect(catalogHighlightKey('so', items)).toBe(catalogHighlightKey('sofa', items));
    expect(catalogHighlightKey('sofa', items)).not.toBe(catalogHighlightKey('sofas', items));
  });
});

describe('editor view store invariants (#439)', () => {
  it('switching back to 3D, by any action, disarms zone drawing', () => {
    const store = createEditorViewStore(makeViewSettings({ view2D: true, drawZoneMode: true }));
    store.getState().actions.toggle('view2D');
    expect(store.getState().view).toMatchObject({ view2D: false, drawZoneMode: false });

    const walk = createEditorViewStore(makeViewSettings({ view2D: true, drawZoneMode: true }));
    walk.getState().actions.setView((view) => ({ ...view, view2D: false, walkthroughMode: true }));
    expect(walk.getState().view.drawZoneMode).toBe(false);
  });

  it('zone drawing on the plan survives other view changes', () => {
    const store = createEditorViewStore(makeViewSettings({ view2D: true, drawZoneMode: true }));
    store.getState().actions.toggle('showMeasurements');
    expect(store.getState().view.drawZoneMode).toBe(true);
  });
});
