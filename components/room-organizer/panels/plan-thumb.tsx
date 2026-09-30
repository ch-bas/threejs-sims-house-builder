'use client';

import { useEffect, useRef, useState } from 'react';
import { addFloorPlanRepaintHandler, render2DTopDown } from '../canvas-2d/render';
import { hasCollisions } from '../lib/geometry';
import { entranceKeepOut, planFloorIndex } from '../lib/street';
import type { FloorLayout, RoomLayout } from '../lib/types';
import type { CSSProperties } from 'react';

/**
 * The renderer's default 60px margin was tuned for the full-screen 2D view
 * and left a 180×130 canvas ~10px of drawable height (#118).
 */
const THUMB_PADDING = 6;

export interface PlanThumbProps {
  /**
   * The building to draw, or a loader that yields it. The loader runs only
   * once the canvas has scrolled into view, so a list of twenty History rows
   * doesn't parse twenty snapshots up front (#303). A loader returning null
   * leaves the thumbnail blank.
   */
  layout: RoomLayout | (() => RoomLayout | null);
  /** The floor to draw; the ground floor when omitted. */
  floor?: FloorLayout;
  /** CSS size; the backing store is this × devicePixelRatio (#226). */
  width: number;
  height: number;
  padding?: number;
  selectedItemId?: string | null;
  /**
   * Paint the tracing image under the plan. Off by default: the renderer
   * decodes floor plans through a single-slot cache keyed on the data-URL,
   * so a thumbnail of a house with a different image than the one on screen
   * would evict the live view's image and the two would repaint each other
   * forever. Only the minimap, which shows the live house, turns this on.
   */
  showFloorPlan?: boolean;
  /**
   * Paint on mount instead of when scrolled into view. For always-visible
   * consumers such as the minimap.
   */
  eager?: boolean;
  className?: string;
  style?: CSSProperties;
  /** Accessible name; thumbnails are decorative when omitted. */
  label?: string;
}

/**
 * A small top-down plan drawn by the pure 2D renderer into an offscreen-sized
 * canvas (#303). Nothing is stored: thumbnails are re-rendered on demand,
 * which costs no localStorage — the quota is already contested by the
 * restore-point ring (#295).
 */
export function PlanThumb({
  layout,
  floor,
  width,
  height,
  padding = THUMB_PADDING,
  selectedItemId = null,
  showFloorPlan = false,
  eager = false,
  className,
  style,
  label,
}: PlanThumbProps): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [visible, setVisible] = useState(eager);

  // Lazy rows: wait until the canvas is on screen before resolving the
  // layout and painting. Browsers without IntersectionObserver paint at once.
  useEffect(() => {
    if (visible) return undefined;
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    if (typeof IntersectionObserver === 'undefined') {
      setVisible(true);
      return undefined;
    }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        setVisible(true);
        observer.disconnect();
      }
    });
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [visible]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!visible || !canvas) return undefined;
    const resolved = typeof layout === 'function' ? layout() : layout;
    if (!resolved) return undefined;
    // Never let a thumbnail touch the shared floor-plan image cache — see
    // `showFloorPlan`.
    const building: RoomLayout = { ...resolved };
    if (!showFloorPlan) delete building.floorPlanImage;
    const shown = floor ?? building.floors[0];
    if (!shown) return undefined;
    const keepOut = entranceKeepOut(building, planFloorIndex(building.floors, shown));

    const paint = () => {
      // Size the backing store to CSS size × devicePixelRatio (the CSS size is
      // pinned via style below) so render2DTopDown's derived dpr scales the
      // render — a fixed store is blurry on retina (#226).
      const dpr = window.devicePixelRatio || 1;
      const backingWidth = Math.round(width * dpr);
      const backingHeight = Math.round(height * dpr);
      // Assigning canvas.width/height clears the canvas — only touch it when
      // the value actually changes.
      if (canvas.width !== backingWidth) canvas.width = backingWidth;
      if (canvas.height !== backingHeight) canvas.height = backingHeight;
      render2DTopDown({
        canvas,
        layout: building,
        floor: shown,
        selectedItemId,
        showMeasurements: false,
        showWiFiSignals: false,
        hasCollision: (item) => hasCollisions(item, shown.items, building.width, building.height, keepOut),
        padding,
      });
    };
    paint();
    // Repaint when an async floor-plan decode lands — the minimap renders in
    // 3D view where the 2D view's handler isn't registered (#118).
    return showFloorPlan ? addFloorPlanRepaintHandler(paint) : undefined;
  }, [visible, layout, floor, width, height, padding, selectedItemId, showFloorPlan]);

  return (
    // CSS size is pinned here; the paint effect sizes the backing store to
    // this × devicePixelRatio (#226).
    <canvas
      ref={canvasRef}
      className={className}
      style={{ width, height, ...style }}
      role={label ? 'img' : 'presentation'}
      aria-label={label}
    />
  );
}
