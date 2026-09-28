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
