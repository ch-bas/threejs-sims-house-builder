import { FURNITURE_CATALOG } from './constants';
import type { CatalogItem } from './types';

export const CATALOG_DRAG_MIME = 'application/x-room-organizer-catalog-item';

export function findCatalogItem(type: string): CatalogItem | null {
  return FURNITURE_CATALOG.find((entry) => entry.type === type) ?? null;
}
