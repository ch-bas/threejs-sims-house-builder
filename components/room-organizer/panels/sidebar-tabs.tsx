'use client';

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
  { key: 'buy',    icon: 'buy',     label: 'Buy',    hint: 'Catalog, sets, placed items' },
  { key: 'style',  icon: 'sparkle', label: 'Style',  hint: 'Themes, time of day, finishes' },
  { key: 'manage', icon: 'box',     label: 'Manage', hint: 'Templates, library, actions, stats' },
];

export interface SidebarTabsProps {
  active: SidebarTab;
  onChange(tab: SidebarTab): void;
}

export function SidebarTabs({ active, onChange }: SidebarTabsProps): JSX.Element {
  return (
    <div
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
            onClick={() => onChange(tab.key)}
            title={tab.hint}
            aria-current={isActive ? 'true' : undefined}
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
