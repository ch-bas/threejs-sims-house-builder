'use client';

import { useRoomEditor } from '../contexts';
import { formatMetres } from '../lib/format';
import { floorStairHeadroom, isHeadroomShort, STAIR_HEADROOM, stairGoesNowhere } from '../lib/stairs';
import type { FurnitureItem } from '../lib/types';

/**
 * The warning in a stair's controls when the flight is short of headroom
 * (#631), or leads nowhere because the storey is the top one (#654). Says
 * nothing otherwise.
 */
export function StairHeadroomNote({ item }: { item: FurnitureItem }): JSX.Element | null {
  const { layout, activeFloorIndex } = useRoomEditor();
  const headroom = floorStairHeadroom(item, layout, activeFloorIndex);
  const nowhere = stairGoesNowhere(layout, activeFloorIndex);
  if (!nowhere && (!headroom || !isHeadroomShort(headroom.clearance))) return null;
  return (
    <p
      role="status"
      style={{
        margin: 0,
        padding: '4px 8px',
        borderRadius: 8,
        fontSize: 11,
        lineHeight: 1.35,
        color: 'var(--pc-demolish-ink)',
        background: 'rgba(120, 24, 18, 0.85)',
      }}
    >
      {nowhere || !headroom
        ? 'This flight leads nowhere: there is no floor above it.'
        : `Only ${formatMetres(headroom.clearance)} of headroom on this flight; ${formatMetres(STAIR_HEADROOM)} is the minimum.`}
    </p>
  );
}
