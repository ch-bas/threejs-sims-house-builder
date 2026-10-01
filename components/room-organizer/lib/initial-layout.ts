import { DEFAULT_ROOF } from './constants';
import type { FloorLayout, RoomLayout } from './types';

/**
 * The house every new session starts from. Lives in `lib/` so pure modules —
 * `restore-point.ts` decides "untouched" by comparing against it (#346) —
 * can read it; `hooks/layout-reducer.ts` re-exports it as the reducer's
 * initial state.
 */
export const INITIAL_GROUND_FLOOR: FloorLayout = {
  id: 'ground',
  name: 'Ground Floor',
  floorColor: '#c9a57d',
  floorPattern: 'wood',
  items: [],
};

export const INITIAL_LAYOUT: RoomLayout = {
  name: 'My Home',
  width: 8,
  height: 8,
  floors: [INITIAL_GROUND_FLOOR],
  roof: DEFAULT_ROOF,
  floorPlanOpacity: 0.5,
  floorPlanFitMode: 'stretch',
};
