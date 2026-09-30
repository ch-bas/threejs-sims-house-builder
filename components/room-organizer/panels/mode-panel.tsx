'use client';

import { useRoomEditor } from '../contexts';
import { CURRENCY_SYMBOL } from '../lib/constants';
import { Icon, type PlotcraftIconName } from '../plotcraft/icon';
import type { GameMode } from '../lib/types';

export type { GameMode };

export interface ModePanelProps {
  onSetMode(mode: GameMode): void;
  onSurprise(): void;
}

// Each mode owns a slice of the HUD (#151): DESIGN the structure tools and
// the Build tab, FURNISH the furniture tools and the Buy tab, EXPLORE the
// first-person walkthrough with the build HUD out of the way.
const MODES: ReadonlyArray<{
  key: GameMode;
  label: string;
  icon: PlotcraftIconName;
  hint: string;
}> = [
  { key: 'live',  label: 'EXPLORE', icon: 'live',  hint: 'Explore — walk through the house in first person' },
  { key: 'build', label: 'DESIGN',  icon: 'build', hint: 'Design — walls, doors, windows, stairs' },
  { key: 'buy',   label: 'FURNISH', icon: 'buy',   hint: 'Furnish — the furniture catalog' },
];

export function ModePanel({ onSetMode, onSurprise }: ModePanelProps): JSX.Element {
  const { layout, gameMode, autoCycleLighting, setAutoCycleLighting, history, view, toggle } = useRoomEditor();
  const totalCost = layout.floors.reduce(
    (sum, floor) =>
      sum + floor.items.reduce((acc, item) => acc + (item.price ?? 0), 0),
    0
  );

  return (
    <div
      className="pointer-events-auto pc-glass pc-mode-panel"
      style={{
        width: 248,
        padding: '14px 16px',
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
        alignItems: 'stretch',
      }}
    >
      <div style={{ textAlign: 'right' }}>
        <div
          className="pc-money"
          style={{ fontSize: 36, lineHeight: 1, letterSpacing: '-0.01em' }}
        >
          {CURRENCY_SYMBOL}
          {totalCost.toLocaleString()}
        </div>
        <div
          className="pc-hud-header"
          style={{ fontSize: 9, opacity: 0.8, marginTop: 2 }}
        >
          Furniture Value
        </div>
      </div>

      <div
        className="pc-mode-pill"
        role="group"
        aria-label="Game mode"
        style={{ alignSelf: 'stretch', justifyContent: 'space-between' }}
      >
        {MODES.map((entry) => {
          const isActive = gameMode === entry.key;
          return (
            <button
              key={entry.key}
              type="button"
              aria-pressed={isActive}
              onClick={() => onSetMode(entry.key)}
              title={entry.hint}
              className={`pc-mode-pill__cell${isActive ? ' pc-mode-pill__cell--active' : ''}`}
              style={{
                flex: 1,
                flexDirection: 'column',
                gap: 2,
                padding: '6px 4px',
              }}
            >
              <Icon
                name={entry.icon}
                size={16}
                style={{
                  color: isActive
                    ? 'var(--pc-cyan-glow)'
                    : 'var(--pc-paper-soft)',
                }}
              />
              <span
                className={`pc-mode-label${isActive ? ' pc-mode-label--active' : ''}`}
                style={{ fontSize: 11 }}
              >
                {entry.label}
              </span>
            </button>
          );
        })}
      </div>

      {/* A wrapping grid, not a flex row: nine 36 px buttons don't fit the
          panel on one line and flex-shrink squeezed them to ~22 px (#301). */}
      <div
        className="pc-mode-actions"
        role="group"
        aria-label="History and view options"
        style={{
          background: 'rgba(0, 0, 0, 0.20)',
          border: '1px solid rgba(255, 255, 255, 0.08)',
          borderRadius: 12,
          padding: 4,
          boxShadow: 'inset 0 2px 4px rgba(0, 0, 0, 0.30)',
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(36px, 1fr))',
          gap: 4,
        }}
      >
        <ActionButton
          label="Undo"
          icon="undo"
          disabled={!history.canUndo}
          onClick={history.undo}
        />
        <ActionButton
          label="Redo"
          icon="undo"
          mirrorIcon
          disabled={!history.canRedo}
          onClick={history.redo}
        />
        {/* Lighting only exists in 3D — disable in the 2D top-down view like
            TimeOfDayPanel's twin button (#220). */}
        <ActionButton
          label={view.view2D ? 'Speed up time — switch back to 3D view' : 'Speed up time'}
          icon="fastfwd"
          active={autoCycleLighting}
          disabled={view.view2D}
          onClick={() => setAutoCycleLighting((cur) => !cur)}
        />
        <ActionButton
          label="Surprise me"
          icon="sparkle"
          accent
          onClick={onSurprise}
        />
        <ActionButton
          label={view.showMinimap ? 'Hide minimap' : 'Show minimap'}
          icon="minimap"
          active={view.showMinimap}
          onClick={() => toggle('showMinimap')}
        />
        <ActionButton
          label={view.snapToGrid ? 'Snap off' : 'Snap to grid'}
          icon="grid"
          active={view.snapToGrid}
          onClick={() => toggle('snapToGrid')}
        />
        <ActionButton
          label={view.soundsEnabled ? 'Mute sounds' : 'Enable sounds'}
          icon="sound"
          active={view.soundsEnabled}
          onClick={() => toggle('soundsEnabled')}
        />
        <ActionButton
          label={view.showCameraVision ? 'Hide camera cones' : 'Show camera cones'}
          icon="vision"
          active={view.showCameraVision}
          onClick={() => toggle('showCameraVision')}
        />
        <ActionButton
          label={view.showNpcs ? 'Hide walkers' : 'Show walkers'}
          icon="person"
          active={view.showNpcs}
          onClick={() => toggle('showNpcs')}
        />
      </div>
    </div>
  );
}

interface ActionButtonProps {
  icon: PlotcraftIconName;
  label: string;
  active?: boolean;
  accent?: boolean;
  disabled?: boolean;
  /** Flip the glyph horizontally — Redo reuses the Undo arrow. */
  mirrorIcon?: boolean;
  onClick(): void;
}

function ActionButton({
  icon,
  label,
  active,
  accent,
  disabled,
  mirrorIcon,
  onClick,
}: ActionButtonProps): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      className={`pc-tile${active ? ' pc-tile--active' : ''}`}
      style={{
        width: '100%',
        minWidth: 36,
        height: 36,
        borderRadius: 10,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        opacity: disabled ? 0.35 : 1,
        cursor: disabled ? 'not-allowed' : 'pointer',
        color: accent && !active ? 'var(--pc-cyan-glow)' : undefined,
      }}
    >
      <Icon
        name={icon}
        size={18}
        style={mirrorIcon ? { transform: 'scaleX(-1)' } : undefined}
      />
    </button>
  );
}
