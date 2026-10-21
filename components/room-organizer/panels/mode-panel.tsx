'use client';

import { forwardRef, useCallback, useId, useRef, useState } from 'react';
import { useEditorView, useEditorViewActions, useRoomEditor, useViewSettings } from '../contexts';
import { useEdgeVar } from '../hooks/use-edge-var';
import { CURRENCY_SYMBOL } from '../lib/constants';
import { ENTRANCE_DOOR_ID } from '../lib/street';
import { Icon, type PlotcraftIconName } from '../plotcraft/icon';
import { ViewOptionsMenu } from './view-options';
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
  const { layout, history } = useRoomEditor();
  const view = useViewSettings('showCameraVision', 'showMinimap', 'showNpcs', 'snapToGrid', 'soundsEnabled', 'view2D');
  const { setAutoCycleLighting, toggle } = useEditorViewActions();
  const gameMode = useEditorView((state) => state.gameMode);
  const autoCycleLighting = useEditorView((state) => state.autoCycleLighting);
  const totalCost = layout.floors.reduce(
    (sum, floor) =>
      sum + floor.items.reduce((acc, item) => acc + (item.id === ENTRANCE_DOOR_ID ? 0 : item.price ?? 0), 0),
    0
  );
  const [viewMenuOpen, setViewMenuOpen] = useState(false);
  // Docked on a phone, the action row folds behind ⋯ except Undo and Redo
  // (#395). The toggle is hidden at every other size.
  const [moreOpen, setMoreOpen] = useState(false);
  // The View menu opens upward from here; in the dock it is capped to the
  // room above this panel.
  const panelRef = useRef<HTMLDivElement>(null);
  useEdgeVar(panelRef, '--pc-mode-top', 'top');
  const viewButtonRef = useRef<HTMLButtonElement>(null);
  const viewMenuId = useId();
  const closeViewMenu = useCallback(() => setViewMenuOpen(false), []);

  return (
    <div
      ref={panelRef}
      className="pointer-events-auto pc-glass pc-mode-panel"
      data-scene-occluder=""
      data-more-open={moreOpen ? '' : undefined}
      style={{
        position: 'relative',
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

      {/* A wrapping grid, not a flex row: ten 36 px buttons don't fit the
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
        {/* The two groups are `display: contents` — one grid, as before —
            except in the phone dock, which lays them out apart. */}
        <div className="pc-mode-actions-primary" style={{ display: 'contents' }}>
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
        </div>
        <div className="pc-mode-actions-more" style={{ display: 'contents' }}>
        {/* Touch has no 2 key: the dock's tray carries the 2D/3D switch.
            Hidden elsewhere, where the key and the menus cover it. */}
        <ActionButton
          className="pc-mode-dock-only"
          label={view.view2D ? 'Show 3D view' : 'Show 2D plan'}
          icon={view.view2D ? 'box' : 'floor'}
          active={view.view2D}
          onClick={() => toggle('view2D')}
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
        <ActionButton
          ref={viewButtonRef}
          label="View options"
          icon="eye"
          active={viewMenuOpen}
          expanded={viewMenuOpen}
          controls={viewMenuId}
          onClick={() => setViewMenuOpen((open) => !open)}
        />
        </div>
      </div>
      <button
        type="button"
        className={`pc-tile pc-mode-more${moreOpen ? ' pc-tile--active' : ''}`}
        aria-expanded={moreOpen}
        aria-label={moreOpen ? 'Fewer controls' : 'More controls'}
        title={moreOpen ? 'Fewer controls' : 'More controls'}
        onClick={() => setMoreOpen((open) => !open)}
      >
        <svg viewBox="0 0 24 24" width={18} height={18} fill="currentColor" aria-hidden="true">
          <circle cx="6" cy="12" r="1.6" />
          <circle cx="12" cy="12" r="1.6" />
          <circle cx="18" cy="12" r="1.6" />
        </svg>
      </button>
      {viewMenuOpen && (
        <ViewOptionsMenu id={viewMenuId} anchorRef={viewButtonRef} onClose={closeViewMenu} />
      )}
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
  /** Extra class, e.g. a button that exists only in the phone dock. */
  className?: string;
  /** For a button that opens a menu: whether it is open, and the menu's id. */
  expanded?: boolean;
  controls?: string;
  onClick(): void;
}

const ActionButton = forwardRef<HTMLButtonElement, ActionButtonProps>(function ActionButton(
  { icon, label, active, accent, disabled, mirrorIcon, expanded, controls, onClick, className },
  ref
) {
  return (
    <button
      ref={ref}
      type="button"
      onClick={onClick}
      aria-expanded={expanded}
      aria-controls={expanded ? controls : undefined}
      disabled={disabled}
      title={label}
      aria-label={label}
      className={`pc-tile${active ? ' pc-tile--active' : ''}${className ? ` ${className}` : ''}`}
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
});
