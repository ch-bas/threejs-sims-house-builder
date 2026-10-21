'use client';

import { useMemo, type ReactNode } from 'react';
import { RoomEditorProvider, useRoomEditor } from './room-editor-context';
import { SelectionProvider, useSelection } from './selection-context';

/**
 * Re-provides the editor and selection contexts, frozen at their last value
 * while `hold` is set: a subtree nobody can see or reach, such as the closed
 * drawer, then skips every layout edit and catches up in one render when it
 * shows again (#3). Wrap a memoised child, or the parent's own render still
 * re-renders it. Zustand-backed view state is not held.
 */
export function HeldEditorContexts({ hold, children }: { hold: boolean; children: ReactNode }): JSX.Element {
  const editor = useHeld(useRoomEditor(), hold);
  const selection = useHeld(useSelection(), hold);
  return (
    <RoomEditorProvider value={editor}>
      <SelectionProvider value={selection}>{children}</SelectionProvider>
    </RoomEditorProvider>
  );
}

// The value at the moment `hold` turned on. useMemo is only a cache: should
// React drop it, the live value shows, which is never wrong.
function useHeld<T>(value: T, hold: boolean): T {
  const key = hold ? HOLD : value;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => value, [key]);
}

const HOLD = Symbol('hold');
