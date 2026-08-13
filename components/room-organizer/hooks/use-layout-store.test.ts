import { beforeEach, describe, expect, it } from 'vitest';
import { makeCatalogItem } from '../lib/__testfixtures__/fixtures';
import { INITIAL_LAYOUT } from './layout-reducer';
import { layoutStore } from './use-layout-store';

// Smoke test for the Zustand store WIRING only. The actual state transitions are
// delegated to `layoutReducer`, which is already exhaustively covered by
// layout-reducer.test.ts — here we just prove actions mutate the store's state.

function reset(): void {
  layoutStore.setState({ layout: INITIAL_LAYOUT, activeFloorIndex: 0 });
}

describe('use-layout-store — wiring', () => {
  beforeEach(reset);

  it('actions is a stable reference across state changes', () => {
    const before = layoutStore.getState().actions;
    layoutStore.getState().actions.setName('Villa');
    expect(layoutStore.getState().actions).toBe(before);
  });

  it('setName updates layout.name through the reducer', () => {
    layoutStore.getState().actions.setName('Beach House');
    expect(layoutStore.getState().layout.name).toBe('Beach House');
  });

  it('addCatalogItem adds an item to the active floor and returns its id', () => {
    const { addCatalogItem } = layoutStore.getState().actions;
    const id = addCatalogItem(makeCatalogItem(), { x: 2, z: 3 });

    const items = layoutStore.getState().layout.floors[0]!.items;
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ id, position: { x: 2, z: 3 } });
  });

  it('moveItem repositions an existing item', () => {
    const { addCatalogItem, moveItem } = layoutStore.getState().actions;
    const id = addCatalogItem(makeCatalogItem());
    moveItem(id, 5, 7);

    const moved = layoutStore.getState().layout.floors[0]!.items.find((i) => i.id === id);
    expect(moved?.position).toEqual({ x: 5, z: 7 });
  });

  it('addFloor + setActiveFloorIndex append a floor and switch to it', () => {
    const { addFloor, setActiveFloorIndex } = layoutStore.getState().actions;
    const newFloorId = addFloor();

    const { layout } = layoutStore.getState();
    expect(layout.floors).toHaveLength(2);
    expect(layout.floors[1]!.id).toBe(newFloorId);

    setActiveFloorIndex(1);
    expect(layoutStore.getState().activeFloorIndex).toBe(1);
  });
});
