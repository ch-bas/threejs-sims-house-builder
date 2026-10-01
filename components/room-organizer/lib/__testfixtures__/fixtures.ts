import type { CatalogItem, FloorLayout, FurnitureItem, RoomLayout, ViewSettings } from '../types';

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

/** `makeItem()` without a position: an item that is not placed on the floor. */
export function makeUnplacedItem(overrides: Partial<FurnitureItem> = {}): FurnitureItem {
  const { position: _unplaced, ...item } = makeItem(overrides);
  return item;
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

/** The editor's initial view settings, with overrides. */
export function makeViewSettings(overrides: Partial<ViewSettings> = {}): ViewSettings {
  return {
    view2D: false,
    showMeasurements: true,
    showWiFiSignals: true,
    snapToGrid: false,
    snapToWall: false,
    snapToItems: false,
    showMinimap: false,
    floorPlan3DEffect: false,
    timeOfDay: 12,
    weather: 'clear',
    walkthroughMode: false,
    showOutdoor: true,
    showAllFloors: false,
    wallDisplay: 'cutaway',
    measurementMode: false,
    soundsEnabled: false,
    drawWallMode: false,
    drawZoneMode: false,
    showHeatmap: false,
    showItemLabels: false,
    showNpcs: false,
    showCameraVision: true,
    ...overrides,
  };
}
