// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { memo } from 'react';
import { afterEach, expect, it } from 'vitest';
import { makeLayout } from '../lib/__testfixtures__/fixtures';
import { HeldEditorContexts } from './held-editor-contexts';
import { RoomEditorProvider, useRoomEditor, type RoomEditorContextValue } from './room-editor-context';
import { SelectionProvider, useSelection, type SelectionContextValue } from './selection-context';
import type { UseHistoryResult } from '../hooks/use-history';
import type { LayoutActions } from '../hooks/use-layout-state';
import type { RoomLayout } from '../lib/types';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(cleanup);

const actions = {} as LayoutActions;
const history = {} as UseHistoryResult;
const noop = (): void => {};

function editorValue(layout: RoomLayout): RoomEditorContextValue {
  return {
    layout,
    activeFloor: layout.floors[0]!,
    activeFloorIndex: 0,
    actions,
    collidingIds: new Set(),
    recentColors: [],
    pushColor: noop,
    playCue: noop,
    history,
    isReady: true,
    error: null,
  };
}

function selectionValue(selectedItemId: string | null): SelectionContextValue {
  return {
    selectedItemId,
    setSelectedItemId: noop,
    selectedItem: null,
    extraSelectedIds: new Set(),
    setExtraSelectedIds: noop,
    allSelectedIds: new Set(selectedItemId ? [selectedItemId] : []),
    selectOnly: noop,
  };
}

// #3: the closed drawer's panels skip every layout edit, and catch up when it opens.
it('holds the editor and selection while hidden and catches up on release', () => {
  const seen: Array<{ name: string; selected: string | null }> = [];
  const Panel = memo(function Panel(): null {
    seen.push({ name: useRoomEditor().layout.name, selected: useSelection().selectedItemId });
    return null;
  });
  const panel = <Panel />;
  const tree = (name: string, selected: string | null, hold: boolean) => (
    <RoomEditorProvider value={editorValue(makeLayout({ name }))}>
      <SelectionProvider value={selectionValue(selected)}>
        <HeldEditorContexts hold={hold}>{panel}</HeldEditorContexts>
      </SelectionProvider>
    </RoomEditorProvider>
  );

  const { rerender } = render(tree('A', null, false));
  expect(seen).toEqual([{ name: 'A', selected: null }]);
  rerender(tree('B', null, false));
  expect(seen.at(-1)).toEqual({ name: 'B', selected: null });
  const shown = seen.length;

  rerender(tree('C', null, true));
  rerender(tree('D', 'x', true));
  rerender(tree('E', 'y', true));
  // Hiding froze the value from the render that hid it.
  expect(seen.length - shown).toBe(1);
  expect(seen.at(-1)).toEqual({ name: 'C', selected: null });

  rerender(tree('F', 'y', false));
  expect(seen.length - shown).toBe(2);
  expect(seen.at(-1)).toEqual({ name: 'F', selected: 'y' });
});
