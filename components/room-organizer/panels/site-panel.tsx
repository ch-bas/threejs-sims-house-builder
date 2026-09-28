'use client';

import { useId } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { useRoomEditor } from '../contexts';
import { MAX_TERRAIN_Y, MIN_TERRAIN_Y, NEIGHBOUR_SIDES } from '../lib/site';
import { storeyHeight } from '../lib/storeys';
import { RoomDimensionInput } from './room-settings-panel';
import type { NeighbourSide } from '../lib/types';

const SIDE_LABELS: Record<NeighbourSide, string> = { west: 'West', east: 'East' };

/**
 * Sloped site and party-wall neighbours (#202). Ground heights are relative
 * to the ground floor: the street runs along the north (front) side.
 */
export function SitePanel(): JSX.Element {
  const { layout, actions } = useRoomEditor();
  const frontId = useId();
  const backId = useId();
  const terrain = layout.terrain;

  // A sensible first slope: the street a storey up, so the ground floor is
  // a basement at the front and opens onto the garden at the back.
  const startSlope = () =>
    actions.setTerrain({ frontY: Math.min(MAX_TERRAIN_Y, storeyHeight(layout.floors[0])), backY: 0 });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">⛰️ Site</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <Label className="text-xs">Sloped site</Label>
          <Button
            variant={terrain ? 'default' : 'outline'}
            size="sm"
            className="text-xs"
            aria-pressed={terrain !== undefined}
            onClick={() => (terrain ? actions.setTerrain(null) : startSlope())}
          >
            {terrain ? 'On' : 'Off'}
          </Button>
        </div>
        {terrain && (
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label htmlFor={frontId} className="text-xs">
                Street level (m)
              </Label>
              <RoomDimensionInput
                id={frontId}
                value={terrain.frontY}
                onCommit={(frontY) => actions.setTerrain({ ...terrain, frontY })}
                min={MIN_TERRAIN_Y}
                max={MAX_TERRAIN_Y}
                step={0.1}
              />
            </div>
            <div>
              <Label htmlFor={backId} className="text-xs">
                Garden level (m)
              </Label>
              <RoomDimensionInput
                id={backId}
                value={terrain.backY}
                onCommit={(backY) => actions.setTerrain({ ...terrain, backY })}
                min={MIN_TERRAIN_Y}
                max={MAX_TERRAIN_Y}
                step={0.1}
              />
            </div>
          </div>
        )}
        <div>
          <Label className="text-xs">Neighbours</Label>
          <div className="mt-1 grid grid-cols-2 gap-2" role="group" aria-label="Neighbours">
            {NEIGHBOUR_SIDES.map((side) => {
              const present = layout.neighbours?.[side] === true;
              return (
                <Button
                  key={side}
                  variant={present ? 'default' : 'outline'}
                  size="sm"
                  className="text-xs"
                  aria-pressed={present}
                  onClick={() => actions.setNeighbour(side, !present)}
                >
                  {SIDE_LABELS[side]}
                </Button>
              );
            })}
          </div>
        </div>
        <p className="text-[10px] text-muted-foreground">
          Heights are relative to the ground floor; the street runs along the north side. Neighbours are
          terrace houses sharing your party walls, built to your eaves.
        </p>
      </CardContent>
    </Card>
  );
}
