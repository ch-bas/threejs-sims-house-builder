import { getMaxAnisotropy } from './texture-settings';
import type { FloorPattern } from '../lib/types';
import type * as ThreeNS from 'three';

type ThreeModule = typeof import('three');

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
}

const PATTERNS: Record<Exclude<FloorPattern, 'solid'>, PatternRenderer> = {
  wood: {
    repeatPerMeter: 0.55,
    draw(ctx, size, baseColor) {
      ctx.fillStyle = baseColor;
      ctx.fillRect(0, 0, size, size);
      const plankCount = 5;
      const plankHeight = size / plankCount;
      for (let i = 0; i < plankCount; i++) {
        // Per-plank shade — wider spread (0.78..1.06) so the planks read
        // as visibly different boards rather than near-identical strips.
        const shade = 0.78 + ((i * 37) % 60) / 200;
        ctx.fillStyle = shadeColor(baseColor, shade);
        ctx.fillRect(0, i * plankHeight, size, plankHeight);

        // Hard plank seam shadow on top and bottom edges.
        ctx.fillStyle = 'rgba(0,0,0,0.35)';
        ctx.fillRect(0, i * plankHeight, size, 1.5);
        // Soft grain streaks within each plank.
        ctx.strokeStyle = 'rgba(0,0,0,0.10)';
        ctx.lineWidth = 1;
        const grainCount = 4 + (i % 3);
        for (let g = 0; g < grainCount; g += 1) {
          const gy = i * plankHeight + ((g + 1) / (grainCount + 1)) * plankHeight;
          const sway = (Math.sin(g * 1.7 + i) * size) / 80;
          ctx.beginPath();
          ctx.moveTo(0, gy + sway);
          ctx.bezierCurveTo(
            size * 0.3,
            gy - sway,
            size * 0.7,
            gy + sway,
            size,
            gy - sway
          );
          ctx.stroke();
        }

        // Random plank end-seams across the row.
        ctx.strokeStyle = 'rgba(0,0,0,0.45)';
        ctx.lineWidth = 1.5;
        const seamCount = 2 + (i % 2);
        for (let s = 1; s <= seamCount; s++) {
          const x = ((s + i * 0.4) / (seamCount + 1)) * size;
          ctx.beginPath();
          ctx.moveTo(x, i * plankHeight);
          ctx.lineTo(x, (i + 1) * plankHeight);
          ctx.stroke();
        }
      }
    },
  },
  tile: {
    repeatPerMeter: 1,
    draw(ctx, size, baseColor) {
      ctx.fillStyle = baseColor;
      ctx.fillRect(0, 0, size, size);
      const cells = 4;
      const cell = size / cells;
      ctx.strokeStyle = 'rgba(0,0,0,0.35)';
      ctx.lineWidth = 2;
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
  carpet: {
    repeatPerMeter: 2,
    draw(ctx, size, baseColor) {
      ctx.fillStyle = baseColor;
      ctx.fillRect(0, 0, size, size);
      // Speckle for fibers.
      for (let i = 0; i < 1200; i++) {
        const x = Math.random() * size;
        const y = Math.random() * size;
        const alpha = 0.06 + Math.random() * 0.12;
        ctx.fillStyle = `rgba(0,0,0,${alpha.toFixed(2)})`;
        ctx.fillRect(x, y, 1.5, 1.5);
      }
    },
  },
  concrete: {
    repeatPerMeter: 0.4,
    draw(ctx, size, baseColor) {
      ctx.fillStyle = baseColor;
      ctx.fillRect(0, 0, size, size);
      // Subtle blotches.
      for (let i = 0; i < 35; i++) {
        const x = Math.random() * size;
        const y = Math.random() * size;
        const radius = 10 + Math.random() * 30;
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
 * independently disposable; the cached master is never disposed, so the shared
 * GPU image is never freed while cached (a freed-then-reused texture is black).
 */
const floorTextureCache = new Map<string, ThreeNS.CanvasTexture>();

export function buildFloorMaterial(
  THREE: ThreeModule,
  options: BuildFloorPatternOptions
): ThreeNS.MeshStandardMaterial {
  if (options.pattern === 'solid') {
    return new THREE.MeshStandardMaterial({ color: options.color, roughness: 0.8, metalness: 0.2 });
  }

  const renderer = PATTERNS[options.pattern];
  const size = 256;
  const master = getFloorTexture(THREE, options.pattern, options.color, size, renderer);
  if (!master) {
    return new THREE.MeshStandardMaterial({ color: options.color, roughness: 0.8, metalness: 0.2 });
  }

  // Clone per material so each floor owns a disposable copy sharing the cached
  // canvas image; per-room `repeat` is set on the clone, not the master.
  const texture = master.clone();
  texture.needsUpdate = true;
  texture.repeat.set(
    options.roomWidth * renderer.repeatPerMeter,
    options.roomDepth * renderer.repeatPerMeter
  );

  return new THREE.MeshStandardMaterial({
    map: texture,
    roughness: options.pattern === 'tile' ? 0.5 : 0.85,
    metalness: 0.1,
  });
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
  texture.anisotropy = getMaxAnisotropy();

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
