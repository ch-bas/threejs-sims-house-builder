'use client';

import { useEditorViewActions, useViewSettings } from '../contexts';
import { onRovingKeyDown } from '../hooks/roving-keys';
import { sceneWallDisplay } from '../lib/walkthrough-view';
import { Icon, type PlotcraftIconName } from '../plotcraft/icon';
import { PlanViewToggle } from './view-options';
import type { ViewSettings } from '../lib/types';

type WallDisplay = ViewSettings['wallDisplay'];

interface Mode {
  key: WallDisplay;
  label: string;
  icon: PlotcraftIconName;
  hint: string;
}

const MODES: readonly Mode[] = [
  { key: 'up',      label: 'Up',   icon: 'wall',   hint: 'All walls up' },
  { key: 'cutaway', label: 'Cut',  icon: 'window', hint: 'Hide walls facing the camera (Automatic cutaway)' },
  { key: 'down',    label: 'Down', icon: 'floor',  hint: 'All walls down — top-down planning view' },
];

/**
 * Automatic wall display toggle: Up / Cut / Down. Lives as a small floating
 * overlay near the Floor Pill so view-level toggles stay grouped on the
 * top-right corner of the lot. The 2D plan switch leads it (#526).
 */
export function WallDisplayPill(): JSX.Element {
  const view = useViewSettings('wallDisplay', 'view2D', 'walkthroughMode');
  // The plan draws no walls up or down: off in 2D, like the time controls (#220, #444).
  // Walking keeps every wall up (#359), so the pill is off then too (#643)
  // and shows the walls the scene draws; the chosen mode comes back on exit.
  const walking = view.walkthroughMode && !view.view2D;
  const off = view.view2D || walking;
  const shown = sceneWallDisplay(view.wallDisplay, walking);
  const { setView } = useEditorViewActions();

  return (
    <div
      className="pointer-events-auto pc-glass pc-glass--dark pc-wall-pill"
      style={{
        padding: 6,
        display: 'flex',
        alignItems: 'center',
        gap: 6,
      }}
    >
      {/* In place of the "Walls" caption: beside it the switch would widen
          the pill into the stats bar. The radio group keeps the name, and
          the Up tile carries the wall glyph. */}
      <div className="pc-pill-well">
        <PlanViewToggle />
      </div>

      {/* Touch tablets only: no tooltip there to say what these tiles do, or
          why they are off (#679). It takes the room of the tiles' glyphs, so
          the pill keeps its width beside the stats bar. */}
      <span className="pc-hud-header pc-wall-caption">
        Walls
        {off && <span className="pc-wall-caption__why">{walking ? 'Walking' : '3D only'}</span>}
      </span>

      <div
        role="radiogroup"
        aria-label="Wall display"
        style={{
          background: 'rgba(0, 0, 0, 0.20)',
          border: '1px solid rgba(255, 255, 255, 0.08)',
          borderRadius: 10,
          padding: 3,
          boxShadow: 'inset 0 2px 4px rgba(0, 0, 0, 0.30)',
          display: 'flex',
          gap: 3,
        }}
      >
        {MODES.map((entry) => {
          const isActive = shown === entry.key;
          return (
            <button
              key={entry.key}
              type="button"
              role="radio"
              aria-checked={isActive}
              tabIndex={isActive ? 0 : -1}
              onClick={() => setView((v) => ({ ...v, wallDisplay: entry.key }))}
              onKeyDown={(event) => onRovingKeyDown(event, (index) => {
                const next = MODES[index];
                if (next) setView((v) => ({ ...v, wallDisplay: next.key }));
              })}
              disabled={off}
              title={walking ? `${entry.hint} — walls stay up while walking` : off ? `${entry.hint} — switch back to 3D view` : entry.hint}
              className={`pc-tile${isActive ? ' pc-tile--active' : ''}`}
              style={{
                padding: '4px 8px',
                height: 32,
                borderRadius: 7,
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                fontFamily: 'var(--pc-font-display)',
                fontWeight: 800,
                fontSize: 10,
                letterSpacing: 'var(--pc-tr-caps)',
                textTransform: 'uppercase',
                ...(off ? DISABLED_TILE : {}),
              }}
            >
              <Icon name={entry.icon} size={12} />
              {entry.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** A pill tile that does nothing in the current view, dimmed as ModePanel dims its buttons. */
export const DISABLED_TILE = { opacity: 0.35, cursor: 'not-allowed' } as const;
