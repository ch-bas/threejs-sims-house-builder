'use client';

import { useId } from 'react';
import { Icon, iconForItem, type PlotcraftIconName } from '../plotcraft/icon';
import type { SofaShape } from '../lib/types';
import { useRoomEditor } from '../contexts';
import { useSelection } from '../contexts';

const COLOR_SWATCHES = [
  '#8B4513',
  '#4A5568',
  '#E8E8E8',
  '#2C3E50',
  '#C62828',
  '#1976D2',
  '#388E3C',
  '#FFB300',
  '#6A1B9A',
  '#5D4037',
  '#0D47A1',
  '#FAFAFA',
];

type ResizableDimension = 'width' | 'depth' | 'height';

interface DimensionConfig {
  label: string;
  key: ResizableDimension;
  min: number;
  max: number;
}

const DIMENSIONS: readonly DimensionConfig[] = [
  { label: 'W', key: 'width',  min: 0.1, max: 5 },
  { label: 'D', key: 'depth',  min: 0.1, max: 5 },
  { label: 'H', key: 'height', min: 0.1, max: 3 },
];

export interface ItemContextPopoverProps {
  hasCollision: boolean;
  onRemove(id: string): void;
  onDuplicate(id: string): void;
  onRotate(id: string): void;
  onClose(): void;
}

export function ItemContextPopover(props: ItemContextPopoverProps): JSX.Element {
  const { actions, recentColors, pushColor } = useRoomEditor();
  const { selectedItem: item } = useSelection();
  if (!item) return <></>;
  const { onClose } = props;
  return (
    <div
      className="pc-glass pc-glass--dark"
      role="dialog"
      aria-label={`Edit ${item.name}`}
      style={{
        position: 'absolute',
        top: 130,
        right: 16,
        width: 296,
        padding: 0,
        overflow: 'hidden',
        zIndex: 28,
      }}
    >
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
          padding: '10px 12px',
          borderBottom: '1px solid var(--pc-glass-inner)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
          <div
            style={{
              height: 32,
              width: 32,
              borderRadius: 10,
              background: 'rgba(127,243,255,0.18)',
              border: '1px solid var(--pc-cyan-glow)',
              display: 'grid',
              placeItems: 'center',
              color: 'var(--pc-cyan-glow)',
              boxShadow: 'var(--pc-halo-cyan-soft)',
            }}
            aria-hidden
          >
            <Icon name={iconForItem(item.type, item.category)} size={18} />
          </div>
          <div style={{ minWidth: 0 }}>
            <p
              className="pc-body"
              style={{
                margin: 0,
                fontWeight: 700,
                fontFamily: 'var(--pc-font-display)',
                fontSize: 14,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {item.name}
            </p>
            {item.position && (
              <p
                className="pc-blurb"
                style={{
                  margin: 0,
                  fontSize: 10,
                  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                }}
              >
                ({item.position.x.toFixed(2)}, {item.position.z.toFixed(2)})
              </p>
            )}
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          title="Close"
          className="pc-tile"
          style={{
            width: 28,
            height: 28,
            borderRadius: 8,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Icon name="close" size={14} />
        </button>
      </header>

      <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 12 }}>
        {props.hasCollision && (
          <div
            className="pc-body"
            style={{
              fontSize: 11,
              color: 'var(--pc-paper)',
              background: 'rgba(228,82,72,0.18)',
              border: '1px solid var(--pc-demolish)',
              borderRadius: 8,
              padding: '6px 8px',
            }}
          >
            Overlaps another item or escapes the room.
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 4 }}>
          <ActionTile icon="rotate" label="Rotate" onClick={() => props.onRotate(item.id)} />
          <ActionTile
            icon="mirror"
            label="Mirror"
            active={item.mirrored}
            onClick={() => actions.toggleMirror(item.id)}
          />
          <ActionTile
            icon={item.locked ? 'lock' : 'unlock'}
            label={item.locked ? 'Unlock' : 'Lock'}
            active={item.locked}
            onClick={() => actions.setLocked(item.id, !item.locked)}
          />
          <ActionTile icon="copy" label="Copy" onClick={() => props.onDuplicate(item.id)} />
          <ActionTile icon="target" label="Centre" onClick={() => actions.moveItem(item.id, 0, 0)} />
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {DIMENSIONS.map((dimension) => (
            <DimensionRow
              key={dimension.key}
              dimension={dimension}
              value={item[dimension.key]}
              onChange={(value) => actions.resizeItem(item.id, dimension.key, value)}
            />
          ))}
        </div>

        {item.type === 'sofa' && (
          <SofaShapeSegmented
            value={item.sofaShape ?? 'standard'}
            onChange={(shape) => actions.setSofaShape(item.id, shape)}
          />
        )}

        {(item.isWiFiAccessPoint || item.isCCTV) && (
          <SignalRangeRow
            label={item.isWiFiAccessPoint ? 'Signal' : 'Coverage'}
            value={item.signalRange ?? (item.isWiFiAccessPoint ? 10 : 8)}
            min={2}
            max={item.isWiFiAccessPoint ? 20 : 15}
            onChange={(value) => actions.setSignalRange(item.id, value)}
          />
        )}

        <CompactColorPicker
          value={item.color}
          recent={recentColors}
          onChange={(color) => actions.setColor(item.id, color)}
          onCommit={(color) => pushColor(color)}
        />

        <button
          type="button"
          onClick={() => props.onRemove(item.id)}
          className="pc-tile"
          style={{
            width: '100%',
            height: 34,
            borderRadius: 10,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 6,
            color: 'var(--pc-demolish)',
            borderColor: 'rgba(228,82,72,0.5)',
            background: 'rgba(228,82,72,0.10)',
            fontFamily: 'var(--pc-font-display)',
            fontWeight: 700,
            fontSize: 12,
            letterSpacing: 'var(--pc-tr-caps)',
            textTransform: 'uppercase',
          }}
        >
          <Icon name="demolish" size={16} />
          Demolish
        </button>
      </div>
    </div>
  );
}

interface ActionTileProps {
  icon: PlotcraftIconName;
  label: string;
  onClick(): void;
  active?: boolean;
}

function ActionTile({ icon, label, onClick, active }: ActionTileProps): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className={`pc-tile${active ? ' pc-tile--active' : ''}`}
      style={{
        padding: 6,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 2,
        borderRadius: 10,
      }}
    >
      <Icon name={icon} size={16} />
      <span
        style={{
          fontFamily: 'var(--pc-font-display)',
          fontWeight: 600,
          fontSize: 8,
          letterSpacing: 'var(--pc-tr-caps)',
          textTransform: 'uppercase',
          color: active ? 'var(--pc-cyan-glow)' : 'var(--pc-paper-soft)',
        }}
      >
        {label}
      </span>
    </button>
  );
}

interface DimensionRowProps {
  dimension: DimensionConfig;
  value: number;
  onChange(value: number): void;
}

function DimensionRow({ dimension, value, onChange }: DimensionRowProps): JSX.Element {
  const id = useId();
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <label
        htmlFor={id}
        style={{
          width: 14,
          fontFamily: 'var(--pc-font-display)',
          fontWeight: 700,
          fontSize: 10,
          color: 'var(--pc-paper-soft)',
        }}
      >
        {dimension.label}
      </label>
      <input
        id={id}
        type="range"
        min={dimension.min}
        max={dimension.max}
        step="0.1"
        value={value}
        onChange={(event) => onChange(parseFloat(event.target.value))}
        style={{ flex: 1, accentColor: 'var(--pc-cyan-glow)' }}
      />
      <span
        style={{
          width: 48,
          textAlign: 'right',
          fontFamily: 'var(--pc-font-display)',
          fontWeight: 600,
          fontSize: 10,
          fontVariantNumeric: 'tabular-nums',
          color: 'var(--pc-paper)',
        }}
      >
        {value.toFixed(2)} m
      </span>
    </div>
  );
}

interface SofaShapeSegmentedProps {
  value: SofaShape;
  onChange(value: SofaShape): void;
}

function SofaShapeSegmented({ value, onChange }: SofaShapeSegmentedProps): JSX.Element {
  const options: ReadonlyArray<{ key: SofaShape; label: string }> = [
    { key: 'standard', label: 'Std' },
    { key: 'L-shape', label: 'L' },
    { key: 'U-shape', label: 'U' },
  ];
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <span
        style={{
          width: 48,
          fontFamily: 'var(--pc-font-display)',
          fontWeight: 600,
          fontSize: 10,
          letterSpacing: 'var(--pc-tr-caps)',
          textTransform: 'uppercase',
          color: 'var(--pc-paper-soft)',
        }}
      >
        Sofa
      </span>
      <div style={{ flex: 1, display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 4 }}>
        {options.map((option) => (
          <button
            key={option.key}
            type="button"
            onClick={() => onChange(option.key)}
            className={`pc-tile${value === option.key ? ' pc-tile--active' : ''}`}
            style={{
              padding: '4px 6px',
              borderRadius: 8,
              fontFamily: 'var(--pc-font-display)',
              fontWeight: 700,
              fontSize: 10,
              letterSpacing: 'var(--pc-tr-caps)',
              textTransform: 'uppercase',
            }}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

interface SignalRangeRowProps {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange(value: number): void;
}

function SignalRangeRow({ label, value, min, max, onChange }: SignalRangeRowProps): JSX.Element {
  const id = useId();
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <label
        htmlFor={id}
        style={{
          width: 48,
          fontFamily: 'var(--pc-font-display)',
          fontWeight: 600,
          fontSize: 10,
          letterSpacing: 'var(--pc-tr-caps)',
          textTransform: 'uppercase',
          color: 'var(--pc-paper-soft)',
        }}
      >
        {label}
      </label>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step="0.5"
        value={value}
        onChange={(event) => onChange(parseFloat(event.target.value))}
        style={{ flex: 1, accentColor: 'var(--pc-cyan-glow)' }}
      />
      <span
        style={{
          width: 48,
          textAlign: 'right',
          fontFamily: 'var(--pc-font-display)',
          fontWeight: 600,
          fontSize: 10,
          fontVariantNumeric: 'tabular-nums',
          color: 'var(--pc-paper)',
        }}
      >
        {value.toFixed(1)} m
      </span>
    </div>
  );
}

interface CompactColorPickerProps {
  value: string;
  recent: readonly string[];
  onChange(color: string): void;
  onCommit(color: string): void;
}

function CompactColorPicker({
  value,
  recent,
  onChange,
  onCommit,
}: CompactColorPickerProps): JSX.Element {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span
          style={{
            width: 48,
            fontFamily: 'var(--pc-font-display)',
            fontWeight: 600,
            fontSize: 10,
            letterSpacing: 'var(--pc-tr-caps)',
            textTransform: 'uppercase',
            color: 'var(--pc-paper-soft)',
          }}
        >
          Colour
        </span>
        <input
          type="color"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onBlur={(event) => onCommit(event.target.value)}
          style={{
            width: 30,
            height: 26,
            borderRadius: 6,
            border: '1px solid var(--pc-glass-stroke)',
            background: 'transparent',
            cursor: 'pointer',
            padding: 0,
          }}
        />
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, flex: 1 }}>
          {COLOR_SWATCHES.slice(0, 8).map((swatch) => {
            const selected = value.toLowerCase() === swatch.toLowerCase();
            return (
              <button
                key={swatch}
                type="button"
                aria-label={`Use color ${swatch}`}
                onClick={() => onChange(swatch)}
                style={{
                  height: 16,
                  width: 16,
                  borderRadius: 999,
                  border: '1px solid var(--pc-glass-stroke)',
                  backgroundColor: swatch,
                  cursor: 'pointer',
                  boxShadow: selected ? 'var(--pc-halo-cyan-soft)' : 'none',
                  outline: selected ? '1px solid var(--pc-cyan-glow)' : 'none',
                  padding: 0,
                }}
              />
            );
          })}
        </div>
      </div>
      {recent.length > 0 && (
        <div
          style={{ display: 'flex', flexWrap: 'wrap', gap: 4, paddingLeft: 56 }}
        >
          {recent.slice(0, 6).map((swatch) => {
            const selected = value.toLowerCase() === swatch.toLowerCase();
            return (
              <button
                key={swatch}
                type="button"
                aria-label={`Reuse colour ${swatch}`}
                onClick={() => onChange(swatch)}
                style={{
                  height: 14,
                  width: 14,
                  borderRadius: 4,
                  border: '1px solid var(--pc-glass-stroke)',
                  backgroundColor: swatch,
                  cursor: 'pointer',
                  boxShadow: selected ? 'var(--pc-halo-cyan-soft)' : 'none',
                  outline: selected ? '1px solid var(--pc-cyan-glow)' : 'none',
                  padding: 0,
                }}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
