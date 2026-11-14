'use client';

import { useCallback, useState } from 'react';
import { useMediaQuery } from '../hooks/use-media-query';
import { catalogKey } from '../lib/catalog-drag';
import { COARSE_POINTER_QUERY } from '../lib/hud-layout';
import type { CatalogItem } from '../lib/types';

/**
 * The colour each catalogue tile will place (#621), by entry key; a tile
 * nobody has touched places its first colour, the entry's own.
 */
export function useVariantPicks(): {
  pickOf(entry: CatalogItem): number;
  setPick(entry: CatalogItem, index: number): void;
} {
  const [picks, setPicks] = useState<Readonly<Record<string, number>>>({});
  const pickOf = useCallback((entry: CatalogItem) => picks[catalogKey(entry)] ?? 0, [picks]);
  const setPick = useCallback((entry: CatalogItem, index: number) => {
    setPicks((current) => (current[catalogKey(entry)] === index ? current : { ...current, [catalogKey(entry)]: index }));
  }, []);
  return { pickOf, setPick };
}

export interface VariantDotsProps {
  entry: CatalogItem;
  picked: number;
  onPick(index: number): void;
}

/**
 * Swatch dots in a tile's top-right corner (#621). They sit beside the tile
 * button, not in it, so a dot never picks the item up; the keyboard picks a
 * colour in the item popover instead, so they stay out of the Tab order.
 *
 * A finger can't hit a row of small dots, so on touch the corner is one
 * 32 px button: the picked colour with the next one peeking out behind it,
 * and each tap moves on to the next colour.
 */
export function VariantDots({ entry, picked, onPick }: VariantDotsProps): JSX.Element | null {
  const touch = useMediaQuery(COARSE_POINTER_QUERY);
  const variants = entry.variants;
  if (!variants || variants.length < 2) return null;
  if (touch) {
    const current = variants[picked] ?? variants[0]!;
    const next = variants[(picked + 1) % variants.length]!;
    return (
      <button
        type="button"
        tabIndex={-1}
        className="pc-variant-cycle"
        aria-label={`${entry.name} colour: ${current.name}. Tap for ${next.name}`}
        onClick={() => onPick((picked + 1) % variants.length)}
      >
        <span className="pc-variant-cycle__next" style={{ backgroundColor: next.color }} />
        <span className="pc-variant-cycle__current" style={{ backgroundColor: current.color }} />
      </button>
    );
  }
  return (
    <div role="radiogroup" aria-label={`${entry.name} colour`} className="pc-variant-dots">
      {variants.map((variant, index) => (
        <button
          key={variant.name}
          type="button"
          role="radio"
          aria-checked={index === picked}
          aria-label={variant.name}
          title={variant.name}
          tabIndex={-1}
          className="pc-variant-dot"
          onClick={() => onPick(index)}
        >
          <span style={{ backgroundColor: variant.color }} />
        </button>
      ))}
    </div>
  );
}
