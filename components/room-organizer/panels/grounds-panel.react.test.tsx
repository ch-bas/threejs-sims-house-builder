// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EditorViewProvider } from '../contexts/editor-view-context';
import { RoomEditorProvider, type RoomEditorContextValue } from '../contexts/room-editor-context';
import { createEditorViewStore } from '../hooks/editor-view-store';
import { getGroundDrawKind, setGroundDrawKind } from '../hooks/ground-draw';
import { endPlanCalibration, startPlanCalibration } from '../hooks/plan-calibration';
import { makeLayout, makeViewSettings } from '../lib/__testfixtures__/fixtures';
import { GroundDrawChip } from './ground-draw-chip';
import { GroundsPanel } from './grounds-panel';
import type { GroundPatch } from '../lib/types';

const patch = (id: string, kind: GroundPatch['kind'], x: number): GroundPatch => ({ id, kind, x, z: 4, w: 1, d: 1 });

function setup() {
  const layout = makeLayout({ grounds: [patch('a', 'paving', -3), patch('b', 'deck', -1), patch('c', 'paving', 1)] });
  const editor = { layout, activeFloor: layout.floors[0], activeFloorIndex: 0, actions: { setActiveFloorIndex: vi.fn() }, isReady: true } as unknown as RoomEditorContextValue;
  const store = createEditorViewStore(makeViewSettings({ view2D: true }));
  render(
    <EditorViewProvider store={store}>
      <RoomEditorProvider value={editor}>
        <GroundsPanel />
        <GroundDrawChip />
      </RoomEditorProvider>
    </EditorViewProvider>
  );
}

describe('garden surfaces panel and chip (#924)', () => {
  afterEach(() => {
    cleanup();
    endPlanCalibration();
    setGroundDrawKind(null);
  });

  it('numbers the rows within each kind', () => {
    setup();
    expect(screen.getByRole('button', { name: 'Remove Paving 1' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Remove Timber deck 1' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Remove Paving 2' })).toBeTruthy();
  });

  it('ends the tool when the traced plan’s calibration starts', () => {
    setup();
    act(() => setGroundDrawKind('gravel'));
    expect(screen.getByText(/to lay gravel/)).toBeTruthy();
    act(() => startPlanCalibration({ width: 100, height: 100 }));
    expect(getGroundDrawKind()).toBeNull();
    expect(screen.queryByText(/to lay gravel/)).toBeNull();
  });
});
