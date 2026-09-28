'use client';

import { useId } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useRoomEditor } from '../contexts';
import { ROOF_STYLE_DEFAULT_COLORS } from '../lib/constants';
import {
  DORMER_PRESET_LABELS,
  MAX_DORMER_WIDTH,
  MAX_DORMERS,
  MIN_DORMER_WIDTH,
  dormerPresetFields,
  dormerPresetOf,
  roofSlopeSides,
  type DormerPreset,
} from '../lib/dormers';
import { ROOF_LABELS } from '../three/roof';
import { RoomDimensionInput } from './room-settings-panel';
import type { DormerSpec, RoofStyle, WallId } from '../lib/types';

const ROOF_STYLES: ReadonlyArray<RoofStyle> = ['none', 'flat', 'gable', 'hipped'];

export function RoofPanel(): JSX.Element {
  const { layout, actions } = useRoomEditor();
  const style = layout.roof?.style ?? 'none';
  // Show what the roof actually renders in when it has no colour of its own.
  const color = layout.roof?.color ?? ROOF_STYLE_DEFAULT_COLORS[style];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">🏠 Roof</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div>
          <Label className="text-xs">Style</Label>
          <Select value={style} onValueChange={(value) => actions.setRoofStyle(value as RoofStyle)}>
            <SelectTrigger className="text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ROOF_STYLES.map((option) => (
                <SelectItem key={option} value={option}>
                  {ROOF_LABELS[option]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {style !== 'none' && (
          <div>
            <Label className="text-xs">Colour</Label>
            <Input
              type="color"
              value={color}
              onChange={(event) => actions.setRoofColor(event.target.value)}
              className="h-8 w-full"
            />
          </div>
        )}
        {(style === 'gable' || style === 'hipped') && <DormersSection />}
        <p className="text-[10px] text-muted-foreground">
          The roof sits on top of the highest floor. Gable sheds along the longer side.
        </p>
      </CardContent>
    </Card>
  );
}

const SIDE_LABELS: Record<WallId, string> = { north: 'North (street)', south: 'South (garden)', east: 'East', west: 'West' };
const PRESETS = Object.keys(DORMER_PRESET_LABELS) as DormerPreset[];

/** Roof dormers (#203): one row of controls per dormer, on the slopes this roof has. */
function DormersSection(): JSX.Element {
  const { layout, actions } = useRoomEditor();
  const style = layout.roof?.style ?? 'none';
  const dormers = layout.roof?.dormers ?? [];
  const sides = roofSlopeSides(style, layout.width, layout.height);
  // Rear (garden) dormers first, the usual loft conversion.
  const defaultSide = sides.includes('south') ? 'south' : sides[0];

  return (
    <div className="space-y-2 border-t pt-2">
      <div className="flex items-center justify-between">
        <Label className="text-xs">Dormers</Label>
        <Button
          variant="outline"
          size="sm"
          className="text-xs"
          disabled={!defaultSide || dormers.length >= MAX_DORMERS}
          onClick={() => {
            if (!defaultSide) return;
            actions.addDormer({ side: defaultSide, width: 2, ...dormerPresetFields('juliet') });
          }}
        >
          Add dormer
        </Button>
      </div>
      {dormers.map((dormer, index) => (
        <DormerRow key={dormer.id} dormer={dormer} index={index} sides={sides} />
      ))}
    </div>
  );
}

function DormerRow({ dormer, index, sides }: { dormer: DormerSpec; index: number; sides: readonly WallId[] }): JSX.Element {
  const { actions } = useRoomEditor();
  const widthId = useId();
  const offsetId = useId();
  const preset = dormerPresetOf(dormer);
  const onSlope = sides.includes(dormer.side);

  return (
    <div className="space-y-2 rounded-md border p-2" aria-label={`Dormer ${index + 1}`} role="group">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium">Dormer {index + 1}</span>
        <Button variant="ghost" size="sm" className="text-xs" onClick={() => actions.removeDormer(dormer.id)}>
          Remove
        </Button>
      </div>
      <Select value={dormer.side} onValueChange={(value) => actions.updateDormer(dormer.id, { side: value as WallId })}>
        <SelectTrigger className="text-xs" aria-label="Slope">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {sides.map((side) => (
            <SelectItem key={side} value={side}>
              {SIDE_LABELS[side]}
            </SelectItem>
          ))}
          {!onSlope && (
            <SelectItem value={dormer.side} disabled>
              {SIDE_LABELS[dormer.side]} (no slope)
            </SelectItem>
          )}
        </SelectContent>
      </Select>
      <Select
        value={preset ?? 'custom'}
        onValueChange={(value) => actions.updateDormer(dormer.id, dormerPresetFields(value as DormerPreset))}
      >
        <SelectTrigger className="text-xs" aria-label="Face">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {PRESETS.map((option) => (
            <SelectItem key={option} value={option}>
              {DORMER_PRESET_LABELS[option]}
            </SelectItem>
          ))}
          {preset === null && (
            <SelectItem value="custom" disabled>
              Custom openings
            </SelectItem>
          )}
        </SelectContent>
      </Select>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <Label htmlFor={widthId} className="text-[10px]">
            Width (m)
          </Label>
          <RoomDimensionInput
            id={widthId}
            value={dormer.width}
            onCommit={(width) => actions.updateDormer(dormer.id, { width })}
            min={MIN_DORMER_WIDTH}
            max={MAX_DORMER_WIDTH}
            step={0.1}
          />
        </div>
        <div>
          <Label htmlFor={offsetId} className="text-[10px]">
            Offset (m)
          </Label>
          <RoomDimensionInput
            id={offsetId}
            value={dormer.offset ?? 0}
            onCommit={(offset) => actions.updateDormer(dormer.id, { offset })}
            min={-20}
            max={20}
            step={0.1}
          />
        </div>
      </div>
      <Input
        type="color"
        aria-label="Dormer finish"
        value={dormer.color ?? '#ece6da'}
        onChange={(event) => actions.updateDormer(dormer.id, { color: event.target.value })}
        className="h-8 w-full"
      />
    </div>
  );
}
