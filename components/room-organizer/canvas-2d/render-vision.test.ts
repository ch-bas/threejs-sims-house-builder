import { describe, expect, it } from 'vitest';
import { makeFloor, makeItem, makeLayout } from '../lib/__testfixtures__/fixtures';
import { DEFAULT_VISION_FOV_DEG, DEFAULT_VISION_RANGE_M } from '../lib/constants';
import { visionWedges } from '../lib/plan-export/plan-geometry';
import { get2DViewTransform, render2DTopDown } from './render';
import type { FurnitureItem } from '../lib/types';

interface ArcCall {
  x: number;
  y: number;
  radius: number;
  start: number;
  end: number;
}

/** A 2D context that ignores everything but records `arc` calls. */
function recordingCanvas(width: number, height: number): { canvas: HTMLCanvasElement; arcs: ArcCall[] } {
  const arcs: ArcCall[] = [];
  const helper = { width: 0, addColorStop: () => undefined };
  const ctx = new Proxy({} as Record<string | symbol, unknown>, {
    get(target, key) {
      if (key in target) return target[key];
      if (key === 'arc') {
        return (x: number, y: number, radius: number, start: number, end: number) => {
          arcs.push({ x, y, radius, start, end });
        };
      }
      return () => helper;
    },
    set(target, key, value) {
      target[key] = value;
      return true;
    },
  });
  const canvas = { width, height, clientWidth: width, clientHeight: height, getContext: () => ctx };
  return { canvas: canvas as unknown as HTMLCanvasElement, arcs };
}

const camera = (overrides: Partial<FurnitureItem>): FurnitureItem =>
  makeItem({
    id: 'cam',
    type: 'security-camera',
    category: 'security',
    width: 0.25,
    depth: 0.2,
    hasVisionCone: true,
    position: { x: 3.85, z: -3.85 },
    rotation: -Math.PI / 4,
    ...overrides,
  });

describe('2D vision cones (#401)', () => {
  it('draws a camera without range/FOV with the shared defaults, as the vector exports do', () => {
    const item = camera({});
    const layout = makeLayout({ width: 8, height: 8, floors: [makeFloor({ items: [item] })] });
    const floor = layout.floors[0]!;
    const { canvas, arcs } = recordingCanvas(800, 600);
    render2DTopDown({
      canvas,
      layout,
      floor,
      selectedItemId: null,
      showMeasurements: false,
      showWiFiSignals: true,
      hasCollision: () => false,
    });

    const { scale } = get2DViewTransform(800, 600, layout, 60);
    const fov = (DEFAULT_VISION_FOV_DEG * Math.PI) / 180;
    const cone = arcs.find((arc) => Math.abs(arc.end - arc.start - fov) < 1e-9);
    expect(cone).toBeDefined();
    expect(cone!.radius).toBeCloseTo(DEFAULT_VISION_RANGE_M * scale, 9);
    // Same wedge as the SVG / DXF geometry.
    const [wedge] = visionWedges([item]);
    expect(cone!.start).toBeCloseTo(wedge!.startAngle, 9);
    expect(cone!.end).toBeCloseTo(wedge!.endAngle, 9);
  });

  it('keeps an explicit range and FOV', () => {
    const layout = makeLayout({
      width: 8,
      height: 8,
      floors: [makeFloor({ items: [camera({ visionRange: 3, visionFov: 40 })] })],
    });
    const { canvas, arcs } = recordingCanvas(800, 600);
    render2DTopDown({
      canvas,
      layout,
      floor: layout.floors[0]!,
      selectedItemId: null,
      showMeasurements: false,
      showWiFiSignals: true,
      hasCollision: () => false,
    });
    const { scale } = get2DViewTransform(800, 600, layout, 60);
    const cone = arcs.find((arc) => Math.abs(arc.end - arc.start - (40 * Math.PI) / 180) < 1e-9);
    expect(cone?.radius).toBeCloseTo(3 * scale, 9);
  });
});
