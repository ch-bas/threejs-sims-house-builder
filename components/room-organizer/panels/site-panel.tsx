'use client';

import { useId } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { useRoomEditor } from '../contexts';
import { MAX_TERRAIN_Y, MIN_TERRAIN_Y, NEIGHBOUR_SIDES } from '../lib/site';
import { storeyHeight } from '../lib/storeys';
import { DEFAULT_ENTRANCE, ENTRANCE_LIMITS } from '../lib/street';
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
  const entranceWidthId = useId();
  const entranceDepthId = useId();
  const entranceOffsetId = useId();
  const entrance = layout.entrance;
  const pavement = layout.frontage === 'pavement';
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
        <div>
          <Label className="text-xs">Frontage</Label>
          <div className="mt-1 grid grid-cols-2 gap-2" role="group" aria-label="Frontage">
            {(['garden', 'pavement'] as const).map((frontage) => {
              const active = (layout.frontage ?? 'garden') === frontage;
              return (
                <Button
                  key={frontage}
                  variant={active ? 'default' : 'outline'}
                  size="sm"
                  className="text-xs"
                  aria-pressed={active}
                  onClick={() => actions.setFrontage(frontage)}
                >
                  {frontage === 'garden' ? 'Front garden' : 'Pavement'}
                </Button>
              );
            })}
          </div>
        </div>
        <div className="flex items-center justify-between gap-2">
          <Label className="text-xs">Recessed entrance</Label>
          <Button
            variant={entrance ? 'default' : 'outline'}
            size="sm"
            className="text-xs"
            aria-pressed={entrance !== undefined}
            onClick={() => actions.setEntrance(entrance ? null : DEFAULT_ENTRANCE)}
          >
            {entrance ? 'On' : 'Off'}
          </Button>
        </div>
        {entrance && (
          <div className="grid grid-cols-3 gap-2">
            <div>
              <Label htmlFor={entranceWidthId} className="text-[10px]">
                Width (m)
              </Label>
              <RoomDimensionInput
                id={entranceWidthId}
                value={entrance.width}
                onCommit={(width) => actions.setEntrance({ ...entrance, width })}
                min={ENTRANCE_LIMITS.width[0]}
                max={ENTRANCE_LIMITS.width[1]}
                step={0.1}
              />
            </div>
            <div>
              <Label htmlFor={entranceDepthId} className="text-[10px]">
                Depth (m)
              </Label>
              <RoomDimensionInput
                id={entranceDepthId}
                value={entrance.depth}
                onCommit={(depth) => actions.setEntrance({ ...entrance, depth })}
                min={ENTRANCE_LIMITS.depth[0]}
                max={ENTRANCE_LIMITS.depth[1]}
                step={0.1}
              />
            </div>
            <div>
              <Label htmlFor={entranceOffsetId} className="text-[10px]">
                Offset (m)
              </Label>
              <RoomDimensionInput
                id={entranceOffsetId}
                value={entrance.offset ?? 0}
                onCommit={(offset) => actions.setEntrance({ ...entrance, offset })}
                min={-20}
                max={20}
                step={0.1}
              />
            </div>
          </div>
        )}
        <p className="text-[10px] text-muted-foreground">
          {pavement ? 'The pavement runs right up to the front wall. ' : ''}
          {entrance ? 'The porch opens onto the storey at street level; its door sits on the wall across the back. ' : ''}
          Heights are relative to the ground floor; the street runs along the north side. Neighbours are
          terrace houses sharing your party walls, built to your eaves.
        </p>
      </CardContent>
    </Card>
  );
}
