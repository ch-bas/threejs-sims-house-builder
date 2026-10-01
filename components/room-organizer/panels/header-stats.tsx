'use client';

import { useEffect, useState } from 'react';
import { useLayout } from '../hooks/use-layout-store';
import { CURRENCY_SYMBOL, DEFAULT_BUDGET } from '../lib/constants';
import { totalCost } from '../lib/geometry';
import { ENTRANCE_DOOR_ID } from '../lib/street';
import { Icon, type PlotcraftIconName } from '../plotcraft/icon';
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
}

export function HeaderStats({
  lastSavedAt = null,
  saving = false,
  saveError = null,
  remoteChange = false,
  onAdoptRemote,
  onDismissRemote,
}: HeaderStatsProps): JSX.Element {
  // `layout` from the store selector — re-renders only on layout changes.
  const layout = useLayout();
  const budget = DEFAULT_BUDGET;
  // The porch door is structure, not furniture: older saves still carry its
  // catalog price (#382).
  const allItems = layout.floors.flatMap((floor) => floor.items).filter((item) => item.id !== ENTRANCE_DOOR_ID);
  const cost = totalCost(allItems);
  const overBudget = cost > budget;
  const ratio = budget > 0 ? Math.min(1, cost / budget) : 0;

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
      <Chip icon="box" label="Items" value={allItems.length.toString()} />
      <Chip icon="stairs" label="Floors" value={layout.floors.length.toString()} />
      <Chip icon="ruler" label="Room" value={`${layout.width}m × ${layout.height}m`} />
      <Chip
        icon="coin"
        label="Cost"
        value={`${CURRENCY_SYMBOL}${cost.toLocaleString()} / ${CURRENCY_SYMBOL}${budget.toLocaleString()}`}
        intent={overBudget ? 'danger' : ratio > 0.85 ? 'warning' : 'normal'}
      />
      <SaveIndicator lastSavedAt={lastSavedAt} saving={saving} saveError={saveError} />
      {remoteChange && (
        <RemoteChangeNotice onAdopt={onAdoptRemote} onDismiss={onDismissRemote} />
      )}
    </div>
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
}

/**
 * What a failed save tells the user (#472): a full quota can be fixed by
 * freeing space, blocked storage can't — only an export keeps the work.
 */
const SAVE_FAILURE_COPY: Record<SaveFailureReason, { label: string; detail: string }> = {
  quota: {
    label: 'Storage full — changes not saved',
    detail:
      'Browser storage is full. Remove the floor-plan image or delete saved layouts in Manage, or keep your work with Manage → Export / share → JSON.',
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

function SaveIndicator({ lastSavedAt, saving, saveError }: SaveIndicatorProps): JSX.Element {
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
  else if (lastSavedAt) label = `Saved ${formatRelative(Date.now() - lastSavedAt)}`;

  const iconColor = saveError
    ? 'var(--pc-danger, #f87171)'
    : saving
      ? 'var(--pc-cyan-glow)'
      : 'var(--pc-paper-soft)';

  return (
    <div
      role={failure ? 'alert' : undefined}
      title={failure?.detail}
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
        style={{
          color: iconColor,
          display: 'inline-flex',
          animation: saving && !saveError ? 'pcHaloPulse 1.6s ease-in-out infinite' : undefined,
        }}
      >
        <Icon name="save" size={14} />
      </span>
      <span>{label}</span>
    </div>
  );
}

function formatRelative(ms: number): string {
  if (ms < 5_000) return 'just now';
  if (ms < 60_000) return `${Math.floor(ms / 1000)}s ago`;
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ago`;
  return `${Math.floor(ms / 3_600_000)}h ago`;
}

interface ChipProps {
  icon: PlotcraftIconName;
  label: string;
  value: string;
  intent?: 'normal' | 'warning' | 'danger';
}

function Chip({ icon, label, value, intent = 'normal' }: ChipProps): JSX.Element {
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
      color: 'var(--pc-demolish)',
    },
  };
  return (
    <div
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 8,
        borderRadius: 999,
        border: '1px solid',
        padding: '4px 12px 4px 10px',
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
        style={{
          opacity: 0.7,
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
