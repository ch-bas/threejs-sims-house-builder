import { isPhone } from '../lib/render-quality';

/**
 * Renderer capabilities relevant to texture creation, captured once at
 * renderer init so material builders (which have no renderer access) can
 * apply them. Without anisotropy, the procedural floor/wall CanvasTextures
 * shimmer badly at grazing angles in walkthrough mode.
 */
let maxAnisotropy = 1;

export function setMaxAnisotropy(value: number): void {
    maxAnisotropy = Math.max(1, value);
}

export function getMaxAnisotropy(): number {
    return maxAnisotropy;
}

/** Whether textures made at runtime should come in their phone size. */
export function drawsForPhone(): boolean {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
    return isPhone({
        coarsePointer: window.matchMedia('(pointer: coarse)').matches,
        screenShortSide: Math.min(window.screen.width, window.screen.height),
    });
}
