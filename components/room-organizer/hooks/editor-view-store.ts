// The editor's view and game state (#3, #148): view settings, catalog search,
// game mode and the time auto-cycle. It lives in a store, not in the
// orchestrator's useState, so a time-of-day tick or a search keystroke
// re-renders only the components that select the changed field, instead of
// the orchestrator and with it the whole panel tree.
//
// One store per editor instance (see EditorViewProvider), not a module
// singleton: view state is per mount and is never persisted, unlike the layout.

import { createStore, type StoreApi } from 'zustand/vanilla';
import type { FurnitureItem, GameMode, ViewSettings } from '../lib/types';
import type { Dispatch, SetStateAction } from 'react';

export interface EditorViewActions {
  readonly setView: Dispatch<SetStateAction<ViewSettings>>;
  toggle<K extends keyof ViewSettings>(key: K): void;
  readonly setCatalogQuery: Dispatch<SetStateAction<string>>;
  readonly setGameMode: Dispatch<SetStateAction<GameMode>>;
  readonly setAutoCycleLighting: Dispatch<SetStateAction<boolean>>;
}

export interface EditorViewState {
  readonly view: ViewSettings;
  /** Catalog search, shared by the catalog panel and the 3D highlight. */
  readonly catalogQuery: string;
  readonly gameMode: GameMode;
  readonly autoCycleLighting: boolean;
  /** Created once per store, so selecting it never re-renders. */
  readonly actions: EditorViewActions;
}

export type EditorViewStore = StoreApi<EditorViewState>;

function resolve<T>(next: SetStateAction<T>, current: T): T {
  return typeof next === 'function' ? (next as (previous: T) => T)(current) : next;
}

export function createEditorViewStore(initialView: ViewSettings): EditorViewStore {
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
    const actions: EditorViewActions = {
      setView: (next) => setField('view', next),
      toggle: (key) => setField('view', (view) => ({ ...view, [key]: !view[key] })),
      setCatalogQuery: (next) => setField('catalogQuery', next),
      setGameMode: (next) => setField('gameMode', next),
      setAutoCycleLighting: (next) => setField('autoCycleLighting', next),
    };
    return { view: initialView, catalogQuery: '', gameMode: 'build', autoCycleLighting: false, actions };
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
