'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { useRoomEditor } from '../contexts';
import { useSelection } from '../contexts';
import { useDialogFocus } from '../hooks/use-dialog-focus';
import { NOT_WHILE_EXPLORING, useExploring } from '../hooks/use-exploring';
import { useMediaQuery } from '../hooks/use-media-query';
import { CCTV_MODELS, getCctvModel } from '../lib/cctv-models';
import { DEFAULT_VISION_FOV_DEG, DEFAULT_VISION_RANGE_M, FURNITURE_CATALOG } from '../lib/constants';
import { lockedNote } from '../lib/editor-notices';
import { COARSE_POINTER_QUERY } from '../lib/hud-layout';
import { isWallMounted } from '../lib/opening-snap';
import { COMPACT_OVERLAY_QUERY } from '../lib/overlay-queue';
import { MAX_STAIRS_LEAD_IN } from '../lib/stairs';
import { MAX_SILL_HEIGHT, MIN_SILL_HEIGHT, windowSillHeight } from '../lib/street';
import { Icon, iconForItem, type PlotcraftIconName } from '../plotcraft/icon';
import { COLOR_SWATCHES, ColorSwatchPicker } from './color-swatch-picker';
import { DRAWER_FULL_SCREEN_QUERY } from './sidebar-tabs';
import { SliderRow } from './slider-row';
import type { FurnitureItem, SofaShape, StairsShape } from '../lib/types';

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

/**
 * A range input clamps its value to `max`, so a Pine Tree (4.5 m) shown on a
 * 3 m slider shrank to 3 m on the first nudge (#547). The slider reaches the
 * item's own size and its catalogue size, whichever is larger.
 */
function sliderMax(dimension: DimensionConfig, item: FurnitureItem): number {
  const catalog = FURNITURE_CATALOG.find((entry) => entry.type === item.type);
  return Math.max(dimension.max, item[dimension.key], catalog?.[dimension.key] ?? 0);
}

export interface ItemContextPopoverProps {
  /** Why the item shows red, as a sentence; null when it stands clear (#627). */
  collision: string | null;
  onRemove(id: string): void;
  onDuplicate(id: string): void;
  onRotate(id: string): void;
  onToggleCameraBracket(id: string): void;
  onClose(): void;
}

export function ItemContextPopover(props: ItemContextPopoverProps): JSX.Element {
  const { actions, recentColors, pushColor } = useRoomEditor();
  const { selectedItem: item } = useSelection();
  // EXPLORE never edits the house, the 2D plan included (#643, #699): the
  // item can still be selected and inspected, but every control that would
  // change it is off, with the reason as its hint.
  const exploring = useExploring();
  const dialogRef = useRef<HTMLDivElement>(null);
  // On a phone or a short screen the popover is a bottom sheet (globals.css,
  // "Overlays"): collapsed to the header and the action row so the selected
  // item stays in view above it, expanded on demand, and collapsed again for
  // each new selection.
  const sheet = useMediaQuery(COMPACT_OVERLAY_QUERY);
  const touch = useMediaQuery(COARSE_POINTER_QUERY);
  const [expandedFor, setExpandedFor] = useState<string | null>(null);
  const expanded = item !== null && expandedFor === item.id;
  const sheetOpen = sheet && item !== null;
  // The phone HUD hides the catalog and build tools while the sheet is up,
  // and the camera framing treats the sheet as an occluder.
  useEffect(() => {
    if (!sheetOpen) return undefined;
    const root = document.documentElement;
    root.dataset.sheetOpen = expanded ? 'expanded' : 'collapsed';
    return () => {
      delete root.dataset.sheetOpen;
    };
  }, [sheetOpen, expanded]);
  // Non-modal: move focus in so screen readers land in the dialog, and hand it
  // back when it closes (Close / Demolish / deselect) instead of dropping it
  // to <body> (#152). The container, not a button, takes focus so Enter/Space
  // can't trigger an action by accident. Escape is left to the global
  // shortcut (deselect), which also cancels an in-progress wall draft first.
  // After the effect above: closing unhides the dock, which may hold the tile
  // that focus returns to (#638). Selected on the scene there is nothing to
  // return to, so a keyboard close goes to the panels toggle.
  useDialogFocus(item !== null, dialogRef, { returnHome: 'keyboard' });
  const underDrawer = useMediaQuery(DRAWER_FULL_SCREEN_QUERY);
  if (!item) return <></>;
  const { onClose } = props;
  const setExpanded = (next: boolean) => setExpandedFor(next ? item.id : null);
  // Why a control is off: exploring first, then the item's lock.
  const offHint = (lockedHint: string): string | undefined =>
    exploring ? NOT_WHILE_EXPLORING : item.locked ? lockedHint : undefined;
  const lockedOff = exploring || item.locked === true;
  const colorPicker = (
    <ColorSwatchPicker
      variant="glass"
      value={item.color}
      swatches={COLOR_SWATCHES.slice(0, 8)}
      recent={recentColors.slice(0, 6)}
      // Guarded too: a disabled fieldset stops the browser's clicks, not a
      // dispatched event.
      onChange={(color) => {
        if (!exploring) actions.setColor(item.id, color);
      }}
      onCommit={(color) => {
        if (!exploring) pushColor(color);
      }}
    />
  );
  const exploreHint = exploring ? NOT_WHILE_EXPLORING : undefined;
  return (
    <div
      ref={dialogRef}
      tabIndex={-1}
      className="pc-glass pc-glass--dark pc-item-popover"
      role="dialog"
      aria-label={`Edit ${item.name}`}
      data-sheet={expanded ? 'expanded' : 'collapsed'}
      data-focus-companion={underDrawer ? undefined : ''}
      style={{
        position: 'absolute',
        top: 130,
        right: 16,
        width: 296,
        padding: 0,
        overflow: 'hidden',
        // Above the drawer's backdrop (35) so its controls stay live while the
        // drawer is open, below the drawer itself (40) (#361).
        zIndex: 36,
      }}
    >
      <SheetHandle expanded={expanded} onExpandedChange={setExpanded} />
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
            {item.type === 'security-camera' ? (
              <p
                className="pc-blurb"
                style={{ margin: 0, fontSize: 10, color: 'var(--pc-cyan-glow)' }}
              >
                {(() => {
                  const model = getCctvModel(item.cctvModelId);
                  return model ? `${model.brand} ${model.model}` : 'Custom camera';
                })()}
              </p>
            ) : (
              item.position && (
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
              )
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

      <div
        className="pc-item-popover__body"
        style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 12, maxHeight: 'calc(100vh - 180px)', overflowY: 'auto' }}
      >
        {exploring && (
          <p role="note" className="pc-body" style={{ margin: 0, fontSize: 11, opacity: 0.85 }}>
            {NOT_WHILE_EXPLORING}.
          </p>
        )}

        {props.collision !== null && (
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
            {props.collision}
          </div>
        )}

        {/* Nothing else says why Rotate and Centre are off on a phone, which has
            no tooltip (#635), so it stays in the collapsed sheet too. */}
        {item.locked && !exploring && (
          <p role="note" className="pc-body" style={{ margin: 0, fontSize: 11 }}>
            {lockedNote(touch)}
          </p>
        )}

        {/* A collapsed sheet shows only the warning and the action row; the
            `pc-sheet-more` wrappers are `display: contents` everywhere else. */}
        <div className="pc-sheet-more">
          {item.type === 'security-camera' && (
            <CameraModelCard
              disabled={exploring}
              modelId={item.cctvModelId ?? ''}
              fov={item.visionFov ?? DEFAULT_VISION_FOV_DEG}
              range={item.visionRange ?? DEFAULT_VISION_RANGE_M}
              onPickModel={(modelId) => {
                const model = getCctvModel(modelId);
                if (model) {
                  actions.updateItem(item.id, {
                    cctvModelId: model.id,
                    visionFov: model.fov,
                    visionRange: model.range,
                  });
                } else {
                  actions.updateItem(item.id, { cctvModelId: '' });
                }
              }}
              onSetFov={(value) => actions.updateItem(item.id, { visionFov: value, cctvModelId: '' })}
              onSetRange={(value) => actions.updateItem(item.id, { visionRange: value, cctvModelId: '' })}
            />
          )}

          {item.type === 'security-camera' && (
            <button
              type="button"
              onClick={() => props.onToggleCameraBracket(item.id)}
              aria-pressed={item.cameraBracket === true}
              disabled={lockedOff}
              title={offHint('Locked — unlock to change the mount')}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 8,
                padding: '8px 10px',
                borderRadius: 8,
                cursor: lockedOff ? 'not-allowed' : 'pointer',
                opacity: lockedOff ? 0.5 : 1,
                border: '1px solid rgba(255,255,255,0.12)',
                background: item.cameraBracket ? 'rgba(56,189,248,0.18)' : 'rgba(255,255,255,0.04)',
                color: 'inherit',
                textAlign: 'left',
                font: 'inherit',
              }}
            >
              <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <span style={{ fontSize: 12, fontWeight: 600 }}>Stand-off bracket</span>
                <span style={{ fontSize: 10.5, opacity: 0.85 }}>
                  {item.cameraBracket
                    ? 'On its arm — pan left/right freely'
                    : 'Flush mount — Rotate flips in/out only'}
                </span>
              </span>
              <span style={{ fontSize: 11, fontWeight: 700, opacity: 0.9 }}>
                {item.cameraBracket ? 'ON' : 'OFF'}
              </span>
            </button>
          )}

        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 4 }}>
          <ActionTile
            icon="rotate"
            label="Rotate"
            disabled={lockedOff}
            title={offHint('Locked — unlock to rotate')}
            onClick={() => props.onRotate(item.id)}
          />
          <ActionTile
            icon="mirror"
            label="Mirror"
            active={item.mirrored}
            disabled={lockedOff}
            title={offHint('Locked — unlock to mirror')}
            onClick={() => actions.toggleMirror(item.id)}
          />
          <ActionTile
            icon={item.locked ? 'lock' : 'unlock'}
            label={item.locked ? 'Unlock' : 'Lock'}
            active={item.locked}
            disabled={exploring}
            title={exploreHint}
            onClick={() => actions.setLocked(item.id, !item.locked)}
          />
          <ActionTile
            icon="copy"
            label="Copy"
            disabled={exploring}
            title={exploreHint}
            onClick={() => props.onDuplicate(item.id)}
          />
          <ActionTile
            icon="target"
            label="Centre"
            disabled={isWallMounted(item.type) || lockedOff}
            title={
              exploring
                ? NOT_WHILE_EXPLORING
                : isWallMounted(item.type)
                  ? 'Wall-mounted — drag along the wall instead'
                  : item.locked
                    ? 'Locked — unlock to move'
                    : undefined
            }
            onClick={() => actions.moveItem(item.id, 0, 0)}
          />
        </div>

        <div className="pc-sheet-more">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {DIMENSIONS.map((dimension) => (
              <SliderRow
                key={dimension.key}
                label={dimension.label}
                min={dimension.min}
                max={sliderMax(dimension, item)}
                step={0.1}
                value={item[dimension.key]}
                format={(v) => `${v.toFixed(2)} m`}
                onChange={(value) => actions.resizeItem(item.id, dimension.key, value)}
                labelWidth={14}
                uppercaseLabel={false}
                disabled={lockedOff}
                title={offHint('Locked — unlock to resize')}
              />
            ))}
          </div>

          {item.type === 'sofa' && (
            <SofaShapeSegmented
              value={item.sofaShape ?? 'standard'}
              disabled={lockedOff}
              title={offHint('Locked — unlock to reshape')}
              onChange={(shape) => actions.setSofaShape(item.id, shape)}
            />
          )}

          {/* The type-specific controls the Style tab has, where players
              look first (#458). Locked like W/D/H: they reshape the item. */}
          {item.type === 'stairs' && (
            <>
              <SegmentedRow
                label="Stairs"
                value={item.stairsShape ?? 'straight'}
                options={STAIRS_SHAPES}
                labelWidth={TYPE_LABEL_WIDTH}
                disabled={lockedOff}
                title={offHint('Locked — unlock to reshape')}
                onChange={(shape) => actions.setStairsShape(item.id, shape)}
              />
              {item.stairsShape === 'winder' && (
                <SliderRow
                  label="Lead-in"
                  min={0}
                  max={MAX_STAIRS_LEAD_IN}
                  step={1}
                  value={item.stairsLeadIn ?? 0}
                  format={(v) => `${v} ${v === 1 ? 'step' : 'steps'}`}
                  onChange={(value) => actions.setStairsShape(item.id, 'winder', value)}
                  labelWidth={TYPE_LABEL_WIDTH}
                  disabled={lockedOff}
                  title={offHint('Locked — unlock to reshape')}
                />
              )}
            </>
          )}

          {item.type === 'window' && (
            <SliderRow
              label="Sill"
              min={MIN_SILL_HEIGHT}
              max={MAX_SILL_HEIGHT}
              step={0.05}
              value={windowSillHeight(item)}
              format={(v) => `${v.toFixed(2)} m`}
              onChange={(value) => actions.setSillHeight(item.id, value)}
              labelWidth={TYPE_LABEL_WIDTH}
              disabled={lockedOff}
              title={offHint('Locked — unlock to move the sill')}
            />
          )}

          {(item.isWiFiAccessPoint || item.isCCTV) && (
            <SliderRow
              label={item.isWiFiAccessPoint ? 'Signal' : 'Coverage'}
              value={item.signalRange ?? (item.isWiFiAccessPoint ? 10 : 8)}
              min={2}
              max={item.isWiFiAccessPoint ? 20 : 15}
              step={0.5}
              format={(v) => `${v.toFixed(1)} m`}
              onChange={(value) => actions.setSignalRange(item.id, value)}
              disabled={exploring}
              title={exploreHint}
            />
          )}

          {exploring ? (
            // The picker has no disabled state of its own; a disabled
            // fieldset turns off its colour input and swatches.
            <fieldset disabled title={NOT_WHILE_EXPLORING} style={{ border: 0, margin: 0, padding: 0, minWidth: 0, opacity: 0.45 }}>
              {colorPicker}
            </fieldset>
          ) : (
            colorPicker
          )}

          <button
            type="button"
            onClick={() => props.onRemove(item.id)}
            disabled={exploring}
            {...(exploring ? { title: NOT_WHILE_EXPLORING } : {})}
            className="pc-tile"
            style={{
              ...(exploring ? { opacity: 0.4, cursor: 'not-allowed' } : {}),
              width: '100%',
              height: 34,
              borderRadius: 10,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 6,
              color: 'var(--pc-demolish-ink)',
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
    </div>
  );
}

/** Vertical travel on the handle that counts as a swipe rather than a tap. */
const SWIPE_PX = 16;

/**
 * The bottom sheet's grab handle (phones and short screens; hidden by CSS
 * elsewhere). A tap toggles; a swipe up expands, a swipe down collapses.
 */
function SheetHandle({
  expanded,
  onExpandedChange,
}: {
  expanded: boolean;
  onExpandedChange(next: boolean): void;
}): JSX.Element {
  const swipe = useRef<{ y: number; handled: boolean } | null>(null);
  const label = expanded ? 'Show fewer options' : 'Show all options';
  return (
    <button
      type="button"
      className="pc-sheet-handle"
      aria-expanded={expanded}
      aria-label={label}
      title={label}
      onPointerDown={(event) => {
        swipe.current = { y: event.clientY, handled: false };
      }}
      onPointerUp={(event) => {
        const start = swipe.current;
        if (!start) return;
        const dy = event.clientY - start.y;
        if (Math.abs(dy) < SWIPE_PX) return;
        start.handled = true;
        onExpandedChange(dy < 0);
      }}
      onClick={() => {
        const start = swipe.current;
        swipe.current = null;
        if (start?.handled) return;
        onExpandedChange(!expanded);
      }}
    >
      <span aria-hidden className="pc-sheet-handle__bar" />
    </button>
  );
}

interface ActionTileProps {
  icon: PlotcraftIconName;
  label: string;
  onClick(): void;
  active?: boolean | undefined;
  disabled?: boolean | undefined;
  /** Tooltip override — used to explain why a disabled tile can't act. */
  title?: string | undefined;
}

function ActionTile({ icon, label, onClick, active, disabled, title }: ActionTileProps): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title ?? label}
      aria-label={label}
      className={`pc-tile${active ? ' pc-tile--active' : ''}`}
      style={{
        padding: 6,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 2,
        borderRadius: 10,
        ...(disabled ? { opacity: 0.4, cursor: 'not-allowed' } : {}),
      }}
    >
      <Icon name={icon} size={16} />
      <span
        style={{
          fontFamily: 'var(--pc-font-display)',
          fontWeight: 600,
          fontSize: 9,
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

interface SofaShapeSegmentedProps {
  value: SofaShape;
  onChange(value: SofaShape): void;
  disabled?: boolean | undefined;
  title?: string | undefined;
}

const SOFA_SHAPES: ReadonlyArray<SegmentOption<SofaShape>> = [
  { key: 'standard', label: 'Std' },
  { key: 'L-shape', label: 'L' },
  { key: 'U-shape', label: 'U' },
];

/** Label column of the stairs and window rows: wide enough for "Lead-in" on one line. */
const TYPE_LABEL_WIDTH = 58;

const STAIRS_SHAPES: ReadonlyArray<SegmentOption<StairsShape>> = [
  { key: 'straight', label: 'Straight' },
  { key: 'winder', label: 'Winder' },
];

function SofaShapeSegmented({ value, onChange, disabled, title }: SofaShapeSegmentedProps): JSX.Element {
  return (
    <SegmentedRow label="Sofa" value={value} options={SOFA_SHAPES} onChange={onChange} disabled={disabled} title={title} />
  );
}

interface SegmentOption<T extends string> {
  key: T;
  label: string;
}

interface SegmentedRowProps<T extends string> {
  label: string;
  value: T;
  options: ReadonlyArray<SegmentOption<T>>;
  onChange(value: T): void;
  /** Label column width (px). */
  labelWidth?: number;
  disabled?: boolean | undefined;
  /** Tooltip explaining why the row is disabled. */
  title?: string | undefined;
}

function SegmentedRow<T extends string>({ label, value, options, onChange, labelWidth = 48, disabled, title }: SegmentedRowProps<T>): JSX.Element {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <span
        style={{
          width: labelWidth,
          fontFamily: 'var(--pc-font-display)',
          fontWeight: 600,
          fontSize: 10,
          letterSpacing: 'var(--pc-tr-caps)',
          textTransform: 'uppercase',
          color: 'var(--pc-paper-soft)',
        }}
      >
        {label}
      </span>
      <div
        role="group"
        aria-label={label}
        style={{ flex: 1, display: 'grid', gridTemplateColumns: `repeat(${options.length}, 1fr)`, gap: 4 }}
      >
        {options.map((option) => (
          <button
            key={option.key}
            type="button"
            onClick={() => onChange(option.key)}
            aria-pressed={value === option.key}
            disabled={disabled}
            title={title}
            className={`pc-tile${value === option.key ? ' pc-tile--active' : ''}`}
            style={{
              // No opacity: the shape is a value to read, locked or not (#640).
              // The choice keeps its active look; the others step back.
              ...(disabled ? { cursor: 'not-allowed' } : {}),
              ...(disabled && value !== option.key
                ? { borderStyle: 'dashed', boxShadow: 'none', background: 'transparent', color: 'rgba(255, 255, 255, 0.62)' }
                : {}),
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

interface CameraModelCardProps {
  /** Off while exploring (#699). */
  disabled: boolean;
  modelId: string;
  fov: number;
  range: number;
  onPickModel(modelId: string): void;
  onSetFov(value: number): void;
  onSetRange(value: number): void;
}

function CameraModelCard({ disabled, modelId, fov, range, onPickModel, onSetFov, onSetRange }: CameraModelCardProps): JSX.Element {
  const hint = disabled ? NOT_WHILE_EXPLORING : undefined;
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        padding: 10,
        borderRadius: 12,
        background: 'rgba(127,243,255,0.08)',
        border: '1px solid var(--pc-cyan-glow)',
        boxShadow: 'var(--pc-halo-cyan-soft)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <Icon name="vision" size={14} style={{ color: 'var(--pc-cyan-glow)' }} />
        <span
          style={{
            fontFamily: 'var(--pc-font-display)',
            fontWeight: 700,
            fontSize: 11,
            letterSpacing: 'var(--pc-tr-caps)',
            textTransform: 'uppercase',
            color: 'var(--pc-cyan-glow)',
          }}
        >
          Choose a real camera
        </span>
      </div>
      <CctvModelRow value={modelId} onChange={onPickModel} disabled={disabled} />
      <SliderRow
        label="FOV"
        value={fov}
        min={20}
        max={140}
        step={1}
        format={(v) => `${Math.round(v)}°`}
        onChange={onSetFov}
        disabled={disabled}
        title={hint}
      />
      <SliderRow
        label="Range"
        value={range}
        min={2}
        max={100}
        step={0.5}
        format={(v) => `${v.toFixed(1)} m`}
        onChange={onSetRange}
        disabled={disabled}
        title={hint}
      />
    </div>
  );
}

const CCTV_TYPES = ['Dome', 'Bullet', 'PTZ', 'Indoor', 'Battery'] as const;

interface CctvModelRowProps {
  value: string;
  onChange(modelId: string): void;
  disabled: boolean;
}

function CctvModelRow({ value, onChange, disabled }: CctvModelRowProps): JSX.Element {
  const id = useId();
  const selected = getCctvModel(value);
  const spec = selected
    ? `${selected.type} · ${selected.resolution} · ${selected.fov}° · ${selected.range} m IR${selected.note ? ` · ${selected.note}` : ''}`
    : 'Custom — tune FOV and range below';
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <label
        htmlFor={id}
        style={{
          fontFamily: 'var(--pc-font-display)',
          fontWeight: 600,
          fontSize: 10,
          letterSpacing: 'var(--pc-tr-caps)',
          textTransform: 'uppercase',
          color: 'var(--pc-paper-soft)',
        }}
      >
        Camera model
      </label>
      <select
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
        {...(disabled ? { title: NOT_WHILE_EXPLORING } : {})}
        style={{
          ...(disabled ? { opacity: 0.45, cursor: 'not-allowed' } : {}),
          width: '100%',
          padding: '6px 8px',
          borderRadius: 8,
          background: 'rgba(0,0,0,0.30)',
          border: '1px solid rgba(255,255,255,0.12)',
          color: 'var(--pc-paper)',
          fontFamily: 'var(--pc-font-display)',
          fontSize: 11,
        }}
      >
        <option value="">Custom</option>
        {CCTV_TYPES.map((type) => {
          const models = CCTV_MODELS.filter((entry) => entry.type === type);
          if (models.length === 0) return null;
          return (
            <optgroup key={type} label={type}>
              {models.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.brand} {entry.model}
                </option>
              ))}
            </optgroup>
          );
        })}
      </select>
      <span
        style={{
          fontFamily: 'var(--pc-font-body)',
          fontSize: 9.5,
          lineHeight: 1.3,
          color: 'var(--pc-paper-soft)',
        }}
      >
        {spec}
      </span>
    </div>
  );
}

