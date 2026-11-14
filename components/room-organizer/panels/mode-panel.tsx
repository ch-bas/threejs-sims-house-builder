'use client';

import { forwardRef, useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { useEditorView, useEditorViewActions, useRoomEditor, useViewSettings } from '../contexts';
import { useEdgeVar } from '../hooks/use-edge-var';
import { NOT_WHILE_EXPLORING, useExploring } from '../hooks/use-exploring';
import { useBudgetRemaining, useFunds, useLayoutActions } from '../hooks/use-layout-store';
import { useMediaQuery } from '../hooks/use-media-query';
import { useRefusal } from '../hooks/use-refusal';
import { MAX_FUNDS, MIN_FUNDS, readFunds } from '../lib/budget';
import { CURRENCY_SYMBOL } from '../lib/constants';
import { formatAmount, formatMoney } from '../lib/format';
import { canVibrate, saveHapticsChoice } from '../lib/haptics';
import { COARSE_POINTER_QUERY } from '../lib/hud-layout';
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
  const view = useViewSettings('showCameraVision', 'showMinimap', 'showNpcs', 'snapToGrid', 'soundsEnabled', 'hapticsEnabled', 'view2D');
  // Only where a buzz can happen: a touch-first device with the API (#687).
  const coarsePointer = useMediaQuery(COARSE_POINTER_QUERY);
  const hapticsSwitch = coarsePointer && canVibrate();
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
  const funds = useFunds();
  const fundsDelta = useFundsDelta(remaining, funds);
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
            {formatMoney(fundsDelta.amount, { signed: true, compact: true })}
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
          {formatMoney(remaining ?? totalCost, { compact: true })}
        </div>
        <div
          className="pc-hud-header"
          style={{ fontSize: 9, opacity: 0.8, marginTop: 2 }}
        >
          {/* "Funds" folds away on a phone while the funds field shares the line (#609). */}
          {remaining === null ? 'Cost' : <><span className="pc-funds-left-word">Funds </span>Left</>}
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
        {remaining !== null && <FundsField disabled={exploring} />}
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
          label={history.undoLabel ? `Undo: ${history.undoLabel}` : 'Undo'}
          icon="undo"
          disabled={!history.canUndo}
          onClick={history.undo}
        />
        <ActionButton
          label={history.redoLabel ? `Redo: ${history.redoLabel}` : 'Redo'}
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
        {hapticsSwitch && (
          <ActionButton
            label={view.hapticsEnabled ? 'Turn off vibration' : 'Turn on vibration'}
            icon="vibrate"
            active={view.hapticsEnabled}
            onClick={() => {
              saveHapticsChoice(!view.hapticsEnabled);
              toggle('hapticsEnabled');
            }}
          />
        )}
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

/**
 * The house's funds (#609), shown while the hard budget is on, on the
 * switch's line: what Funds Left counts down from. Typed in and set on
 * Enter or when the field loses focus; Escape puts it back. A typed amount
 * that isn't plain is refused and the funds stay as they were.
 */
function FundsField({ disabled }: { disabled: boolean }): JSX.Element {
  const funds = useFunds();
  const { setFunds } = useLayoutActions();
  const { history } = useRoomEditor();
  const refuse = useRefusal();
  // The text being typed, or null while the field shows the funds.
  const [draft, setDraft] = useState<string | null>(null);
  const draftRef = useRef<string | null>(null);
  const justFocused = useRef(false);
  const selectOnRender = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);
  useLayoutEffect(() => {
    if (!selectOnRender.current) return;
    selectOnRender.current = false;
    inputRef.current?.select();
  }, [draft]);
  const edit = (text: string | null): void => {
    draftRef.current = text;
    setDraft(text);
  };
  const commit = (): void => {
    const text = draftRef.current;
    edit(null);
    const entry = text === null ? null : readFunds(text);
    if (entry === null) return;
    if ('refusal' in entry) {
      refuse(entry.refusal);
      return;
    }
    if (entry.funds === funds) return;
    // A discrete edit: its own undo step, never merged with the next one.
    history.commitNow();
    setFunds(entry.funds);
    if (entry.note !== null) refuse(entry.note);
  };
  const shown = draft ?? formatAmount(funds);
  const hint = `Funds: what the house may spend, ${formatMoney(MIN_FUNDS)} to ${formatMoney(MAX_FUNDS)}`;
  return (
    <label className="pc-funds-field" title={disabled ? NOT_WHILE_EXPLORING : hint}>
      <span aria-hidden className="pc-funds-field__currency">
        <span className="pc-funds-field__of">of </span>
        {CURRENCY_SYMBOL}
      </span>
      <input
        ref={inputRef}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        spellCheck={false}
        aria-label="Funds"
        // Setting the funds writes `layout.budget`: a house edit (#700).
        disabled={disabled}
        className="pc-funds-field__input"
        value={shown}
        onFocus={() => {
          // Selected once the plain number is in: a new value moves the caret.
          selectOnRender.current = true;
          justFocused.current = true;
          edit(String(funds));
        }}
        // The click that focused the field would put the caret in and drop
        // the selection, and typing would add to the old amount.
        onMouseUp={(event) => {
          if (justFocused.current) event.preventDefault();
          justFocused.current = false;
        }}
        onChange={(event) => edit(event.currentTarget.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key !== 'Enter' && event.key !== 'Escape') return;
          event.preventDefault();
          event.stopPropagation();
          if (event.repeat) return;
          if (event.key === 'Escape') edit(null);
          else commit();
          event.currentTarget.blur();
        }}
        // As wide as what it holds, up to "100,000,000".
        style={{ width: fieldWidth(shown), ...(disabled ? DISABLED_TILE : {}) }}
      />
    </label>
  );
}

const FUNDS_DELTA_MS = 1600;

/** The field's width for `text`: a digit is about 1ch, a comma half that, plus padding and border. */
function fieldWidth(text: string): string {
  const digits = Math.min(12, Math.max(4, text.replace(/[^\d]/g, '').length));
  const marks = Math.min(4, text.length - text.replace(/[^\d]/g, '').length);
  return `calc(${digits + marks / 2}ch + 12px)`;
}

/**
 * The last change to the funds, shown for a moment beside them: a sale
 * floats up green, a purchase red (#463e). Null while the hard budget is
 * off, and not when it is switched on, nor when the funds themselves are
 * set or that is undone (#609): nothing was bought or sold.
 */
function useFundsDelta(remaining: number | null, funds: number): { amount: number; key: number } | null {
  const [delta, setDelta] = useState<{ amount: number; key: number } | null>(null);
  const previous = useRef({ remaining, funds });
  useEffect(() => {
    const before = previous.current;
    previous.current = { remaining, funds };
    if (remaining === null) {
      setDelta(null);
      return undefined;
    }
    const prior = before.remaining;
    if (prior === null || prior === remaining || before.funds !== funds) return undefined;
    setDelta((current) => ({ amount: remaining - prior, key: (current?.key ?? 0) + 1 }));
    const timer = window.setTimeout(() => setDelta(null), FUNDS_DELTA_MS);
    return () => window.clearTimeout(timer);
  }, [remaining, funds]);
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
