// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { RoomEditorProvider, type RoomEditorContextValue } from '../contexts/room-editor-context';
import { layoutStore } from '../hooks/use-layout-store';
import { makeFloor, makeItem, makeLayout } from '../lib/__testfixtures__/fixtures';
import { ENTRANCE_DOOR_ID } from '../lib/street';
import { StatisticsPanel } from './statistics-panel';

afterEach(cleanup);

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
