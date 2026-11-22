import { describe, expect, it } from 'vitest';
import { makeItem, makeViewSettings } from '../lib/__testfixtures__/fixtures';
import { getDisplayUnit } from '../lib/format';
import { catalogHighlightKey, createEditorViewStore, highlightIdsFromKey, loadLengthUnit, viewExceptTime } from './editor-view-store';

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

describe('lamps switched in EXPLORE (#910)', () => {
  it('switches a lamp off and back on, outside the view and the house', () => {
    const store = createEditorViewStore(makeViewSettings());
    const before = store.getState();
    const { switchLamp } = before.actions;
    expect(before.lampsOff.size).toBe(0);
    switchLamp('lamp-1');
    const off = store.getState();
    expect([...off.lampsOff]).toEqual(['lamp-1']);
    // Its own field: the view settings keep their identity.
    expect(off.view).toBe(before.view);
    switchLamp('lamp-1');
    expect(store.getState().lampsOff.size).toBe(0);
    // A new set each time, so a selector sees the change.
    expect(store.getState().lampsOff).not.toBe(off.lampsOff);
  });

  it('forgets the switched lamps, or only those no longer in the house', () => {
    const store = createEditorViewStore(makeViewSettings());
    const { switchLamp, resetSwitches } = store.getState().actions;
    const empty = store.getState();
    resetSwitches();
    expect(store.getState()).toBe(empty);
    switchLamp('a');
    switchLamp('b');
    const both = store.getState();
    resetSwitches(new Set(['a', 'b', 'c']));
    expect(store.getState()).toBe(both);
    resetSwitches(new Set(['a']));
    expect([...store.getState().lampsOff]).toEqual(['a']);
    resetSwitches();
    expect(store.getState().lampsOff.size).toBe(0);
  });
});

describe('TVs switched in EXPLORE (#910)', () => {
  it('switches a TV on and back off, beside the lamps', () => {
    const store = createEditorViewStore(makeViewSettings());
    const { switchTv, switchLamp } = store.getState().actions;
    expect(store.getState().tvsOn.size).toBe(0);
    switchTv('tv-1');
    expect([...store.getState().tvsOn]).toEqual(['tv-1']);
    expect(store.getState().lampsOff.size).toBe(0);
    switchLamp('lamp-1');
    const lampsOff = store.getState().lampsOff;
    switchTv('tv-1');
    expect(store.getState().tvsOn.size).toBe(0);
    // A TV switch leaves the lamps' set alone: the lamp effects don't rerun.
    expect(store.getState().lampsOff).toBe(lampsOff);
  });

  it('forgets switched TVs with the lamps, keeping what is still in the house', () => {
    const store = createEditorViewStore(makeViewSettings());
    const { switchTv, switchLamp, resetSwitches } = store.getState().actions;
    switchTv('tv-1');
    switchTv('tv-2');
    switchLamp('lamp-1');
    const lampsOff = store.getState().lampsOff;
    resetSwitches(new Set(['tv-1', 'lamp-1']));
    expect([...store.getState().tvsOn]).toEqual(['tv-1']);
    expect(store.getState().lampsOff).toBe(lampsOff);
    resetSwitches();
    expect(store.getState().tvsOn.size).toBe(0);
    expect(store.getState().lampsOff.size).toBe(0);
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

describe('length unit (#725)', () => {
  function memoryStorage(): Storage {
    const data = new Map<string, string>();
    return {
      get length() {
        return data.size;
      },
      clear: () => data.clear(),
      getItem: (key) => data.get(key) ?? null,
      key: (index) => [...data.keys()][index] ?? null,
      removeItem: (key) => void data.delete(key),
      setItem: (key, value) => void data.set(key, value),
    };
  }

  it('starts in metres, and anything unreadable in storage is metres', () => {
    const storage = memoryStorage();
    expect(createEditorViewStore(makeViewSettings()).getState().lengthUnit).toBe('metric');
    expect(loadLengthUnit(storage)).toBe('metric');
    storage.setItem('length-unit', 'cubits');
    expect(loadLengthUnit(storage)).toBe('metric');
  });

  it('remembers the unit on the browser and mirrors it for strings outside React', () => {
    const storage = memoryStorage();
    const store = createEditorViewStore(makeViewSettings(), { storage });
    try {
      store.getState().actions.setLengthUnit('imperial');
      expect(store.getState().lengthUnit).toBe('imperial');
      expect(getDisplayUnit()).toBe('imperial');
      expect(loadLengthUnit(storage)).toBe('imperial');
      expect(createEditorViewStore(makeViewSettings(), { lengthUnit: loadLengthUnit(storage) }).getState().lengthUnit).toBe('imperial');
    } finally {
      store.getState().actions.setLengthUnit('metric');
    }
    expect(getDisplayUnit()).toBe('metric');
  });

  it('the same unit again keeps the state object', () => {
    const store = createEditorViewStore(makeViewSettings(), { storage: memoryStorage() });
    const before = store.getState();
    before.actions.setLengthUnit('metric');
    expect(store.getState()).toBe(before);
  });

  it('a store made with no unit leaves the mirror alone, and an unchanged unit writes nothing', () => {
    const storage = memoryStorage();
    const chosen = createEditorViewStore(makeViewSettings(), { lengthUnit: 'imperial', storage });
    try {
      expect(getDisplayUnit()).toBe('imperial');
      createEditorViewStore(makeViewSettings());
      expect(getDisplayUnit()).toBe('imperial');
      chosen.getState().actions.setLengthUnit('imperial');
      expect(storage.length).toBe(0);
    } finally {
      chosen.getState().actions.setLengthUnit('metric');
    }
    expect(getDisplayUnit()).toBe('metric');
    expect(loadLengthUnit(storage)).toBe('metric');
  });
});
