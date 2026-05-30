'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { FLOOR_PATTERN_LABELS } from '../three/floor-patterns';
import { WALL_PATTERN_LABELS } from '../three/wall-patterns';
import type { FloorPattern, WallId, WallPattern } from '../lib/types';
import { useRoomEditor } from '../contexts';

const WALL_LABELS: Record<WallId, string> = {
  north: 'North wall',
  south: 'South wall',
  east: 'East wall',
  west: 'West wall',
};

const FLOOR_PATTERNS: ReadonlyArray<FloorPattern> = ['solid', 'wood', 'tile', 'carpet', 'concrete'];
const WALL_PATTERNS: ReadonlyArray<WallPattern> = ['solid', 'brick', 'wallpaper', 'panel', 'plaster'];

const DEFAULT_WALL_COLOR = '#cccccc';

export function WallsPanel(): JSX.Element {
  const { activeFloor, actions } = useRoomEditor();

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">🎨 Walls &amp; Floor</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div>
          <Label className="text-xs">Floor Pattern</Label>
          <Select
            value={activeFloor.floorPattern ?? 'solid'}
            onValueChange={(value) => actions.setFloorPattern(value as FloorPattern)}
          >
            <SelectTrigger className="text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {FLOOR_PATTERNS.map((pattern) => (
                <SelectItem key={pattern} value={pattern}>
                  {FLOOR_PATTERN_LABELS[pattern]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs">Wall Pattern</Label>
          <Select
            value={activeFloor.wallPattern ?? 'solid'}
            onValueChange={(value) => actions.setWallPattern(value as WallPattern)}
          >
            <SelectTrigger className="text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {WALL_PATTERNS.map((pattern) => (
                <SelectItem key={pattern} value={pattern}>
                  {WALL_PATTERN_LABELS[pattern]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="grid grid-cols-2 gap-2 pt-2 border-t">
          {(Object.keys(WALL_LABELS) as WallId[]).map((wall) => (
            <div key={wall}>
              <Label className="text-xs">{WALL_LABELS[wall]}</Label>
              <Input
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
