// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Button } from '@/components/ui/button';
import { EditorViewProvider } from '../contexts/editor-view-context';
import { RoomEditorProvider, type RoomEditorContextValue } from '../contexts/room-editor-context';
import { createEditorViewStore } from '../hooks/editor-view-store';
import { layoutStore } from '../hooks/use-layout-store';
import { makeFloor, makeLayout, makeViewSettings } from '../lib/__testfixtures__/fixtures';
import { ACHIEVEMENTS } from '../lib/achievements';
import { AchievementsPanel } from './achievements-panel';
import { CatalogStrip } from './catalog-strip';
import { ChipNameField } from './chip-controls';
import { ColorSwatchPicker } from './color-swatch-picker';
import { FloorPill } from './floor-pill';
import { FloorSwitcher } from './floor-switcher';
import { SitePanel } from './site-panel';
import { SliderRow } from './slider-row';
import type { ReactNode } from 'react';

const source = (file: string) => readFileSync(resolve(__dirname, file), 'utf8');

describe('AchievementsPanel semantics (#648, #640)', () => {
  afterEach(cleanup);

  it('names the bar as a progress bar with its value', () => {
    const first = ACHIEVEMENTS[0];
    render(<AchievementsPanel unlocked={new Set(first ? [first.id] : [])} />);
    const bar = screen.getByRole('progressbar', { name: 'Achievements unlocked' });
    expect(bar.getAttribute('aria-valuenow')).toBe('1');
    expect(bar.getAttribute('aria-valuemin')).toBe('0');
    expect(bar.getAttribute('aria-valuemax')).toBe(String(ACHIEVEMENTS.length));
  });

  it('says locked or unlocked per row without naming the row after it', () => {
    const first = ACHIEVEMENTS[0];
    render(<AchievementsPanel unlocked={new Set(first ? [first.id] : [])} />);
    const rows = screen.getAllByRole('listitem');
    expect(rows.some((row) => row.hasAttribute('title'))).toBe(false);
    const [unlockedRow, lockedRow] = rows;
    if (!unlockedRow || !lockedRow) throw new Error('rows missing');
    expect(within(unlockedRow).getByRole('img', { name: 'Unlocked' })).toBeTruthy();
    expect(within(lockedRow).getByRole('img', { name: 'Locked' })).toBeTruthy();
  });

  it('does not dim a locked row as a whole', () => {
    render(<AchievementsPanel unlocked={new Set()} />);
    for (const row of screen.getAllByRole('listitem')) {
      expect(row.className).not.toMatch(/opacity-/);
    }
  });
});

describe('ColorSwatchPicker semantics (#557)', () => {
  afterEach(cleanup);

  it.each(['glass', 'card'] as const)('marks the selected preset and recent swatch pressed (%s)', (variant) => {
    render(
      <ColorSwatchPicker
        variant={variant}
        value="#ABCDEF"
        swatches={['#abcdef', '#000000']}
        recent={['#abcdef', '#111111']}
        onChange={() => {}}
        onCommit={() => {}}
      />
    );
    expect(screen.getByRole('button', { name: 'Use colour #abcdef', pressed: true })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Use colour #000000', pressed: false })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Reuse colour #abcdef', pressed: true })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Reuse colour #111111', pressed: false })).toBeTruthy();
  });
});

describe('ChipNameField focus (#557)', () => {
  afterEach(cleanup);

  it('leaves the outline to the focus-visible rule', () => {
    render(<ChipNameField label="Set name" initialValue="" submitLabel="Save" onSubmit={vi.fn()} onCancel={vi.fn()} />);
    const input = screen.getByRole('textbox', { name: 'Set name' });
    expect(input.style.outline).toBe('');
    expect(input.className).toContain('pc-chip-name');
    expect(source('../../../app/globals.css')).toMatch(/\.pc-chip-name:focus-visible\s*{[^}]*outline:/);
  });
});

describe('SliderRow when disabled (#640)', () => {
  afterEach(cleanup);

  it('dims the track only: the label and value stay readable', () => {
    render(
      <SliderRow label="W" min={0} max={2} step={0.1} value={1.2} format={(v) => `${v} m`} onChange={() => {}} disabled />
    );
    const slider = screen.getByRole('slider', { name: 'W' });
    expect(slider.style.opacity).toBe('0.45');
    expect(slider.parentElement?.style.opacity).toBe('');
  });
});

describe('Disabled Button (#640)', () => {
  afterEach(cleanup);

  it.each(['default', 'destructive', 'secondary'] as const)('the %s variant drops its fill and is not dimmed', (variant) => {
    render(<Button variant={variant} disabled>Pack</Button>);
    const { className } = screen.getByRole('button', { name: 'Pack' });
    expect(className).toContain('disabled:bg-transparent');
    expect(className).toContain('disabled:text-muted-foreground');
    expect(className).not.toContain('disabled:opacity-50');
  });
});

describe('Disabled toggles keep their selected look (#640)', () => {
  afterEach(cleanup);

  const SELECTED = '[aria-checked=true]';

  it.each([
    ['aria-pressed', { 'aria-pressed': true }],
    ['aria-checked', { role: 'radio', 'aria-checked': true }],
    ['data-selected', { 'data-selected': true }],
  ] as const)('tints a selected default button (%s)', (_, attrs) => {
    render(<Button disabled {...attrs}>Rain</Button>);
    const button = screen.getByText('Rain');
    expect(button.className).toContain(SELECTED);
    expect(button.className).toMatch(/\]:bg-primary\/\d+/);
    expect(button.className).toMatch(/\]:text-foreground/);
    // A grey tint would be no tint: the filter must lift too.
    expect(button.className).toMatch(/\]:grayscale-0/);
  });

  it('the unselected outline stays muted, with no tint', () => {
    render(<Button variant="outline" disabled aria-pressed={false}>Winder</Button>);
    const { className } = screen.getByRole('button', { name: 'Winder' });
    expect(className).toContain('disabled:text-muted-foreground');
    expect(className).not.toContain('bg-primary');
  });

  it('a disabled Pack with no state stays neutral', () => {
    // The tint applies only to the three selected states, never bare.
    render(<Button disabled>Pack</Button>);
    expect(screen.getByRole('button', { name: 'Pack' }).matches('[aria-pressed=true],[aria-checked=true],[data-selected]')).toBe(false);
  });
});

describe('Reduced motion (#557)', () => {
  it.each(['achievement-toast.tsx', 'header-stats.tsx'])('%s pulses through the guarded class', (file) => {
    const text = source(file);
    expect(text).not.toContain("'pcHaloPulse");
    expect(text).toContain('pc-halo-pulse');
  });
});

describe('Generic elements carry no aria-label (#557)', () => {
  it('item-resize-panel gives the lock an image role', () => {
    expect(source('item-resize-panel.tsx')).toContain('<span role="img" aria-label="Locked">');
  });

  it('walk-hud spells the time out instead of labelling a span', () => {
    expect(source('walk-hud.tsx')).not.toMatch(/aria-label=\{`Time/);
  });
});

const twoFloors = () =>
  makeLayout({ floors: [makeFloor({ id: 'a', name: 'Ground Floor' }), makeFloor({ id: 'b', name: 'Loft' })] });

function editorTree(children: ReactNode) {
  const layout = twoFloors();
  const floor = layout.floors[0];
  const actions = { setTerrain: vi.fn(), setEntrance: vi.fn(), setActiveFloorIndex: vi.fn(), addFloor: vi.fn() };
  const editor = { layout, activeFloor: floor, activeFloorIndex: 0, actions, isReady: true } as unknown as RoomEditorContextValue;
  render(
    <EditorViewProvider store={createEditorViewStore(makeViewSettings())}>
      <RoomEditorProvider value={editor}>{children}</RoomEditorProvider>
    </EditorViewProvider>
  );
  return { actions };
}

describe('Toggles and floors have real names (#645)', () => {
  afterEach(cleanup);

  it('Site toggles are switches named by their label', () => {
    const { actions } = editorTree(<SitePanel />);
    const slope = screen.getByRole('switch', { name: 'Sloped site' });
    expect(slope.getAttribute('aria-checked')).toBe('false');
    expect(slope.textContent).toBe('Off');
    expect(screen.getByRole('switch', { name: 'Recessed entrance' })).toBeTruthy();
    fireEvent.click(slope);
    expect(actions.setTerrain).toHaveBeenCalled();
  });

  it('HUD floor buttons carry the floor name and keep the visible number', () => {
    editorTree(<FloorPill />);
    expect(screen.getByRole('button', { name: '2: Loft' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '1: Ground Floor' }).getAttribute('aria-current')).toBe('true');
  });

  it('the drawer All toggle states whether it is on', () => {
    layoutStore.getState().actions.applyLayout(twoFloors());
    editorTree(<FloorSwitcher />);
    expect(screen.getByRole('button', { name: 'All floors', pressed: false })).toBeTruthy();
  });

  it('renames in a field beside the buttons, not inside one (#557)', () => {
    layoutStore.getState().actions.applyLayout(twoFloors());
    editorTree(<FloorSwitcher />);
    fireEvent.click(screen.getByRole('button', { name: 'Rename Loft' }));
    const field = screen.getByRole('textbox', { name: 'Floor name' });
    expect(field.closest('button')).toBeNull();
    expect(screen.queryByRole('button', { name: /^Loft/ })).toBeNull();
  });

  it('the rename row stays current, and its padding still picks the floor', () => {
    layoutStore.getState().actions.applyLayout(twoFloors());
    layoutStore.getState().actions.setActiveFloorIndex(1);
    editorTree(<FloorSwitcher />);
    fireEvent.click(screen.getByRole('button', { name: 'Rename Loft' }));
    const field = screen.getByRole('textbox', { name: 'Floor name' });
    expect(field.parentElement?.getAttribute('aria-current')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'Rename Ground Floor' }));
    const other = screen.getByRole('textbox', { name: 'Floor name' });
    expect(other.parentElement?.getAttribute('aria-current')).toBeNull();
    fireEvent.mouseDown(other);
    expect(layoutStore.getState().activeFloorIndex).toBe(1);
    // The field blurs on this press and the row turns back into a button,
    // so the pick can't wait for the click.
    fireEvent.mouseDown(other.parentElement as HTMLElement);
    expect(layoutStore.getState().activeFloorIndex).toBe(0);
  });
});

describe('Catalogue tiles are named (#637)', () => {
  afterEach(cleanup);

  it('leads with the item name, then the price', () => {
    layoutStore.getState().actions.applyLayout(makeLayout());
    editorTree(<CatalogStrip category="structure" onAdd={() => {}} />);
    expect(screen.getByRole('button', { name: 'Stairs, $1,500' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Winder Stairs, $2,200' })).toBeTruthy();
  });
});

describe('ColorSwatchPicker clicks', () => {
  afterEach(cleanup);

  it('a pressed swatch still reports the pick', () => {
    const onChange = vi.fn();
    render(<ColorSwatchPicker variant="glass" value="#000000" swatches={['#000000']} recent={[]} onChange={onChange} onCommit={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Use colour #000000' }));
    expect(onChange).toHaveBeenCalledWith('#000000');
  });
});
