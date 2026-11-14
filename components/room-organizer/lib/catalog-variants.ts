import { catalogKey, findCatalogEntry } from './catalog-drag';
import type { CatalogItem, CatalogVariant, FurnitureItem } from './types';

/**
 * Colour variants of a catalogue entry (#621). A tile's swatch dots pick one
 * before placing; the placed item is the entry in that colour (and at that
 * price), and the item popover offers the same colours again. Variants are
 * colour only, so nothing but `color` and `price` reaches the item.
 */

/** The entry without its variant list: what a placed item is made from. */
export function catalogFields(entry: CatalogItem): CatalogItem {
  if (entry.variants === undefined) return entry;
  const fields = { ...entry };
  delete fields.variants;
  return fields;
}

/** The entry in variant `index`'s colour and price; an index it doesn't have gives the entry as it is. */
export function withVariant(entry: CatalogItem, index: number): CatalogItem {
  const variant = entry.variants?.[index];
  const fields = catalogFields(entry);
  if (!variant) return fields;
  return { ...fields, color: variant.color, price: variant.price ?? entry.price };
}

/** Separates the variant from the entry key in a catalogue drag. */
const VARIANT_SEPARATOR = '#';

/** What a tile's drag carries: the entry's key, and the variant when it isn't the first. */
export function catalogDragKey(entry: { type: string; name: string }, index: number): string {
  return index > 0 ? `${catalogKey(entry)}${VARIANT_SEPARATOR}${index}` : catalogKey(entry);
}

/** The item a drag places: its entry in the variant it carried. Older drags carry a bare key or type. */
export function catalogItemFromDrag(catalog: readonly CatalogItem[], key: string): CatalogItem | undefined {
  const at = key.lastIndexOf(VARIANT_SEPARATOR);
  const index = at >= 0 ? Number(key.slice(at + 1)) : 0;
  const variantKey = at >= 0 && Number.isInteger(index) && index > 0;
  const entry = findCatalogEntry(catalog, variantKey ? key.slice(0, at) : key);
  return entry && withVariant(entry, variantKey ? index : 0);
}

/**
 * The colours a placed item's entry comes in, for the popover: found by the
 * entry's key, then by type (a renamed item keeps its type). Empty for an
 * item whose entry has none, or that the catalogue no longer has.
 */
export function placedItemVariants(
  catalog: readonly CatalogItem[],
  item: Pick<FurnitureItem, 'type' | 'name'>
): readonly CatalogVariant[] {
  const entry =
    catalog.find((candidate) => catalogKey(candidate) === catalogKey(item)) ??
    catalog.find((candidate) => candidate.type === item.type);
  return entry?.variants ?? [];
}
