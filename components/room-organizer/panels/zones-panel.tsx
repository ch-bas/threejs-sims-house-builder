'use client';

import { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { useRoomEditor } from '../contexts';
import { CURRENCY_SYMBOL } from '../lib/constants';
import { MAX_ZONES, zoneStats } from '../lib/zones';
import type { RoomZone } from '../lib/types';

export interface ZonesPanelProps {
  /**
   * Called when the draw mode is switched on: the drawer this sits in covers
   * the left third of the plan the user is about to draw on, so it folds
   * itself away (#323).
   */
  onDrawStart?(): void;
}

/**
 * Room zones of the active floor (#155): the list with rename / recolour /
 * delete, and the toggle for the 2D draw mode that creates them. Drawing
 * only works on the plan, so switching the mode on also switches to 2D and
 * parks the 3D floor-click modes it would otherwise sit beside.
 */
export function ZonesPanel({ onDrawStart }: ZonesPanelProps = {}): JSX.Element {
  const { activeFloor, actions, view, setView } = useRoomEditor();
  const zones = activeFloor.zones ?? [];
  const drawing = view.drawZoneMode;

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
