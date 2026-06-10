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