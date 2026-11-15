'use client';

import { useId } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { useLengthUnit, useRoomEditor, useViewSettings } from '../contexts';
import { ROOF_STYLE_DEFAULT_COLORS } from '../lib/constants';
import { PITCHED_OVER_CUTOUT_REFUSAL, roofCoversCutout } from '../lib/cutout';
import {
  DORMER_PRESET_LABELS,
  MAX_DORMER_WIDTH,
  MAX_DORMERS,
  MIN_DORMER_WIDTH,
  dormerMaxWidth,
  dormerOffsetRange,
  dormerPresetFields,
  dormerPresetOf,
  roofSlopeSides,
  unfittedDormers,
  type DormerPreset,
} from '../lib/dormers';
import { lengthUnitSymbol } from '../lib/format';
import { DEFAULT_ROOF_PITCH, MAX_ROOF_PITCH, MIN_ROOF_PITCH, partyWallsHoldRidge, ridgeAlongX, roofPitchDegrees } from '../lib/roof-shape';
import { buildingHeight } from '../lib/storeys';
import { ROOF_LABELS } from '../three/roof';
import { RoomDimensionInput } from './room-settings-panel';
import type { DormerSpec, RoofRidge, RoofStyle, WallId } from '../lib/types';

const ROOF_STYLES: ReadonlyArray<RoofStyle> = ['none', 'flat', 'gable', 'hipped'];

export function RoofPanel(): JSX.Element {
  const { layout, actions } = useRoomEditor();
  const view = useViewSettings('view2D');
  const style = layout.roof?.style ?? 'none';
  // Show what the roof actually renders in when it has no colour of its own.
  const color = layout.roof?.color ?? ROOF_STYLE_DEFAULT_COLORS[style];
  const id = useId();

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">🏠 Roof</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* The plan draws no roof or dormers: say so instead of letting the
            controls look broken, but keep them live — the 3D view shows the
            result on the way back (#289). */}
        {view.view2D && (
          <p className="text-[10px] text-muted-foreground" role="note">
            Shown in the 3D view only.
          </p>
        )}
        <div>
          <Label htmlFor={`${id}-style`} className="text-xs">Style</Label>
          <Select
            id={`${id}-style`}
            value={style}
            onValueChange={(value) => actions.setRoofStyle(value as RoofStyle)}
            className="text-xs"
            aria-label="Roof style"
          >
            {ROOF_STYLES.map((option) => (
              <option key={option} value={option} disabled={!!layout.cutout && !roofCoversCutout(option)}>
                {ROOF_LABELS[option]}
              </option>
            ))}
          </Select>
          {layout.cutout && (
            <p className="mt-1 text-[10px] text-muted-foreground" role="note">
              {PITCHED_OVER_CUTOUT_REFUSAL}
            </p>
          )}
        </div>
        {style !== 'none' && (
          <div>
            <Label htmlFor={`${id}-colour`} className="text-xs">Colour</Label>
            <Input
              id={`${id}-colour`}
              type="color"
              value={color}
              onChange={(event) => actions.setRoofColor(event.target.value)}
              className="h-8 w-full"
            />
          </div>
        )}
        {(style === 'gable' || style === 'hipped') && <RoofShapeControls />}
        {(style === 'gable' || style === 'hipped') && <DormersSection />}
        <p className="text-[10px] text-muted-foreground">
          The roof sits on top of the highest floor. A gable&apos;s ridge runs along the longer side unless you turn it.
        </p>
      </CardContent>
    </Card>
  );
}

const RIDGE_LABELS: Record<RoofRidge, string> = { x: 'East–west', z: 'North–south' };
const AUTO_RIDGE = 'auto';

/** Pitch for a gable or hipped roof, and which way a gable's ridge runs (#916). */
function RoofShapeControls(): JSX.Element | null {
  const { layout, actions } = useRoomEditor();
  const id = useId();
  const roof = layout.roof;
  if (!roof) return null;
  const pitch = roof.pitch ?? DEFAULT_ROOF_PITCH;
  const degrees = `${Math.round(roofPitchDegrees(roof, layout.width, layout.height))}°`;
  const longer: RoofRidge = ridgeAlongX('gable', layout.width, layout.height) ? 'x' : 'z';
  // Attached houses east or west rule out a north–south ridge (the reducer refuses it).
  const terrace = partyWallsHoldRidge(layout.neighbours);
  const unfitted = unfittedDormers(roof, layout.width, layout.height).length;
  // Picking the axis the longer side gives keeps it there when the house is resized.
  const axisLabel = (axis: RoofRidge) => `${RIDGE_LABELS[axis]}${axis === longer ? ' (pinned)' : ''}`;
  return (
    <div className="space-y-2">
      <div>
        <Label htmlFor={`${id}-pitch`} className="text-xs">
          Pitch: {degrees}
        </Label>
        <Input
          id={`${id}-pitch`}
          type="range"
          min={MIN_ROOF_PITCH}
          max={MAX_ROOF_PITCH}
          step={0.05}
          value={pitch}
          aria-valuetext={degrees}
          onChange={(event) => actions.setRoofPitch(parseFloat(event.target.value))}
          className="w-full"
        />
        {unfitted > 0 && (
          <p className="mt-1 text-[10px] text-muted-foreground" role="note">
            {unfitted === 1 ? 'A dormer doesn’t fit at this pitch.' : 'Some dormers don’t fit at this pitch.'} Raise the pitch, or make the dormer lower.
          </p>
        )}
      </div>
      {roof.style === 'gable' && (
        <div>
          <Label htmlFor={`${id}-ridge`} className="text-xs">Ridge</Label>
          <Select
            id={`${id}-ridge`}
            value={roof.ridge ?? AUTO_RIDGE}
            onValueChange={(value) => actions.setRoofRidge(value === 'x' || value === 'z' ? value : null)}
            className="text-xs"
            aria-label="Ridge direction"
          >
            <option value={AUTO_RIDGE}>Along the longer side ({RIDGE_LABELS[longer].toLowerCase()})</option>
            <option value="x">{axisLabel('x')}</option>
            <option value="z" disabled={terrace && roof.ridge !== 'z'}>
              {axisLabel('z')}
            </option>
          </Select>
          {terrace && (
            <p className="mt-1 text-[10px] text-muted-foreground" role="note">
              The attached houses keep the ridge from running north–south.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

const SIDE_LABELS: Record<WallId, string> = { north: 'North (street)', south: 'South (garden)', east: 'East', west: 'West' };
const PRESETS = Object.keys(DORMER_PRESET_LABELS) as DormerPreset[];

/** Roof dormers (#203): one row of controls per dormer, on the slopes this roof has. */
function DormersSection(): JSX.Element {
  const { layout, actions } = useRoomEditor();
  const style = layout.roof?.style ?? 'none';
  const dormers = layout.roof?.dormers ?? [];
  const sides = roofSlopeSides(layout.roof ?? style, layout.width, layout.height);
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
  const { layout, actions } = useRoomEditor();
  const unit = useLengthUnit();
  const widthId = useId();
  const offsetId = useId();
  const preset = dormerPresetOf(dormer);
  const onSlope = sides.includes(dormer.side);
  // The fields clamp to what the slope can take, so the value shown is the
  // value built (#281): typing 8 into a 6 m house lands on the roof edge.
  const roof = layout.roof ?? 'none';
  const baseY = buildingHeight(layout.floors);
  const offsetRange = dormerOffsetRange(roof, layout.width, layout.height, baseY, dormer);
  const maxWidth = dormerMaxWidth(roof, layout.width, layout.height, baseY, dormer);

  return (
    <div className="space-y-2 rounded-md border p-2" aria-label={`Dormer ${index + 1}`} role="group">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium">Dormer {index + 1}</span>
        <Button variant="ghost" size="sm" className="text-xs" onClick={() => actions.removeDormer(dormer.id)}>
          Remove
        </Button>
      </div>
      <Select
        value={dormer.side}
        onValueChange={(value) => actions.updateDormer(dormer.id, { side: value as WallId })}
        className="text-xs"
        aria-label="Slope"
      >
        {sides.map((side) => (
          <option key={side} value={side}>
            {SIDE_LABELS[side]}
          </option>
        ))}
        {!onSlope && (
          <option value={dormer.side} disabled>
            {SIDE_LABELS[dormer.side]} (no slope)
          </option>
        )}
      </Select>
      <Select
        value={preset ?? 'custom'}
        onValueChange={(value) => actions.updateDormer(dormer.id, dormerPresetFields(value as DormerPreset))}
        className="text-xs"
        aria-label="Face"
      >
        {PRESETS.map((option) => (
          <option key={option} value={option}>
            {DORMER_PRESET_LABELS[option]}
          </option>
        ))}
        {preset === null && (
          <option value="custom" disabled>
            Custom openings
          </option>
        )}
      </Select>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <Label htmlFor={widthId} className="text-[10px]">
            Width ({lengthUnitSymbol(unit)})
          </Label>
          <RoomDimensionInput
            id={widthId}
            value={dormer.width}
            onCommit={(width) => actions.updateDormer(dormer.id, { width })}
            min={MIN_DORMER_WIDTH}
            max={maxWidth ?? MAX_DORMER_WIDTH}
            step={0.1}
          />
        </div>
        <div>
          <Label htmlFor={offsetId} className="text-[10px]">
            Offset ({lengthUnitSymbol(unit)})
          </Label>
          <RoomDimensionInput
            id={offsetId}
            value={dormer.offset ?? 0}
            onCommit={(offset) => actions.updateDormer(dormer.id, { offset })}
            min={offsetRange?.[0] ?? -20}
            max={offsetRange?.[1] ?? 20}
            step={0.1}
          />
        </div>
      </div>
      {onSlope && offsetRange === null && (
        <p className="text-[10px] text-muted-foreground" role="note">
          Doesn&apos;t fit on this roof — the slope is too low or too short for a dormer.
        </p>
      )}
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
