'use client';

import { useId, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useRoomEditor } from '../contexts';
import { DEFAULT_FLOOR_PLAN_OPACITY } from '../lib/constants';
import { MAX_NAME_LENGTH } from '../lib/schema';
import { MAX_STOREY_HEIGHT, MIN_STOREY_HEIGHT, storeyHeight } from '../lib/storeys';
import type { FloorPlanFitMode } from '../lib/types';

const ROOM_INPUT_MIN = 2;
const ROOM_INPUT_MAX = 20;

const FIT_MODE_HINTS: Record<FloorPlanFitMode, string> = {
  stretch: '↔️ Stretches image to fill entire room',
  cover: '📐 Covers room, may crop image',
  contain: '🖼️ Shows full image, may have gaps',
};

export interface RoomSettingsPanelProps {
  onFloorPlanUpload(file: File): void;
}

export function RoomSettingsPanel({ onFloorPlanUpload }: RoomSettingsPanelProps): JSX.Element {
  const { layout, activeFloor, actions, view, setView } = useRoomEditor();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const nameId = useId();
  const widthId = useId();
  const heightId = useId();
  const storeyId = useId();
  const colorId = useId();
  const opacityId = useId();
  const effectId = useId();
  const fitModeId = useId();
  const fileInputId = useId();

  const handleFile = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) onFloorPlanUpload(file);
    event.target.value = '';
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Room Settings</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <Label htmlFor={nameId}>Layout Name</Label>
          <Input
            id={nameId}
            value={layout.name}
            maxLength={MAX_NAME_LENGTH}
            onChange={(e) => actions.setName(e.target.value)}
            placeholder="My Room"
          />
        </div>
        <div>
          <Label htmlFor={widthId}>Width (meters)</Label>
          <RoomDimensionInput id={widthId} value={layout.width} onCommit={actions.setWidth} />
        </div>
        <div>
          <Label htmlFor={heightId}>Depth (meters)</Label>
          <RoomDimensionInput id={heightId} value={layout.height} onCommit={actions.setHeight} />
        </div>
        <div>
          <Label htmlFor={storeyId}>Storey height (meters)</Label>
          <div className="flex items-center gap-2">
            <RoomDimensionInput
              id={storeyId}
              value={storeyHeight(activeFloor)}
              onCommit={actions.setStoreyHeight}
              min={MIN_STOREY_HEIGHT}
              max={MAX_STOREY_HEIGHT}
              step={0.1}
            />
            {activeFloor.height !== undefined && (
              <Button
                variant="outline"
                size="sm"
                className="text-xs shrink-0"
                onClick={() => actions.setStoreyHeight(null)}
                title="Back to the standard 3 m storey"
              >
                Reset
              </Button>
            )}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {activeFloor.name}, floor to floor. Try 2.5 for a basement or 1.1 for a loft knee wall.
          </p>
        </div>
        <div>
          <Label htmlFor={colorId}>Floor Color</Label>
          <Input
            id={colorId}
            type="color"
            value={activeFloor.floorColor}
            onChange={(e) => actions.setFloorColor(e.target.value)}
          />
        </div>

        <div className="pt-2 border-t">
          <Label className="text-sm font-medium">Floor Plan Image</Label>
          <div className="mt-2 space-y-2">
            {layout.floorPlanImage ? (
              <>
                <div className="text-xs text-muted-foreground bg-green-50 p-2 rounded">✓ Floor plan uploaded</div>
                <div>
                  <Label htmlFor={opacityId} className="text-xs">
                    Opacity: {((layout.floorPlanOpacity ?? DEFAULT_FLOOR_PLAN_OPACITY) * 100).toFixed(0)}%
                  </Label>
                  <Input
                    id={opacityId}
                    type="range"
                    min="0"
                    max="1"
                    step="0.05"
                    value={layout.floorPlanOpacity ?? DEFAULT_FLOOR_PLAN_OPACITY}
                    onChange={(e) => actions.setFloorPlanOpacity(parseFloat(e.target.value))}
                    className="w-full"
                  />
                </div>
                <div className="flex items-center space-x-2 pt-2">
                  <input
                    id={effectId}
                    type="checkbox"
                    checked={view.floorPlan3DEffect}
                    onChange={(e) => setView((v) => ({ ...v, floorPlan3DEffect: e.target.checked }))}
                    className="w-4 h-4 rounded border-gray-300"
                  />
                  <Label htmlFor={effectId} className="text-xs cursor-pointer">
                    Enable 3D Displacement Effect
                  </Label>
                </div>
                <p className="text-xs text-muted-foreground">
                  Creates height variations based on the floor plan image brightness
                </p>

                <div>
                  <Label htmlFor={fitModeId} className="text-xs">
                    Fit Mode
                  </Label>
                  <Select
                    value={layout.floorPlanFitMode ?? 'stretch'}
                    onValueChange={(value) => actions.setFloorPlanFitMode(value as FloorPlanFitMode)}
                  >
                    <SelectTrigger id={fitModeId} className="w-full text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="stretch">Stretch (Fill Room)</SelectItem>
                      <SelectItem value="cover">Cover (No Gaps)</SelectItem>
                      <SelectItem value="contain">Contain (Show All)</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground mt-1">
                    {FIT_MODE_HINTS[layout.floorPlanFitMode ?? 'stretch']}
                  </p>
                </div>

                <Button onClick={() => actions.setFloorPlan(null)} variant="outline" size="sm" className="w-full text-xs">
                  Remove Floor Plan
                </Button>
              </>
            ) : (
              <>
                <input
                  ref={fileInputRef}
                  id={fileInputId}
                  type="file"
                  accept="image/*"
                  onChange={handleFile}
                  className="hidden"
                />
                <Button
                  onClick={() => fileInputRef.current?.click()}
                  variant="outline"
                  size="sm"
                  className="w-full text-xs"
                >
                  📤 Upload Floor Plan
                </Button>
                <p className="text-xs text-muted-foreground">Upload an image to overlay on your room layout</p>
              </>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export interface RoomDimensionInputProps {
  id: string;
  value: number;
  onCommit(value: number): void;
  /** Accepted range and spinner step; default to the room footprint's. */
  min?: number;
  max?: number;
  step?: number;
}

/**
 * A room Width/Depth field that never resizes the room to a mid-typing
 * value (#217). Same draft-string approach as the item X/Z inputs (#122):
 * keystrokes update a local draft and only an in-range parse is applied
 * live, so clearing the field or passing through "1" on the way to "12"
 * leaves the room alone. Blur or Enter commits the draft clamped to the
 * declared range; an empty or unparseable draft restores the current value.
 */
export function RoomDimensionInput({
  id,
  value,
  onCommit,
  min = ROOM_INPUT_MIN,
  max = ROOM_INPUT_MAX,
  step = 0.5,
}: RoomDimensionInputProps): JSX.Element {
  const [draft, setDraft] = useState<string | null>(null);

  const finish = () => {
    if (draft !== null) {
      const parsed = parseFloat(draft);
      if (Number.isFinite(parsed)) {
        const clamped = Math.min(max, Math.max(min, parsed));
        if (clamped !== value) onCommit(clamped);
      }
    }
    setDraft(null);
  };

  return (
    <Input
      id={id}
      type="number"
      min={min}
      max={max}
      step={step}
      value={draft ?? value}
      onChange={(event) => {
        setDraft(event.target.value);
        // Typed digits wait for blur/Enter: typing "20" passes through 2, and
        // a footprint change re-fits openings and zones, which 20 can't undo
        // (#431). Spinner and arrow-key steps (no inputType) apply at once.
        if ((event.nativeEvent as InputEvent).inputType) return;
        const parsed = parseFloat(event.target.value);
        // Same guard as blur: re-typing the current value is not an edit (#279).
        if (Number.isFinite(parsed) && parsed >= min && parsed <= max && parsed !== value) {
          onCommit(parsed);
        }
      }}
      onBlur={finish}
      onKeyDown={(event) => {
        if (event.key === 'Enter') event.currentTarget.blur();
      }}
    />
  );
}
