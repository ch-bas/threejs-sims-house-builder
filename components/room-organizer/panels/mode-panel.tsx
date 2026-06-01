'use client';

import { CURRENCY_SYMBOL } from '../lib/constants';
import type { GameMode } from '../lib/types';
import { Icon, type PlotcraftIconName } from '../plotcraft/icon';
import { useRoomEditor } from '../contexts';

export type { GameMode };

export interface ModePanelProps {
  onSetMode(mode: GameMode): void;
  onSurprise(): void;
}

const MODES: ReadonlyArray<{
  key: GameMode;
  label: string;
  icon: PlotcraftIconName;
  hint: string;
}> = [
  { key: 'live',  label: 'EXPLORE', icon: 'live',  hint: 'Walkthrough mode' },
  { key: 'build', label: 'DESIGN', icon: 'build', hint: 'Walls, windows, doors' },
  { key: 'buy',   label: 'FURNISH', icon: 'buy',   hint: 'Furniture catalog' },
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
          Total Spent
        </div>
      </div>

      <div
        className="pc-mode-pill"
        role="tablist"
        aria-label="Game mode"
        style={{ alignSelf: 'stretch', justifyContent: 'space-between' }}
      >
        {MODES.map((entry) => {
          const isActive = gameMode === entry.key;
          return (
            <button
              key={entry.key}
              type="button"
              role="tab"
              aria-selected={isActive}
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

      <div
        style={{
          background: 'rgba(0, 0, 0, 0.20)',
          border: '1px solid rgba(255, 255, 255, 0.08)',
          borderRadius: 12,
          padding: 4,
          boxShadow: 'inset 0 2px 4px rgba(0, 0, 0, 0.30)',
          display: 'flex',
          gap: 4,
        }}
      >
        <ActionButton
          label="Speed up time"
          icon="fastfwd"
          active={autoCycleLighting}
          onClick={() => setAutoCycleLighting((cur) => !cur)}
        />
        <ActionButton
          label="Undo"
          icon="undo"
          disabled={!history.canUndo}
          onClick={history.undo}
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
  onClick(): void;
}

function ActionButton({
  icon,
  label,
  active,
  accent,
  disabled,
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
        width: 36,
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
      <Icon name={icon} size={18} />
    </button>
  );
}
