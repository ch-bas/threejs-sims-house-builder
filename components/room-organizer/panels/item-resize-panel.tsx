'use client';

import { useId, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { useRoomEditor } from '../contexts';
import { useSelection } from '../contexts';
import { FURNITURE_CATALOG } from '../lib/constants';
import { formatMetres } from '../lib/format';
import { isWallMounted } from '../lib/opening-snap';
import { MAX_STAIRS_LEAD_IN } from '../lib/stairs';
import { MAX_SILL_HEIGHT, MIN_SILL_HEIGHT, windowSillHeight } from '../lib/street';
import { COLOR_SWATCHES, ColorSwatchPicker } from './color-swatch-picker';
import type { FurnitureItem, SofaShape } from '../lib/types';

type ResizableDimension = 'width' | 'depth' | 'height';

interface DimensionConfig {
  label: string;
  key: ResizableDimension;
  min: number;
  max: number;
}

const DIMENSIONS: readonly DimensionConfig[] = [
  { label: 'Width', key: 'width', min: 0.1, max: 5 },
  { label: 'Depth', key: 'depth', min: 0.1, max: 5 },
  { label: 'Height', key: 'height', min: 0.1, max: 3 },
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

function randomHexColor(): string {
  const hue = Math.floor(Math.random() * 360);
  const saturation = 55 + Math.floor(Math.random() * 30);
  const lightness = 35 + Math.floor(Math.random() * 40);
  return hslToHex(hue, saturation, lightness);
}

function hslToHex(h: number, s: number, l: number): string {
  const sat = s / 100;
  const lit = l / 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = sat * Math.min(lit, 1 - lit);
  const f = (n: number) => lit - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  const toHex = (value: number) => Math.round(value * 255).toString(16).padStart(2, '0');
  return `#${toHex(f(0))}${toHex(f(8))}${toHex(f(4))}`;
}

export interface ItemResizePanelProps {
  /** Why the item shows red, as a sentence; null when it stands clear (#627). */
  collision: string | null;
  onDuplicate(id: string): void;
}

export function ItemResizePanel(props: ItemResizePanelProps): JSX.Element {
  const { actions, recentColors, pushColor } = useRoomEditor();
  const { selectedItem } = useSelection();
  if (!selectedItem) return <></>;
  const item = selectedItem;
  // Stored rotations can be negative (the studio sofa is -π/2); the input is
  // min=0, so normalise to 0–359 like the onChange path does (#387).
  const rotationDeg = ((Math.round(((item.rotation ?? 0) * 180) / Math.PI) % 360) + 360) % 360;
  // The reducer refuses geometry mutations on locked items (#209) — mirror
  // that here so the controls look inert instead of silently no-opping.
  const locked = item.locked === true;
  const lockedTitle = locked ? 'Locked — unlock to edit' : undefined;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          {item.locked && <span role="img" aria-label="Locked">🔒</span>}
          Edit: {item.name}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {DIMENSIONS.map((dimension) => (
          <DimensionSlider
            key={dimension.key}
            item={item}
            dimension={dimension}
            disabled={locked}
            title={lockedTitle}
            onChange={(value) => actions.resizeItem(item.id, dimension.key, value)}
          />
        ))}

        <RotationInput
          value={rotationDeg}
          disabled={locked}
          title={lockedTitle}
          onChange={(deg) => actions.setRotation(item.id, (deg * Math.PI) / 180)}
        />

        <PositionInputs
          x={item.position?.x ?? 0}
          z={item.position?.z ?? 0}
          disabled={locked}
          title={lockedTitle}
          onChange={(x, z) => actions.moveItem(item.id, x, z)}
        />

        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            className="flex-1 text-xs"
            disabled={locked}
            title={lockedTitle}
            onClick={() => actions.toggleMirror(item.id)}
          >
            🪞 {item.mirrored ? 'Unmirror' : 'Mirror'}
          </Button>
          <Button
            variant={item.locked ? 'default' : 'outline'}
            size="sm"
            className="flex-1 text-xs"
            onClick={() => actions.setLocked(item.id, !item.locked)}
          >
            {item.locked ? '🔒 Unlock' : '🔓 Lock'}
          </Button>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="w-full text-xs"
          disabled={locked || isWallMounted(item.type)}
          title={
            isWallMounted(item.type)
              ? 'Wall-mounted — drag along the wall instead'
              : lockedTitle
          }
          onClick={() => actions.moveItem(item.id, 0, 0)}
        >
          🎯 Centre in room
        </Button>

        <ColorSwatchPicker
          variant="card"
          value={item.color}
          swatches={COLOR_SWATCHES}
          recent={recentColors}
          onChange={(color) => actions.setColor(item.id, color)}
          onCommit={(color) => pushColor(color)}
        />
        <Button
          size="sm"
          variant="ghost"
          onClick={() => actions.setColor(item.id, randomHexColor())}
          className="text-xs w-full"
        >
          🎲 Randomise colour
        </Button>

        {item.type === 'sofa' && (
          <SofaShapeSelect
            value={item.sofaShape ?? 'standard'}
            disabled={locked}
            title={lockedTitle}
            onChange={(shape) => actions.setSofaShape(item.id, shape)}
          />
        )}

        {item.type === 'stairs' && (
          <div className="space-y-2">
            <div className="grid grid-cols-2 gap-2" role="group" aria-label="Stairs shape">
              {(['straight', 'winder'] as const).map((shape) => {
                const active = (item.stairsShape ?? 'straight') === shape;
                return (
                  <Button
                    key={shape}
                    variant={active ? 'default' : 'outline'}
                    size="sm"
                    className="text-xs"
                    aria-pressed={active}
                    disabled={locked}
                    title={lockedTitle}
                    onClick={() => actions.setStairsShape(item.id, shape)}
                  >
                    {shape === 'straight' ? 'Straight' : 'Winder'}
                  </Button>
                );
              })}
            </div>
            {item.stairsShape === 'winder' && (
              <SignalRangeSlider
                label="Up-flight lead-in (steps)"
                min={0}
                max={MAX_STAIRS_LEAD_IN}
                step={1}
                value={item.stairsLeadIn ?? 0}
                format={(value) => `${value}`}
                disabled={locked}
                title={lockedTitle}
                onChange={(value) => actions.setStairsShape(item.id, 'winder', value)}
              />
            )}
          </div>
        )}

        {item.type === 'window' && (
          <SignalRangeSlider
            label="Sill height"
            min={MIN_SILL_HEIGHT}
            max={MAX_SILL_HEIGHT}
            step={0.05}
            value={windowSillHeight(item)}
            disabled={locked}
            title={lockedTitle}
            onChange={(value) => actions.setSillHeight(item.id, value)}
          />
        )}

        {item.isWiFiAccessPoint && (
          <SignalRangeSlider
            label="Signal Range"
            min={2}
            max={20}
            value={item.signalRange ?? 10}
            onChange={(value) => actions.setSignalRange(item.id, value)}
          />
        )}

        {item.isCCTV && (
          <SignalRangeSlider
            label="Coverage Range"
            min={2}
            max={15}
            value={item.signalRange ?? 8}
            onChange={(value) => actions.setSignalRange(item.id, value)}
          />
        )}

        {props.collision !== null && (
          <div className="text-xs text-red-600 bg-red-50 p-2 rounded">⚠️ {props.collision}</div>
        )}

        <div className="pt-2 border-t">
          <Button
            onClick={() => props.onDuplicate(item.id)}
            variant="outline"
            className="w-full text-xs"
            size="sm"
          >
            📋 Duplicate Item
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

interface PositionInputsProps {
  x: number;
  z: number;
  disabled?: boolean;
  title?: string | undefined;
  onChange(x: number, z: number): void;
}

function PositionInputs({ x, z, disabled, title, onChange }: PositionInputsProps): JSX.Element {
  const xId = useId();
  const zId = useId();
  // While a field is being edited, show the raw draft instead of the
  // re-formatted value: feeding toFixed(2) back on every keystroke snapped
  // intermediate states like "-" or "1." away mid-typing (#122). Commit only
  // parseable drafts; blur restores the canonical formatting.
  const [xDraft, setXDraft] = useState<string | null>(null);
  const [zDraft, setZDraft] = useState<string | null>(null);
  return (
    <div className={`grid grid-cols-2 gap-2${disabled ? ' opacity-50' : ''}`} title={title}>
      <div>
        <Label htmlFor={xId} className="text-xs">
          X (m)
        </Label>
        <Input
          id={xId}
          type="number"
          step={0.1}
          disabled={disabled}
          value={xDraft ?? x.toFixed(2)}
          onChange={(event) => {
            setXDraft(event.target.value);
            const parsed = parseFloat(event.target.value);
            if (Number.isFinite(parsed)) onChange(parsed, z);
          }}
          onBlur={() => setXDraft(null)}
        />
      </div>
      <div>
        <Label htmlFor={zId} className="text-xs">
          Z (m)
        </Label>
        <Input
          id={zId}
          type="number"
          step={0.1}
          disabled={disabled}
          value={zDraft ?? z.toFixed(2)}
          onChange={(event) => {
            setZDraft(event.target.value);
            const parsed = parseFloat(event.target.value);
            if (Number.isFinite(parsed)) onChange(x, parsed);
          }}
          onBlur={() => setZDraft(null)}
        />
      </div>
    </div>
  );
}

interface RotationInputProps {
  value: number;
  disabled?: boolean;
  title?: string | undefined;
  onChange(value: number): void;
}

/** Degrees in 0–359, as the field shows them; 359.6 rounds round to 0. */
function wholeDegrees(degrees: number): number {
  return ((Math.round(degrees) % 360) + 360) % 360;
}

function RotationInput({ value, disabled, title, onChange }: RotationInputProps): JSX.Element {
  const id = useId();
  // The raw text while typing, as in PositionInputs (#122): writing the
  // normalised value back on each keystroke turned "-90" into 270 by way of
  // 351 (#548). `sent` is the value this text gave the store, so a rotation
  // that comes from elsewhere replaces the draft instead of hiding behind it.
  const [draft, setDraft] = useState<{ text: string; sent: number } | null>(null);
  return (
    <div title={title} className={disabled ? 'opacity-50' : undefined}>
      <Label htmlFor={id} className="text-xs">
        Rotation (°)
      </Label>
      <Input
        id={id}
        type="number"
        min={0}
        max={359}
        step={5}
        disabled={disabled}
        value={draft?.sent === value ? draft.text : value}
        onChange={(event) => {
          const parsed = parseFloat(event.target.value);
          const finite = Number.isFinite(parsed);
          setDraft({ text: event.target.value, sent: finite ? wholeDegrees(parsed) : value });
          if (finite) onChange(((parsed % 360) + 360) % 360);
        }}
        onBlur={() => setDraft(null)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') setDraft(null);
        }}
      />
    </div>
  );
}

interface DimensionSliderProps {
  item: FurnitureItem;
  dimension: DimensionConfig;
  disabled?: boolean;
  title?: string | undefined;
  onChange(value: number): void;
}

function DimensionSlider({ item, dimension, disabled, title, onChange }: DimensionSliderProps): JSX.Element {
  const inputId = useId();
  const value = item[dimension.key];
  return (
    <div title={title} className={disabled ? 'opacity-50' : undefined}>
      <Label htmlFor={inputId} className="text-xs">
        {dimension.label}: {formatMetres(value, 2)}
      </Label>
      <Input
        id={inputId}
        type="range"
        min={dimension.min}
        max={sliderMax(dimension, item)}
        step="0.1"
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(parseFloat(event.target.value))}
        className="w-full"
      />
    </div>
  );
}

interface SofaShapeSelectProps {
  value: SofaShape;
  onChange(value: SofaShape): void;
  disabled?: boolean;
  title?: string | undefined;
}

function SofaShapeSelect({ value, onChange, disabled, title }: SofaShapeSelectProps): JSX.Element {
  const id = useId();
  return (
    <div title={title}>
      <Label htmlFor={id} className="text-xs">
        Sofa Shape
      </Label>
      <Select
        id={id}
        value={value}
        disabled={disabled}
        onValueChange={(next) => onChange(next as SofaShape)}
        className="w-full text-xs"
      >
        <option value="standard">Standard Sofa</option>
        <option value="L-shape">L-Shape Sofa</option>
        <option value="U-shape">U-Shape Sofa</option>
      </Select>
    </div>
  );
}

interface SignalRangeSliderProps {
  label: string;
  min: number;
  max: number;
  step?: number;
  value: number;
  disabled?: boolean;
  title?: string | undefined;
  /** How the value reads in the label; metres by default. */
  format?(value: number): string;
  onChange(value: number): void;
}

function SignalRangeSlider({
  label,
  min,
  max,
  step = 0.5,
  value,
  disabled,
  title,
  format = (v) => formatMetres(v, 1),
  onChange,
}: SignalRangeSliderProps): JSX.Element {
  const id = useId();
  return (
    <div>
      <Label htmlFor={id} className="text-xs">
        {label}: {format(value)}
      </Label>
      <Input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        title={title}
        onChange={(event) => onChange(parseFloat(event.target.value))}
        className="w-full"
      />
    </div>
  );
}
