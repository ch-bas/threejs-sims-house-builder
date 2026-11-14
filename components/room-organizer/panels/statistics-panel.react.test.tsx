// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { RoomEditorProvider, type RoomEditorContextValue } from '../contexts/room-editor-context';
import { layoutStore } from '../hooks/use-layout-store';
import { makeFloor, makeItem, makeLayout } from '../lib/__testfixtures__/fixtures';
import { ENTRANCE_DOOR_ID } from '../lib/street';
import { StatisticsPanel } from './statistics-panel';
import type { FurnitureCategory } from '../lib/types';

afterEach(cleanup);

describe('Statistics rooms (#719)', () => {
  const show = (walls: Array<{ id: string; x1: number; z1: number; x2: number; z2: number }>) => {
    const floor = makeFloor({ id: 'g', name: 'Ground', interiorWalls: walls });
    layoutStore.setState({ layout: makeLayout({ id: 'house-test', width: 10, height: 8, floors: [floor] }), activeFloorIndex: 0 });
    render(
      <RoomEditorProvider value={{ collidingIds: new Set<string>(), layout: layoutStore.getState().layout, activeFloorIndex: 0 } as unknown as RoomEditorContextValue}>
        <StatisticsPanel />
      </RoomEditorProvider>
    );
  };

  it('lists the rooms the walls close, with their areas', () => {
    show([{ id: 'w', x1: 0, z1: -4, x2: 0, z2: 4 }]);
    expect(screen.getByText('Room 1').parentElement?.textContent).toContain('40.0 m²');
    expect(screen.getByText('Room 2').parentElement?.textContent).toContain('40.0 m²');
  });

  it('says why a floor past the wall cap lists no rooms', () => {
    show(Array.from({ length: 121 }, (_, i) => ({ id: `w${i}`, x1: -4, z1: -3 + i * 0.05, x2: 4, z2: -3 + i * 0.05 })));
    expect(screen.getByText(/Rooms aren’t listed on a floor with over 120 walls/)).toBeTruthy();
    expect(screen.queryByText('Rooms')).toBeNull();
  });

  it('has no rooms section for a floor without partitions', () => {
    show([]);
    expect(screen.queryByText('Rooms')).toBeNull();
  });
});

describe('Statistics by floor (#693)', () => {
  it('counts a legacy priced porch door as free, so the floors add up to the header', () => {
    const door = makeItem({ id: ENTRANCE_DOOR_ID, type: 'door', name: 'Front door', price: 300 });
    const ground = makeFloor({ id: 'g', name: 'Ground', items: [makeItem({ id: 'sofa', price: 650 }), door] });
    const upper = makeFloor({ id: 'u', name: 'Upper', items: [makeItem({ id: 'bed', price: 800 })] });
    layoutStore.setState({ layout: makeLayout({ id: 'house-test', floors: [ground, upper] }), activeFloorIndex: 0 });
    const editor = { collidingIds: new Set<string>(), layout: layoutStore.getState().layout, activeFloorIndex: 0 } as unknown as RoomEditorContextValue;
    render(
      <RoomEditorProvider value={editor}>
        <StatisticsPanel />
      </RoomEditorProvider>
    );
    const row = (label: string) => screen.getByText(label).parentElement?.textContent ?? '';
    expect(row('Ground')).toContain('$650');
    expect(row('Ground')).not.toContain('$950');
    expect(row('Upper')).toContain('$800');
  });
});

describe('Statistics room scores (#613)', () => {
  it('types and scores each zone, says what is missing, and how a zone gets a type', () => {
    const at = (id: string, type: string, x: number, z: number, category: FurnitureCategory = 'bedroom') =>
      makeItem({ id, type, category, width: 0.5, depth: 0.5, position: { x, z } });
    const ground = makeFloor({
      id: 'g',
      name: 'Ground',
      zones: [
        { id: 'z1', name: 'Back', color: '#fff', x: -4, z: -4, w: 4, d: 4 },
        { id: 'z2', name: 'Front', color: '#fff', x: 0, z: 0, w: 4, d: 4 },
      ],
      items: [at('bed', 'bed', -2, -2), at('lamp', 'lamp', -3, -3, 'electronics'), at('plant', 'plant', 2, 2, 'decor')],
    });
    const layout = makeLayout({ id: 'house-test', floors: [ground] });
    layoutStore.setState({ layout, activeFloorIndex: 0 });
    render(
      <RoomEditorProvider value={{ collidingIds: new Set<string>(), layout, activeFloorIndex: 0 } as unknown as RoomEditorContextValue}>
        <StatisticsPanel />
      </RoomEditorProvider>
    );
    const section = screen.getByRole('group', { name: 'Room scores' });
    expect(section.textContent).toContain('Back · Bedroom');
    // A lamp, nothing colliding and room to move: three of five.
    expect(screen.getByRole('img', { name: '3 of 5 stars' })).toBeTruthy();
    expect(section.textContent).toContain('For more stars: more decor (a piece per 10 m²), a window on its walls');
    expect(section.textContent).not.toContain('Front ·');
    expect(section.textContent).toContain('A zone becomes a room from its furniture');
  });
});

describe('Statistics room scores while the drawer is closed (#613)', () => {
  it('scores the house the drawer holds, not each edit behind it, and the editor collisions on the active storey', () => {
    const zone = { id: 'z1', name: 'Back', color: '#fff', x: -4, z: -4, w: 4, d: 4 };
    const bed = makeItem({ id: 'bed', type: 'bed', category: 'bedroom', width: 0.5, depth: 0.5, position: { x: -2, z: -2 } });
    const held = makeLayout({ id: 'house-test', floors: [makeFloor({ id: 'g', name: 'Ground', zones: [zone], items: [bed] })] });
    layoutStore.setState({ layout: held, activeFloorIndex: 0 });
    const editor = { collidingIds: new Set(['bed']), layout: held, activeFloorIndex: 0 } as unknown as RoomEditorContextValue;
    render(
      <RoomEditorProvider value={editor}>
        <StatisticsPanel />
      </RoomEditorProvider>
    );
    expect(screen.getByRole('group', { name: 'Room scores' }).textContent).toContain('no collisions');
    // An edit behind the closed drawer: the store moves on, the held editor doesn't.
    act(() => {
      layoutStore.setState({ layout: { ...held, floors: [{ ...held.floors[0]!, zones: [{ ...zone, name: 'Moved on' }] }] }, activeFloorIndex: 0 });
    });
    expect(screen.getByRole('group', { name: 'Room scores' }).textContent).toContain('Back · Bedroom');
  });
});
