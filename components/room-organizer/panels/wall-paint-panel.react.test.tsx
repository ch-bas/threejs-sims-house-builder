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
      .filter((label) => label?.startsWith('Use colour'));
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
    fireEvent.click(screen.getByRole('button', { name: 'Use colour #e8dcc4' }));
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
    expect(setup(floor, null).ringedSwatches()).toEqual(['Use colour #ffffff']);
  });

  it('treats unpainted walls as the default colour', () => {
    expect(setup(makeFloor(), null).ringedSwatches()).toEqual(['Use colour #e8dcc4']);
  });
});

describe('WallPaintPanel — tabs and radios (#557, #646)', () => {
  afterEach(cleanup);

  it('names both tablists', () => {
    setup(makeFloor(), null);
    expect(screen.getByRole('tablist', { name: 'Paint surface' })).toBeTruthy();
    expect(screen.getByRole('tablist', { name: 'Wall colour palette' })).toBeTruthy();
  });

  it('ties each tablist to its panel', () => {
    setup(makeFloor(), null);
    for (const name of ['Walls', 'Pastels']) {
      const tab = screen.getByRole('tab', { name });
      const panel = document.getElementById(tab.getAttribute('aria-controls') ?? '');
      expect(panel?.getAttribute('role')).toBe('tabpanel');
      expect(panel?.getAttribute('aria-labelledby')).toBe(tab.id);
    }
  });

  it('keeps one tab stop per tablist and radio group', () => {
    setup(makeFloor(), null);
    const stops = (role: 'tab' | 'radio') => screen.getAllByRole(role).filter((el) => el.tabIndex === 0);
    expect(stops('tab').map((el) => el.textContent)).toEqual(['Walls', 'Pastels']);
    expect(stops('radio').map((el) => el.textContent)).toEqual(['All']);
  });

  it('keeps Apply-to reachable when nothing is checked', () => {
    setup(makeFloor({ interiorWalls: [{ id: 'iw-1', x1: 0, z1: 0, x2: 2, z2: 0, color: '#ffffff' }] }), { id: 'iw-1', kind: 'interior' });
    expect(screen.getAllByRole('radio').filter((el) => el.tabIndex === 0).map((el) => el.textContent)).toEqual(['All']);
  });

  it('arrows, Home and End move between tabs and open the one they land on', () => {
    setup(makeFloor(), null);
    const pastels = screen.getByRole('tab', { name: 'Pastels' });
    pastels.focus();
    fireEvent.keyDown(pastels, { key: 'ArrowRight' });
    const warm = screen.getByRole('tab', { name: 'Warm' });
    expect(warm.getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(warm);
    fireEvent.keyDown(warm, { key: 'End' });
    expect(screen.getByRole('tab', { name: 'Neutral' }).getAttribute('aria-selected')).toBe('true');
    fireEvent.keyDown(screen.getByRole('tab', { name: 'Neutral' }), { key: 'ArrowRight' });
    expect(screen.getByRole('tab', { name: 'Pastels' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('tabpanel', { name: 'Pastels' })).toBeTruthy();
  });

  it('switches the surface from the keyboard and names the floor palette', () => {
    setup(makeFloor(), null);
    const walls = screen.getByRole('tab', { name: 'Walls' });
    fireEvent.keyDown(walls, { key: 'ArrowRight' });
    expect(screen.getByRole('tab', { name: 'Floor' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('tablist', { name: 'Floor colour palette' })).toBeTruthy();
  });

  it('marks the custom colour well for its focus ring', () => {
    setup(makeFloor(), null);
    const input = screen.getAllByLabelText('Custom colour')[0];
    expect(input?.closest('label')?.className).toContain('pc-colour-well');
  });
});

describe('WallPaintPanel — tabs and radios (#557, #646)', () => {
  afterEach(cleanup);

  it('names both tablists', () => {
    setup(makeFloor(), null);
    expect(screen.getByRole('tablist', { name: 'Paint surface' })).toBeTruthy();
    expect(screen.getByRole('tablist', { name: 'Wall colour palette' })).toBeTruthy();
  });

  it('ties each tablist to its panel', () => {
    setup(makeFloor(), null);
    for (const name of ['Walls', 'Pastels']) {
      const tab = screen.getByRole('tab', { name });
      const panel = document.getElementById(tab.getAttribute('aria-controls') ?? '');
      expect(panel?.getAttribute('role')).toBe('tabpanel');
      expect(panel?.getAttribute('aria-labelledby')).toBe(tab.id);
    }
  });

  it('keeps one tab stop per tablist and radio group', () => {
    setup(makeFloor(), null);
    const stops = (role: 'tab' | 'radio') => screen.getAllByRole(role).filter((el) => el.tabIndex === 0);
    expect(stops('tab').map((el) => el.textContent)).toEqual(['Walls', 'Pastels']);
    expect(stops('radio').map((el) => el.textContent)).toEqual(['All']);
  });

  it('keeps Apply-to reachable when nothing is checked', () => {
    setup(makeFloor({ interiorWalls: [{ id: 'iw-1', x1: 0, z1: 0, x2: 2, z2: 0, color: '#ffffff' }] }), { id: 'iw-1', kind: 'interior' });
    expect(screen.getAllByRole('radio').filter((el) => el.tabIndex === 0).map((el) => el.textContent)).toEqual(['All']);
  });

  it('arrows, Home and End move between tabs and open the one they land on', () => {
    setup(makeFloor(), null);
    const pastels = screen.getByRole('tab', { name: 'Pastels' });
    pastels.focus();
    fireEvent.keyDown(pastels, { key: 'ArrowRight' });
    const warm = screen.getByRole('tab', { name: 'Warm' });
    expect(warm.getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(warm);
    fireEvent.keyDown(warm, { key: 'End' });
    expect(screen.getByRole('tab', { name: 'Neutral' }).getAttribute('aria-selected')).toBe('true');
    fireEvent.keyDown(screen.getByRole('tab', { name: 'Neutral' }), { key: 'ArrowRight' });
    expect(screen.getByRole('tab', { name: 'Pastels' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('tabpanel', { name: 'Pastels' })).toBeTruthy();
  });

  it('switches the surface from the keyboard and names the floor palette', () => {
    setup(makeFloor(), null);
    const walls = screen.getByRole('tab', { name: 'Walls' });
    fireEvent.keyDown(walls, { key: 'ArrowRight' });
    expect(screen.getByRole('tab', { name: 'Floor' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('tablist', { name: 'Floor colour palette' })).toBeTruthy();
  });

  it('marks the custom colour well for its focus ring', () => {
    setup(makeFloor(), null);
    const input = screen.getAllByLabelText('Custom colour')[0];
    expect(input?.closest('label')?.className).toContain('pc-colour-well');
  });
});
