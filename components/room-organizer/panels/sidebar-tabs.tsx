'use client';

import { useRef, type KeyboardEvent } from 'react';
import { Icon, type PlotcraftIconName } from '../plotcraft/icon';

export type SidebarTab = 'build' | 'buy' | 'style' | 'manage';

interface TabSpec {
  key: SidebarTab;
  icon: PlotcraftIconName;
  label: string;
  hint: string;
}

const TABS: readonly TabSpec[] = [
  { key: 'build',  icon: 'build',   label: 'Build',  hint: 'Floors, walls, roof, dimensions' },
  { key: 'buy',    icon: 'buy',     label: 'Buy',    hint: 'Catalogue, sets, placed items' },
  { key: 'style',  icon: 'sparkle', label: 'Style',  hint: 'Themes, time of day, finishes' },
  { key: 'manage', icon: 'box',     label: 'Manage', hint: 'Templates, library, actions, stats' },
];

/** The drawer's `<aside>`: the panel toggle names it in `aria-controls`. */
export const SIDE_PANELS_ID = 'pc-side-panels';
/** At this width the drawer fills the screen, over the item popover (globals.css). */
export const DRAWER_FULL_SCREEN_QUERY = '(max-width: 768px)';
/** The drawer's one tab panel, shared by every tab. */
export const SIDE_TABPANEL_ID = 'pc-side-tabpanel';
export function sideTabId(tab: SidebarTab): string {
  return `pc-side-tab-${tab}`;
}

export interface SidebarTabsProps {
  active: SidebarTab;
  onChange(tab: SidebarTab): void;
}

export function SidebarTabs({ active, onChange }: SidebarTabsProps): JSX.Element {
  const listRef = useRef<HTMLDivElement>(null);
  // WAI-ARIA tabs with automatic activation (#434): one tab stop, the arrow
  // keys (and Home/End) move between tabs and open the one they land on.
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    // Alt+Left is the browser's Back; leave modified keys alone.
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const index = TABS.findIndex((tab) => sideTabId(tab.key) === event.currentTarget.id);
    let next: number;
    switch (event.key) {
      case 'ArrowRight':
        next = (index + 1) % TABS.length;
        break;
      case 'ArrowLeft':
        next = (index - 1 + TABS.length) % TABS.length;
        break;
      case 'Home':
        next = 0;
        break;
      case 'End':
        next = TABS.length - 1;
        break;
      default:
        return;
    }
    // Kept from the editor's window shortcuts, where arrows nudge the selection.
    event.preventDefault();
    event.stopPropagation();
    const tab = TABS[next];
    if (!tab) return;
    onChange(tab.key);
    listRef.current?.querySelector<HTMLButtonElement>(`#${sideTabId(tab.key)}`)?.focus();
  };
  return (
    <div
      ref={listRef}
      role="tablist"
      aria-label="Panel sections"
      className="pc-glass pc-glass--dark sticky top-0 z-10"
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(4, 1fr)',
        gap: 6,
        padding: 6,
      }}
    >
      {TABS.map((tab) => {
        const isActive = active === tab.key;
        return (
          <button
            key={tab.key}
            type="button"
            role="tab"
            id={sideTabId(tab.key)}
            aria-selected={isActive}
            aria-controls={SIDE_TABPANEL_ID}
            tabIndex={isActive ? 0 : -1}
            onClick={() => onChange(tab.key)}
            onKeyDown={onKeyDown}
            title={tab.hint}
            className={`pc-tile${isActive ? ' pc-tile--active' : ''}`}
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 4,
              padding: '10px 6px',
              borderRadius: 12,
            }}
          >
            <Icon name={tab.icon} size={20} />
            <span
              style={{
                fontFamily: 'var(--pc-font-display)',
                fontWeight: 700,
                fontSize: 10,
                letterSpacing: 'var(--pc-tr-caps)',
                textTransform: 'uppercase',
                color: isActive ? 'var(--pc-cyan-glow)' : 'var(--pc-paper-soft)',
              }}
            >
              {tab.label}
            </span>
          </button>
        );
      })}
    </div>
  );
}
