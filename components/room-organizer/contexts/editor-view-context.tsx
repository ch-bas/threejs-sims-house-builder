'use client';

import { createContext, useContext, type ReactNode } from 'react';
import { useStore } from 'zustand';
import { useShallow } from 'zustand/react/shallow';
import { viewExceptTime, type EditorViewActions, type EditorViewState, type EditorViewStore } from '../hooks/editor-view-store';
import type { ViewSettings } from '../lib/types';

// The context carries the store itself, whose identity never changes, so the
// provider never re-renders a consumer; consumers subscribe to the fields they
// select (#3, #148).
const EditorViewContext = createContext<EditorViewStore | null>(null);

export function EditorViewProvider({ store, children }: { store: EditorViewStore; children: ReactNode }): JSX.Element {
  return <EditorViewContext.Provider value={store}>{children}</EditorViewContext.Provider>;
}

export function useEditorViewStore(): EditorViewStore {
  const store = useContext(EditorViewContext);
  if (!store) throw new Error('useEditorViewStore must be used within an EditorViewProvider');
  return store;
}

/** Subscribe to one slice; the selector must return a stable value (a field, not a new object). */
export function useEditorView<T>(selector: (state: EditorViewState) => T): T {
  return useStore(useEditorViewStore(), selector);
}

export function useEditorViewActions(): EditorViewActions {
  return useEditorView((state) => state.actions);
}

/**
 * The named view settings, re-rendering only when one of them changes —
 * never select the whole `view`, which changes four times a second while the
 * time of day auto-cycles.
 */
export function useViewSettings<K extends keyof ViewSettings>(...keys: readonly K[]): Pick<ViewSettings, K> {
  return useEditorView(
    useShallow((state: EditorViewState) => {
      const picked = {} as Pick<ViewSettings, K>;
      for (const key of keys) picked[key] = state.view[key];
      return picked;
    })
  );
}

/** Every view setting but the time of day: what the orchestrator reads. */
export function useViewExceptTime(): Omit<ViewSettings, 'timeOfDay'> {
  return useEditorView(useShallow(viewExceptTime));
}
