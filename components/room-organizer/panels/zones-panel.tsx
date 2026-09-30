'use client';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { useRoomEditor } from '../contexts';
import { CURRENCY_SYMBOL } from '../lib/constants';
import { MAX_ZONES, zoneStats } from '../lib/zones';
import type { RoomZone } from '../lib/types';

/**
 * Room zones of the active floor (#155): the list with rename / recolour /
 * delete, and the toggle for the 2D draw mode that creates them. Drawing
 * only works on the plan, so switching the mode on also switches to 2D and
 * parks the 3D floor-click modes it would otherwise sit beside.
 */
export function ZonesPanel(): JSX.Element {
  const { activeFloor, actions, view, setView } = useRoomEditor();
  const zones = activeFloor.zones ?? [];
  const drawing = view.drawZoneMode;

  const toggleDrawing = () =>
    setView((v) =>
      v.drawZoneMode
        ? { ...v, drawZoneMode: false }
        : { ...v, drawZoneMode: true, view2D: true, drawWallMode: false, measurementMode: false }
    );

  const rename = (zone: RoomZone) => {
    const name = window.prompt('Zone name:', zone.name);
    if (name === null) return;
    const trimmed = name.trim();
    if (trimmed) actions.updateZone(zone.id, { name: trimmed });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">🏷️ Zones</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <Button
          variant={drawing ? 'default' : 'outline'}
          size="sm"
          className="w-full text-xs"
          aria-pressed={drawing}
          disabled={!drawing && zones.length >= MAX_ZONES}
          onClick={toggleDrawing}
        >
          {drawing ? '✏️ Drawing zones — click to stop' : '✏️ Draw zone'}
        </Button>
        <p className="text-xs text-muted-foreground">
          {drawing
            ? 'Drag a rectangle on the 2D plan, then name it.'
            : 'Name the rooms of this floor to see what each one costs and measures.'}
        </p>

        {zones.length > 0 && (
          <ul className="space-y-1 border-t pt-2" aria-label="Zones on this floor">
            {zones.map((zone) => {
              const stats = zoneStats(zone, activeFloor.items);
              return (
                <li key={zone.id} className="flex items-center gap-2 text-xs">
                  <Input
                    type="color"
                    aria-label={`${zone.name} colour`}
                    value={zone.color}
                    onChange={(event) => actions.updateZone(zone.id, { color: event.target.value })}
                    className="h-7 w-8 shrink-0 p-0.5"
                  />
                  <div className="min-w-0 flex-1">
                    <button
                      type="button"
                      className="block max-w-full truncate text-left font-medium hover:underline"
                      title="Rename"
                      onClick={() => rename(zone)}
                    >
                      {zone.name}
                    </button>
                    <span className="block text-muted-foreground">
                      {stats.itemCount} {stats.itemCount === 1 ? 'item' : 'items'} · {CURRENCY_SYMBOL}
                      {stats.cost.toLocaleString()} · {stats.area.toFixed(1)} m²
                    </span>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-xs"
                    aria-label={`Delete ${zone.name}`}
                    onClick={() => actions.removeZone(zone.id)}
                  >
                    ✕
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
