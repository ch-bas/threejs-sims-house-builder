'use client';

import { useId } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { FurnitureItem, SofaShape } from '../lib/types';
import { useRoomEditor } from '../contexts';
import { useSelection } from '../contexts';

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

export interface ItemResizePanelProps {
  hasCollision: boolean;
  onDuplicate(id: string): void;
}

export function ItemResizePanel(props: ItemResizePanelProps): JSX.Element {
  const { actions, recentColors, pushColor, layout, activeFloor } = useRoomEditor();
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

        <ColorPicker
          value={item.color}
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
  const parseOrFallback = (raw: string, fallback: number) => {
    const parsed = parseFloat(raw);
    return Number.isFinite(parsed) ? parsed : fallback;
  };
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
          value={x.toFixed(2)}
          onChange={(event) => onChange(parseOrFallback(event.target.value, x), z)}
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
          value={z.toFixed(2)}
          onChange={(event) => onChange(x, parseOrFallback(event.target.value, z))}
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

interface ColorPickerProps {
  value: string;
  recent: readonly string[];
  onChange(color: string): void;
  onCommit(color: string): void;
}

function ColorPicker({ value, recent, onChange, onCommit }: ColorPickerProps): JSX.Element {
  const inputId = useId();
  return (
    <div className="space-y-2">
      <Label htmlFor={inputId} className="text-xs">
        Color
      </Label>
      <div className="flex items-center gap-2">
        <input
          id={inputId}
          type="color"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onBlur={(event) => onCommit(event.target.value)}
          className="h-8 w-10 rounded border cursor-pointer"
        />
        <div className="flex flex-wrap gap-1">
          {COLOR_SWATCHES.map((swatch) => (
            <button
              key={swatch}
              type="button"
              aria-label={`Use color ${swatch}`}
              onClick={() => onChange(swatch)}
              className={`h-5 w-5 rounded-full border ${
                value.toLowerCase() === swatch.toLowerCase() ? 'ring-2 ring-primary' : ''
              }`}
              style={{ backgroundColor: swatch }}
            />
          ))}
        </div>
      </div>
      {recent.length > 0 && (
        <div>
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Recent</p>
          <div className="flex flex-wrap gap-1 mt-1">
            {recent.map((swatch) => (
              <button
                key={swatch}
                type="button"
                aria-label={`Reuse colour ${swatch}`}
                onClick={() => onChange(swatch)}
                className={`h-5 w-5 rounded border ${
                  value.toLowerCase() === swatch.toLowerCase() ? 'ring-2 ring-primary' : ''
                }`}
                style={{ backgroundColor: swatch }}
              />
            ))}
          </div>
        </div>
      )}
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
