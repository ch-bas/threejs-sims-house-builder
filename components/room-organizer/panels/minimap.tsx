'use client';

import { PlanThumb } from './plan-thumb';
import type { FloorLayout, RoomLayout } from '../lib/types';

const MINIMAP_WIDTH = 180;
const MINIMAP_HEIGHT = 130;

export interface MinimapProps {
  layout: RoomLayout;
  floor: FloorLayout;
  selectedItemId: string | null;
}

export function Minimap({ layout, floor, selectedItemId }: MinimapProps): JSX.Element {
  return (
    // Offset below the top-right pill stack (FloorPill + WallDisplayPill, at
    // top:16) so the minimap no longer overlaps them or the measurement /
    // wall-draw chips that share the same corner. While an item is selected
    // it steps left of the item popover, which shares that corner and used
    // to cover it completely (#390); small screens size and place it in
    // app/globals.css ("Overlays", #308).
    <div
      className="pc-minimap absolute right-4 rounded-lg border bg-background/90 backdrop-blur-sm p-2 shadow"
      style={{ top: 128, zIndex: 20 }}
      data-beside-popover={selectedItemId !== null ? '' : undefined}
    >
      <p className="text-[10px] text-muted-foreground mb-1">{floor.name}</p>
      {/* Eager: always on screen. The tracing image is painted here and
          repainted when its async decode lands (#118) — the live house is the
          one the renderer's image cache belongs to. */}
      <PlanThumb
        layout={layout}
        floor={floor}
        selectedItemId={selectedItemId}
        width={MINIMAP_WIDTH}
        height={MINIMAP_HEIGHT}
        showFloorPlan
        eager
        className="rounded"
      />
    </div>
  );
}
