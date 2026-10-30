'use client';

import { forwardRef, useCallback, useEffect, useId, useRef, useState } from 'react';
import { useEditorView, useEditorViewActions, useRoomEditor, useViewSettings } from '../contexts';
import { useEdgeVar } from '../hooks/use-edge-var';
import { NOT_WHILE_EXPLORING, useExploring } from '../hooks/use-exploring';
import { useBudgetRemaining, useLayoutActions } from '../hooks/use-layout-store';
import { CURRENCY_SYMBOL } from '../lib/constants';
import { ENTRANCE_DOOR_ID } from '../lib/street';
import { Icon, type PlotcraftIconName } from '../plotcraft/icon';
import { ViewOptionsMenu } from './view-options';
import { DISABLED_TILE } from './wall-display-pill';
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
  { key: 'buy',   label: 'FURNISH', icon: 'buy',   hint: 'Furnish — the furniture catalogue' },
];

export function ModePanel({ onSetMode, onSurprise }: ModePanelProps): JSX.Element {
  const { layout, history } = useRoomEditor();
  const view = useViewSettings('showCameraVision', 'showMinimap', 'showNpcs', 'snapToGrid', 'soundsEnabled', 'view2D');
  const { setAutoCycleLighting, toggle } = useEditorViewActions();
  const gameMode = useEditorView((state) => state.gameMode);
  const exploring = useExploring();
  /** A 3D-only control's label, which says so while the plan is shown. */
  const in3D = (label: string): string => (view.view2D ? `${label} — switch back to 3D view` : label);
  const autoCycleLighting = useEditorView((state) => state.autoCycleLighting);
  const totalCost = layout.floors.reduce(
    (sum, floor) =>
      sum + floor.items.reduce((acc, item) => acc + (item.id === ENTRANCE_DOOR_ID ? 0 : item.price ?? 0), 0),
    0
  );
  // Hard budget (#463e): the readout shows what's left to spend instead.
  const remaining = useBudgetRemaining();
  const fundsDelta = useFundsDelta(remaining);
  const { setHardBudget } = useLayoutActions();
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
      data-hard-budget={remaining !== null ? '' : undefined}
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
      <div style={{ textAlign: 'right', position: 'relative' }}>
        {fundsDelta && (
          <span
            key={fundsDelta.key}
            aria-hidden
            className="pc-funds-delta"
            style={{ color: fundsDelta.amount > 0 ? 'var(--pc-confirm-green)' : 'var(--pc-demolish-ink)' }}
          >
            {formatMoney(fundsDelta.amount, true)}
          </span>
        )}
        <div
          className="pc-money"
          style={{
            fontSize: 36,
            lineHeight: 1,
            letterSpacing: '-0.01em',
            ...(remaining !== null && remaining < 0 ? { color: 'var(--pc-demolish-ink)' } : {}),
          }}
        >
          {remaining === null ? `${CURRENCY_SYMBOL}${totalCost.toLocaleString()}` : formatMoney(remaining, false)}
        </div>
        <div
          className="pc-hud-header"
          style={{ fontSize: 9, opacity: 0.8, marginTop: 2 }}
        >
          {remaining === null ? 'Cost' : 'Funds Left'}
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={remaining !== null}
          aria-label="Hard budget"
          // Switching it writes `layout.budget`: a house edit, so not while
          // exploring (#700).
          disabled={exploring}
          title={exploring ? NOT_WHILE_EXPLORING : "Hard budget: can't buy past the budget, Demolish refunds 80%"}
          className="pc-budget-switch"
          onClick={() => setHardBudget(remaining === null)}
          {...(exploring ? { style: DISABLED_TILE } : {})}
        >
          <span aria-hidden className="pc-budget-switch__track">
            <span className="pc-budget-switch__knob" />
          </span>
          Hard budget
        </button>
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
            Hidden elsewhere, where the walls pill leads with it (#526). */}
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
          // EXPLORE looks around and never edits the house (#643).
          disabled={gameMode === 'live'}
          onClick={onSurprise}
        />
        {/* The minimap, the walkers and the camera cones are 3D-only too (#444). */}
        <ActionButton
          label={in3D(view.showMinimap ? 'Hide minimap' : 'Show minimap')}
          icon="minimap"
          active={view.showMinimap}
          disabled={view.view2D}
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
          label={in3D(view.showCameraVision ? 'Hide camera cones' : 'Show camera cones')}
          icon="vision"
          active={view.showCameraVision}
          disabled={view.view2D}
          onClick={() => toggle('showCameraVision')}
        />
        <ActionButton
          label={in3D(view.showNpcs ? 'Hide walkers' : 'Show walkers')}
          icon="person"
          active={view.showNpcs}
          disabled={view.view2D}
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

/** `$1,200`, `−$1,200`, or with `signed` `+$960`. */
function formatMoney(amount: number, signed: boolean): string {
  const sign = amount < 0 ? '−' : signed ? '+' : '';
  return `${sign}${CURRENCY_SYMBOL}${Math.abs(amount).toLocaleString()}`;
}

const FUNDS_DELTA_MS = 1600;

/**
 * The last change to the funds, shown for a moment beside them: a sale
 * floats up green, a purchase red (#463e). Null while the hard budget is
 * off, and not when it is switched on — nothing was bought or sold.
 */
function useFundsDelta(remaining: number | null): { amount: number; key: number } | null {
  const [delta, setDelta] = useState<{ amount: number; key: number } | null>(null);
  const previous = useRef(remaining);
  useEffect(() => {
    const before = previous.current;
    previous.current = remaining;
    if (remaining === null) {
      setDelta(null);
      return undefined;
    }
    if (before === null || before === remaining) return undefined;
    setDelta((current) => ({ amount: remaining - before, key: (current?.key ?? 0) + 1 }));
    const timer = window.setTimeout(() => setDelta(null), FUNDS_DELTA_MS);
    return () => window.clearTimeout(timer);
  }, [remaining]);
  return delta;
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
