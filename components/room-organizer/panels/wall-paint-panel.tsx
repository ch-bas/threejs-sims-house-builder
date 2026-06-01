'use client';

import { useState } from 'react';
import type {
  FloorPattern,
  WallId,
  WallPattern,
} from '../lib/types';
import { Icon } from '../plotcraft/icon';
import { useRoomEditor } from '../contexts';

// ============================================================================
// Pattern + style metadata
// ============================================================================

const WALL_PATTERNS: ReadonlyArray<{ id: WallPattern; label: string; thumb: PatternThumbName }> = [
  { id: 'solid',     label: 'Solid',     thumb: 'solid'   },
  { id: 'siding',    label: 'Siding',    thumb: 'siding'  },
  { id: 'brick',     label: 'Brick',     thumb: 'brick'   },
  { id: 'panel',     label: 'Panel',     thumb: 'panel'   },
  { id: 'wallpaper', label: 'Paper',     thumb: 'dots'    },
  { id: 'plaster',   label: 'Plaster',   thumb: 'speckle' },
];

const FLOOR_PATTERNS: ReadonlyArray<{ id: FloorPattern; label: string; thumb: PatternThumbName }> = [
  { id: 'wood',     label: 'Wood',     thumb: 'wood'    },
  { id: 'tile',     label: 'Tile',     thumb: 'tile'    },
  { id: 'carpet',   label: 'Carpet',   thumb: 'speckle' },
  { id: 'concrete', label: 'Concrete', thumb: 'solid'   },
  { id: 'solid',    label: 'Solid',    thumb: 'solid'   },
];

// ============================================================================
// Colour palettes — Interactive, grouped by mood the way the reference does
// ============================================================================

interface SwatchGroup {
  id: string;
  label: string;
  colors: readonly string[];
}

const WALL_PALETTES: readonly SwatchGroup[] = [
  {
    id: 'pastel',
    label: 'Pastels',
    colors: [
      '#e8dcc4', '#ffffff', '#fff4d6', '#ffe9b0',
      '#b8e0c4', '#a8d8e8', '#d6c4e8', '#fce4ec',
      '#f5b7a8', '#ffd1b3', '#c4d4b0', '#a0c5c5',
    ],
  },
  {
    id: 'warm',
    label: 'Warm',
    colors: [
      '#d4a373', '#c9885a', '#b06a3b', '#8b5a3c',
      '#f7c873', '#e9a13c', '#c47a2a', '#7a4f2a',
      '#c93b3b', '#a02828', '#d9908e', '#cf6f7d',
    ],
  },
  {
    id: 'cool',
    label: 'Cool',
    colors: [
      '#7aa9d6', '#4a7fb7', '#2c5d9b', '#1d3f78',
      '#4fa8a5', '#2e7d7a', '#1b5e60', '#114448',
      '#a48ad4', '#6f4c9b', '#4b2e7a', '#2d1b54',
    ],
  },
  {
    id: 'neutral',
    label: 'Neutral',
    colors: [
      '#ffffff', '#f0ece4', '#d8d8d8', '#b0b0b0',
      '#888888', '#5a5a5a', '#2d2d2d', '#1a1a1a',
      '#dccab0', '#bca58a', '#8a7560', '#4a3a2a',
    ],
  },
];

const FLOOR_PALETTES: readonly SwatchGroup[] = [
  {
    id: 'wood',
    label: 'Wood',
    colors: [
      '#e5c8a0', '#d4b896', '#c9a57d', '#b08858',
      '#8b5a3c', '#6b4226', '#5d3a23', '#3e261a',
    ],
  },
  {
    id: 'stone',
    label: 'Stone',
    colors: [
      '#f0e8da', '#d8c4a0', '#b4afa3', '#8a8580',
      '#b0b0b0', '#7c7c7c', '#444448', '#2d2d2d',
    ],
  },
  {
    id: 'bold',
    label: 'Bold',
    colors: [
      '#c93b3b', '#1d3f78', '#2e7d7a', '#6f4c9b',
      '#e9a13c', '#a02828', '#1b5e60', '#4b2e7a',
    ],
  },
];

// ============================================================================
// Apply-to + active-tab state
// ============================================================================

const APPLY_TARGETS: ReadonlyArray<{ id: WallId | 'all'; label: string }> = [
  { id: 'all',   label: 'All' },
  { id: 'north', label: 'N' },
  { id: 'east',  label: 'E' },
  { id: 'south', label: 'S' },
  { id: 'west',  label: 'W' },
];

type Surface = 'walls' | 'floor';

export interface WallPaintPanelProps {
  /** Optional pre-selected wall (from 3D click) — pre-targets the Apply-to chip. */
  selectedWall: { id: string; kind: 'exterior' | 'interior' } | null;
  onSelectedWallChange(wall: { id: string; kind: 'exterior' | 'interior' } | null): void;
}

/**
 * Interactive wall + floor finish picker. Surface tabs (Walls / Floor),
 * pattern row with mini thumbnails, then a categorized swatch palette with
 * mood tabs (Pastels / Warm / Cool / Neutral on walls, Wood / Stone / Bold on
 * floors) — roughly 48 wall colours and 24 floor colours one click away.
 */
export function WallPaintPanel(props: WallPaintPanelProps): JSX.Element {
  const { activeFloor: floor, actions } = useRoomEditor();

  const applyWallColor = (target: WallId | 'all', color: string) => {
    if (target === 'all') {
      actions.setWallColor('north', color);
      actions.setWallColor('south', color);
      actions.setWallColor('east', color);
      actions.setWallColor('west', color);
    } else {
      actions.setWallColor(target, color);
    }
  };
  const [surface, setSurface] = useState<Surface>('walls');
  const [wallGroup, setWallGroup] = useState<string>('pastel');
  const [floorGroup, setFloorGroup] = useState<string>('wood');

  // Apply-to driven by the 3D click selection: when the user clicks a wall in
  // the world, the chip jumps to that wall automatically; otherwise default
  // to "All".
  const selectedExteriorId =
    props.selectedWall && props.selectedWall.kind === 'exterior'
      ? (props.selectedWall.id as WallId)
      : null;
  const applyTo: WallId | 'all' = selectedExteriorId ?? 'all';

  const currentWallPattern = floor.wallPattern ?? 'solid';
  const currentFloorPattern = floor.floorPattern ?? 'solid';
  const currentWallColor =
    (selectedExteriorId
      ? floor.wallColors?.[selectedExteriorId]
      : floor.wallColors?.north) ?? '#e8dcc4';

  const activeWallPalette =
    WALL_PALETTES.find((g) => g.id === wallGroup) ?? WALL_PALETTES[0]!;
  const activeFloorPalette =
    FLOOR_PALETTES.find((g) => g.id === floorGroup) ?? FLOOR_PALETTES[0]!;

  return (
    <div
      className="pointer-events-auto pc-glass pc-wall-paint"
      style={{ width: 280, padding: '10px 12px' }}
    >
      {/* Title + Surface toggle */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 6,
          marginBottom: 8,
        }}
      >
        <div
          className="pc-hud-header"
          style={{
            fontSize: 11,
            display: 'flex',
            alignItems: 'center',
            gap: 4,
          }}
        >
          <Icon name="sparkle" size={12} />
          Paint
        </div>
        <SurfaceTabs surface={surface} onChange={setSurface} />
      </div>

      {surface === 'walls' ? (
        <>
          <SectionLabel>Wall Pattern</SectionLabel>
          <PatternGrid>
            {WALL_PATTERNS.map((p) => (
              <PatternTile
                key={p.id}
                label={p.label}
                thumb={p.thumb}
                active={currentWallPattern === p.id}
                onClick={() => actions.setWallPattern(p.id)}
              />
            ))}
          </PatternGrid>

          <SectionLabel>
            Apply To
            {props.selectedWall && (
              <span
                style={{
                  marginLeft: 6,
                  fontFamily: 'var(--pc-font-display)',
                  fontWeight: 700,
                  fontSize: 9,
                  color: 'var(--pc-cyan-glow)',
                }}
              >
                · Wall selected
              </span>
            )}
          </SectionLabel>
          <ApplyToggle
            value={applyTo}
            onChange={(v) => {
              if (v === 'all') {
                props.onSelectedWallChange(null);
              } else {
                props.onSelectedWallChange({ id: v, kind: 'exterior' });
              }
            }}
          />

          <SectionLabel>Wall Colour · {activeWallPalette.label}</SectionLabel>
          <GroupTabs
            groups={WALL_PALETTES}
            active={wallGroup}
            onChange={setWallGroup}
          />
          <SwatchGrid
            swatches={activeWallPalette.colors}
            value={currentWallColor}
            onChange={(color) => applyWallColor(applyTo, color)}
            onCustomChange={(color) => applyWallColor(applyTo, color)}
          />
        </>
      ) : (
        <>
          <SectionLabel>Floor Pattern</SectionLabel>
          <PatternGrid>
            {FLOOR_PATTERNS.map((p) => (
              <PatternTile
                key={p.id}
                label={p.label}
                thumb={p.thumb}
                active={currentFloorPattern === p.id}
                onClick={() => actions.setFloorPattern(p.id)}
              />
            ))}
          </PatternGrid>

          <SectionLabel>Floor Colour · {activeFloorPalette.label}</SectionLabel>
          <GroupTabs
            groups={FLOOR_PALETTES}
            active={floorGroup}
            onChange={setFloorGroup}
          />
          <SwatchGrid
            swatches={activeFloorPalette.colors}
            value={floor.floorColor}
            onChange={(color) => actions.setFloorColor(color)}
            onCustomChange={(color) => actions.setFloorColor(color)}
          />
        </>
      )}
    </div>
  );
}

// ============================================================================
// Helpers
// ============================================================================

interface SurfaceTabsProps {
  surface: Surface;
  onChange(surface: Surface): void;
}

function SurfaceTabs({ surface, onChange }: SurfaceTabsProps): JSX.Element {
  const tabs: ReadonlyArray<{ id: Surface; label: string }> = [
    { id: 'walls', label: 'Walls' },
    { id: 'floor', label: 'Floor' },
  ];
  return (
    <div
      role="tablist"
      style={{
        display: 'inline-flex',
        gap: 3,
        background: 'rgba(0,0,0,0.20)',
        border: '1px solid rgba(255,255,255,0.08)',
        borderRadius: 8,
        padding: 3,
        boxShadow: 'inset 0 2px 4px rgba(0,0,0,0.30)',
      }}
    >
      {tabs.map((t) => {
        const active = surface === t.id;
        return (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(t.id)}
            className={`pc-tile${active ? ' pc-tile--active' : ''}`}
            style={{
              padding: '4px 10px',
              height: 22,
              borderRadius: 5,
              fontFamily: 'var(--pc-font-display)',
              fontWeight: 800,
              fontSize: 9,
              letterSpacing: 'var(--pc-tr-caps)',
              textTransform: 'uppercase',
            }}
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}

interface ApplyToggleProps {
  value: WallId | 'all';
  onChange(v: WallId | 'all'): void;
}

function ApplyToggle({ value, onChange }: ApplyToggleProps): JSX.Element {
  return (
    <div
      role="radiogroup"
      aria-label="Apply paint to"
      style={{
        display: 'flex',
        gap: 3,
        background: 'rgba(0,0,0,0.20)',
        border: '1px solid rgba(255,255,255,0.08)',
        borderRadius: 8,
        padding: 3,
        boxShadow: 'inset 0 2px 4px rgba(0,0,0,0.30)',
      }}
    >
      {APPLY_TARGETS.map((target) => {
        const active = value === target.id;
        return (
          <button
            key={target.id}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(target.id)}
            title={target.id === 'all' ? 'Apply to every exterior wall' : `Apply to ${target.id} wall only`}
            className={`pc-tile${active ? ' pc-tile--active' : ''}`}
            style={{
              flex: 1,
              height: 22,
              borderRadius: 6,
              fontFamily: 'var(--pc-font-display)',
              fontWeight: 800,
              fontSize: 9,
              letterSpacing: 'var(--pc-tr-caps)',
              textTransform: 'uppercase',
            }}
          >
            {target.label}
          </button>
        );
      })}
    </div>
  );
}

interface GroupTabsProps {
  groups: readonly SwatchGroup[];
  active: string;
  onChange(id: string): void;
}

function GroupTabs({ groups, active, onChange }: GroupTabsProps): JSX.Element {
  return (
    <div
      role="tablist"
      style={{
        display: 'flex',
        gap: 3,
        marginBottom: 4,
      }}
    >
      {groups.map((g) => {
        const isActive = g.id === active;
        return (
          <button
            key={g.id}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => onChange(g.id)}
            className={`pc-tile${isActive ? ' pc-tile--active' : ''}`}
            style={{
              flex: 1,
              height: 20,
              borderRadius: 6,
              padding: '0 4px',
              fontFamily: 'var(--pc-font-display)',
              fontWeight: 700,
              fontSize: 8,
              letterSpacing: 'var(--pc-tr-caps)',
              textTransform: 'uppercase',
            }}
          >
            {g.label}
          </button>
        );
      })}
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }): JSX.Element {
  return (
    <p
      className="pc-hud-header"
      style={{
        fontSize: 9,
        opacity: 0.75,
        marginTop: 6,
        marginBottom: 4,
        paddingLeft: 2,
      }}
    >
      {children}
    </p>
  );
}

function PatternGrid({ children }: { children: React.ReactNode }): JSX.Element {
  return (
    <div
      style={{
        background: 'rgba(0,0,0,0.20)',
        border: '1px solid rgba(255,255,255,0.08)',
        borderRadius: 10,
        padding: 4,
        boxShadow: 'inset 0 2px 6px rgba(0,0,0,0.35)',
        display: 'grid',
        gridTemplateColumns: 'repeat(6, 1fr)',
        gap: 4,
      }}
    >
      {children}
    </div>
  );
}

interface PatternTileProps {
  label: string;
  thumb: PatternThumbName;
  active: boolean;
  onClick(): void;
}

function PatternTile({ label, thumb, active, onClick }: PatternTileProps): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-pressed={active}
      className={`pc-tile${active ? ' pc-tile--active' : ''}`}
      style={{
        height: 36,
        padding: 2,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 1,
        overflow: 'hidden',
      }}
    >
      <PatternThumb name={thumb} />
      <span
        style={{
          fontFamily: 'var(--pc-font-display)',
          fontWeight: 700,
          fontSize: 7,
          letterSpacing: '0.04em',
          textTransform: 'uppercase',
          color: active ? 'var(--pc-cyan-glow)' : 'var(--pc-paper-soft)',
          lineHeight: 1,
        }}
      >
        {label}
      </span>
    </button>
  );
}

type PatternThumbName =
  | 'solid'
  | 'siding'
  | 'brick'
  | 'panel'
  | 'dots'
  | 'speckle'
  | 'wood'
  | 'tile';

function PatternThumb({ name }: { name: PatternThumbName }): JSX.Element {
  const common = { width: 22, height: 12 };
  switch (name) {
    case 'siding':
      return (
        <svg viewBox="0 0 22 12" {...common} aria-hidden>
          <rect width="22" height="12" fill="rgba(255,255,255,0.20)" />
          <path d="M0 3 L22 3 M0 6 L22 6 M0 9 L22 9" stroke="rgba(0,0,0,0.35)" strokeWidth="0.6" />
        </svg>
      );
    case 'brick':
      return (
        <svg viewBox="0 0 22 12" {...common} aria-hidden>
          <rect width="22" height="12" fill="rgba(179,86,61,0.5)" />
          <path d="M0 4 L22 4 M0 8 L22 8 M5 0 L5 4 M16 0 L16 4 M11 4 L11 8 M6 8 L6 12 M16 8 L16 12" stroke="rgba(0,0,0,0.35)" strokeWidth="0.5" />
        </svg>
      );
    case 'panel':
      return (
        <svg viewBox="0 0 22 12" {...common} aria-hidden>
          <rect width="22" height="12" fill="rgba(185,133,81,0.55)" />
          <path d="M5.5 0 L5.5 12 M11 0 L11 12 M16.5 0 L16.5 12" stroke="rgba(0,0,0,0.40)" strokeWidth="0.6" />
        </svg>
      );
    case 'dots':
      return (
        <svg viewBox="0 0 22 12" {...common} aria-hidden>
          <rect width="22" height="12" fill="rgba(232,220,196,0.7)" />
          {[2, 7, 12, 17].flatMap((x, i) =>
            [3, 7, 11].map((y, j) => (
              <circle key={`${i}-${j}`} cx={x + (j % 2 ? 2 : 0)} cy={y} r="0.7" fill="rgba(0,0,0,0.40)" />
            ))
          )}
        </svg>
      );
    case 'speckle':
      return (
        <svg viewBox="0 0 22 12" {...common} aria-hidden>
          <rect width="22" height="12" fill="rgba(217,201,168,0.6)" />
          {Array.from({ length: 22 }).map((_, i) => (
            <circle
              key={i}
              cx={(i * 11) % 22}
              cy={(i * 5) % 12}
              r="0.45"
              fill="rgba(0,0,0,0.30)"
            />
          ))}
        </svg>
      );
    case 'wood':
      return (
        <svg viewBox="0 0 22 12" {...common} aria-hidden>
          <rect width="22" height="12" fill="rgba(201,165,125,0.85)" />
          <path d="M0 4 L22 4 M0 8 L22 8" stroke="rgba(0,0,0,0.45)" strokeWidth="0.6" />
          <path d="M6 0 L6 4 M14 4 L14 8 M9 8 L9 12" stroke="rgba(0,0,0,0.35)" strokeWidth="0.5" />
        </svg>
      );
    case 'tile':
      return (
        <svg viewBox="0 0 22 12" {...common} aria-hidden>
          <rect width="22" height="12" fill="rgba(240,232,218,0.85)" />
          <path d="M11 0 L11 12 M0 6 L22 6" stroke="rgba(0,0,0,0.40)" strokeWidth="0.6" />
        </svg>
      );
    case 'solid':
    default:
      return (
        <svg viewBox="0 0 22 12" {...common} aria-hidden>
          <rect width="22" height="12" fill="rgba(255,255,255,0.20)" />
        </svg>
      );
  }
}

interface SwatchGridProps {
  swatches: readonly string[];
  value: string | undefined;
  onChange(color: string): void;
  onCustomChange?(color: string): void;
}

function SwatchGrid({ swatches, value, onChange, onCustomChange }: SwatchGridProps): JSX.Element {
  const normalized = (value ?? '').toLowerCase();
  return (
    <div
      style={{
        background: 'rgba(0,0,0,0.20)',
        border: '1px solid rgba(255,255,255,0.08)',
        borderRadius: 10,
        padding: 4,
        boxShadow: 'inset 0 2px 6px rgba(0,0,0,0.35)',
        display: 'grid',
        gridTemplateColumns: 'repeat(8, 1fr)',
        gap: 3,
      }}
    >
      {swatches.map((swatch) => {
        const active = swatch.toLowerCase() === normalized;
        return (
          <button
            key={swatch}
            type="button"
            onClick={() => onChange(swatch)}
            aria-label={`Use color ${swatch}`}
            title={swatch}
            style={{
              height: 22,
              borderRadius: 5,
              backgroundColor: swatch,
              border: active ? '2px solid var(--pc-cyan-glow)' : '1px solid rgba(255,255,255,0.30)',
              boxShadow: active ? 'var(--pc-halo-cyan-soft)' : 'inset 0 1px 0 rgba(255,255,255,0.40)',
              cursor: 'pointer',
              padding: 0,
            }}
          />
        );
      })}
      {onCustomChange && (
        <label
          title="Pick a custom colour"
          style={{
            height: 22,
            borderRadius: 5,
            border: '1px dashed rgba(255,255,255,0.45)',
            background:
              'conic-gradient(from 0deg, #ff5b6a, #ffd24a, #79e08a, #4fc3f7, #c77bff, #ff5b6a)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            position: 'relative',
            overflow: 'hidden',
            gridColumn: 'span 1',
          }}
        >
          <input
            type="color"
            value={value ?? '#ffffff'}
            onChange={(event) => onCustomChange(event.target.value)}
            style={{
              position: 'absolute',
              inset: 0,
              opacity: 0,
              cursor: 'pointer',
              border: 'none',
              padding: 0,
            }}
          />
        </label>
      )}
    </div>
  );
}
