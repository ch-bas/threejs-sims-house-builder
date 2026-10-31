'use client';

import { onRovingKeyDown } from '../hooks/roving-keys';
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
  return (
    <div
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
            // WAI-ARIA tabs with automatic activation (#434).
            onKeyDown={(event) => onRovingKeyDown(event, (index) => {
              const next = TABS[index];
              if (next) onChange(next.key);
            })}
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
