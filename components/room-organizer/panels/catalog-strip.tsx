'use client';

import { useState } from 'react';
import { useRovingTiles, type RovingTileProps } from '../hooks/use-keyboard-placement';
import { useActiveFloorIndex } from '../hooks/use-layout-store';
import { useMediaQuery } from '../hooks/use-media-query';
import { CATALOG_DRAG_MIME, catalogKey, catalogTileBlockedReason } from '../lib/catalog-drag';
import { CATEGORIES, CURRENCY_SYMBOL, FURNITURE_CATALOG } from '../lib/constants';
import { catalogPageSize, COARSE_POINTER_QUERY, COMPACT_DOCK_QUERY } from '../lib/hud-layout';
import { Icon, iconForItem, type PlotcraftIconName } from '../plotcraft/icon';
import { CctvMenu } from './cctv-menu';
import type { CatalogItem, FurnitureCategory } from '../lib/types';

const PAGE_SIZE = 8;
const COLUMNS = 4;

export interface CatalogStripProps {
  category: FurnitureCategory | 'all';
  onAdd(item: CatalogItem): void;
}

export function CatalogStrip({ category, onAdd }: CatalogStripProps): JSX.Element {
  const activeFloorIndex = useActiveFloorIndex();
  const [page, setPage] = useState(0);
  const [collapsed, setCollapsed] = useState(false);
  // Docked on a phone (#395): one row of every item, scrolled sideways,
  // instead of a two-row page with a pager.
  const compact = useMediaQuery(COMPACT_DOCK_QUERY);
  // A tooltip never shows on touch, so tiles name their item there (#423).
  const showNames = useMediaQuery(COARSE_POINTER_QUERY) || compact;

  const items =
    category === 'all'
      ? FURNITURE_CATALOG
      : FURNITURE_CATALOG.filter((item) => item.category === category);
  const pageSize = catalogPageSize(items.length, compact, PAGE_SIZE);
  const pages = Math.max(1, Math.ceil(items.length / pageSize));
  const safePage = Math.min(page, pages - 1);
  const visible = items.slice(safePage * pageSize, (safePage + 1) * pageSize);

  // Keyboard placement (#168): one tile in the Tab order, arrows rove the grid.
  const { gridRef, tileProps } = useRovingTiles(visible.length, compact ? visible.length : COLUMNS);

  // Cameras get a dedicated, type-grouped menu rather than the paged grid.
  if (category === 'security') {
    return (
      <div
        className="pointer-events-auto pc-glass pc-catalog-strip"
        data-scene-occluder=""
        style={{ width: 540, maxWidth: '100%', padding: '10px 14px 12px' }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: collapsed ? 0 : 8 }}>
          <StripToggle
            label="Security Cameras"
            collapsed={collapsed}
            onToggle={() => setCollapsed((c) => !c)}
          />
          <div style={{ flex: 1, height: 1, background: 'var(--pc-glass-inner)' }} />
        </div>
        {!collapsed && (
        <div
          style={{
            background: 'rgba(0, 0, 0, 0.20)',
            border: '1px solid rgba(255, 255, 255, 0.08)',
            borderRadius: 14,
            padding: 8,
            boxShadow: 'inset 0 2px 6px rgba(0, 0, 0, 0.35)',
          }}
        >
          <CctvMenu variant="strip" onAdd={onAdd} />
        </div>
        )}
      </div>
    );
  }

  if (compact) {
    return (
      <div className="pointer-events-auto pc-glass pc-catalog-strip pc-catalog-strip--docked" data-scene-occluder="">
        <div
          ref={gridRef}
          role="group"
          aria-label="Catalog"
          className="pc-catalog-row"
          style={{ display: 'flex', gap: 6, overflowX: 'auto', scrollbarWidth: 'none' }}
        >
          {visible.map((item, index) => {
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
                showName
                docked
              />
            );
          })}
        </div>
      </div>
    );
  }

  const categoryMeta = CATEGORIES.find((entry) => entry.key === category);
  const categoryLabel =
    category === 'all' ? 'All' : (categoryMeta?.label ?? String(category));

  return (
    <div
      className="pointer-events-auto pc-glass pc-catalog-strip"
        data-scene-occluder=""
      style={{ width: 540, maxWidth: '100%', padding: '10px 14px 12px' }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          marginBottom: collapsed ? 0 : 8,
        }}
      >
        <StripToggle
          label={`Build Tools: ${categoryLabel}`}
          collapsed={collapsed}
          onToggle={() => setCollapsed((c) => !c)}
        />
        <div
          style={{ flex: 1, height: 1, background: 'var(--pc-glass-inner)' }}
        />
        <div
          className="pc-blurb"
          style={{
            fontSize: 11,
            fontFamily: 'var(--pc-font-display)',
            fontWeight: 600,
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {safePage + 1} / {pages}
        </div>
      </div>

      {!collapsed && (
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '28px 1fr 28px',
          gap: 8,
          alignItems: 'stretch',
        }}
      >
        <PageButton
          icon="chevL"
          label="Previous"
          onClick={() => setPage((p) => Math.max(0, p - 1))}
          disabled={safePage === 0}
        />

        {/* Recessed inner panel — the catalog "well" that holds the tiles */}
        <div
          style={{
            background: 'rgba(0, 0, 0, 0.20)',
            border: '1px solid rgba(255, 255, 255, 0.08)',
            borderRadius: 14,
            padding: 8,
            boxShadow: 'inset 0 2px 6px rgba(0, 0, 0, 0.35)',
          }}
        >
          <div
            className="pc-hud-header"
            style={{
              fontSize: 9,
              marginBottom: 6,
              opacity: 0.7,
              paddingLeft: 2,
            }}
          >
            Catalog Selection
          </div>
          <div
            ref={gridRef}
            style={{
              display: 'grid',
              gridTemplateColumns: `repeat(${COLUMNS}, 1fr)`,
              gridTemplateRows: 'repeat(2, 1fr)',
              gap: 6,
            }}
          >
            {Array.from({ length: PAGE_SIZE }).map((_, index) => {
              const item = visible[index];
              if (!item) {
                return (
                  <div
                    key={index}
                    aria-hidden
                    className="pc-tile pc-tile--ghost"
                    style={{ height: 56 }}
                  />
                );
              }
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
                  showName={showNames}
                />
              );
            })}
          </div>
        </div>

        <PageButton
          icon="chevR"
          label="Next"
          onClick={() => setPage((p) => Math.min(pages - 1, p + 1))}
          disabled={safePage >= pages - 1}
        />
      </div>
      )}
    </div>
  );
}

interface StripToggleProps {
  label: string;
  collapsed: boolean;
  onToggle(): void;
}

/** Strip header that doubles as the show/hide toggle. */
function StripToggle({ label, collapsed, onToggle }: StripToggleProps): JSX.Element {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={!collapsed}
      title={collapsed ? 'Show catalog' : 'Hide catalog'}
      className="pc-hud-header"
      style={{
        fontSize: 12,
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        background: 'none',
        border: 'none',
        cursor: 'pointer',
        color: 'inherit',
        padding: 0,
      }}
    >
      <span>{label}</span>
      <span
        aria-hidden
        className="pc-tile"
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 24,
          height: 24,
          borderRadius: 6,
          fontSize: 12,
          color: 'var(--pc-cyan-glow)',
        }}
      >
        {collapsed ? '▸' : '▾'}
      </span>
    </button>
  );
}

interface PageButtonProps {
  icon: PlotcraftIconName;
  label: string;
  disabled: boolean;
  onClick(): void;
}

function PageButton({ icon, label, disabled, onClick }: PageButtonProps): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className="pc-tile"
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        opacity: disabled ? 0.35 : 1,
        cursor: disabled ? 'not-allowed' : 'pointer',
      }}
    >
      <Icon name={icon} size={18} />
    </button>
  );
}

interface CatalogTileProps {
  item: CatalogItem;
  /** Why the tile can't place on the active floor (#347); it stays focusable so the roving grid keeps working. */
  blockedReason: string | null;
  onAdd(): void;
  roving: RovingTileProps;
  /** Name the item under its icon: on touch, where the tooltip never shows (#423). */
  showName?: boolean;
  /** A tile on the docked phone row: fixed width so the row scrolls. */
  docked?: boolean;
}

function CatalogTile({ item, blockedReason, onAdd, roving, showName, docked }: CatalogTileProps): JSX.Element {
  const icon = iconForItem(item.type, item.category);
  const blocked = blockedReason !== null;
  return (
    <button
      type="button"
      onClick={onAdd}
      aria-disabled={blocked || undefined}
      title={
        blocked
          ? `${item.name} — ${blockedReason}`
          : `${item.name} — ${CURRENCY_SYMBOL}${item.price.toLocaleString()}. Drag onto the 3D view to place precisely, or press Enter to place and position it with the keyboard.`
      }
      {...roving}
      draggable={!blocked}
      onDragStart={(event) => {
        event.dataTransfer.effectAllowed = 'copy';
        event.dataTransfer.setData(CATALOG_DRAG_MIME, catalogKey(item));
        event.dataTransfer.setData('text/plain', item.name);
      }}
      className="pc-tile"
      style={{
        height: 56,
        ...(docked ? { width: 76, flexShrink: 0 } : {}),
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 2,
        padding: 4,
        cursor: blocked ? 'not-allowed' : 'grab',
        opacity: blocked ? 0.35 : 1,
      }}
    >
      <Icon name={icon} size={showName ? 18 : 20} />
      {showName && (
        <span
          style={{
            fontFamily: 'var(--pc-font-display)',
            fontWeight: 600,
            fontSize: 9,
            color: 'var(--pc-paper)',
            lineHeight: 1.1,
            maxWidth: '100%',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {item.name}
        </span>
      )}
      <span
        style={{
          fontFamily: 'var(--pc-font-display)',
          fontWeight: 700,
          fontSize: 9,
          letterSpacing: '0.03em',
          color: 'var(--pc-money)',
          fontVariantNumeric: 'tabular-nums',
          lineHeight: 1,
        }}
      >
        {CURRENCY_SYMBOL}
        {item.price.toLocaleString()}
      </span>
    </button>
  );
}
