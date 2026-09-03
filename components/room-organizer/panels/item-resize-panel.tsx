'use client';

import { useId, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useRoomEditor } from '../contexts';
import { useSelection } from '../contexts';
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
  hasCollision: boolean;
  onDuplicate(id: string): void;
}

export function ItemResizePanel(props: ItemResizePanelProps): JSX.Element {
  const { actions, recentColors, pushColor } = useRoomEditor();
  const { selectedItem } = useSelection();
  if (!selectedItem) return <></>;
  const item = selectedItem;
  const rotationDeg = Math.round(((item.rotation ?? 0) * 180) / Math.PI) % 360;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          {item.locked && <span aria-label="Locked">🔒</span>}
          Edit: {item.name}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {DIMENSIONS.map((dimension) => (
          <DimensionSlider
            key={dimension.key}
            item={item}
            dimension={dimension}
            onChange={(value) => actions.resizeItem(item.id, dimension.key, value)}
          />
        ))}

        <RotationInput
          value={rotationDeg}
          onChange={(deg) => actions.setRotation(item.id, (deg * Math.PI) / 180)}
        />

        <PositionInputs
          x={item.position?.x ?? 0}
          z={item.position?.z ?? 0}
          onChange={(x, z) => actions.moveItem(item.id, x, z)}
        />

        <div className="flex gap-2">
          <Button variant="outline" size="sm" className="flex-1 text-xs" onClick={() => actions.toggleMirror(item.id)}>
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
          🎲 Randomize color
        </Button>

        {item.type === 'sofa' && (
          <SofaShapeSelect
            value={item.sofaShape ?? 'standard'}
            onChange={(shape) => actions.setSofaShape(item.id, shape)}
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

        {props.hasCollision && (
          <div className="text-xs text-red-600 bg-red-50 p-2 rounded">⚠️ Item overlaps or is out of bounds!</div>
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
  onChange(x: number, z: number): void;
}

function PositionInputs({ x, z, onChange }: PositionInputsProps): JSX.Element {
  const xId = useId();
  const zId = useId();
  // While a field is being edited, show the raw draft instead of the
  // re-formatted value: feeding toFixed(2) back on every keystroke snapped
  // intermediate states like "-" or "1." away mid-typing (#122). Commit only
  // parseable drafts; blur restores the canonical formatting.
  const [xDraft, setXDraft] = useState<string | null>(null);
  const [zDraft, setZDraft] = useState<string | null>(null);
  return (
    <div className="grid grid-cols-2 gap-2">
      <div>
        <Label htmlFor={xId} className="text-xs">
          X (m)
        </Label>
        <Input
          id={xId}
          type="number"
          step={0.1}
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
  onChange(value: number): void;
}

function RotationInput({ value, onChange }: RotationInputProps): JSX.Element {
  const id = useId();
  return (
    <div>
      <Label htmlFor={id} className="text-xs">
        Rotation (°)
      </Label>
      <Input
        id={id}
        type="number"
        min={0}
        max={359}
        step={5}
        value={value}
        onChange={(event) => {
          const parsed = parseFloat(event.target.value);
          if (Number.isFinite(parsed)) onChange(((parsed % 360) + 360) % 360);
        }}
      />
    </div>
  );
}

interface DimensionSliderProps {
  item: FurnitureItem;
  dimension: DimensionConfig;
  onChange(value: number): void;
}

function DimensionSlider({ item, dimension, onChange }: DimensionSliderProps): JSX.Element {
  const inputId = useId();
  const value = item[dimension.key];
  return (
    <div>
      <Label htmlFor={inputId} className="text-xs">
        {dimension.label}: {value.toFixed(2)}m
      </Label>
      <Input
        id={inputId}
        type="range"
        min={dimension.min}
        max={dimension.max}
        step="0.1"
        value={value}
        onChange={(event) => onChange(parseFloat(event.target.value))}
        className="w-full"
      />
    </div>
  );
}

interface SofaShapeSelectProps {
  value: SofaShape;
  onChange(value: SofaShape): void;
}

function SofaShapeSelect({ value, onChange }: SofaShapeSelectProps): JSX.Element {
  const id = useId();
  return (
    <div>
      <Label htmlFor={id} className="text-xs">
        Sofa Shape
      </Label>
      <Select value={value} onValueChange={(next) => onChange(next as SofaShape)}>
        <SelectTrigger id={id} className="w-full text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="standard">Standard Sofa</SelectItem>
          <SelectItem value="L-shape">L-Shape Sofa</SelectItem>
          <SelectItem value="U-shape">U-Shape Sofa</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}

interface SignalRangeSliderProps {
  label: string;
  min: number;
  max: number;
  value: number;
  onChange(value: number): void;
}

function SignalRangeSlider({ label, min, max, value, onChange }: SignalRangeSliderProps): JSX.Element {
  const id = useId();
  return (
    <div>
      <Label htmlFor={id} className="text-xs">
        {label}: {value.toFixed(1)}m
      </Label>
      <Input
        id={id}
        type="range"
        min={min}
        max={max}
        step="0.5"
        value={value}
        onChange={(event) => onChange(parseFloat(event.target.value))}
        className="w-full"
      />
    </div>
  );
}
