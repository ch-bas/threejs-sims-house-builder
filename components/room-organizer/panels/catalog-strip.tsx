'use client';

import { useState } from 'react';
import { CATEGORIES, CURRENCY_SYMBOL, FURNITURE_CATALOG } from '../lib/constants';
import { CATALOG_DRAG_MIME } from '../lib/catalog-drag';
import { Icon, iconForItem, type PlotcraftIconName } from '../plotcraft/icon';
import type { CatalogItem, FurnitureCategory } from '../lib/types';

const PAGE_SIZE = 8;

export interface CatalogStripProps {
  category: FurnitureCategory | 'all';
  onAdd(item: CatalogItem): void;
}

export function CatalogStrip({ category, onAdd }: CatalogStripProps): JSX.Element {
  const [page, setPage] = useState(0);
  const items =
    category === 'all'
      ? FURNITURE_CATALOG
      : FURNITURE_CATALOG.filter((item) => item.category === category);
  const pages = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
  const safePage = Math.min(page, pages - 1);
  const visible = items.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE);

  const categoryMeta = CATEGORIES.find((entry) => entry.key === category);
  const categoryLabel =
    category === 'all' ? 'All' : (categoryMeta?.label ?? String(category));

  return (
    <div
      className="pointer-events-auto pc-glass pc-catalog-strip"
      style={{ width: 540, maxWidth: '100%', padding: '10px 14px 12px' }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          marginBottom: 8,
        }}
      >
        <div className="pc-hud-header" style={{ fontSize: 12 }}>
          Build Tools: {categoryLabel}
        </div>
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
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(4, 1fr)',
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
              return <CatalogTile key={item.type} item={item} onAdd={onAdd} />;
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
    </div>
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
  onAdd(item: CatalogItem): void;
}

function CatalogTile({ item, onAdd }: CatalogTileProps): JSX.Element {
  const icon = iconForItem(item.type, item.category);
  return (
    <button
      type="button"
      onClick={() => onAdd(item)}
      title={`${item.name} — ${CURRENCY_SYMBOL}${item.price.toLocaleString()}. Drag onto the canvas to place precisely.`}
      draggable
      onDragStart={(event) => {
        event.dataTransfer.effectAllowed = 'copy';
        event.dataTransfer.setData(CATALOG_DRAG_MIME, item.type);
        event.dataTransfer.setData('text/plain', item.name);
      }}
      className="pc-tile"
      style={{
        height: 56,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 2,
        padding: 4,
        cursor: 'grab',
      }}
    >
      <Icon name={icon} size={20} />
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
