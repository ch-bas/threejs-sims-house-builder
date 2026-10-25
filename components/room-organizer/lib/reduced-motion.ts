/**
 * The operating system's "reduce motion" preference (#436). With it set, the
 * scene stops its ambient animation: weather particles hang still, walkers
 * stand where they spawn, security-camera cones stop sweeping, and the camera
 * moves without easing (no orbit glide, no sit-down ease in walkthrough).
 */
export const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

/**
 * A one-off read for code outside React (a scene set-up, a RAF session).
 * False where `matchMedia` is unavailable (SSR, old test environments).
 */
export function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(REDUCED_MOTION_QUERY).matches;
}
