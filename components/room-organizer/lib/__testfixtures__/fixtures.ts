import type { CatalogItem, FloorLayout, FurnitureItem, RoomLayout } from '../types';

/** Build a valid FurnitureItem with sane defaults; override any field. */
export function makeItem(overrides: Partial<FurnitureItem> = {}): FurnitureItem {
  return {
    id: 'item-1',
    type: 'chair',
    name: 'Chair',
    width: 1,
    depth: 1,
    height: 1,
    color: '#ffffff',
    icon: '🪑',
    position: { x: 0, z: 0 },
    rotation: 0,
    ...overrides,
  };
}

/** Build a valid CatalogItem (no id/position/rotation). */
export function makeCatalogItem(overrides: Partial<CatalogItem> = {}): CatalogItem {
  return {
    type: 'chair',
    name: 'Chair',
    width: 1,
    depth: 1,
    height: 1,
    color: '#ffffff',
    icon: '🪑',
    price: 100,
    category: 'seating',
    ...overrides,
  };
}

export function makeFloor(overrides: Partial<FloorLayout> = {}): FloorLayout {
  return {
    id: 'ground',
    name: 'Ground Floor',
    floorColor: '#c9a57d',
    items: [],
    ...overrides,
  };
}

export function makeLayout(overrides: Partial<RoomLayout> = {}): RoomLayout {
  return {
    name: 'My Home',
    width: 8,
    height: 8,
    floors: [makeFloor()],
    roof: { style: 'gable', color: '#5d3a23' },
    ...overrides,
  };
}
