'use client';

import { useEffect, useRef } from 'react';
import { useRoomEditor, useViewSettings } from '../contexts';
import { endPlanCalibration, setCalibrationPhase, usePlanCalibration } from '../hooks/plan-calibration';
import { useExploring } from '../hooks/use-exploring';
import { layoutStore } from '../hooks/use-layout-store';
import { useMediaQuery } from '../hooks/use-media-query';
import { useRefusal } from '../hooks/use-refusal';
import { calibrateFloorPlan, calibrationProblem, floorPlanFitOf, type CalibrationProblem } from '../lib/floor-plan-fit';
import { COARSE_POINTER_QUERY } from '../lib/hud-layout';
import { Icon } from '../plotcraft/icon';
import { ChipButton, ChipNameField } from './chip-controls';

/** A typed length in metres: a decimal comma is fine, anything else isn't one. */
function parseMetres(text: string): number {
  const value = Number(text.trim().replace(',', '.').replace(/\s*m$/i, ''));
  return Number.isFinite(value) ? value : Number.NaN;
}

const PROBLEMS: Record<CalibrationProblem, string> = {
  length: 'Type the length between the two points in metres',
  points: 'Those two points are on the same spot of the plan: pick two further apart',
  scale: 'That length would scale the plan past what it can take (0.1 mm to 1 m a pixel): check the points and the length',
};

/**
 * The traced plan's calibration steps (#726), in the top-centre chip slot
 * while the 2D plan shows: pick two points, type the length between them,
 * then drag the image into place. Room settings starts it; leaving the plan,
 * EXPLORE or removing the image ends it.
 */
export function PlanCalibrationChip(): JSX.Element | null {
  const { layout, activeFloorIndex, actions, history } = useRoomEditor();
  const view = useViewSettings('view2D');
  const exploring = useExploring();
  const calibration = usePlanCalibration();
  const refuse = useRefusal();
  const touch = useMediaQuery(COARSE_POINTER_QUERY);
  const hasImage = !!layout.floorPlanImage;
  const calibrated = !!layout.floorPlanTransform;
  const live = calibration !== null;
  const phase = calibration?.phase;
  const bodyRef = useRef<HTMLDivElement>(null);

  // The image is the ground floor's, and only the plan picks points on it.
  useEffect(() => {
    if (live && (!view.view2D || exploring || !hasImage || activeFloorIndex !== 0)) endPlanCalibration();
  }, [live, view.view2D, exploring, hasImage, activeFloorIndex]);
  useEffect(() => endPlanCalibration, []);
  // Placing needs a calibration: undone, or fitted from Room settings, back to the points.
  useEffect(() => {
    if (phase === 'move' && !calibrated) setCalibrationPhase('points');
  }, [phase, calibrated]);
  // The second point asks for the length: the field takes the keys (and a phone's keyboard).
  useEffect(() => {
    if (phase !== 'distance') return undefined;
    const frame = requestAnimationFrame(() => bodyRef.current?.querySelector('input')?.focus());
    return () => cancelAnimationFrame(frame);
  }, [phase]);

  if (!calibration || !view.view2D) return null;

  const apply = (text: string) => {
    const metres = parseMetres(text);
    // Read the house again: the plan may have changed since the points were picked.
    const current = layoutStore.getState().layout;
    const [a, b] = calibration.points;
    if (!a || !b) return;
    const { width, height } = calibration.image;
    const fit = floorPlanFitOf(current);
    const problem = calibrationProblem(a, b, metres, width, height, fit);
    const transform = problem ? null : calibrateFloorPlan(a, b, metres, width, height, fit);
    if (!transform) {
      refuse(PROBLEMS[problem ?? 'points']);
      return;
    }
    history.commitNow();
    actions.setFloorPlanTransform(transform);
    setCalibrationPhase('move');
  };

  const done = (
    <ChipButton title="Finish calibrating the floor plan" onClick={endPlanCalibration}>
      {calibration.phase === 'move' ? 'Done' : 'Cancel'}
    </ChipButton>
  );

  return (
    <div className="pc-top-chip" style={CHIP_SLOT} role={calibration.phase === 'distance' ? undefined : 'status'}>
      <div ref={bodyRef} className="pc-glass pc-glass--dark" style={{ ...CHIP_BODY, color: 'var(--pc-cyan-glow)' }}>
        <Icon name="ruler" size={14} />
        {calibration.phase === 'points' && (
          <>
            {`${touch ? 'Tap' : 'Click'} two points a known distance apart (${calibration.points.length + 1} of 2)`}
            {done}
          </>
        )}
        {calibration.phase === 'distance' && (
          <>
            Length between them, in metres
            <ChipNameField
              label="Length between the points, in metres"
              initialValue=""
              submitLabel="Apply"
              maxLength={12}
              onSubmit={apply}
              onCancel={() => setCalibrationPhase('points')}
            />
          </>
        )}
        {calibration.phase === 'move' && (
          <>
            {`Drag the plan into place`}
            <ChipButton title="Measure the scale again" onClick={() => setCalibrationPhase('points')}>
              Measure again
            </ChipButton>
            {done}
          </>
        )}
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
