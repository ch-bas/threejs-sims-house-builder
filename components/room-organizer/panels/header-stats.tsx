'use client';

import { useEffect, useState } from 'react';
import { CURRENCY_SYMBOL, DEFAULT_BUDGET } from '../lib/constants';
import { totalCost } from '../lib/geometry';
import { Icon, type PlotcraftIconName } from '../plotcraft/icon';
import { useRoomEditor } from '../contexts';

export interface HeaderStatsProps {
  lastSavedAt?: number | null;
  saving?: boolean;
}

export function HeaderStats({
  lastSavedAt = null,
  saving = false,
}: HeaderStatsProps): JSX.Element {
  const { layout } = useRoomEditor();
  const budget = DEFAULT_BUDGET;
  const allItems = layout.floors.flatMap((floor) => floor.items);
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
      <SaveIndicator lastSavedAt={lastSavedAt} saving={saving} />
    </div>
  );
}

interface SaveIndicatorProps {
  lastSavedAt: number | null;
  saving: boolean;
}

function SaveIndicator({ lastSavedAt, saving }: SaveIndicatorProps): JSX.Element {
  const [, force] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => force((n) => n + 1), 10_000);
    return () => window.clearInterval(id);
  }, []);

  let label = 'Auto-save on';
  if (saving) label = 'Saving…';
  else if (lastSavedAt) label = `Saved ${formatRelative(Date.now() - lastSavedAt)}`;

  return (
    <div
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '4px 10px',
        color: 'var(--pc-paper-soft)',
        fontFamily: 'var(--pc-font-body)',
        fontSize: 11,
        fontWeight: 600,
      }}
    >
      <span
        aria-hidden
        style={{
          color: saving ? 'var(--pc-cyan-glow)' : 'var(--pc-paper-soft)',
          display: 'inline-flex',
          animation: saving ? 'pcHaloPulse 1.6s ease-in-out infinite' : undefined,
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
