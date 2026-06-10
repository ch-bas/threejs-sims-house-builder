'use client';

import { useState } from 'react';
import { Icon, type PlotcraftIconName } from '../plotcraft/icon';
import type { FurnitureCategory } from '../lib/types';

export type BuildToolCategory = FurnitureCategory | 'walls';

interface ToolSpec {
  key: BuildToolCategory;
  icon: PlotcraftIconName;
  label: string;
}

const TOOLS: readonly ToolSpec[] = [
  { key: 'seating',     icon: 'chair',     label: 'Seating'  },
  { key: 'structure',   icon: 'window',    label: 'Windows'  },
  { key: 'walls',       icon: 'wall',      label: 'Walls'    },
  { key: 'tables',      icon: 'table',     label: 'Tables'   },
  { key: 'bedroom',     icon: 'bed',       label: 'Bedroom'  },
  { key: 'kitchen',     icon: 'fireplace', label: 'Kitchen'  },
  { key: 'bathroom',    icon: 'bath',      label: 'Bathroom' },
  { key: 'decor',       icon: 'plant',     label: 'Decor'    },
  { key: 'electronics', icon: 'light',     label: 'Tech'     },
  { key: 'security',    icon: 'vision',    label: 'Security' },
  { key: 'outdoor',     icon: 'tree',      label: 'Outdoor'  },
  { key: 'people',      icon: 'person',    label: 'People'   },
];

export interface BuildToolsPanelProps {
  active: BuildToolCategory;
  drawWallMode: boolean;
  onSelect(tool: BuildToolCategory): void;
}

export function BuildToolsPanel(props: BuildToolsPanelProps): JSX.Element {
  const [collapsed, setCollapsed] = useState(false);
  return (
    <div
      className="pointer-events-auto pc-glass pc-build-tools"
      style={{ width: 232, padding: 'var(--pc-s-3)' }}
    >
      {/* Header doubles as the show/hide toggle. */}
      <div className="pc-build-tools-header">
        <button
          type="button"
          onClick={() => setCollapsed((c) => !c)}
          aria-expanded={!collapsed}
          title={collapsed ? 'Show build tools' : 'Hide build tools'}
          className="pc-hud-header"
          style={{
            fontSize: 11,
            marginBottom: collapsed ? 0 : 8,
            paddingLeft: 2,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            width: '100%',
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            color: 'inherit',
          }}
        >
          <span>Build Tools</span>
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
            {collapsed ? '▸' : '▾'}
          </span>
        </button>
      </div>

      {/* Desktop: 3-col grid */}
      {!collapsed && (
      <div
        className="pc-build-tools-grid"
        style={{
          background: 'rgba(0, 0, 0, 0.20)',
          border: '1px solid rgba(255, 255, 255, 0.08)',
          borderRadius: 14,
          padding: 6,
          boxShadow: 'inset 0 2px 6px rgba(0, 0, 0, 0.35)',
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          gap: 4,
        }}
      >
        {TOOLS.map((tool) => {
          const isActive =
            props.active === tool.key || (tool.key === 'walls' && props.drawWallMode);
          return (
            <button
              key={tool.key}
              type="button"
              onClick={() => props.onSelect(tool.key)}
              title={tool.label}
              aria-pressed={isActive}
              className={`pc-tile${isActive ? ' pc-tile--active' : ''}`}
              style={{
                height: 52,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 3,
                padding: '4px 2px',
                overflow: 'hidden',
              }}
            >
              <Icon name={tool.icon} size={18} />
              <span
                className="pc-build-tools-label"
                style={{
                  fontFamily: 'var(--pc-font-display)',
                  fontWeight: 600,
                  fontSize: 8,
                  letterSpacing: '0.06em',
                  textTransform: 'uppercase',
                  color: isActive ? 'var(--pc-cyan-glow)' : 'var(--pc-paper-soft)',
                  lineHeight: 1,
                  maxWidth: '100%',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {tool.label}
              </span>
            </button>
          );
        })}
      </div>
      )}
    </div>
  );
}
