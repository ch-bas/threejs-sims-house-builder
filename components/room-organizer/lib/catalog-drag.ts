export const CATALOG_DRAG_MIME = 'application/x-room-organizer-catalog-item';

/**
 * A catalogue entry's identity for drags and list keys. Several entries can
 * share a type (Stairs / Winder Stairs, #205), so the name disambiguates.
 */
export function catalogKey(item: { type: string; name: string }): string {
  return `${item.type}:${item.name}`;
}

/** The catalogue entry a drag carried; accepts a bare type from older drags. */
export function findCatalogEntry<T extends { type: string; name: string }>(
  catalog: readonly T[],
  key: string
): T | undefined {
  return catalog.find((entry) => catalogKey(entry) === key) ?? catalog.find((entry) => entry.type === key);
}

/**
 * Why a catalogue tile can't place on the active floor, or null when it can.
 * Placement refuses garden items above the ground floor, so the tiles say so
 * instead of silently doing nothing (#347).
 */
export function catalogTileBlockedReason(item: { category: string }, activeFloorIndex: number): string | null {
  return item.category === 'outdoor' && activeFloorIndex > 0 ? 'Garden items go on the ground floor' : null;
}
