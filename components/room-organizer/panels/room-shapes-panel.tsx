'use client';

import { useState } from 'react';
import { formatMetres } from '../lib/format';
import { ROOM_SHAPES, type RoomShapeId } from '../lib/room-shapes';
import { Icon } from '../plotcraft/icon';
import { DockFoldButton, useDockFold, type PanelFold } from './dock-fold';

export interface RoomShapesPanelProps {
  /** Maximum drawable dimensions, derived from the lot's footprint. */
  maxWidth: number;
  maxDepth: number;
  onStamp(args: {
    shape: RoomShapeId;
    width: number;
    depth: number;
    centerX: number;
    centerZ: number;
  }): void;
  /** Folded or not in the phone dock; the HUD unfolds one wall panel at a time. */
  fold?: PanelFold;
}

/**
 * Custom Room Tool — pick a pre-made footprint (rectangle / L /
 * U / T / plus / hexagon / octagon), choose a size, then stamp a closed
 * outline of interior walls onto the active floor. Shows only when the
 * walls build-tool is active.
 */
export function RoomShapesPanel({ maxWidth, maxDepth, onStamp, fold: panelFold }: RoomShapesPanelProps): JSX.Element {
  const [shape, setShape] = useState<RoomShapeId>('rectangle');
  const [width, setWidth] = useState(4);
  const [depth, setDepth] = useState(3);
  const fold = useDockFold(panelFold);

  const clampedW = clamp(width, 1.5, Math.max(1.5, maxWidth - 0.5));
  const clampedD = clamp(depth, 1.5, Math.max(1.5, maxDepth - 0.5));

  return (
    <div
      className={`pointer-events-auto pc-glass pc-room-stamp${fold.open ? '' : ' pc-dock-folded'}`}
      data-scene-occluder=""
      style={{ width: 232, padding: '10px 12px' }}
    >
      {fold.docked ? (
        <div style={{ marginBottom: fold.open ? 6 : 0, paddingLeft: 2 }}>
          <DockFoldButton label="Room Stamp" open={fold.open} onToggle={fold.toggle} />
        </div>
      ) : (
      <div
        className="pc-hud-header"
        style={{ fontSize: 11, marginBottom: 6, paddingLeft: 2 }}
      >
        Room Stamp
      </div>
      )}
      {fold.open && (
      <>

      {/* Shape grid */}
      <div
        className="pc-stamp-shapes"
        style={{
          background: 'rgba(0, 0, 0, 0.20)',
          border: '1px solid rgba(255, 255, 255, 0.08)',
          borderRadius: 12,
          padding: 4,
          boxShadow: 'inset 0 2px 6px rgba(0, 0, 0, 0.35)',
          display: 'grid',
          gridTemplateColumns: 'repeat(4, 1fr)',
          gap: 4,
        }}
      >
        {ROOM_SHAPES.map((spec) => {
          const isActive = shape === spec.id;
          return (
            <button
              key={spec.id}
              type="button"
              onClick={() => setShape(spec.id)}
              title={spec.label}
              aria-pressed={isActive}
              className={`pc-tile${isActive ? ' pc-tile--active' : ''}`}
              style={{
                height: 34,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <svg
                viewBox="0 0 24 24"
                width={22}
                height={22}
                fill="none"
                stroke="currentColor"
                strokeWidth={1.5}
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden
              >
                <path d={spec.path} />
              </svg>
            </button>
          );
        })}
      </div>

      {/* Size + stamp */}
      <div
        style={{
          marginTop: 8,
          paddingTop: 8,
          borderTop: '1px solid var(--pc-glass-inner)',
          display: 'flex',
          flexDirection: 'column',
          gap: 4,
        }}
      >
        <SizeRow label="W" name="Width" value={clampedW} min={1.5} max={Math.max(1.5, maxWidth - 0.5)} onChange={setWidth} />
        <SizeRow label="D" name="Depth" value={clampedD} min={1.5} max={Math.max(1.5, maxDepth - 0.5)} onChange={setDepth} />

        <button
          type="button"
          onClick={() =>
            onStamp({
              shape,
              width: clampedW,
              depth: clampedD,
              centerX: 0,
              centerZ: 0,
            })
          }
          className="pc-tile pc-tile--active pc-stamp-go"
          style={{
            marginTop: 4,
            padding: '6px 10px',
            borderRadius: 10,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 6,
            fontFamily: 'var(--pc-font-display)',
            fontWeight: 800,
            fontSize: 11,
            letterSpacing: 'var(--pc-tr-caps)',
            textTransform: 'uppercase',
          }}
        >
          <Icon name="sparkle" size={14} />
          Stamp Room
        </button>
      </div>
      </>
      )}
    </div>
  );
}

interface SizeRowProps {
  label: string;
  /** Accessible name of the slider; the visible label is a single letter. */
  name: string;
  value: number;
  min: number;
  max: number;
  onChange(v: number): void;
}

function SizeRow({ label, name, value, min, max, onChange }: SizeRowProps): JSX.Element {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <span
        style={{
          width: 12,
          fontFamily: 'var(--pc-font-display)',
          fontWeight: 700,
          fontSize: 10,
          color: 'var(--pc-paper-soft)',
        }}
      >
        {label}
      </span>
      <input
        type="range"
        aria-label={name}
        min={min}
        max={max}
        step={0.5}
        value={value}
        aria-valuetext={formatMetres(value, 1)}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        style={{ flex: 1, accentColor: 'var(--pc-cyan-glow)' }}
      />
      <span
        style={{
          width: 42,
          textAlign: 'right',
          fontFamily: 'var(--pc-font-display)',
          fontWeight: 700,
          fontSize: 10,
          fontVariantNumeric: 'tabular-nums',
          color: 'var(--pc-paper)',
        }}
      >
        {formatMetres(value, 1)}
      </span>
    </div>
  );
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}
