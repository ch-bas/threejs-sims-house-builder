'use client';

import { useEffect } from 'react';
import { useRoomEditor, useViewSettings } from '../contexts';
import { setGroundDrawKind, useGroundDrawKind } from '../hooks/ground-draw';
import { usePlanCalibration } from '../hooks/plan-calibration';
import { useExploring } from '../hooks/use-exploring';
import { useMediaQuery } from '../hooks/use-media-query';
import { GROUND_LABELS } from '../lib/grounds';
import { COARSE_POINTER_QUERY } from '../lib/hud-layout';
import { Icon } from '../plotcraft/icon';
import { ChipButton } from './chip-controls';

/**
 * The garden-surface tool's top-centre chip (#924): what a drag lays and how
 * to stop, as the zone tool's chip says it. The Garden panel that switched
 * the tool on folds away with the drawer. The tool ends here when the plan
 * goes, another drawing tool or EXPLORE starts, or a storey other than the
 * ground floor shows: the surfaces are on the ground floor's plan.
 */
export function GroundDrawChip(): JSX.Element | null {
  const { activeFloorIndex } = useRoomEditor();
  const view = useViewSettings('view2D', 'drawWallMode', 'drawZoneMode', 'measurementMode');
  const exploring = useExploring();
  const kind = useGroundDrawKind();
  const touch = useMediaQuery(COARSE_POINTER_QUERY);
  // Calibrating the traced plan claims the plan's presses and the chip slot.
  const calibrating = usePlanCalibration() !== null;
  const otherTool = view.drawWallMode || view.drawZoneMode || view.measurementMode || calibrating;

  useEffect(() => {
    if (kind && (!view.view2D || otherTool || exploring || activeFloorIndex !== 0)) setGroundDrawKind(null);
  }, [kind, view.view2D, otherTool, exploring, activeFloorIndex]);
  useEffect(() => () => setGroundDrawKind(null), []);

  if (!kind || !view.view2D) return null;
  const what = GROUND_LABELS[kind].toLowerCase();
  return (
    <div className="pc-top-chip" style={CHIP_SLOT} role="status">
      <div className="pc-glass pc-glass--dark" style={{ ...CHIP_BODY, color: 'var(--pc-sky)' }}>
        <Icon name="floor" size={14} />
        {touch ? `Drag outside the house to lay ${what}` : `Drag outside the house to lay ${what} · Esc to stop`}
        <ChipButton title="Stop laying garden surfaces" onClick={() => setGroundDrawKind(null)}>
          Done
        </ChipButton>
      </div>
    </div>
  );
}

const CHIP_SLOT: React.CSSProperties = {
  position: 'absolute',
  top: 104,
  left: '50%',
  transform: 'translateX(-50%)',
  zIndex: 31,
  maxWidth: 'calc(100vw - 32px)',
};

const CHIP_BODY: React.CSSProperties = {
  padding: '6px 8px 6px 12px',
  display: 'inline-flex',
  flexWrap: 'wrap',
  alignItems: 'center',
  gap: 8,
  borderRadius: 999,
  fontFamily: 'var(--pc-font-display)',
  fontWeight: 600,
  fontSize: 11,
};
