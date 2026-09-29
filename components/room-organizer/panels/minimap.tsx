'use client';

import { useEffect, useRef } from 'react';
import { addFloorPlanRepaintHandler, render2DTopDown } from '../canvas-2d/render';
import { hasCollisions } from '../lib/geometry';
import type { FloorLayout, RoomLayout } from '../lib/types';

const MINIMAP_WIDTH = 180;
const MINIMAP_HEIGHT = 130;
// The renderer's default 60px margin was tuned for the full-screen 2D view
// and left this canvas ~10px of drawable height (#118).
const MINIMAP_PADDING = 6;

export interface MinimapProps {
  layout: RoomLayout;
  floor: FloorLayout;
  selectedItemId: string | null;
}

export function Minimap({ layout, floor, selectedItemId }: MinimapProps): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const paint = () => {
      // Size the backing store to CSS size × devicePixelRatio (the CSS size is
      // pinned via style below) so render2DTopDown's derived dpr scales the
      // render — a fixed 180×130 store is blurry on retina (#226).
      const dpr = window.devicePixelRatio || 1;
      const backingWidth = Math.round(MINIMAP_WIDTH * dpr);
      const backingHeight = Math.round(MINIMAP_HEIGHT * dpr);
      // Assigning canvas.width/height clears the canvas — only touch it when
      // the value actually changes.
      if (canvas.width !== backingWidth) canvas.width = backingWidth;
      if (canvas.height !== backingHeight) canvas.height = backingHeight;
      render2DTopDown({
        canvas,
        layout,
        floor,
        selectedItemId,
        showMeasurements: false,
        showWiFiSignals: false,
        hasCollision: (item) => hasCollisions(item, floor.items, layout.width, layout.height),
        padding: MINIMAP_PADDING,
      });
    };
    paint();
    // Repaint when an async floor-plan decode lands — the minimap renders in
    // 3D view where the 2D view's handler isn't registered (#118).
    return addFloorPlanRepaintHandler(paint);
  }, [layout, floor, selectedItemId]);

  return (
    // Offset below the top-right pill stack (FloorPill + WallDisplayPill, at
    // top:16) so the minimap no longer overlaps them or the measurement /
    // wall-draw chips that share the same corner.
    <div
      className="absolute right-4 rounded-lg border bg-background/90 backdrop-blur-sm p-2 shadow"
      style={{ top: 128, zIndex: 20 }}
    >
      <p className="text-[10px] text-muted-foreground mb-1">{floor.name}</p>
      {/* CSS size is pinned here; the paint effect sizes the backing store to
          this × devicePixelRatio (#226). */}
      <canvas
        ref={canvasRef}
        className="rounded"
        style={{ width: MINIMAP_WIDTH, height: MINIMAP_HEIGHT }}
      />
    </div>
  );
}
