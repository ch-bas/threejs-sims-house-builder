// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { RoomEditorProvider, type RoomEditorContextValue } from '../contexts/room-editor-context';
import { layoutStore } from '../hooks/use-layout-store';
import { makeFloor, makeItem, makeLayout } from '../lib/__testfixtures__/fixtures';
import { ENTRANCE_DOOR_ID } from '../lib/street';
import { StatisticsPanel } from './statistics-panel';

afterEach(cleanup);

describe('Statistics rooms (#719)', () => {
  const show = (walls: Array<{ id: string; x1: number; z1: number; x2: number; z2: number }>) => {
    const floor = makeFloor({ id: 'g', name: 'Ground', interiorWalls: walls });
    layoutStore.setState({ layout: makeLayout({ id: 'house-test', width: 10, height: 8, floors: [floor] }), activeFloorIndex: 0 });
    render(
      <RoomEditorProvider value={{ collidingIds: new Set<string>() } as unknown as RoomEditorContextValue}>
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
    const editor = { collidingIds: new Set<string>() } as unknown as RoomEditorContextValue;
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
