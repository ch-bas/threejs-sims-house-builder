// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RoomEditorProvider, type RoomEditorContextValue } from '../contexts/room-editor-context';
import { makeFloor } from '../lib/__testfixtures__/fixtures';
import { WallPaintPanel } from './wall-paint-panel';
import type { FloorLayout } from '../lib/types';

type Wall = { id: string; kind: 'exterior' | 'interior' } | null;

function setup(floor: FloorLayout, selectedWall: Wall) {
  const actions = { setWallColor: vi.fn(), setInteriorWallColor: vi.fn(), toggleExteriorWall: vi.fn() };
  const value = { activeFloor: floor, actions } as unknown as RoomEditorContextValue;
  render(
    <RoomEditorProvider value={value}>
      <WallPaintPanel selectedWall={selectedWall} onSelectedWallChange={() => {}} />
    </RoomEditorProvider>
  );
  const checkedChips = () =>
    screen
      .getAllByRole('radio')
      .filter((chip) => chip.getAttribute('aria-checked') === 'true')
      .map((chip) => chip.textContent);
  const ringedSwatches = () =>
    screen
      .queryAllByRole('button', { pressed: true })
      .map((button) => button.getAttribute('aria-label'))
      .filter((label) => label?.startsWith('Use color'));
  return { actions, checkedChips, ringedSwatches };
}

describe('WallPaintPanel — Apply-to truthfulness (#221)', () => {
  afterEach(cleanup);

  const interiorFloor = () =>
    makeFloor({ interiorWalls: [{ id: 'iw-1', x1: 0, z1: 0, x2: 2, z2: 0, color: '#ffffff' }] });

  it('checks no Apply-to chip while an interior wall is the target', () => {
    const { checkedChips } = setup(interiorFloor(), { id: 'iw-1', kind: 'interior' });
    expect(checkedChips()).toEqual([]);
  });

  it('still paints only the interior wall from that state', () => {
    const { actions } = setup(interiorFloor(), { id: 'iw-1', kind: 'interior' });
    fireEvent.click(screen.getByRole('button', { name: 'Use color #e8dcc4' }));
    expect(actions.setInteriorWallColor).toHaveBeenCalledWith('iw-1', '#e8dcc4');
    expect(actions.setWallColor).not.toHaveBeenCalled();
  });

  it('checks the exterior wall chip for an exterior selection, and All with nothing selected', () => {
    expect(setup(makeFloor(), { id: 'south', kind: 'exterior' }).checkedChips()).toEqual(['S']);
    cleanup();
    expect(setup(makeFloor(), null).checkedChips()).toEqual(['All']);
  });

  it('rings no swatch in the All state when the exterior walls differ', () => {
    // Both are on the default (pastel) tab, so a north-only fallback would ring one.
    const floor = makeFloor({ wallColors: { north: '#ffffff', south: '#fff4d6' } });
    expect(setup(floor, null).ringedSwatches()).toEqual([]);
  });

  it('rings the shared colour when all four exterior walls match', () => {
    const floor = makeFloor({
      wallColors: { north: '#ffffff', south: '#ffffff', east: '#FFFFFF', west: '#ffffff' },
    });
    expect(setup(floor, null).ringedSwatches()).toEqual(['Use color #ffffff']);
  });

  it('treats unpainted walls as the default colour', () => {
    expect(setup(makeFloor(), null).ringedSwatches()).toEqual(['Use color #e8dcc4']);
  });
});
