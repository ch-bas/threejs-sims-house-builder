'use client';

import { createContext, useContext, useMemo, type Dispatch, type ReactNode, type SetStateAction } from 'react';
import type { FurnitureItem } from '../lib/types';

export interface SelectionContextValue {
  readonly selectedItemId: string | null;
  readonly setSelectedItemId: Dispatch<SetStateAction<string | null>>;
  readonly selectedItem: FurnitureItem | null;
  readonly extraSelectedIds: ReadonlySet<string>;
  readonly setExtraSelectedIds: Dispatch<SetStateAction<ReadonlySet<string>>>;
  readonly allSelectedIds: ReadonlySet<string>;
}

const SelectionContext = createContext<SelectionContextValue | null>(null);

export function useSelection(): SelectionContextValue {
  const ctx = useContext(SelectionContext);
  if (!ctx) throw new Error('useSelection must be used within a SelectionProvider');
  return ctx;
}

export interface SelectionProviderProps {
  value: SelectionContextValue;
  children: ReactNode;
}

export function SelectionProvider({ value, children }: SelectionProviderProps): JSX.Element {
  const memoised = useMemo(() => value, [
    value.selectedItemId,
    value.setSelectedItemId,
    value.selectedItem,
    value.extraSelectedIds,
    value.setExtraSelectedIds,
    value.allSelectedIds,
  ]);
  return <SelectionContext.Provider value={memoised}>{children}</SelectionContext.Provider>;
}
