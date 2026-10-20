'use client';

import { createContext, useContext, useMemo, type ReactNode } from 'react';
import type { UseHistoryResult } from '../hooks/use-history';
import type { LayoutActions } from '../hooks/use-layout-state';
import type { SoundCue } from '../lib/sounds';
import type { FloorLayout, RoomLayout } from '../lib/types';

export interface RoomEditorContextValue {
  // Layout state
  readonly layout: RoomLayout;
  readonly activeFloor: FloorLayout;
  readonly activeFloorIndex: number;
  readonly actions: LayoutActions;

  // View settings, catalog search and game mode live in the editor view
  // store (`useViewSettings`, `useEditorView`): they change at typing and
  // time-tick rates, and in this context every change re-rendered every
  // consumer (#148).

  // Computed
  readonly collidingIds: ReadonlySet<string>;

  // Utilities
  readonly recentColors: readonly string[];
  pushColor(color: string): void;
  playCue(cue: SoundCue): void;

  // History
  readonly history: UseHistoryResult;

  // Engine state
  readonly isReady: boolean;
  readonly error: string | null;
}

const RoomEditorContext = createContext<RoomEditorContextValue | null>(null);

export function useRoomEditor(): RoomEditorContextValue {
  const ctx = useContext(RoomEditorContext);
  if (!ctx) throw new Error('useRoomEditor must be used within a RoomEditorProvider');
  return ctx;
}

export interface RoomEditorProviderProps {
  value: RoomEditorContextValue;
  children: ReactNode;
}

export function RoomEditorProvider({ value, children }: RoomEditorProviderProps): JSX.Element {
  // The parent rebuilds `value` every render, so depending on it would make
  // this memo a no-op; the enumerated fields are the real invalidation keys.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const memoised = useMemo(() => value, [
    value.layout,
    value.activeFloor,
    value.activeFloorIndex,
    value.actions,
    value.collidingIds,
    value.recentColors,
    value.pushColor,
    value.playCue,
    value.history,
    value.isReady,
    value.error,
  ]);
  return <RoomEditorContext.Provider value={memoised}>{children}</RoomEditorContext.Provider>;
}
