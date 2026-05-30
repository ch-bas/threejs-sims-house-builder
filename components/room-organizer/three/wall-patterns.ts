import type * as ThreeNS from 'three';
import type { WallPattern } from '../lib/types';

type ThreeModule = typeof import('three');

export const WALL_PATTERN_LABELS: Record<WallPattern, string> = {
  solid: 'Solid',
  brick: 'Brick',
  wallpaper: 'Wallpaper',
  panel: 'Wood Panel',
  plaster: 'Plaster',
  siding: 'Siding',
};

interface PatternRenderer {
  draw(ctx: CanvasRenderingContext2D, size: number, baseColor: string): void;
  /** How many tiles per meter of wall length. */
  repeatPerMeter: number;
  opacity: number;
}

const PATTERNS: Record<Exclude<WallPattern, 'solid'>, PatternRenderer> = {
  brick: {
    repeatPerMeter: 0.8,
    opacity: 0.55,
    draw(ctx, size, baseColor) {
      ctx.fillStyle = baseColor;
      ctx.fillRect(0, 0, size, size);
      ctx.strokeStyle = 'rgba(0,0,0,0.35)';
      ctx.lineWidth = 2;
      const rows = 6;
      const rowHeight = size / rows;
      const bricksPerRow = 4;
      const brickWidth = size / bricksPerRow;
      for (let r = 0; r < rows; r++) {
        const offset = (r % 2) * (brickWidth / 2);
        const y = r * rowHeight;
        for (let c = -1; c < bricksPerRow + 1; c++) {
          const x = c * brickWidth + offset;
          ctx.strokeRect(x, y, brickWidth, rowHeight);
        }
      }
    },
  },
  wallpaper: {
    repeatPerMeter: 1.2,
    opacity: 0.55,
    draw(ctx, size, baseColor) {
      ctx.fillStyle = baseColor;
      ctx.fillRect(0, 0, size, size);
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      const dots = 7;
      const spacing = size / dots;
      for (let i = 0; i < dots; i++) {
        for (let j = 0; j < dots; j++) {
          const x = i * spacing + spacing / 2;
          const y = j * spacing + spacing / 2 + (i % 2 === 0 ? 0 : spacing / 2);
          ctx.beginPath();
          ctx.arc(x, y, 4, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    },
  },
  panel: {
    repeatPerMeter: 0.5,
    opacity: 0.55,
    draw(ctx, size, baseColor) {
      ctx.fillStyle = baseColor;
      ctx.fillRect(0, 0, size, size);
      const panels = 4;
      const w = size / panels;
      ctx.strokeStyle = 'rgba(0,0,0,0.35)';
      ctx.lineWidth = 2;
      for (let i = 0; i < panels; i++) {
        const x = i * w;
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, size);
        ctx.stroke();
        // grain
        ctx.strokeStyle = 'rgba(0,0,0,0.12)';
        ctx.lineWidth = 1;
        for (let g = 1; g < 4; g++) {
          const gx = x + (g / 4) * w;
          ctx.beginPath();
          ctx.moveTo(gx, 0);
          ctx.lineTo(gx, size);
          ctx.stroke();
        }
        ctx.strokeStyle = 'rgba(0,0,0,0.35)';
        ctx.lineWidth = 2;
      }
    },
  },
  plaster: {
    repeatPerMeter: 0.3,
    opacity: 0.5,
    draw(ctx, size, baseColor) {
      ctx.fillStyle = baseColor;
      ctx.fillRect(0, 0, size, size);
      for (let i = 0; i < 250; i++) {
        const x = Math.random() * size;
        const y = Math.random() * size;
        const r = 5 + Math.random() * 15;
        const gradient = ctx.createRadialGradient(x, y, 0, x, y, r);
        gradient.addColorStop(0, `rgba(255,255,255,${0.04 + Math.random() * 0.05})`);
        gradient.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
      }
    },
  },
  // Horizontal lap siding — the white-board look of classic
  // suburban houses. Boards are wider than they are tall and have a
  // subtle shadow line under each.
  siding: {
    repeatPerMeter: 0.5,
    opacity: 0.7,
    draw(ctx, size, baseColor) {
      ctx.fillStyle = baseColor;
      ctx.fillRect(0, 0, size, size);
      const boardCount = 8;
      const boardHeight = size / boardCount;
      for (let i = 0; i < boardCount; i += 1) {
        const y = i * boardHeight;
        // Soft top highlight on each board.
        const grad = ctx.createLinearGradient(0, y, 0, y + boardHeight);
        grad.addColorStop(0, 'rgba(255,255,255,0.08)');
        grad.addColorStop(0.5, 'rgba(255,255,255,0)');
        grad.addColorStop(1, 'rgba(0,0,0,0.12)');
        ctx.fillStyle = grad;
        ctx.fillRect(0, y, size, boardHeight);
        // Hard shadow line at the bottom of each board (the lap shadow).
        ctx.fillStyle = 'rgba(0,0,0,0.22)';
        ctx.fillRect(0, y + boardHeight - 1, size, 1.5);
      }
    },
  },
};

export interface BuildWallMaterialOptions {
  pattern: WallPattern;
  color: string;
  width: number;
  height: number;
}

export function buildWallMaterial(
  THREE: ThreeModule,
  options: BuildWallMaterialOptions
): ThreeNS.MeshStandardMaterial {
  if (options.pattern === 'solid') {
    // Walls are fully opaque — the cutaway view hides the front walls by
    // setting .visible rather than by fading them, so the room reads as an
    // actual building.
    return new THREE.MeshStandardMaterial({
      color: options.color,
      side: THREE.DoubleSide,
      roughness: 0.85,
    });
  }

  const renderer = PATTERNS[options.pattern];
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return new THREE.MeshStandardMaterial({
      color: options.color,
      transparent: true,
      opacity: 0.3,
      side: THREE.DoubleSide,
    });
  }

  renderer.draw(ctx, size, options.color);

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(options.width * renderer.repeatPerMeter, options.height * renderer.repeatPerMeter * 0.6);

  return new THREE.MeshStandardMaterial({
    map: texture,
    side: THREE.DoubleSide,
    roughness: 0.85,
  });
}
