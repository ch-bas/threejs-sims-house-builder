'use client';

import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { useRoomEditor, useViewSettings } from '../contexts';
import { useMediaQuery } from '../hooks/use-media-query';
import { challengeProgress, isRoomGoal, ZONE_HINT } from '../lib/challenges';
import { COMPACT_DOCK_QUERY } from '../lib/hud-layout';
import { Icon } from '../plotcraft/icon';

/**
 * The challenge checklist (#909), pinned under the house card (top right on
 * phones) while the house is played under a brief: the brief's goals,
 * ticking off live as the house changes. Folded to its title on phones,
 * where it would cover the scene; a tap opens it. Not in a shared-link tour
 * (the orchestrator leaves it out) nor on a walk, and it steps aside while a
 * tool's top chip would cover it.
 */
export function ChallengeChip(): JSX.Element | null {
  const { layout, activeFloorIndex, collidingIds } = useRoomEditor();
  const view = useViewSettings('walkthroughMode', 'view2D');
  const compact = useMediaQuery(COMPACT_DOCK_QUERY);
  // null: the default for the viewport (open on desktop, folded on phones).
  const [open, setOpen] = useState<boolean | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  // The room goals score the active storey with the editor's own collisions.
  const progress = useMemo(
    () => challengeProgress(layout, { floorIndex: activeFloorIndex, ids: collidingIds }),
    [layout, activeFloorIndex, collidingIds]
  );
  const walking = view.walkthroughMode && !view.view2D;
  const shown = progress !== null && !walking;
  const covered = useCoveredByTopChip(boxRef, shown);
  if (!progress || !shown) return null;
  const expanded = open ?? !compact;
  const { challenge, goals, met, done } = progress;
  const needsZones = !done && challenge.goals.some(isRoomGoal);
  return (
    <div
      ref={boxRef}
      className="pc-glass pc-glass--dark"
      style={{ ...CHIP, ...(compact ? CHIP_COMPACT : {}), ...(covered ? { visibility: 'hidden' } : {}) }}
      {...(covered ? { 'aria-hidden': true } : { 'data-scene-occluder': '' })}
    >
      <button
        type="button"
        className="pc-challenge-toggle"
        style={HEADER}
        aria-expanded={expanded}
        {...(expanded ? { 'aria-controls': GOALS_ID } : {})}
        onClick={() => setOpen(!expanded)}
        title={expanded ? 'Fold the checklist' : 'Show the checklist'}
      >
        <Icon name="target" size={14} />
        <span style={{ flex: 1, textAlign: 'left' }}>{challenge.name}</span>
        <span style={{ color: done ? MET_GREEN : 'var(--pc-sky)' }} aria-label={`${met} of ${goals.length} goals met`}>
          {done ? 'Done!' : `${met}/${goals.length}`}
        </span>
      </button>
      {expanded && (
        <div id={GOALS_ID}>
          <ul style={LIST} aria-label={`${challenge.name} goals`}>
            {goals.map((goal) => (
              <li key={goal.label} style={GOAL}>
                <span aria-hidden="true" style={goal.met ? MARK_MET : MARK}>
                  {goal.met ? '✓' : ''}
                </span>
                <span style={{ color: goal.met ? MET_GREEN : 'var(--pc-paper)' }}>
                  {goal.label}
                  <span className="sr-only">{goal.met ? ' (met)' : ' (not yet)'}</span>
                </span>
              </li>
            ))}
          </ul>
          {needsZones && <p style={HINT}>{ZONE_HINT}</p>}
        </div>
      )}
    </div>
  );
}

const GOALS_ID = 'pc-challenge-goals';

/**
 * Whether one of the tools' top chips (`.pc-top-chip`: zone, walls,
 * calibration) overlaps the checklist. On phones those chips take the row
 * under the top pills, where the checklist sits; the checklist keeps its
 * box but hides, so the check has something to measure. Checked once a
 * frame at most, on DOM changes and resizes, and only while shown.
 */
function useCoveredByTopChip(ref: RefObject<HTMLDivElement>, active: boolean): boolean {
  const [covered, setCovered] = useState(false);
  useEffect(() => {
    if (!active) {
      setCovered(false);
      return undefined;
    }
    let frame = 0;
    const check = () => {
      frame = 0;
      const box = ref.current?.getBoundingClientRect();
      if (!box) return;
      const hit = Array.from(document.querySelectorAll('.pc-top-chip')).some((chip) => {
        const r = chip.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && r.left < box.right && r.right > box.left && r.top < box.bottom && r.bottom > box.top;
      });
      setCovered(hit);
    };
    const schedule = () => {
      frame ||= requestAnimationFrame(check);
    };
    const observer = new MutationObserver(schedule);
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    window.addEventListener('resize', schedule);
    schedule();
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', schedule);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [ref, active]);
  return covered;
}

/** Met goals: 5.9:1 over the dark glass on white, 12:1 on black (#909). */
const MET_GREEN = '#9BE87F';

const CHIP: React.CSSProperties = {
  position: 'absolute',
  top: 84,
  left: 16,
  zIndex: 30,
  width: 240,
  padding: '6px 10px',
  borderRadius: 14,
  fontFamily: 'var(--pc-font-display)',
  fontSize: 12,
  color: 'var(--pc-paper)',
};

/** Phones: under the walls pill, clear of the camera pad on the left, as narrow as the title. */
const CHIP_COMPACT: React.CSSProperties = {
  top: 'calc(var(--pc-top-pills-bottom, 60px) + 8px)',
  left: 'auto',
  right: 8,
  width: 'auto',
  maxWidth: 'min(260px, calc(100vw - 96px))',
};

const HEADER: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  width: '100%',
  minHeight: 28,
  background: 'none',
  border: 'none',
  padding: 0,
  color: 'inherit',
  font: 'inherit',
  fontWeight: 700,
  cursor: 'pointer',
};

const LIST: React.CSSProperties = {
  listStyle: 'none',
  margin: '4px 0 2px',
  padding: 0,
  display: 'grid',
  gap: 3,
};

const GOAL: React.CSSProperties = {
  display: 'flex',
  alignItems: 'baseline',
  gap: 6,
  fontWeight: 500,
  lineHeight: 1.3,
};

/** A goal's mark: an empty ring, or a white tick on green that reads on any backdrop. */
const MARK: React.CSSProperties = {
  flex: 'none',
  width: 12,
  height: 12,
  borderRadius: 999,
  border: '1.5px solid var(--pc-paper)',
  transform: 'translateY(1px)',
};

const MARK_MET: React.CSSProperties = {
  ...MARK,
  border: 'none',
  background: '#2E7D32',
  color: '#fff',
  fontSize: 9,
  lineHeight: '12px',
  textAlign: 'center',
  fontWeight: 700,
};

const HINT: React.CSSProperties = {
  margin: '4px 0 2px',
  fontSize: 11,
  fontWeight: 500,
  color: 'var(--pc-paper-soft)',
};
