'use client';

import { createContext, useContext, useMemo, type Dispatch, type ReactNode, type SetStateAction } from 'react';
import type { LayoutActions } from '../hooks/use-layout-state';
import type { UseHistoryResult } from '../hooks/use-history';
import type { FloorLayout, GameMode, RoomLayout, ViewSettings } from '../lib/types';
import type { SoundCue } from '../lib/sounds';

export interface RoomEditorContextValue {
  // Layout state
  readonly layout: RoomLayout;
  readonly activeFloor: FloorLayout;
  readonly activeFloorIndex: number;
  readonly actions: LayoutActions;

  // View settings
  readonly view: ViewSettings;
  readonly setView: Dispatch<SetStateAction<ViewSettings>>;
  toggle<K extends keyof ViewSettings>(key: K): void;

  // Computed
  readonly collidingIds: ReadonlySet<string>;
  readonly highlightedIds: ReadonlySet<string>;

  // Catalog search (shared between sidebar and 3D highlighting)
  readonly catalogQuery: string;
  setCatalogQuery: Dispatch<SetStateAction<string>>;

  // Utilities
  readonly recentColors: readonly string[];
  pushColor(color: string): void;
  playCue(cue: SoundCue): void;

  // History
  readonly history: UseHistoryResult;

  // Engine state
  readonly isReady: boolean;
  readonly error: string | null;

  // Game / lighting
  readonly gameMode: GameMode;
  setGameMode: Dispatch<SetStateAction<GameMode>>;
  readonly autoCycleLighting: boolean;
  setAutoCycleLighting: Dispatch<SetStateAction<boolean>>;
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
  const memoised = useMemo(() => value, [
    value.layout,
    value.activeFloor,
    value.activeFloorIndex,
    value.actions,
    value.view,
    value.setView,
    value.collidingIds,
    value.highlightedIds,
    value.catalogQuery,
    value.setCatalogQuery,
    value.recentColors,
    value.pushColor,
    value.playCue,
    value.history,
    value.isReady,
    value.error,
    value.gameMode,
    value.setGameMode,
    value.autoCycleLighting,
    value.setAutoCycleLighting,
    value.toggle,
  ]);
  return <RoomEditorContext.Provider value={memoised}>{children}</RoomEditorContext.Provider>;
}
