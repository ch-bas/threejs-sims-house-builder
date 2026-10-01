'use client';

import { useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { useRoomEditor } from '../contexts';
import { useRovingTiles, type RovingTileProps } from '../hooks/use-keyboard-placement';
import { CATALOG_DRAG_MIME, catalogKey, catalogTileBlockedReason } from '../lib/catalog-drag';
import { CCTV_MODELS } from '../lib/cctv-models';
import { CATEGORIES, CURRENCY_SYMBOL, FURNITURE_CATALOG } from '../lib/constants';
import { CctvMenu } from './cctv-menu';
import type { CatalogItem, CategoryMeta, FurnitureCategory } from '../lib/types';

type FilterKey = 'all' | FurnitureCategory;

const COLUMNS = 3;

const COUNTS_BY_CATEGORY: ReadonlyMap<FurnitureCategory, number> = (() => {
  const counts = new Map<FurnitureCategory, number>();
  for (const item of FURNITURE_CATALOG) {
    counts.set(item.category, (counts.get(item.category) ?? 0) + 1);
  }
  return counts;
})();

export interface FurnitureCatalogPanelProps {
  query?: string;
  onQueryChange?(query: string): void;
  onAdd(item: CatalogItem): void;
}

export function FurnitureCatalogPanel({
  onAdd,
  query: controlledQuery,
  onQueryChange,
}: FurnitureCatalogPanelProps): JSX.Element {
  const { activeFloorIndex } = useRoomEditor();
  const [filter, setFilter] = useState<FilterKey>('all');
  const [internalQuery, setInternalQuery] = useState('');
  const query = controlledQuery ?? internalQuery;
  const setQuery = (next: string) => {
    if (onQueryChange) onQueryChange(next);
    else setInternalQuery(next);
  };

  const filtered = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return FURNITURE_CATALOG.filter((item) => {
      if (filter !== 'all' && item.category !== filter) return false;
      if (!normalizedQuery) return true;
      return item.name.toLowerCase().includes(normalizedQuery) || item.type.toLowerCase().includes(normalizedQuery);
    });
  }, [filter, query]);

  // Keyboard placement (#168): one tile in the Tab order, arrows rove the grid.
  const { gridRef, tileProps } = useRovingTiles(filtered.length, COLUMNS);

  return (
    // shrink-0: overflow-hidden gives a flex item min-height 0, so in the
    // drawer's flex column this card used to collapse to a sliver (#360).
    <Card className="shrink-0 overflow-hidden">
      <CardHeader className="space-y-3">
        <CardTitle className="flex items-center justify-between">
          <span>Catalog</span>
          <span className="text-[10px] font-normal text-muted-foreground">{filtered.length} items</span>
        </CardTitle>
        <Input
          placeholder="🔍 Search furniture…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          className="text-xs"
        />
        <CategoryRail filter={filter} onSelect={setFilter} />
      </CardHeader>
      <CardContent className="pt-3">
        {filter === 'security' ? (
          <CctvMenu variant="panel" onAdd={onAdd} />
        ) : filtered.length === 0 ? (
          <p className="text-xs text-muted-foreground py-8 text-center">
            No items match this filter.
            <br />
            Try a broader category or clear the search.
          </p>
        ) : (
          <div ref={gridRef} className="grid grid-cols-3 gap-2 max-h-[460px] overflow-y-auto pr-1">
            {filtered.map((item, index) => {
              const blockedReason = catalogTileBlockedReason(item, activeFloorIndex);
              const add = () => {
                if (!blockedReason) onAdd(item);
              };
              return (
                <CatalogTile
                  key={catalogKey(item)}
                  item={item}
                  blockedReason={blockedReason}
                  onAdd={add}
                  roving={tileProps(index, add)}
                />
              );
            })}
          </div>
        )}
        <p className="text-[10px] text-muted-foreground mt-3 text-center">
          Click to drop at centre · drag onto the 3D view to place precisely · Enter to place and position with the keyboard
        </p>
      </CardContent>
    </Card>
  );
}

interface CategoryRailProps {
  filter: FilterKey;
  onSelect(filter: FilterKey): void;
}

function CategoryRail({ filter, onSelect }: CategoryRailProps): JSX.Element {
  return (
    <div className="grid grid-cols-6 gap-1">
      <CategoryButton
        active={filter === 'all'}
        icon="✨"
        label="All"
        count={FURNITURE_CATALOG.length}
        onClick={() => onSelect('all')}
      />
      {CATEGORIES.map((category) => (
        <CategoryButton
          key={category.key}
          active={filter === category.key}
          icon={category.icon}
          label={category.label}
          count={category.key === 'security' ? CCTV_MODELS.length : (COUNTS_BY_CATEGORY.get(category.key) ?? 0)}
          onClick={() => onSelect(category.key)}
        />
      ))}
    </div>
  );
}

interface CategoryButtonProps {
  active: boolean;
  icon: string;
  label: string;
  count: number;
  onClick(): void;
}

function CategoryButton({ active, icon, label, count, onClick }: CategoryButtonProps): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      title={`${label} (${count})`}
      aria-pressed={active}
      className={`flex flex-col items-center justify-center rounded-lg py-1.5 transition-all ${
        active
          ? 'bg-amber-300 text-slate-900 shadow-md scale-[1.05]'
          : 'bg-muted/50 hover:bg-muted text-muted-foreground'
      }`}
    >
      <span className="text-base leading-none" aria-hidden>
        {icon}
      </span>
      <span className="text-[9px] mt-0.5 truncate w-full text-center">{label}</span>
    </button>
  );
}

interface CatalogTileProps {
  item: CatalogItem;
  /** Why the tile can't place on the active floor; it stays focusable so the roving grid keeps working. */
  blockedReason: string | null;
  onAdd(): void;
  roving: RovingTileProps;
}

function CatalogTile({ item, blockedReason, onAdd, roving }: CatalogTileProps): JSX.Element {
  const blocked = blockedReason !== null;
  return (
    <button
      type="button"
      onClick={onAdd}
      aria-disabled={blocked || undefined}
      title={
        blocked
          ? `${item.name} — ${blockedReason}`
          : `${item.name} — drag onto the 3D view to place precisely, click to drop at center, or press Enter to place and position it with the keyboard`
      }
      {...roving}
      draggable={!blocked}
      onDragStart={(event) => {
        event.dataTransfer.effectAllowed = 'copy';
        // The full key, not the bare type: Stairs and Winder Stairs share one (#370).
        event.dataTransfer.setData(CATALOG_DRAG_MIME, catalogKey(item));
        event.dataTransfer.setData('text/plain', item.name);
      }}
      className={`group relative flex flex-col items-stretch overflow-hidden rounded-xl border bg-card transition-all shadow-sm ${
        blocked
          ? 'opacity-40 cursor-not-allowed'
          : 'hover:bg-muted hover:border-amber-300 active:scale-[0.97] cursor-grab active:cursor-grabbing hover:shadow-md'
      }`}
    >
      <div className="flex items-center justify-center aspect-square text-3xl bg-muted/40">
        <span aria-hidden>{item.icon}</span>
      </div>
      <div className="px-1.5 py-1 text-center">
        <p className="text-[10px] leading-tight font-medium truncate">{item.name}</p>
        <p className="text-[9px] text-amber-400 font-semibold">
          {CURRENCY_SYMBOL}
          {item.price.toLocaleString()}
        </p>
      </div>
    </button>
  );
}

// Re-export so the existing TS surface area stays unchanged for unrelated callers.
export type { CategoryMeta };
