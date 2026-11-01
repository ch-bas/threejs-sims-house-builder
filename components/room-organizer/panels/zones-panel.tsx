'use client';

import { useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { useEditorViewActions, useRoomEditor, useViewSettings } from '../contexts';
import { NOT_WHILE_EXPLORING, useExploring } from '../hooks/use-exploring';
import { CURRENCY_SYMBOL } from '../lib/constants';
import { requestZoneName } from '../lib/editor-notices';
import { hasTooManyWalls, MAX_ROOM_WALLS } from '../lib/room-detect';
import { entrancePlanOutline, planFloorIndex } from '../lib/street';
import { MAX_ZONES, defaultZoneName, hasFloorFinish, nextZoneColor, roomsToName, zoneFromRoom, zoneStats } from '../lib/zones';
import { FLOOR_PATTERN_LABELS } from '../three/floor-patterns';
import type { DetectedRoom } from '../lib/room-detect';
import type { FloorPattern, RoomZone } from '../lib/types';

export interface ZonesPanelProps {
  /**
   * Called when the draw mode is switched on: the drawer this sits in covers
   * the left third of the plan the user is about to draw on, so it folds
   * itself away (#323).
   */
  onDrawStart?(): void;
}

const STOREY_FINISH = 'storey';
const ZONE_FLOOR_PATTERNS: readonly FloorPattern[] = ['solid', 'wood', 'tile', 'carpet', 'concrete'];

/** A room's own floor (#720): a pattern and a colour, or the storey's. */
function ZoneFinish({ zone }: { zone: RoomZone }): JSX.Element {
  const { activeFloor, actions } = useRoomEditor();
  const custom = hasFloorFinish(zone);
  return (
    <div className="flex w-full items-center gap-2">
      <Select
        value={zone.floorPattern ?? STOREY_FINISH}
        onValueChange={(value) => actions.updateZone(zone.id, { floorPattern: value === STOREY_FINISH ? null : (value as FloorPattern) })}
        className="h-9 min-w-0 flex-1 text-xs"
        aria-label={`${zone.name} floor pattern`}
      >
        <option value={STOREY_FINISH}>Storey floor</option>
        {ZONE_FLOOR_PATTERNS.map((pattern) => (
          <option key={pattern} value={pattern}>
            {FLOOR_PATTERN_LABELS[pattern]}
          </option>
        ))}
      </Select>
      <Input
        type="color"
        aria-label={`${zone.name} floor colour`}
        value={zone.floorColor ?? activeFloor.floorColor}
        onChange={(event) => actions.updateZone(zone.id, { floorColor: event.target.value })}
        className="h-9 w-8 shrink-0 p-0.5"
      />
      {custom && (
        <Button
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-xs"
          onClick={() => actions.updateZone(zone.id, { floorPattern: null, floorColor: null })}
        >
          Reset
        </Button>
      )}
    </div>
  );
}

/**
 * Room zones of the active floor (#155): the list with rename / recolour /
 * delete, and the toggle for the 2D draw mode that creates them. Drawing
 * only works on the plan, so switching the mode on also switches to 2D and
 * parks the 3D floor-click modes it would otherwise sit beside.
 */
export function ZonesPanel({ onDrawStart }: ZonesPanelProps = {}): JSX.Element {
  const { layout, activeFloor, actions } = useRoomEditor();
  const view = useViewSettings('drawZoneMode');
  const { setView } = useEditorViewActions();
  const zones = activeFloor.zones ?? [];
  const floorIndex = planFloorIndex(layout.floors, activeFloor);
  const recess = entrancePlanOutline(layout, floorIndex);
  const drawing = view.drawZoneMode;
  const exploring = useExploring();
  const rooms = useMemo(() => roomsToName(layout, floorIndex), [layout, floorIndex]);

  /** One click: the room becomes a zone, and the chip asks for its name (#374). */
  const nameRoom = (room: DetectedRoom) => {
    requestZoneName(actions.addZone(zoneFromRoom(room, defaultZoneName(zones), nextZoneColor(zones))));
  };

  const toggleDrawing = () => {
    if (drawing) {
      setView((v) => ({ ...v, drawZoneMode: false }));
      return;
    }
    setView((v) => ({ ...v, drawZoneMode: true, view2D: true, drawWallMode: false, measurementMode: false }));
    onDrawStart?.();
  };

  // Inline rename, like the floor list's (#374): Enter or leaving the field
  // keeps the name, Escape drops it, and a blank name keeps the old one.
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  // The blur that follows Enter or Escape (the field unmounts) must not
  // commit a second time, or commit a cancelled draft.
  const openRenameRef = useRef<string | null>(null);
  const startRename = (zone: RoomZone) => {
    openRenameRef.current = zone.id;
    setRenamingId(zone.id);
    setDraft(zone.name);
  };
  const endRename = (zone: RoomZone, commit: boolean) => {
    if (openRenameRef.current !== zone.id) return;
    openRenameRef.current = null;
    setRenamingId(null);
    const trimmed = draft.trim();
    if (commit && trimmed && trimmed !== zone.name) actions.updateZone(zone.id, { name: trimmed });
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

        {hasTooManyWalls(activeFloor) && (
          <p className="border-t pt-2 text-xs text-muted-foreground">Rooms aren’t found on a floor with over {MAX_ROOM_WALLS} walls.</p>
        )}

        {rooms.length > 0 && (
          <ul className="space-y-1 border-t pt-2" aria-label="Rooms without a name">
            {rooms.map((room) => (
              <li key={`${room.anchor.x}:${room.anchor.z}`} className="flex items-center justify-between gap-2 text-xs">
                <span className="text-muted-foreground">Closed room · {room.area.toFixed(1)} m²</span>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 px-2 text-xs"
                  disabled={exploring || zones.length >= MAX_ZONES}
                  title={exploring ? NOT_WHILE_EXPLORING : undefined}
                  onClick={() => nameRoom(room)}
                >
                  Name this room
                </Button>
              </li>
            ))}
          </ul>
        )}

        {zones.length > 0 && (
          <ul className="space-y-1 border-t pt-2" aria-label="Zones on this floor">
            {zones.map((zone) => {
              const stats = zoneStats(zone, activeFloor.items, recess);
              return (
                <li key={zone.id} className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                  <Input
                    type="color"
                    aria-label={`${zone.name} colour`}
                    value={zone.color}
                    onChange={(event) => actions.updateZone(zone.id, { color: event.target.value })}
                    className="h-7 w-8 shrink-0 p-0.5"
                  />
                  <div className="min-w-0 flex-1">
                    {renamingId === zone.id ? (
                      <Input
                        autoFocus
                        aria-label={`Rename ${zone.name}`}
                        value={draft}
                        maxLength={60}
                        onChange={(event) => setDraft(event.target.value)}
                        onFocus={(event) => event.target.select()}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') {
                            endRename(zone, true);
                          } else if (event.key === 'Escape') {
                            // Cancel the rename without also closing the drawer (#152).
                            event.preventDefault();
                            event.stopPropagation();
                            endRename(zone, false);
                          }
                        }}
                        onBlur={() => endRename(zone, true)}
                        className="h-6 text-xs"
                      />
                    ) : (
                      <button
                        type="button"
                        className="block max-w-full truncate text-left font-medium hover:underline"
                        title="Rename"
                        onClick={() => startRename(zone)}
                      >
                        {zone.name}
                      </button>
                    )}
                    <span className="block text-muted-foreground">
                      {stats.itemCount} {stats.itemCount === 1 ? 'item' : 'items'} · {CURRENCY_SYMBOL}
                      {stats.cost.toLocaleString()} · {stats.area.toFixed(1)} m²
                      {zone.outline ? ' · follows its walls' : ''}
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
                  <ZoneFinish zone={zone} />
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
