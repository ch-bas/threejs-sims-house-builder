'use client';

import { REDUCED_MOTION_QUERY } from '../lib/reduced-motion';
import { useMediaQuery } from './use-media-query';

/**
 * Whether the user asked the OS to reduce motion (#436), kept in step with the
 * setting. False on the server and during hydration, like `useMediaQuery`.
 */
export function useReducedMotion(): boolean {
  return useMediaQuery(REDUCED_MOTION_QUERY);
}
