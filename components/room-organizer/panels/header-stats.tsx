'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useLengthUnit } from '../contexts';
import { useLayout } from '../hooks/use-layout-store';
import { useMediaQuery } from '../hooks/use-media-query';
import { budgetOf, budgetSpent } from '../lib/budget';
import { formatAge, formatMoney, formatSizeCompact } from '../lib/format';
import { HEADER_HIDDEN_QUERY } from '../lib/overlay-queue';
import { ENTRANCE_DOOR_ID } from '../lib/street';
import { Icon, type PlotcraftIconName } from '../plotcraft/icon';
import { OverlayStackPortal } from './overlay-stack';
import type { SaveFailureReason } from '../lib/persistence';

export interface HeaderStatsProps {
  lastSavedAt?: number | null;
  saving?: boolean;
  /** Why the last save failed, or null (#472). */
  saveError?: SaveFailureReason | null;
  /** Another tab saved a different layout (#123). */
  remoteChange?: boolean;
  onAdoptRemote?(): void;
  onDismissRemote?(): void;
  /** Share a link to the house (#722), through `lib/share-delivery.ts`. */
  onShare?(): void;
}

/**
 * What gives way, in order, when the stats don't fit one row (#939): the
 * save status's words first (its icon stays, the words stay for screen readers),
 * then the chips' captions (their icons stay). A failed save keeps its words.
 */
export type HeaderFitStep = 'saveLabel' | 'chipLabels';

export function headerFitSteps(saveFailed: boolean): readonly HeaderFitStep[] {
  return saveFailed ? ['chipLabels'] : ['saveLabel', 'chipLabels'];
}

/** The steps taken at `level`: none at 0, the first one at 1, and so on. */
export function headerFitDrops(level: number, saveFailed: boolean): ReadonlySet<HeaderFitStep> {
  return new Set(headerFitSteps(saveFailed).slice(0, Math.max(0, level)));
}

/** The level to try next: one step further while the row wraps and a step is left. */
export function nextHeaderFit(level: number, wraps: boolean, saveFailed: boolean): number {
  return wraps && level < headerFitSteps(saveFailed).length ? level + 1 : level;
}

/** Whether the row's shown children sit on more than one line. */
function rowWraps(row: HTMLElement): boolean {
  const shown = [...row.children].filter((child) => child.getClientRects().length > 0);
  const first = shown[0];
  if (!first || shown.length < 2) return false;
  const firstBottom = first.getBoundingClientRect().bottom;
  return shown.some((child) => child.getBoundingClientRect().top >= firstBottom);
}

export function HeaderStats({
  lastSavedAt = null,
  saving = false,
  saveError = null,
  remoteChange = false,
  onAdoptRemote,
  onDismissRemote,
  onShare,
}: HeaderStatsProps): JSX.Element {
  // `layout` from the store selector — re-renders only on layout changes.
  const layout = useLayout();
  const unit = useLengthUnit();
  const budget = budgetOf(layout);
  // The porch door is structure, not furniture: older saves still carry its
  // catalog price (#382).
  const allItems = layout.floors.flatMap((floor) => floor.items).filter((item) => item.id !== ENTRANCE_DOOR_ID);
  // Under the hard budget, what selling back lost is spent too (#463e).
  const cost = budgetSpent(layout);
  const overBudget = cost > budget;
  const ratio = budget > 0 ? Math.min(1, cost / budget) : 0;
  const room = formatSizeCompact(layout.width, layout.height, unit);
  const costText = `${formatMoney(cost, { compact: true })} / ${formatMoney(budget, { compact: true })}`;
  const saveFailed = saveError !== null;

  // One row at 1440 px whatever the unit (#939): render in full, and while
  // the row wraps, give way one step at a time, before the frame paints. What
  // the chips show, the window size or the fonts start again from the full
  // row; a save doesn't, or the bar would slide on every autosave. The save
  // words growing ("Saved 12 min ago") step on through the ResizeObserver.
  const rowRef = useRef<HTMLDivElement>(null);
  const [resizes, setResizes] = useState(0);
  const fitKey = [allItems.length, layout.floors.length, room, costText, layout.name, saveError, remoteChange, resizes].join('|');
  // The level holds for the key it was found under; a new key starts at 0.
  // State changes only when a step is taken, so a row that fits renders once.
  const [fit, setFit] = useState({ key: fitKey, level: 0 });
  const level = fit.key === fitKey ? fit.level : 0;
  const current = useRef({ key: fitKey, level, saveFailed });
  useLayoutEffect(() => {
    current.current = { key: fitKey, level, saveFailed };
    const row = rowRef.current;
    if (!row) return;
    const next = nextHeaderFit(level, rowWraps(row), saveFailed);
    if (next !== level) setFit({ key: fitKey, level: next });
  }, [fitKey, level, saveFailed]);
  useEffect(() => {
    const restart = () => setResizes((n) => n + 1);
    window.addEventListener('resize', restart);
    // Metrics change once the display font arrives.
    void document.fonts?.ready.then(restart);
    const row = rowRef.current;
    const observer =
      row && typeof ResizeObserver !== 'undefined'
        ? new ResizeObserver(() => {
            const { key, level: shown, saveFailed: failed } = current.current;
            const next = nextHeaderFit(shown, rowWraps(row), failed);
            if (next !== shown) setFit({ key, level: next });
          })
        : null;
    if (row) observer?.observe(row);
    return () => {
      window.removeEventListener('resize', restart);
      observer?.disconnect();
    };
  }, []);
  const drops = headerFitDrops(level, saveFailed);
  const captions = !drops.has('chipLabels');

  return (
    <div ref={rowRef} style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
      <Chip icon="box" label="Items" value={allItems.length.toString()} caption={captions} />
      <Chip icon="stairs" label="Floors" value={layout.floors.length.toString()} caption={captions} />
      <Chip icon="ruler" label="Room" value={room} caption={captions} />
      <Chip
        icon="coin"
        label="Cost"
        value={costText}
        intent={overBudget ? 'danger' : ratio > 0.85 ? 'warning' : 'normal'}
        caption={captions}
      />
      <SaveIndicator
        lastSavedAt={lastSavedAt}
        saving={saving}
        saveError={saveError}
        showLabel={!drops.has('saveLabel')}
      />
      {onShare && (
        <button
          type="button"
          className="pc-tile pc-share-button"
          // Icon only: the stats must stay one row at 1440 px.
          aria-label="Share a link to this house"
          title="Share a link to this house: it opens as a tour"
          onClick={onShare}
          // A held Enter shares once, not once per repeat.
          onKeyDown={(event) => {
            if (event.repeat && (event.key === 'Enter' || event.key === ' ')) event.preventDefault();
          }}
        >
          <Icon name="link" size={16} aria-hidden />
        </button>
      )}
      {remoteChange && (
        <RemoteChangeNotice onAdopt={onAdoptRemote} onDismiss={onDismissRemote} />
      )}
      {(saveError !== null || remoteChange) && (
        <StackedSaveAlerts
          saveError={saveError}
          remoteChange={remoteChange}
          onAdoptRemote={onAdoptRemote}
          onDismissRemote={onDismissRemote}
        />
      )}
    </div>
  );
}

/**
 * Where the stats box is hidden (tablets, phones, short screens), a failed
 * save and the cross-tab notice still have to reach the user: a save that
 * silently stops is data loss (#385). They move to the overlay stack under
 * the top pills, above any toast; the copies in the hidden box stay out of
 * sight and out of the accessibility tree.
 */
function StackedSaveAlerts({
  saveError,
  remoteChange,
  onAdoptRemote,
  onDismissRemote,
}: {
  saveError: SaveFailureReason | null;
  remoteChange: boolean;
  onAdoptRemote?: (() => void) | undefined;
  onDismissRemote?: (() => void) | undefined;
}): JSX.Element | null {
  const headerHidden = useMediaQuery(HEADER_HIDDEN_QUERY);
  if (!headerHidden) return null;
  return (
    <OverlayStackPortal slot="alert">
      {saveError !== null && (
        <div className="pc-glass pc-glass--dark pc-save-alert" style={{ borderRadius: 16 }}>
          <SaveIndicator lastSavedAt={null} saving={false} saveError={saveError} />
        </div>
      )}
      {remoteChange && <RemoteChangeNotice onAdopt={onAdoptRemote} onDismiss={onDismissRemote} />}
    </OverlayStackPortal>
  );
}

/**
 * Cross-tab notice (#123): another tab saved over this tab's layout. Autosave
 * stays last-writer-wins, but the race is made visible with a one-click,
 * undoable way to load the other tab's version.
 */
function RemoteChangeNotice({
  onAdopt,
  onDismiss,
}: {
  onAdopt?: (() => void) | undefined;
  onDismiss?: (() => void) | undefined;
}): JSX.Element {
  const buttonStyle: React.CSSProperties = {
    border: '1px solid var(--pc-warn-amber)',
    borderRadius: 999,
    background: 'transparent',
    color: 'var(--pc-warn-amber)',
    fontFamily: 'var(--pc-font-display)',
    fontWeight: 700,
    fontSize: 10,
    padding: '2px 8px',
    cursor: 'pointer',
  };
  return (
    <div
      role="status"
      // Coarse pointers get 44px tap areas on its buttons (globals.css).
      className="pc-remote-notice"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 8,
        borderRadius: 999,
        border: '1px solid var(--pc-warn-amber)',
        background: 'rgba(242,181,61,0.18)',
        padding: '4px 10px',
        color: 'var(--pc-warn-amber)',
        fontFamily: 'var(--pc-font-body)',
        fontSize: 11,
        fontWeight: 600,
      }}
    >
      <span>Changed in another tab</span>
      <button
        type="button"
        style={buttonStyle}
        onClick={onAdopt}
        title="Load the other tab's version (Ctrl+Z undoes it)"
      >
        Load
      </button>
      <button type="button" style={buttonStyle} onClick={onDismiss} title="Keep this tab's version" aria-label="Dismiss">
        ✕
      </button>
    </div>
  );
}

interface SaveIndicatorProps {
  lastSavedAt: number | null;
  saving: boolean;
  saveError: SaveFailureReason | null;
  /** False: icon only, the words kept for screen readers (#939). */
  showLabel?: boolean;
}

/**
 * What a failed save tells the user (#472): a full quota can be fixed by
 * freeing space, blocked storage can't — only an export keeps the work.
 */
const SAVE_FAILURE_COPY: Record<SaveFailureReason, { label: string; detail: string }> = {
  quota: {
    label: 'Storage full — changes not saved',
    detail:
      'Browser storage is full. Remove the floor-plan image, delete saved layouts, or delete recovered copies in Manage → Saved Layouts → History — or keep your work with Manage → Export / share → JSON.',
  },
  blocked: {
    label: 'Saving is blocked in this browser — export a JSON to keep your work',
    detail:
      'This browser blocks site storage (private mode, blocked cookies or a privacy setting), so nothing can be saved here. Manage → Export / share → JSON downloads your house.',
  },
  unknown: {
    label: 'Save failed — export a JSON to keep your work',
    detail: 'The browser refused to save the house. Manage → Export / share → JSON keeps your work.',
  },
};

function SaveIndicator({ lastSavedAt, saving, saveError, showLabel = true }: SaveIndicatorProps): JSX.Element {
  const [, force] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => force((n) => n + 1), 10_000);
    return () => window.clearInterval(id);
  }, []);

  // A failed save takes precedence — never claim "Saved" for a layout that
  // didn't actually persist.
  const failure = saveError ? SAVE_FAILURE_COPY[saveError] : null;
  let label = 'Auto-save on';
  if (failure) label = failure.label;
  else if (saving) label = 'Saving…';
  else if (lastSavedAt) label = `Saved ${formatAge(Date.now() - lastSavedAt, { seconds: true })}`;

  // Touch screens can't show the `title` tooltip: the advice opens in place.
  const [adviceOpen, setAdviceOpen] = useState(false);

  const iconColor = saveError
    ? 'var(--pc-danger, #f87171)'
    : saving
      ? 'var(--pc-cyan-glow)'
      : 'var(--pc-paper-soft)';

  return (
    <div
      role={failure ? 'alert' : undefined}
      title={failure?.detail}
      className="pc-save-indicator"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '4px 10px',
        color: saveError ? 'var(--pc-danger, #f87171)' : 'var(--pc-paper-soft)',
        fontFamily: 'var(--pc-font-body)',
        fontSize: 11,
        fontWeight: 600,
      }}
    >
      <span
        aria-hidden
        className={saving && !saveError ? 'pc-halo-pulse' : undefined}
        style={{
          color: iconColor,
          display: 'inline-flex',
        }}
      >
        <Icon name="save" size={14} />
      </span>
      <span className={showLabel ? 'pc-save-label' : 'pc-save-label sr-only'}>{label}</span>
      {failure && (
        // Shown on coarse pointers only (globals.css, "Overlays").
        <button
          type="button"
          className="pc-save-advice-toggle"
          aria-expanded={adviceOpen}
          onClick={() => setAdviceOpen((open) => !open)}
        >
          {adviceOpen ? 'Hide' : 'What to do'}
        </button>
      )}
      {failure && adviceOpen && <p className="pc-save-advice">{failure.detail}</p>}
    </div>
  );
}

interface ChipProps {
  icon: PlotcraftIconName;
  label: string;
  value: string;
  intent?: 'normal' | 'warning' | 'danger';
  /** False: icon and value only, the caption kept for screen readers (#939). */
  caption?: boolean;
}

function Chip({ icon, label, value, intent = 'normal', caption = true }: ChipProps): JSX.Element {
  const intentStyles: Record<NonNullable<ChipProps['intent']>, React.CSSProperties> = {
    normal: {
      background: 'rgba(255,255,255,0.10)',
      borderColor: 'var(--pc-glass-stroke)',
      color: 'var(--pc-paper)',
    },
    warning: {
      background: 'rgba(242,181,61,0.18)',
      borderColor: 'var(--pc-warn-amber)',
      color: 'var(--pc-warn-amber)',
    },
    danger: {
      background: 'rgba(228,82,72,0.20)',
      borderColor: 'var(--pc-demolish)',
      color: 'var(--pc-demolish-ink)',
    },
  };
  return (
    <div
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        // Tight enough that the bar stays one row at 1440 px with spaced
        // units and a five-figure cost (#438).
        gap: 6,
        borderRadius: 999,
        border: '1px solid',
        padding: '4px 10px 4px 8px',
        fontFamily: 'var(--pc-font-display)',
        fontWeight: 600,
        fontSize: 11,
        letterSpacing: '0.02em',
        fontVariantNumeric: 'tabular-nums',
        ...intentStyles[intent],
      }}
    >
      <Icon name={icon} size={14} />
      <span
        className={caption ? undefined : 'sr-only'}
        style={{
          // Full strength on a tinted chip: the label at 0.85 missed 4.5:1 (#432).
          opacity: intent === 'normal' ? 0.85 : 1,
          fontWeight: 600,
          letterSpacing: 'var(--pc-tr-caps)',
          textTransform: 'uppercase',
          fontSize: 10,
        }}
      >
        {label}:
      </span>
      <span style={{ fontWeight: 700 }}>{value}</span>
    </div>
  );
}
