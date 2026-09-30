'use client';

import { useState } from 'react';
import { useRoomEditor } from '../contexts';
import { categoriesForMode, type BuildToolKey } from '../lib/modes';
import { Icon, type PlotcraftIconName } from '../plotcraft/icon';

export type BuildToolCategory = BuildToolKey;

interface ToolSpec {
  icon: PlotcraftIconName;
  label: string;
  /** Tooltip; the tile label is too short to say what a category holds. */
  hint: string;
}

const TOOL_SPECS: Readonly<Record<BuildToolCategory, ToolSpec>> = {
  structure:   { icon: 'window',    label: 'Openings', hint: 'Doors, windows, stairs' },
  walls:       { icon: 'wall',      label: 'Walls',    hint: 'Draw interior walls, stamp room shapes' },
  seating:     { icon: 'chair',     label: 'Seating',  hint: 'Seating' },
  tables:      { icon: 'table',     label: 'Tables',   hint: 'Tables' },
  bedroom:     { icon: 'bed',       label: 'Bedroom',  hint: 'Bedroom' },
  storage:     { icon: 'bookshelf', label: 'Storage',  hint: 'Storage' },
  kitchen:     { icon: 'fireplace', label: 'Kitchen',  hint: 'Kitchen' },
  bathroom:    { icon: 'bath',      label: 'Bathroom', hint: 'Bathroom' },
  decor:       { icon: 'plant',     label: 'Decor',    hint: 'Decor' },
  electronics: { icon: 'light',     label: 'Tech',     hint: 'Electronics' },
  security:    { icon: 'vision',    label: 'Security', hint: 'Security cameras' },
  outdoor:     { icon: 'tree',      label: 'Outdoor',  hint: 'Outdoor' },
  people:      { icon: 'person',    label: 'People',   hint: 'People and pets' },
};

export interface BuildToolsPanelProps {
  active: BuildToolCategory;
  drawWallMode: boolean;
  onSelect(tool: BuildToolCategory): void;
}

export function BuildToolsPanel(props: BuildToolsPanelProps): JSX.Element {
  const { gameMode } = useRoomEditor();
  const [collapsed, setCollapsed] = useState(false);
  // DESIGN lists the structure tools, FURNISH the furniture ones — the mode
  // pill is the way to the other half, not a longer grid (#151).
  const tools = categoriesForMode(gameMode);
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
          // DESIGN has two tools; a fixed three-column grid would leave a
          // hole beside them.
          gridTemplateColumns: `repeat(${Math.min(3, Math.max(1, tools.length))}, 1fr)`,
          gap: 4,
        }}
      >
        {tools.map((key) => {
          const tool = TOOL_SPECS[key];
          const isActive =
            props.active === key || (key === 'walls' && props.drawWallMode);
          return (
            <button
              key={key}
              type="button"
              onClick={() => props.onSelect(key)}
              title={tool.hint}
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
