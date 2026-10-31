// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EditorViewProvider } from '../contexts/editor-view-context';
import { createEditorViewStore } from '../hooks/editor-view-store';
import { layoutStore } from '../hooks/use-layout-store';
import { makeFloor, makeLayout, makeViewSettings } from '../lib/__testfixtures__/fixtures';
import { COARSE_POINTER_QUERY } from '../lib/hud-layout';
import { FloorSwitcher } from './floor-switcher';

let coarse = false;

beforeEach(() => {
  window.matchMedia = ((query: string) => ({
    media: query,
    matches: query === COARSE_POINTER_QUERY && coarse,
    addEventListener: () => {},
    removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia;
  layoutStore.setState({ layout: makeLayout({ floors: [makeFloor()] }), activeFloorIndex: 0 });
});

afterEach(cleanup);

function setup(): void {
  render(
    <EditorViewProvider store={createEditorViewStore(makeViewSettings({}))}>
      <FloorSwitcher />
    </EditorViewProvider>
  );
}

describe('FloorSwitcher rename hint (#680)', () => {
  it('speaks of double-clicking to a mouse', () => {
    coarse = false;
    setup();
    expect(screen.getByText(/Double-click a name to rename/)).toBeTruthy();
  });

  it('points at the pencil on a touch screen', () => {
    coarse = true;
    setup();
    expect(screen.getByText(/Tap ✎ to rename/)).toBeTruthy();
    expect(screen.queryByText(/Double-click/)).toBeNull();
  });
});
