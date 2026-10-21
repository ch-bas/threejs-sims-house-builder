'use client';

import { useMediaQuery } from '../hooks/use-media-query';
import { COMPACT_DOCK_QUERY } from '../lib/hud-layout';
import { Icon, type PlotcraftIconName } from '../plotcraft/icon';

/** Fold state owned by the HUD, so only one wall panel unfolds at a time. */
export interface PanelFold {
  open: boolean;
  onToggle(): void;
}

export interface DockFold {
  /** The HUD is docked (phone): the panel folds to its header. */
  docked: boolean;
  /** Whether the body shows: always off the dock, on demand in it. */
  open: boolean;
  toggle(): void;
}

/**
 * The wall tool's panels open folded on a phone, so the floor being drawn
 * on stays in view (#395); a tap on the header unfolds one. Off the dock
 * they are always open and show no toggle.
 */
export function useDockFold(fold: PanelFold | undefined): DockFold {
  const docked = useMediaQuery(COMPACT_DOCK_QUERY);
  return { docked, open: !docked || (fold?.open ?? true), toggle: () => fold?.onToggle() };
}

export interface DockFoldButtonProps {
  label: string;
  icon?: PlotcraftIconName;
  open: boolean;
  onToggle(): void;
}

/** A panel title that doubles as the fold toggle, styled like the catalog's. */
export function DockFoldButton({ label, icon, open, onToggle }: DockFoldButtonProps): JSX.Element {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      className="pc-hud-header"
      style={{
        fontSize: 11,
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        minHeight: 40,
        background: 'none',
        border: 'none',
        cursor: 'pointer',
        color: 'inherit',
        padding: 0,
      }}
    >
      {icon && <Icon name={icon} size={12} />}
      <span>{label}</span>
      <span
        aria-hidden
        className="pc-tile"
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 24,
          height: 24,
          borderRadius: 6,
          fontSize: 12,
          color: 'var(--pc-cyan-glow)',
        }}
      >
        {open ? '▾' : '▸'}
      </span>
    </button>
  );
}
