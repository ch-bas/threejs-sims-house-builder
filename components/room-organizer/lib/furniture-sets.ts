import { FURNITURE_CATALOG } from './constants';
import type { CatalogItem, FurnitureItem, Vec2 } from './types';

export interface FurnitureSet {
  key: string;
  label: string;
  icon: string;
  description: string;
  items: ReadonlyArray<{ type: string; offset: Vec2; rotation?: number }>;
}

export const FURNITURE_SETS: readonly FurnitureSet[] = [
  {
    key: 'dining',
    label: 'Dining Set',
    icon: '🍽️',
    description: 'Dining table + 4 chairs',
    items: [
      { type: 'dining-table', offset: { x: 0, z: 0 } },
      { type: 'dining-chair', offset: { x: -1.2, z: 0 }, rotation: Math.PI / 2 },
      { type: 'dining-chair', offset: { x: 1.2, z: 0 }, rotation: -Math.PI / 2 },
      { type: 'dining-chair', offset: { x: 0, z: -0.85 }, rotation: 0 },
      { type: 'dining-chair', offset: { x: 0, z: 0.85 }, rotation: Math.PI },
    ],
  },
  {
    key: 'bedroom',
    label: 'Bedroom Set',
    icon: '🛏️',
    description: 'Bed + two nightstands + lamp',
    items: [
      { type: 'bed', offset: { x: 0, z: 0 } },
      { type: 'nightstand', offset: { x: -1.4, z: 0 } },
      { type: 'nightstand', offset: { x: 1.4, z: 0 } },
      { type: 'lamp', offset: { x: -1.4, z: -0.3 } },
    ],
  },
  {
    key: 'home-office',
    label: 'Office Set',
    icon: '💼',
    description: 'Desk + chair + computer + lamp',
    items: [
      { type: 'desk', offset: { x: 0, z: -0.3 } },
      { type: 'chair', offset: { x: 0, z: 0.4 }, rotation: Math.PI },
      { type: 'computer', offset: { x: 0, z: -0.3 } },
      { type: 'lamp', offset: { x: 0.6, z: -0.3 } },
    ],
  },
  {
    key: 'kitchen-line',
    label: 'Kitchen Line',
    icon: '🍳',
    description: 'Fridge + stove + counter + sink',
    items: [
      { type: 'fridge', offset: { x: -1.5, z: 0 } },
      { type: 'stove', offset: { x: -0.6, z: 0 } },
      { type: 'counter', offset: { x: 0.4, z: 0 } },
      { type: 'kitchen-sink', offset: { x: 1.5, z: 0 } },
    ],
  },
  {
    key: 'lounge',
    label: 'Lounge Set',
    icon: '🛋️',
    description: 'Sofa + coffee table + TV + plant',
    items: [
      { type: 'sofa', offset: { x: 0, z: -0.6 } },
      { type: 'coffee-table', offset: { x: 0, z: 0.6 } },
      { type: 'tv', offset: { x: 0, z: 2.0 }, rotation: Math.PI },
      { type: 'plant', offset: { x: -1.6, z: 1.8 } },
    ],
  },
];

interface BuildSetOptions {
  center?: Vec2;
  idPrefix?: string;
}

export function buildFurnitureSet(set: FurnitureSet, options: BuildSetOptions = {}): FurnitureItem[] {
  const { center = { x: 0, z: 0 }, idPrefix = `${set.key}-${Date.now()}` } = options;

  const items: FurnitureItem[] = [];
  set.items.forEach((spec, index) => {
    const catalog = FURNITURE_CATALOG.find((entry) => entry.type === spec.type) as CatalogItem | undefined;
    if (!catalog) return;
    items.push({
      ...catalog,
      id: `${idPrefix}-${index}`,
      position: { x: center.x + spec.offset.x, z: center.z + spec.offset.z },
      rotation: spec.rotation ?? 0,
    });
  });
  return items;
}
