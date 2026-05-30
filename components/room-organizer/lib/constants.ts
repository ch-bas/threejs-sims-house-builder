import type { CatalogItem, CategoryMeta, FloorLayout, RoomLayout } from './types';

export const STORAGE_KEY = 'standalone-room-organizer-layout';
export const AUTOSAVE_DEBOUNCE_MS = 1500;
export const GRID_SIZE_METERS = 0.5;
export const DEFAULT_BUDGET = 25_000;

export const CURRENCY_SYMBOL = '$';

export const MAX_FLOORS = 4;

export const CATEGORIES: readonly CategoryMeta[] = [
  { key: 'seating', label: 'Seating', icon: '🪑' },
  { key: 'tables', label: 'Tables', icon: '🟫' },
  { key: 'bedroom', label: 'Bedroom', icon: '🛏️' },
  { key: 'storage', label: 'Storage', icon: '📚' },
  { key: 'kitchen', label: 'Kitchen', icon: '🍳' },
  { key: 'bathroom', label: 'Bathroom', icon: '🛁' },
  { key: 'electronics', label: 'Electronics', icon: '📺' },
  { key: 'decor', label: 'Decor', icon: '🪴' },
  { key: 'outdoor', label: 'Outdoor', icon: '🌳' },
  { key: 'people', label: 'People', icon: '🧍' },
  { key: 'structure', label: 'Structure', icon: '🪜' },
] as const;

export const FURNITURE_CATALOG = [
  // Seating
  { type: 'chair', category: 'seating', name: 'Chair', width: 0.5, depth: 0.5, height: 0.8, color: '#8B4513', icon: '🪑', price: 75 },
  { type: 'dining-chair', category: 'seating', name: 'Dining Chair', width: 0.45, depth: 0.45, height: 0.9, color: '#5D4037', icon: '🪑', price: 95 },
  { type: 'armchair', category: 'seating', name: 'Armchair', width: 0.9, depth: 0.9, height: 0.85, color: '#6D4C41', icon: '💺', price: 280 },
  { type: 'sofa', category: 'seating', name: 'Sofa', width: 2.0, depth: 0.9, height: 0.8, color: '#4A5568', icon: '🛋️', price: 650 },
  { type: 'bench', category: 'seating', name: 'Bench', width: 1.4, depth: 0.4, height: 0.45, color: '#795548', icon: '🪵', price: 150 },

  // Tables
  { type: 'table', category: 'tables', name: 'Table', width: 1.5, depth: 0.8, height: 0.75, color: '#CD853F', icon: '🟫', price: 220 },
  { type: 'dining-table', category: 'tables', name: 'Dining Table', width: 1.8, depth: 1.0, height: 0.75, color: '#A0522D', icon: '🟫', price: 420 },
  { type: 'coffee-table', category: 'tables', name: 'Coffee Table', width: 1.2, depth: 0.6, height: 0.4, color: '#CD853F', icon: '🟫', price: 180 },
  { type: 'side-table', category: 'tables', name: 'Side Table', width: 0.5, depth: 0.5, height: 0.55, color: '#8B4513', icon: '🟫', price: 90 },
  { type: 'desk', category: 'tables', name: 'Desk', width: 1.2, depth: 0.6, height: 0.75, color: '#8B4513', icon: '🖥️', price: 320 },

  // Bedroom
  { type: 'bed', category: 'bedroom', name: 'Double Bed', width: 2.0, depth: 1.6, height: 0.6, color: '#E8E8E8', icon: '🛏️', price: 800 },
  { type: 'nightstand', category: 'bedroom', name: 'Nightstand', width: 0.5, depth: 0.4, height: 0.6, color: '#8B4513', icon: '🕯️', price: 120 },
  { type: 'wardrobe', category: 'bedroom', name: 'Wardrobe', width: 1.4, depth: 0.6, height: 2.1, color: '#6D4C41', icon: '🚪', price: 540 },
  { type: 'dresser', category: 'bedroom', name: 'Dresser', width: 1.2, depth: 0.5, height: 0.9, color: '#8B4513', icon: '🗄️', price: 380 },

  // Storage
  { type: 'bookshelf', category: 'storage', name: 'Bookshelf', width: 1.0, depth: 0.3, height: 2.0, color: '#654321', icon: '📚', price: 260 },
  { type: 'cabinet', category: 'storage', name: 'Cabinet', width: 0.9, depth: 0.4, height: 1.6, color: '#5D4037', icon: '🗃️', price: 310 },

  // Kitchen
  { type: 'fridge', category: 'kitchen', name: 'Refrigerator', width: 0.7, depth: 0.7, height: 1.8, color: '#E0E0E0', icon: '🧊', price: 1200 },
  { type: 'stove', category: 'kitchen', name: 'Stove', width: 0.7, depth: 0.65, height: 0.9, color: '#424242', icon: '🍳', price: 850 },
  { type: 'dishwasher', category: 'kitchen', name: 'Dishwasher', width: 0.6, depth: 0.6, height: 0.85, color: '#9E9E9E', icon: '🍽️', price: 700 },
  { type: 'kitchen-sink', category: 'kitchen', name: 'Kitchen Sink', width: 0.9, depth: 0.6, height: 0.9, color: '#BDBDBD', icon: '🚰', price: 450 },
  { type: 'counter', category: 'kitchen', name: 'Counter', width: 1.2, depth: 0.6, height: 0.9, color: '#D7CCC8', icon: '🟫', price: 280 },

  // Bathroom
  { type: 'toilet', category: 'bathroom', name: 'Toilet', width: 0.4, depth: 0.7, height: 0.8, color: '#FAFAFA', icon: '🚽', price: 220 },
  { type: 'bathtub', category: 'bathroom', name: 'Bathtub', width: 1.7, depth: 0.8, height: 0.55, color: '#FAFAFA', icon: '🛁', price: 950 },
  { type: 'shower', category: 'bathroom', name: 'Shower', width: 0.9, depth: 0.9, height: 2.1, color: '#E1F5FE', icon: '🚿', price: 680 },
  { type: 'bathroom-sink', category: 'bathroom', name: 'Bathroom Sink', width: 0.6, depth: 0.45, height: 0.85, color: '#FAFAFA', icon: '🪞', price: 280 },

  // Electronics
  { type: 'tv', category: 'electronics', name: 'TV Stand', width: 1.5, depth: 0.4, height: 0.5, color: '#2C3E50', icon: '📺', price: 600 },
  { type: 'computer', category: 'electronics', name: 'Computer', width: 0.5, depth: 0.5, height: 0.5, color: '#37474F', icon: '🖥️', price: 950 },
  { type: 'lamp', category: 'electronics', name: 'Lamp', width: 0.3, depth: 0.3, height: 1.5, color: '#FFD700', icon: '💡', price: 110 },
  { type: 'floor-lamp', category: 'electronics', name: 'Floor Lamp', width: 0.35, depth: 0.35, height: 1.7, color: '#FFB300', icon: '🪔', price: 180 },
  { type: 'wifi', category: 'electronics', name: 'Wi-Fi AP', width: 0.2, depth: 0.2, height: 0.1, color: '#0088FF', icon: '📶', price: 140, isWiFiAccessPoint: true, signalRange: 10 },
  { type: 'router', category: 'electronics', name: 'Router', width: 0.3, depth: 0.2, height: 0.1, color: '#1a1a1a', icon: '🌐', price: 160 },
  { type: 'cctv', category: 'electronics', name: 'CCTV Camera', width: 0.15, depth: 0.15, height: 0.2, color: '#2C2C2C', icon: '📹', price: 230, isCCTV: true, signalRange: 8 },

  // Decor
  { type: 'plant', category: 'decor', name: 'House Plant', width: 0.4, depth: 0.4, height: 1.0, color: '#228B22', icon: '🪴', price: 60 },
  { type: 'flowerpot', category: 'decor', name: 'Flowerpot', width: 0.25, depth: 0.25, height: 0.35, color: '#FF7043', icon: '🌷', price: 35 },
  { type: 'rug', category: 'decor', name: 'Area Rug', width: 2.0, depth: 1.4, height: 0.02, color: '#C62828', icon: '🟥', price: 220 },
  { type: 'painting', category: 'decor', name: 'Painting', width: 0.8, depth: 0.05, height: 0.6, color: '#5D4037', icon: '🖼️', price: 320 },
  { type: 'vase', category: 'decor', name: 'Vase', width: 0.25, depth: 0.25, height: 0.5, color: '#1976D2', icon: '🏺', price: 75 },
  { type: 'mirror', category: 'decor', name: 'Mirror', width: 0.7, depth: 0.05, height: 1.2, color: '#B0BEC5', icon: '🪞', price: 190 },
  { type: 'curtains', category: 'decor', name: 'Curtains', width: 1.4, depth: 0.2, height: 2.4, color: '#F5DEB3', icon: '🪟', price: 120 },
  { type: 'pendant-light', category: 'decor', name: 'Pendant Light', width: 0.45, depth: 0.45, height: 1.0, color: '#FFC107', icon: '💡', price: 95 },
  { type: 'wall-shelf', category: 'decor', name: 'Wall Shelf', width: 1.0, depth: 0.25, height: 0.06, color: '#8B4513', icon: '📚', price: 60 },
  { type: 'wall-clock', category: 'decor', name: 'Wall Clock', width: 0.5, depth: 0.08, height: 0.5, color: '#FFFFFF', icon: '🕐', price: 45 },
  { type: 'candles', category: 'decor', name: 'Candle Set', width: 0.4, depth: 0.18, height: 0.30, color: '#FFE4B5', icon: '🕯️', price: 30 },
  { type: 'books', category: 'decor', name: 'Stack of Books', width: 0.3, depth: 0.2, height: 0.25, color: '#5D4037', icon: '📖', price: 40 },

  // Outdoor
  { type: 'tree', category: 'outdoor', name: 'Oak Tree', width: 1.4, depth: 1.4, height: 3.8, color: '#2E7D32', icon: '🌳', price: 250 },
  { type: 'pine-tree', category: 'outdoor', name: 'Pine Tree', width: 1.1, depth: 1.1, height: 4.5, color: '#1B5E20', icon: '🌲', price: 280 },
  { type: 'bush', category: 'outdoor', name: 'Bush', width: 0.8, depth: 0.8, height: 0.7, color: '#4CAF50', icon: '🌿', price: 65 },
  { type: 'hedge', category: 'outdoor', name: 'Hedge Section', width: 2.0, depth: 0.5, height: 1.1, color: '#388E3C', icon: '🌳', price: 140 },
  { type: 'flowerbed', category: 'outdoor', name: 'Flower Bed', width: 1.6, depth: 0.6, height: 0.3, color: '#E91E63', icon: '🌷', price: 95 },
  { type: 'tulips', category: 'outdoor', name: 'Tulips', width: 0.5, depth: 0.5, height: 0.4, color: '#F06292', icon: '🌷', price: 35 },
  { type: 'sunflower', category: 'outdoor', name: 'Sunflower', width: 0.4, depth: 0.4, height: 1.6, color: '#FFC107', icon: '🌻', price: 45 },
  { type: 'rose-bush', category: 'outdoor', name: 'Rose Bush', width: 0.6, depth: 0.6, height: 0.9, color: '#C2185B', icon: '🌹', price: 75 },
  { type: 'fence', category: 'outdoor', name: 'Fence Section', width: 2.0, depth: 0.15, height: 1.2, color: '#8D6E63', icon: '🪵', price: 120 },
  { type: 'pool', category: 'outdoor', name: 'Pool', width: 4.0, depth: 2.5, height: 0.3, color: '#03A9F4', icon: '🏊', price: 4500 },
  { type: 'bbq', category: 'outdoor', name: 'BBQ Grill', width: 0.8, depth: 0.6, height: 1.1, color: '#37474F', icon: '🍖', price: 320 },
  { type: 'mailbox', category: 'outdoor', name: 'Mailbox', width: 0.4, depth: 0.3, height: 1.1, color: '#1976D2', icon: '📬', price: 60 },
  { type: 'birdbath', category: 'outdoor', name: 'Birdbath', width: 0.7, depth: 0.7, height: 0.9, color: '#B0BEC5', icon: '🐦', price: 140 },
  { type: 'lamppost', category: 'outdoor', name: 'Lamppost', width: 0.4, depth: 0.4, height: 3.2, color: '#263238', icon: '💡', price: 220 },
  { type: 'stepping-stone', category: 'outdoor', name: 'Stepping Stone', width: 0.6, depth: 0.6, height: 0.06, color: '#9E9E9E', icon: '⬜', price: 25 },
  { type: 'garden-bench', category: 'outdoor', name: 'Garden Bench', width: 1.5, depth: 0.5, height: 0.85, color: '#5D4037', icon: '🪑', price: 180 },
  { type: 'picnic-table', category: 'outdoor', name: 'Picnic Table', width: 1.8, depth: 1.4, height: 0.75, color: '#A1887F', icon: '🪵', price: 260 },
  { type: 'pond', category: 'outdoor', name: 'Garden Pond', width: 2.2, depth: 1.5, height: 0.25, color: '#0277BD', icon: '💧', price: 1200 },

  // People / scale references
  { type: 'person', category: 'people', name: 'Adult', width: 0.5, depth: 0.3, height: 1.75, color: '#FFCDD2', icon: '🧍', price: 0 },
  { type: 'pet', category: 'people', name: 'Pet', width: 0.45, depth: 0.2, height: 0.4, color: '#A1887F', icon: '🐕', price: 0 },

  // Structure
  { type: 'stairs', category: 'structure', name: 'Stairs', width: 1.2, depth: 2.4, height: 3.0, color: '#8B4513', icon: '🪜', price: 1500, stairsDirection: 'north' },
  { type: 'door', category: 'structure', name: 'Door', width: 0.9, depth: 0.12, height: 2.05, color: '#6D4C41', icon: '🚪', price: 320 },
  { type: 'window', category: 'structure', name: 'Window', width: 1.2, depth: 0.12, height: 1.2, color: '#90CAF9', icon: '🪟', price: 240 },
] as const satisfies readonly CatalogItem[];

export const FURNITURE_TYPES_WITH_SIGNALS = ['wifi', 'cctv'] as const;

export type RoomTemplateKey = 'bedroom' | 'livingRoom' | 'office' | 'kitchen' | 'bathroom' | 'studio' | 'twoStory';

function singleFloorTemplate(
  name: string,
  width: number,
  height: number,
  floorColor: string,
  items: readonly FloorLayout['items'][number][]
): Omit<RoomLayout, 'id'> {
  return {
    name,
    width,
    height,
    floors: [
      {
        id: 'ground',
        name: 'Ground Floor',
        floorColor,
        items: [...items],
      },
    ],
  };
}

export const ROOM_TEMPLATES = {
  bedroom: singleFloorTemplate('Bedroom', 4, 3.5, '#F5E6D3', [
    { id: 'bed-1', type: 'bed', category: 'bedroom', name: 'Double Bed', width: 2.0, depth: 1.6, height: 0.6, color: '#E8E8E8', icon: '🛏️', price: 800, position: { x: 0, z: -0.5 }, rotation: 0 },
    { id: 'nightstand-1', type: 'nightstand', category: 'bedroom', name: 'Nightstand', width: 0.5, depth: 0.4, height: 0.6, color: '#8B4513', icon: '🕯️', price: 120, position: { x: -1.3, z: -0.5 }, rotation: 0 },
    { id: 'nightstand-2', type: 'nightstand', category: 'bedroom', name: 'Nightstand', width: 0.5, depth: 0.4, height: 0.6, color: '#8B4513', icon: '🕯️', price: 120, position: { x: 1.3, z: -0.5 }, rotation: 0 },
    { id: 'wardrobe-1', type: 'wardrobe', category: 'bedroom', name: 'Wardrobe', width: 1.4, depth: 0.6, height: 2.1, color: '#6D4C41', icon: '🚪', price: 540, position: { x: -1.0, z: 1.3 }, rotation: 0 },
    { id: 'lamp-1', type: 'lamp', category: 'electronics', name: 'Lamp', width: 0.3, depth: 0.3, height: 1.5, color: '#FFD700', icon: '💡', price: 110, position: { x: -1.5, z: 1.2 }, rotation: 0 },
  ]),
  livingRoom: singleFloorTemplate('Living Room', 6, 5, '#D4C5B9', [
    { id: 'sofa-1', type: 'sofa', category: 'seating', name: 'Sofa', width: 2.0, depth: 0.9, height: 0.8, color: '#4A5568', icon: '🛋️', price: 650, position: { x: 0, z: -1.5 }, rotation: 0, sofaShape: 'standard' },
    { id: 'coffee-1', type: 'coffee-table', category: 'tables', name: 'Coffee Table', width: 1.2, depth: 0.6, height: 0.4, color: '#CD853F', icon: '🟫', price: 180, position: { x: 0, z: 0.3 }, rotation: 0 },
    { id: 'tv-1', type: 'tv', category: 'electronics', name: 'TV Stand', width: 1.5, depth: 0.4, height: 0.5, color: '#2C3E50', icon: '📺', price: 600, position: { x: 0, z: 2 }, rotation: Math.PI },
    { id: 'armchair-1', type: 'armchair', category: 'seating', name: 'Armchair', width: 0.9, depth: 0.9, height: 0.85, color: '#6D4C41', icon: '💺', price: 280, position: { x: -2.0, z: -1.0 }, rotation: Math.PI / 4 },
    { id: 'plant-1', type: 'plant', category: 'decor', name: 'House Plant', width: 0.4, depth: 0.4, height: 1.0, color: '#228B22', icon: '🪴', price: 60, position: { x: -2.5, z: 2 }, rotation: 0 },
    { id: 'rug-1', type: 'rug', category: 'decor', name: 'Area Rug', width: 2.0, depth: 1.4, height: 0.02, color: '#C62828', icon: '🟥', price: 220, position: { x: 0, z: -0.5 }, rotation: 0 },
    { id: 'wifi-1', type: 'wifi', category: 'electronics', name: 'Wi-Fi AP', width: 0.2, depth: 0.2, height: 0.1, color: '#0088FF', icon: '📶', price: 140, isWiFiAccessPoint: true, signalRange: 10, position: { x: 2, z: 1.5 }, rotation: 0 },
  ]),
  office: singleFloorTemplate('Home Office', 3.5, 3, '#E8DCC4', [
    { id: 'desk-1', type: 'desk', category: 'tables', name: 'Desk', width: 1.2, depth: 0.6, height: 0.75, color: '#8B4513', icon: '🖥️', price: 320, position: { x: 0, z: -0.8 }, rotation: 0 },
    { id: 'computer-1', type: 'computer', category: 'electronics', name: 'Computer', width: 0.5, depth: 0.5, height: 0.5, color: '#37474F', icon: '🖥️', price: 950, position: { x: 0, z: -0.8 }, rotation: 0 },
    { id: 'chair-1', type: 'chair', category: 'seating', name: 'Office Chair', width: 0.5, depth: 0.5, height: 0.8, color: '#8B4513', icon: '🪑', price: 75, position: { x: 0, z: 0 }, rotation: Math.PI },
    { id: 'bookshelf-1', type: 'bookshelf', category: 'storage', name: 'Bookshelf', width: 1.0, depth: 0.3, height: 2.0, color: '#654321', icon: '📚', price: 260, position: { x: -1.2, z: -0.8 }, rotation: 0 },
    { id: 'lamp-1', type: 'lamp', category: 'electronics', name: 'Desk Lamp', width: 0.3, depth: 0.3, height: 1.5, color: '#FFD700', icon: '💡', price: 110, position: { x: 0.5, z: -0.8 }, rotation: 0 },
    { id: 'plant-1', type: 'plant', category: 'decor', name: 'Plant', width: 0.4, depth: 0.4, height: 1.0, color: '#228B22', icon: '🪴', price: 60, position: { x: 1.3, z: 1 }, rotation: 0 },
  ]),
  kitchen: singleFloorTemplate('Kitchen', 4.5, 3.5, '#ECEFF1', [
    { id: 'fridge-1', type: 'fridge', category: 'kitchen', name: 'Refrigerator', width: 0.7, depth: 0.7, height: 1.8, color: '#E0E0E0', icon: '🧊', price: 1200, position: { x: -1.8, z: -1.2 }, rotation: 0 },
    { id: 'stove-1', type: 'stove', category: 'kitchen', name: 'Stove', width: 0.7, depth: 0.65, height: 0.9, color: '#424242', icon: '🍳', price: 850, position: { x: -1.0, z: -1.2 }, rotation: 0 },
    { id: 'counter-1', type: 'counter', category: 'kitchen', name: 'Counter', width: 1.2, depth: 0.6, height: 0.9, color: '#D7CCC8', icon: '🟫', price: 280, position: { x: 0.4, z: -1.2 }, rotation: 0 },
    { id: 'sink-1', type: 'kitchen-sink', category: 'kitchen', name: 'Kitchen Sink', width: 0.9, depth: 0.6, height: 0.9, color: '#BDBDBD', icon: '🚰', price: 450, position: { x: 1.5, z: -1.2 }, rotation: 0 },
    { id: 'dining-1', type: 'dining-table', category: 'tables', name: 'Dining Table', width: 1.8, depth: 1.0, height: 0.75, color: '#A0522D', icon: '🟫', price: 420, position: { x: 0, z: 0.6 }, rotation: 0 },
    { id: 'dining-chair-1', type: 'dining-chair', category: 'seating', name: 'Dining Chair', width: 0.45, depth: 0.45, height: 0.9, color: '#5D4037', icon: '🪑', price: 95, position: { x: -0.7, z: 0.6 }, rotation: Math.PI / 2 },
    { id: 'dining-chair-2', type: 'dining-chair', category: 'seating', name: 'Dining Chair', width: 0.45, depth: 0.45, height: 0.9, color: '#5D4037', icon: '🪑', price: 95, position: { x: 0.7, z: 0.6 }, rotation: -Math.PI / 2 },
  ]),
  bathroom: singleFloorTemplate('Bathroom', 3, 2.5, '#E0F2F1', [
    { id: 'toilet-1', type: 'toilet', category: 'bathroom', name: 'Toilet', width: 0.4, depth: 0.7, height: 0.8, color: '#FAFAFA', icon: '🚽', price: 220, position: { x: -1.0, z: -0.7 }, rotation: 0 },
    { id: 'sink-1', type: 'bathroom-sink', category: 'bathroom', name: 'Sink', width: 0.6, depth: 0.45, height: 0.85, color: '#FAFAFA', icon: '🪞', price: 280, position: { x: 0.2, z: -0.85 }, rotation: 0 },
    { id: 'bathtub-1', type: 'bathtub', category: 'bathroom', name: 'Bathtub', width: 1.7, depth: 0.8, height: 0.55, color: '#FAFAFA', icon: '🛁', price: 950, position: { x: 0, z: 0.7 }, rotation: 0 },
    { id: 'mirror-1', type: 'mirror', category: 'decor', name: 'Mirror', width: 0.7, depth: 0.05, height: 1.2, color: '#B0BEC5', icon: '🪞', price: 190, position: { x: 0.2, z: -1.15 }, rotation: 0 },
  ]),
  studio: singleFloorTemplate('Studio Apartment', 7, 6, '#EFEBE9', [
    { id: 'bed-1', type: 'bed', category: 'bedroom', name: 'Double Bed', width: 2.0, depth: 1.6, height: 0.6, color: '#E8E8E8', icon: '🛏️', price: 800, position: { x: -2.2, z: -1.8 }, rotation: 0 },
    { id: 'sofa-1', type: 'sofa', category: 'seating', name: 'Sofa', width: 2.0, depth: 0.9, height: 0.8, color: '#4A5568', icon: '🛋️', price: 650, position: { x: 1.5, z: 1.0 }, rotation: -Math.PI / 2, sofaShape: 'standard' },
    { id: 'desk-1', type: 'desk', category: 'tables', name: 'Desk', width: 1.2, depth: 0.6, height: 0.75, color: '#8B4513', icon: '🖥️', price: 320, position: { x: 2.5, z: -2.2 }, rotation: 0 },
    { id: 'fridge-1', type: 'fridge', category: 'kitchen', name: 'Refrigerator', width: 0.7, depth: 0.7, height: 1.8, color: '#E0E0E0', icon: '🧊', price: 1200, position: { x: -3.0, z: 2.4 }, rotation: 0 },
    { id: 'stove-1', type: 'stove', category: 'kitchen', name: 'Stove', width: 0.7, depth: 0.65, height: 0.9, color: '#424242', icon: '🍳', price: 850, position: { x: -2.2, z: 2.4 }, rotation: 0 },
    { id: 'sink-1', type: 'kitchen-sink', category: 'kitchen', name: 'Sink', width: 0.9, depth: 0.6, height: 0.9, color: '#BDBDBD', icon: '🚰', price: 450, position: { x: -1.2, z: 2.4 }, rotation: 0 },
  ]),
  twoStory: {
    name: 'Two-Story Home',
    width: 6,
    height: 5,
    floors: [
      {
        id: 'ground',
        name: 'Ground Floor',
        floorColor: '#D4C5B9',
        items: [
          { id: 'gf-sofa', type: 'sofa', category: 'seating', name: 'Sofa', width: 2.0, depth: 0.9, height: 0.8, color: '#4A5568', icon: '🛋️', price: 650, position: { x: -1.4, z: -1.5 }, rotation: 0 },
          { id: 'gf-tv', type: 'tv', category: 'electronics', name: 'TV Stand', width: 1.5, depth: 0.4, height: 0.5, color: '#2C3E50', icon: '📺', price: 600, position: { x: -1.4, z: 1.8 }, rotation: Math.PI },
          { id: 'gf-fridge', type: 'fridge', category: 'kitchen', name: 'Refrigerator', width: 0.7, depth: 0.7, height: 1.8, color: '#E0E0E0', icon: '🧊', price: 1200, position: { x: 2.2, z: -2.0 }, rotation: 0 },
          { id: 'gf-stove', type: 'stove', category: 'kitchen', name: 'Stove', width: 0.7, depth: 0.65, height: 0.9, color: '#424242', icon: '🍳', price: 850, position: { x: 2.2, z: -1.1 }, rotation: 0 },
          { id: 'gf-stairs', type: 'stairs', category: 'structure', name: 'Stairs', width: 1.2, depth: 2.4, height: 3.0, color: '#8B4513', icon: '🪜', price: 1500, position: { x: 2.0, z: 1.0 }, rotation: 0, stairsDirection: 'north' },
        ],
      },
      {
        id: 'first',
        name: 'First Floor',
        floorColor: '#F5E6D3',
        items: [
          { id: 'ff-bed', type: 'bed', category: 'bedroom', name: 'Double Bed', width: 2.0, depth: 1.6, height: 0.6, color: '#E8E8E8', icon: '🛏️', price: 800, position: { x: -1.5, z: -1.5 }, rotation: 0 },
          { id: 'ff-wardrobe', type: 'wardrobe', category: 'bedroom', name: 'Wardrobe', width: 1.4, depth: 0.6, height: 2.1, color: '#6D4C41', icon: '🚪', price: 540, position: { x: -2.0, z: 1.5 }, rotation: 0 },
          { id: 'ff-stairs', type: 'stairs', category: 'structure', name: 'Stairs', width: 1.2, depth: 2.4, height: 3.0, color: '#8B4513', icon: '🪜', price: 1500, position: { x: 2.0, z: 1.0 }, rotation: 0, stairsDirection: 'north' },
        ],
      },
    ],
  },
} as const satisfies Record<RoomTemplateKey, Omit<RoomLayout, 'id'>>;
