import type { InteriorWall } from './types';

export type RoomShapeId =
  | 'rectangle'
  | 'l-shape'
  | 'u-shape'
  | 't-shape'
  | 'plus'
  | 'hexagon'
  | 'octagon';

export interface RoomShapeMeta {
  id: RoomShapeId;
  label: string;
  /**
   * Tiny silhouette SVG path for the picker thumbnail, drawn inside a
   * 24×24 viewBox. Stroke-only (no fill) so it inherits currentColor.
   */
  path: string;
}

export const ROOM_SHAPES: readonly RoomShapeMeta[] = [
  { id: 'rectangle', label: 'Rectangle', path: 'M4 6h16v12H4z' },
  { id: 'l-shape',   label: 'L-Shape',   path: 'M4 4h8v8h8v8H4z' },
  { id: 'u-shape',   label: 'U-Shape',   path: 'M4 4h4v10h8V4h4v16H4z' },
  { id: 't-shape',   label: 'T-Shape',   path: 'M3 4h18v6h-7v10h-4V10H3z' },
  { id: 'plus',      label: 'Plus',      path: 'M9 4h6v5h5v6h-5v5H9v-5H4V9h5z' },
  { id: 'hexagon',   label: 'Hexagon',   path: 'M7 4h10l4 8l-4 8H7l-4-8z' },
  { id: 'octagon',   label: 'Octagon',   path: 'M8 4h8l4 4v8l-4 4H8l-4-4V8z' },
];

/**
 * Generate the interior-wall segments that trace the outline of `shapeId`,
 * centred at (centerX, centerZ) and bounded by `width × depth` metres.
 * Each shape is defined as a closed polygon; walls connect consecutive
 * vertices. Returned walls have unique ids derived from `idSeed` so a
 * single stamp can be undone / re-stamped without collisions.
 *
 * If `lot` is supplied, every emitted endpoint is clamped to that
 * footprint so the stamp can't spill onto the grass when the slider
 * dimensions are at their max.
 */
export function generateRoomShape(
  shapeId: RoomShapeId,
  centerX: number,
  centerZ: number,
  width: number,
  depth: number,
  idSeed: string,
  color?: string,
  lot?: { width: number; depth: number }
): InteriorWall[] {
  const points = outlinePoints(shapeId, width, depth);
  const walls = polygonToWalls(points, centerX, centerZ, idSeed, color);
  if (!lot) return walls;
  const halfW = lot.width / 2;
  const halfD = lot.depth / 2;
  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
  return walls.map((w) => ({
    ...w,
    x1: clamp(w.x1, -halfW, halfW),
    z1: clamp(w.z1, -halfD, halfD),
    x2: clamp(w.x2, -halfW, halfW),
    z2: clamp(w.z2, -halfD, halfD),
  }));
}

interface Vec2 {
  x: number;
  z: number;
}

function outlinePoints(shapeId: RoomShapeId, w: number, d: number): readonly Vec2[] {
  const hw = w / 2;
  const hd = d / 2;
  switch (shapeId) {
    case 'rectangle':
      return [
        { x: -hw, z: -hd },
        { x:  hw, z: -hd },
        { x:  hw, z:  hd },
        { x: -hw, z:  hd },
      ];

    case 'l-shape': {
      // Notch the top-right quadrant out of a rectangle.
      const cw = w / 2;
      const cd = d / 2;
      return [
        { x: -hw,        z: -hd },
        { x:  hw - cw,   z: -hd },
        { x:  hw - cw,   z: -hd + cd },
        { x:  hw,        z: -hd + cd },
        { x:  hw,        z:  hd },
        { x: -hw,        z:  hd },
      ];
    }

    case 'u-shape': {
      // Carve a smaller rectangle out of the top centre.
      const carveW = w / 3;
      const carveD = d * 0.6;
      return [
        { x: -hw,           z: -hd },
        { x: -carveW / 2,   z: -hd },
        { x: -carveW / 2,   z: -hd + carveD },
        { x:  carveW / 2,   z: -hd + carveD },
        { x:  carveW / 2,   z: -hd },
        { x:  hw,           z: -hd },
        { x:  hw,           z:  hd },
        { x: -hw,           z:  hd },
      ];
    }

    case 't-shape': {
      // Wide top bar + narrower vertical stem dropping from its centre.
      const stemW = w / 3;
      const topD = d / 3;
      return [
        { x: -hw,         z: -hd },
        { x:  hw,         z: -hd },
        { x:  hw,         z: -hd + topD },
        { x:  stemW / 2,  z: -hd + topD },
        { x:  stemW / 2,  z:  hd },
        { x: -stemW / 2,  z:  hd },
        { x: -stemW / 2,  z: -hd + topD },
        { x: -hw,         z: -hd + topD },
      ];
    }

    case 'plus': {
      // 12-vertex cross — three equal "arms".
      const armW = w / 3;
      const armD = d / 3;
      return [
        { x: -armW / 2, z: -hd },
        { x:  armW / 2, z: -hd },
        { x:  armW / 2, z: -armD / 2 },
        { x:  hw,       z: -armD / 2 },
        { x:  hw,       z:  armD / 2 },
        { x:  armW / 2, z:  armD / 2 },
        { x:  armW / 2, z:  hd },
        { x: -armW / 2, z:  hd },
        { x: -armW / 2, z:  armD / 2 },
        { x: -hw,       z:  armD / 2 },
        { x: -hw,       z: -armD / 2 },
        { x: -armW / 2, z: -armD / 2 },
      ];
    }

    case 'hexagon': {
      // Regular hexagon inscribed in width × depth, flat top and bottom.
      const out: Vec2[] = [];
      for (let i = 0; i < 6; i += 1) {
        const a = (Math.PI / 3) * i + Math.PI / 6;
        out.push({ x: Math.cos(a) * hw, z: Math.sin(a) * hd });
      }
      return out;
    }

    case 'octagon': {
      // Regular-ish octagon — half-width chamfers at every corner.
      const c = Math.min(w, d) * 0.3;
      return [
        { x: -hw + c, z: -hd },
        { x:  hw - c, z: -hd },
        { x:  hw,     z: -hd + c },
        { x:  hw,     z:  hd - c },
        { x:  hw - c, z:  hd },
        { x: -hw + c, z:  hd },
        { x: -hw,     z:  hd - c },
        { x: -hw,     z: -hd + c },
      ];
    }
  }
}

function polygonToWalls(
  points: readonly Vec2[],
  centerX: number,
  centerZ: number,
  idSeed: string,
  color?: string
): InteriorWall[] {
  const walls: InteriorWall[] = [];
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i]!;
    const b = points[(i + 1) % points.length]!;
    walls.push({
      id: `${idSeed}-${i}`,
      x1: centerX + a.x,
      z1: centerZ + a.z,
      x2: centerX + b.x,
      z2: centerZ + b.z,
      ...(color !== undefined ? { color } : {}),
    });
  }
  return walls;
}
