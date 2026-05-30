'use client';

import { useEffect, useRef } from 'react';
import { render2DTopDown } from '../canvas-2d/render';
import { hasCollisions } from '../lib/geometry';
import type { FloorLayout, RoomLayout } from '../lib/types';

const MINIMAP_WIDTH = 180;
const MINIMAP_HEIGHT = 130;

export interface MinimapProps {
  layout: RoomLayout;
  floor: FloorLayout;
  selectedItemId: string | null;
}

export function Minimap({ layout, floor, selectedItemId }: MinimapProps): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    render2DTopDown({
      canvas,
      layout,
      floor,
      selectedItemId,
      showMeasurements: false,
      showWiFiSignals: false,
      hasCollision: (item) => hasCollisions(item, floor.items, layout.width, layout.height),
    });
  }, [layout, floor, selectedItemId]);

  return (
    <div className="absolute top-4 right-4 rounded-lg border bg-background/90 backdrop-blur-sm p-2 shadow">
      <p className="text-[10px] text-muted-foreground mb-1">{floor.name}</p>
      <canvas ref={canvasRef} width={MINIMAP_WIDTH} height={MINIMAP_HEIGHT} className="rounded" />
    </div>
  );
}
