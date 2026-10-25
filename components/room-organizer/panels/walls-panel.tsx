'use client';

import { useId } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { useRoomEditor } from '../contexts';
import { FLOOR_PATTERN_LABELS } from '../three/floor-patterns';
import { WALL_PATTERN_LABELS } from '../three/wall-patterns';
import type { FloorPattern, WallId, WallPattern } from '../lib/types';

const WALL_LABELS: Record<WallId, string> = {
  north: 'North wall',
  south: 'South wall',
  east: 'East wall',
  west: 'West wall',
};

const FLOOR_PATTERNS: ReadonlyArray<FloorPattern> = ['solid', 'wood', 'tile', 'carpet', 'concrete'];
const WALL_PATTERNS: ReadonlyArray<WallPattern> = ['solid', 'brick', 'wallpaper', 'panel', 'plaster', 'siding'];

const DEFAULT_WALL_COLOR = '#cccccc';

export function WallsPanel(): JSX.Element {
  const { activeFloor, actions } = useRoomEditor();
  const id = useId();

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">🎨 Walls &amp; Floor</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div>
          <Label htmlFor={`${id}-floor`} className="text-xs">Floor Pattern</Label>
          <Select
            id={`${id}-floor`}
            value={activeFloor.floorPattern ?? 'solid'}
            onValueChange={(value) => actions.setFloorPattern(value as FloorPattern)}
            className="text-xs"
            aria-label="Floor pattern"
          >
            {FLOOR_PATTERNS.map((pattern) => (
              <option key={pattern} value={pattern}>
                {FLOOR_PATTERN_LABELS[pattern]}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor={`${id}-wall`} className="text-xs">Wall Pattern</Label>
          <Select
            id={`${id}-wall`}
            value={activeFloor.wallPattern ?? 'solid'}
            onValueChange={(value) => actions.setWallPattern(value as WallPattern)}
            className="text-xs"
            aria-label="Wall pattern"
          >
            {WALL_PATTERNS.map((pattern) => (
              <option key={pattern} value={pattern}>
                {WALL_PATTERN_LABELS[pattern]}
              </option>
            ))}
          </Select>
        </div>

        <div className="grid grid-cols-2 gap-2 pt-2 border-t">
          {(Object.keys(WALL_LABELS) as WallId[]).map((wall) => (
            <div key={wall}>
              <Label htmlFor={`${id}-${wall}`} className="text-xs">{WALL_LABELS[wall]}</Label>
              <Input
                id={`${id}-${wall}`}
                type="color"
                value={activeFloor.wallColors?.[wall] ?? DEFAULT_WALL_COLOR}
                onChange={(event) => actions.setWallColor(wall, event.target.value)}
                className="h-8 w-full"
              />
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
