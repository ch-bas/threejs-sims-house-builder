'use client';

import {
  CCTV_TYPE_ORDER,
  CCTV_TYPE_BLURB,
  REPRESENTATIVE_MODEL_BY_TYPE,
  getCctvModel,
  modelsOfType,
  type CctvModelType,
} from '../lib/cctv-models';
import { FURNITURE_CATALOG } from '../lib/constants';
import { Icon } from '../plotcraft/icon';
import type { CatalogItem } from '../lib/types';

const BASE_CAMERA = FURNITURE_CATALOG.find((entry) => entry.type === 'security-camera');

/** Build the catalog item placed when a camera type is chosen — the base camera
 *  carrying that type's representative model so the cone + silhouette are right. */
function catalogItemForType(type: CctvModelType): CatalogItem | null {
  const model = getCctvModel(REPRESENTATIVE_MODEL_BY_TYPE[type]);
  if (!BASE_CAMERA || !model) return null;
  return {
    ...BASE_CAMERA,
    name: `${type} Camera`,
    cctvModelId: model.id,
    visionFov: model.fov,
    visionRange: model.range,
  };
}

export interface CctvMenuProps {
  /** 'strip' = dark bottom catalog; 'panel' = light sidebar Buy tab. */
  variant: 'strip' | 'panel';
  onAdd(item: CatalogItem): void;
}

export function CctvMenu({ variant, onAdd }: CctvMenuProps): JSX.Element {
  return variant === 'strip' ? <StripMenu onAdd={onAdd} /> : <PanelMenu onAdd={onAdd} />;
}

/** Dark, horizontal row of five type tiles for the bottom catalog strip. */
function StripMenu({ onAdd }: { onAdd(item: CatalogItem): void }): JSX.Element {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 6 }}>
      {CCTV_TYPE_ORDER.map((type) => {
        const item = catalogItemForType(type);
        if (!item) return null;
        const count = modelsOfType(type).length;
        return (
          <button
            key={type}
            type="button"
            onClick={() => onAdd(item)}
            title={`${type} camera — ${CCTV_TYPE_BLURB[type]} (${count} model${count > 1 ? 's' : ''})`}
            className="pc-tile"
            style={{
              height: 64,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 3,
              padding: 4,
            }}
          >
            <Icon name="vision" size={20} />
            <span
              style={{
                fontFamily: 'var(--pc-font-display)',
                fontWeight: 700,
                fontSize: 9,
                letterSpacing: '0.04em',
                textTransform: 'uppercase',
                lineHeight: 1,
              }}
            >
              {type}
            </span>
            <span style={{ fontSize: 8, opacity: 0.7, lineHeight: 1 }}>
              {count} model{count > 1 ? 's' : ''}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/** Light, vertical list of five type rows for the sidebar Buy tab. */
function PanelMenu({ onAdd }: { onAdd(item: CatalogItem): void }): JSX.Element {
  return (
    <div className="flex flex-col gap-2">
      {CCTV_TYPE_ORDER.map((type) => {
        const item = catalogItemForType(type);
        if (!item) return null;
        const models = modelsOfType(type);
        const rep = getCctvModel(REPRESENTATIVE_MODEL_BY_TYPE[type]);
        return (
          <button
            key={type}
            type="button"
            onClick={() => onAdd(item)}
            className="group flex items-center gap-3 rounded-xl border bg-gradient-to-b from-white to-slate-50 hover:from-amber-50 hover:to-amber-100 hover:border-amber-300 active:scale-[0.99] transition-all p-2.5 text-left shadow-sm"
          >
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-900 text-cyan-300">
              <Icon name="vision" size={18} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-xs font-semibold leading-tight">{type} Camera</span>
              <span className="block truncate text-[10px] text-muted-foreground">
                {CCTV_TYPE_BLURB[type]}
                {rep ? ` · e.g. ${rep.brand} ${rep.model}` : ''}
              </span>
            </span>
            <span className="shrink-0 text-[10px] font-medium text-amber-700">
              {models.length} model{models.length > 1 ? 's' : ''}
            </span>
          </button>
        );
      })}
      <p className="mt-1 text-center text-[10px] text-muted-foreground">
        Drops on the nearest wall · switch the exact model in its panel
      </p>
    </div>
  );
}
