'use client';

import { Icon, type PlotcraftIconName } from '../plotcraft/icon';
import type { ViewSettings } from '../lib/types';
import { useRoomEditor } from '../contexts';

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
 * top-right corner of the lot.
 */
export function WallDisplayPill(): JSX.Element {
  const { view, setView } = useRoomEditor();

  return (
    <div
      className="pointer-events-auto pc-glass pc-glass--dark"
      style={{
        padding: 6,
        display: 'flex',
        alignItems: 'center',
        gap: 6,
      }}
      role="radiogroup"
      aria-label="Wall display"
    >
      <div
        className="pc-hud-header"
        style={{
          fontSize: 9,
          paddingLeft: 6,
          paddingRight: 4,
          display: 'inline-flex',
          alignItems: 'center',
          gap: 4,
          opacity: 0.85,
        }}
      >
        <Icon name="wall" size={12} />
        Walls
      </div>

      <div
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
          const isActive = view.wallDisplay === entry.key;
          return (
            <button
              key={entry.key}
              type="button"
              role="radio"
              aria-checked={isActive}
              onClick={() => setView((v) => ({ ...v, wallDisplay: entry.key }))}
              title={entry.hint}
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
