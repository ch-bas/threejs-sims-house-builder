import { applyRelief, reliefMaps, type ReliefSpec } from './surface-maps';
import { DisposableLruCache, PATTERN_CACHE_CAPACITY } from './texture-lru';
import { getPatternSize, patternReliefEnabled, withMaxAnisotropy } from './texture-settings';
import type { FloorPattern } from '../lib/types';
import type * as ThreeNS from 'three';

type ThreeModule = typeof import('./three-runtime');

export const FLOOR_PATTERN_LABELS: Record<FloorPattern, string> = {
  solid: 'Solid',
  wood: 'Wood Planks',
  tile: 'Tile',
  carpet: 'Carpet',
  concrete: 'Concrete',
};

interface PatternRenderer {
  draw(ctx: CanvasRenderingContext2D, size: number, baseColor: string): void;
  /** How many times the texture should tile across one meter. */
  repeatPerMeter: number;
  /** Roughness without relief maps (phones), and the base the maps refine. */
  roughness: number;
  /** Height tile for the normal and roughness maps (#757); none on a flat finish. */
  relief?: ReliefSpec;
}

/** Boards across one wood tile: 1.4 m a tile, so 14 cm boards (#757). */
const WOOD_BOARDS = 10;
const WOOD_REPEAT_PER_METRE = 1 / 1.4;

interface Board {
  row: number;
  /** Start and end along the row, in tiles (0..1); a board may wrap past 1. */
  from: number;
  to: number;
  /** Tone multiplier for this board. */
  tone: number;
  /** Seed for its grain. */
  seed: number;
}

/** A small seeded generator, so the same boards are drawn every time. */
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * The wood tile's boards: rows of 14 cm boards, each row cut by one or two
 * end joints at staggered places (no two neighbouring rows joint within a
 * fifth of a tile of each other), a seeded tone per board. Exported for tests.
 */
export function woodBoards(): Board[] {
  const random = seeded(757);
  const boards: Board[] = [];
  let previous: number[] = [];
  for (let row = 0; row < WOOD_BOARDS; row++) {
    const count = random() < 0.45 ? 2 : 1;
    let joints: number[] = [];
    for (let attempt = 0; attempt < 20; attempt++) {
      const first = random();
      joints = count === 1 ? [first] : [first, (first + 0.4 + random() * 0.2) % 1];
      const near = (a: number, b: number) => Math.min(Math.abs(a - b), 1 - Math.abs(a - b)) < 0.2;
      if (!joints.some((j) => previous.some((p) => near(j, p)))) break;
    }
    joints.sort((a, b) => a - b);
    // Boards run from joint to joint, the last one wrapping round the tile.
    for (let i = 0; i < joints.length; i++) {
      const from = joints[i]!;
      const next = joints[(i + 1) % joints.length]!;
      boards.push({ row, from, to: next > from ? next : next + 1, tone: 0.8 + random() * 0.3, seed: Math.floor(random() * 1e6) });
    }
    previous = joints;
  }
  return boards;
}

/** Each board's spans in pixels on a tile, split where it wraps. */
function boardSpans(board: Board, size: number): Array<[number, number]> {
  const a = board.from * size;
  const b = board.to * size;
  return b <= size ? [[a, b]] : [[a, size], [0, b - size]];
}

const PATTERNS: Record<Exclude<FloorPattern, 'solid'>, PatternRenderer> = {
  wood: {
    repeatPerMeter: WOOD_REPEAT_PER_METRE,
    // Lower than a matt floor, so the environment gives the boards a sheen
    // at grazing angles (#757).
    roughness: 0.6,
    draw(ctx, size, baseColor) {
      const k = size / 256;
      const rowHeight = size / WOOD_BOARDS;
      ctx.fillStyle = baseColor;
      ctx.fillRect(0, 0, size, size);
      for (const board of woodBoards()) {
        const y = board.row * rowHeight;
        const grain = seeded(board.seed);
        for (const [x0, x1] of boardSpans(board, size)) {
          ctx.fillStyle = shadeColor(baseColor, board.tone);
          ctx.fillRect(x0, y, x1 - x0, rowHeight);
          // Soft grain streaks along the board.
          ctx.strokeStyle = 'rgba(0,0,0,0.10)';
          ctx.lineWidth = k;
          for (let g = 0; g < 3; g++) {
            const gy = y + (0.2 + grain() * 0.6) * rowHeight;
            const sway = (grain() - 0.5) * rowHeight * 0.3;
            ctx.beginPath();
            ctx.moveTo(x0, gy);
            ctx.bezierCurveTo(x0 + (x1 - x0) * 0.3, gy + sway, x0 + (x1 - x0) * 0.7, gy - sway, x1, gy);
            ctx.stroke();
          }
        }
      }
      // Seams: along every row, and the end joints.
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      for (let row = 0; row < WOOD_BOARDS; row++) ctx.fillRect(0, row * rowHeight, size, 1.5 * k);
      ctx.fillStyle = 'rgba(0,0,0,0.45)';
      for (const board of woodBoards()) ctx.fillRect((board.from * size) % size, board.row * rowHeight, 1.5 * k, rowHeight);
    },
    relief: {
      roughness: [0.9, 0.55],
      strength: 2.5,
      draw(ctx, size) {
        const k = size / 256;
        const rowHeight = size / WOOD_BOARDS;
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, size, size);
        // A slightly eased edge to each board, then the gaps.
        ctx.fillStyle = 'rgba(0,0,0,0.25)';
        for (let row = 0; row < WOOD_BOARDS; row++) ctx.fillRect(0, row * rowHeight, size, 3 * k);
        ctx.fillStyle = '#000';
        for (let row = 0; row < WOOD_BOARDS; row++) ctx.fillRect(0, row * rowHeight, size, 1.5 * k);
        for (const board of woodBoards()) ctx.fillRect((board.from * size) % size, board.row * rowHeight, 1.5 * k, rowHeight);
      },
    },
  },
  tile: {
    repeatPerMeter: 1,
    roughness: 0.5,
    draw(ctx, size, baseColor) {
      const k = size / 256;
      ctx.fillStyle = baseColor;
      ctx.fillRect(0, 0, size, size);
      const cells = 4;
      const cell = size / cells;
      // A faint tone per tile, as fired tiles vary.
      for (let i = 0; i < cells; i++) {
        for (let j = 0; j < cells; j++) {
          const tone = ((i * 5 + j * 3) % 7) / 6 - 0.5;
          ctx.fillStyle = tone > 0 ? `rgba(255,255,255,${(tone * 0.08).toFixed(3)})` : `rgba(0,0,0,${(-tone * 0.08).toFixed(3)})`;
          ctx.fillRect(i * cell, j * cell, cell, cell);
        }
      }
      ctx.strokeStyle = 'rgba(0,0,0,0.35)';
      ctx.lineWidth = 2 * k;
      for (let i = 0; i <= cells; i++) {
        ctx.beginPath();
        ctx.moveTo(i * cell, 0);
        ctx.lineTo(i * cell, size);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(0, i * cell);
        ctx.lineTo(size, i * cell);
        ctx.stroke();
      }
    },
    relief: {
      // Glazed faces, matt grout.
      roughness: [0.95, 0.2],
      strength: 3,
      draw(ctx, size) {
        const k = size / 256;
        const cells = 4;
        const cell = size / cells;
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, size, size);
        ctx.strokeStyle = '#000';
        ctx.lineWidth = 3 * k;
        for (let i = 0; i <= cells; i++) {
          ctx.beginPath();
          ctx.moveTo(i * cell, 0);
          ctx.lineTo(i * cell, size);
          ctx.stroke();
          ctx.beginPath();
          ctx.moveTo(0, i * cell);
          ctx.lineTo(size, i * cell);
          ctx.stroke();
        }
      },
    },
  },
  carpet: {
    repeatPerMeter: 2,
    roughness: 0.95,
    draw(ctx, size, baseColor) {
      const k = size / 256;
      ctx.fillStyle = baseColor;
      ctx.fillRect(0, 0, size, size);
      // Speckle for fibers.
      for (let i = 0; i < 1200 * k * k; i++) {
        const x = Math.random() * size;
        const y = Math.random() * size;
        const alpha = 0.06 + Math.random() * 0.12;
        ctx.fillStyle = `rgba(0,0,0,${alpha.toFixed(2)})`;
        ctx.fillRect(x, y, 1.5 * k, 1.5 * k);
      }
    },
  },
  concrete: {
    repeatPerMeter: 0.4,
    roughness: 0.85,
    draw(ctx, size, baseColor) {
      const k = size / 256;
      ctx.fillStyle = baseColor;
      ctx.fillRect(0, 0, size, size);
      // Subtle blotches.
      for (let i = 0; i < 35; i++) {
        const x = Math.random() * size;
        const y = Math.random() * size;
        const radius = (10 + Math.random() * 30) * k;
        const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
        gradient.addColorStop(0, 'rgba(0,0,0,0.08)');
        gradient.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.arc(x, y, radius, 0, Math.PI * 2);
        ctx.fill();
      }
    },
  },
};

export interface BuildFloorPatternOptions {
  pattern: FloorPattern;
  color: string;
  roomWidth: number;
  roomDepth: number;
}

/**
 * Cache the painted CanvasTexture keyed on (pattern, color, size). The canvas
 * drawing depends only on those; the per-room `repeat` is applied to a clone.
 * Regenerating the carpet pattern alone redraws 1200 speckles per rebuild.
 * Each caller gets a `.clone()` sharing the cached canvas image (cheap) that is
 * independently disposable. The cache is LRU-capped because `color` is
 * user-pickable: evicted masters are disposed, which is safe for live clones
 * (see texture-lru.ts), while cached masters keep the shared GPU image alive.
 */
const floorTextureCache = new DisposableLruCache<ThreeNS.CanvasTexture>(PATTERN_CACHE_CAPACITY);

export function buildFloorMaterial(
  THREE: ThreeModule,
  options: BuildFloorPatternOptions
): ThreeNS.MeshStandardMaterial {
  if (options.pattern === 'solid') {
    return new THREE.MeshStandardMaterial({ color: options.color, roughness: 0.8, metalness: 0 });
  }

  const renderer = PATTERNS[options.pattern];
  // Defence in depth: the schema rejects unknown patterns (#208), but data
  // saved before that check may still be in the wild — render solid instead
  // of throwing inside the scene build.
  if (!renderer) {
    return new THREE.MeshStandardMaterial({ color: options.color, roughness: 0.8, metalness: 0 });
  }
  const size = getPatternSize();
  const master = getFloorTexture(THREE, options.pattern, options.color, size, renderer);
  if (!master) {
    return new THREE.MeshStandardMaterial({ color: options.color, roughness: 0.8, metalness: 0 });
  }

  // Clone per material so each floor owns a disposable copy sharing the cached
  // canvas image; per-room `repeat` is set on the clone, not the master.
  // (`Texture.clone()` already flags needsUpdate, so no explicit re-upload.)
  const texture = withMaxAnisotropy(master.clone());
  texture.repeat.set(
    options.roomWidth * renderer.repeatPerMeter,
    options.roomDepth * renderer.repeatPerMeter
  );

  const material = new THREE.MeshStandardMaterial({
    map: texture,
    roughness: renderer.roughness,
    metalness: 0,
  });
  // Board gaps and grout catch the light, and a glazed tile shines where its
  // grout doesn't (#757). Not on phones (texture-settings).
  const maps = renderer.relief && patternReliefEnabled() ? reliefMaps(THREE, `floor-${options.pattern}`, size, renderer.relief) : null;
  if (maps) applyRelief(material, maps, texture);
  return material;
}

function getFloorTexture(
  THREE: ThreeModule,
  pattern: Exclude<FloorPattern, 'solid'>,
  color: string,
  size: number,
  renderer: PatternRenderer
): ThreeNS.CanvasTexture | null {
  const key = `${pattern}|${color}|${size}`;
  const cached = floorTextureCache.get(key);
  if (cached) return cached;

  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  renderer.draw(ctx, size, color);

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  withMaxAnisotropy(texture);

  floorTextureCache.set(key, texture);
  return texture;
}

function shadeColor(hex: string, shade: number): string {
  const normalized = hex.replace('#', '');
  const r = Math.min(255, Math.round(parseInt(normalized.slice(0, 2), 16) * shade));
  const g = Math.min(255, Math.round(parseInt(normalized.slice(2, 4), 16) * shade));
  const b = Math.min(255, Math.round(parseInt(normalized.slice(4, 6), 16) * shade));
  return `rgb(${r}, ${g}, ${b})`;
}
