// The editor's view and game state (#3, #148): view settings, catalog search,
// game mode and the time auto-cycle. It lives in a store, not in the
// orchestrator's useState, so a time-of-day tick or a search keystroke
// re-renders only the components that select the changed field, instead of
// the orchestrator and with it the whole panel tree.
//
// One store per editor instance (see EditorViewProvider), not a module
// singleton: view state is per mount and is never persisted, unlike the layout.
// The length unit (#725) is the exception: a per-browser preference, kept in
// its own storage key and never in the house.

import { createStore, type StoreApi } from 'zustand/vanilla';
import { asLengthUnit, setDisplayUnit, type LengthUnit } from '../lib/format';
import { safeGetItem, safeSetItem } from '../lib/safe-storage';
import { withViewInvariants } from '../lib/view-options';
import type { FurnitureItem, GameMode, ViewSettings } from '../lib/types';
import type { Dispatch, SetStateAction } from 'react';

export interface EditorViewActions {
  readonly setView: Dispatch<SetStateAction<ViewSettings>>;
  toggle<K extends keyof ViewSettings>(key: K): void;
  readonly setCatalogQuery: Dispatch<SetStateAction<string>>;
  readonly setGameMode: Dispatch<SetStateAction<GameMode>>;
  readonly setAutoCycleLighting: Dispatch<SetStateAction<boolean>>;
  /** Shows lengths in the unit and remembers it on this browser (#725). */
  setLengthUnit(unit: LengthUnit): void;
  /** Switch a lamp off, or back on (#910). Not an edit: no undo, no save. */
  switchLamp(id: string): void;
  /** Switch a TV on, or back off (#910). Not an edit either. */
  switchTv(id: string): void;
  /**
   * Forget the switched lamps and TVs (#910): when EXPLORE ends, and on a
   * whole-house load, since templates and copies reuse item ids. With `keep`,
   * only the ids not in it are forgotten (items deleted or gone with the
   * house).
   */
  resetSwitches(keep?: ReadonlySet<string>): void;
}

export interface EditorViewState {
  readonly view: ViewSettings;
  /** Catalog search, shared by the catalog panel and the 3D highlight. */
  readonly catalogQuery: string;
  readonly gameMode: GameMode;
  readonly autoCycleLighting: boolean;
  /** Metres or feet and inches, for what is shown; geometry stays in metres (#725). */
  readonly lengthUnit: LengthUnit;
  /**
   * Lamps the walker switched off in EXPLORE (#910), by item id. Only for
   * the walk: cleared when EXPLORE ends and on a whole-house load, never in
   * the house, since switching a lamp is not an edit. A new set on every
   * change.
   */
  readonly lampsOff: ReadonlySet<string>;
  /** TVs the walker switched on in EXPLORE (#910), by item id: as `lampsOff`, a TV is off unless here. */
  readonly tvsOn: ReadonlySet<string>;
  /** Created once per store, so selecting it never re-renders. */
  readonly actions: EditorViewActions;
}

export type EditorViewStore = StoreApi<EditorViewState>;

function resolve<T>(next: SetStateAction<T>, current: T): T {
  return typeof next === 'function' ? (next as (previous: T) => T)(current) : next;
}

/** A new set with `id` in it, or out of it if it was in. */
function toggled(set: ReadonlySet<string>, id: string): ReadonlySet<string> {
  const next = new Set(set);
  if (!next.delete(id)) next.add(id);
  return next;
}

/** The ids of `set` that are in `keep` (none without it); `set` itself when nothing goes. */
function kept(set: ReadonlySet<string>, keep: ReadonlySet<string> | undefined): ReadonlySet<string> {
  if (set.size === 0) return set;
  const next = keep ? new Set([...set].filter((id) => keep.has(id))) : new Set<string>();
  return next.size === set.size ? set : next;
}

const LENGTH_UNIT_KEY = 'length-unit';

/** The unit picked on this browser; anything unreadable is metres. */
export function loadLengthUnit(storage?: Storage): LengthUnit {
  return asLengthUnit(safeGetItem(LENGTH_UNIT_KEY, storage)) ?? 'metric';
}

export function saveLengthUnit(unit: LengthUnit, storage?: Storage): void {
  safeSetItem(LENGTH_UNIT_KEY, unit, storage);
}

export interface EditorViewStoreOptions {
  /** The unit to start in (`loadLengthUnit()` in the editor); metres if absent. */
  lengthUnit?: LengthUnit;
  /** Where the unit is remembered; the browser's storage if absent. */
  storage?: Storage;
}

export function createEditorViewStore(initialView: ViewSettings, options: EditorViewStoreOptions = {}): EditorViewStore {
  const initialUnit = options.lengthUnit ?? 'metric';
  // Strings written outside React (refusals, printouts) read the mirror. Only
  // a unit the caller chose is mirrored: a store made with none (a test, a
  // second mount) must not reset what another set.
  if (options.lengthUnit) setDisplayUnit(options.lengthUnit);
  return createStore<EditorViewState>()((set) => {
    // An unchanged value returns the same state object, so no subscriber is
    // even asked to compare.
    const setField = <K extends 'view' | 'catalogQuery' | 'gameMode' | 'autoCycleLighting'>(
      key: K,
      next: SetStateAction<EditorViewState[K]>
    ): void => {
      set((state) => {
        const value = resolve(next, state[key]);
        return Object.is(value, state[key]) ? state : { ...state, [key]: value };
      });
    };
    // Every view change keeps the cross-field invariants (zone drawing is
    // 2D only, #439).
    const setView = (next: SetStateAction<ViewSettings>): void =>
      setField('view', (view) => withViewInvariants(resolve(next, view)));
    const actions: EditorViewActions = {
      setView,
      toggle: (key) => setView((view) => ({ ...view, [key]: !view[key] })),
      setCatalogQuery: (next) => setField('catalogQuery', next),
      setGameMode: (next) => setField('gameMode', next),
      setAutoCycleLighting: (next) => setField('autoCycleLighting', next),
      setLengthUnit: (unit) => {
        set((state) => {
          if (state.lengthUnit === unit) return state;
          setDisplayUnit(unit);
          saveLengthUnit(unit, options.storage);
          return { ...state, lengthUnit: unit };
        });
      },
      switchLamp: (id) => {
        set((state) => ({ ...state, lampsOff: toggled(state.lampsOff, id) }));
      },
      switchTv: (id) => {
        set((state) => ({ ...state, tvsOn: toggled(state.tvsOn, id) }));
      },
      resetSwitches: (keep) => {
        set((state) => {
          const lampsOff = kept(state.lampsOff, keep);
          const tvsOn = kept(state.tvsOn, keep);
          return lampsOff === state.lampsOff && tvsOn === state.tvsOn ? state : { ...state, lampsOff, tvsOn };
        });
      },
    };
    return {
      view: initialView,
      catalogQuery: '',
      gameMode: 'build',
      autoCycleLighting: false,
      lengthUnit: initialUnit,
      lampsOff: new Set<string>(),
      tvsOn: new Set<string>(),
      actions,
    };
  });
}

/**
 * Every view setting but the time of day — what the orchestrator renders
 * from. Use under `useShallow`: it returns a new object each call.
 */
export function viewExceptTime(state: EditorViewState): Omit<ViewSettings, 'timeOfDay'> {
  const { timeOfDay: _timeOfDay, ...rest } = state.view;
  return rest;
}

/**
 * The ids of the items a catalog search highlights, as a string key: a
 * selector returns this, so its subscriber re-renders only when the matched
 * set changes, not on every keystroke.
 */
export function catalogHighlightKey(query: string, items: readonly FurnitureItem[]): string {
  const normalised = query.trim().toLowerCase();
  if (!normalised) return '';
  const matches: string[] = [];
  for (const item of items) {
    if (item.name.toLowerCase().includes(normalised) || item.type.toLowerCase().includes(normalised)) {
      matches.push(item.id);
    }
  }
  return JSON.stringify(matches);
}

export function highlightIdsFromKey(key: string): ReadonlySet<string> {
  return key ? new Set(JSON.parse(key) as string[]) : new Set<string>();
}
