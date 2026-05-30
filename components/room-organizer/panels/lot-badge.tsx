'use client';

import { Icon } from '../plotcraft/icon';
import { useRoomEditor } from '../contexts';

export interface LotBadgeProps {
  sidebarCollapsed: boolean;
  onToggleSidebar(): void;
}

export function LotBadge({ sidebarCollapsed, onToggleSidebar }: LotBadgeProps): JSX.Element {
  const { layout, activeFloor } = useRoomEditor();

  return (
    <div
      style={{
        position: 'absolute',
        top: 16,
        left: 16,
        zIndex: 30,
        display: 'flex',
        alignItems: 'center',
        gap: 8,
      }}
    >
      <div
        className="pc-glass pc-glass--dark"
        style={{
          padding: '8px 14px 8px 10px',
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          maxWidth: 320,
        }}
      >
        <div
          aria-hidden
          style={{
            height: 36,
            width: 36,
            borderRadius: 10,
            background: 'rgba(127,243,255,0.18)',
            border: '1px solid var(--pc-cyan-glow)',
            color: 'var(--pc-cyan-glow)',
            display: 'grid',
            placeItems: 'center',
            boxShadow: 'var(--pc-halo-cyan-soft)',
            flexShrink: 0,
          }}
        >
          <Icon name="home" size={18} />
        </div>
        <div style={{ minWidth: 0 }}>
          <p
            style={{
              margin: 0,
              fontFamily: 'var(--pc-font-display)',
              fontWeight: 800,
              fontSize: 15,
              lineHeight: 1.1,
              color: 'var(--pc-paper)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {layout.name || 'Untitled Home'}
          </p>
          <p
            className="pc-hud-header"
            style={{ fontSize: 9, opacity: 0.85, margin: '2px 0 0' }}
          >
            {layout.floors.length === 1
              ? '1 Floor'
              : `${layout.floors.length} Floors`}
            {' · '}
            {activeFloor.name}
          </p>
        </div>
      </div>
      <button
        type="button"
        onClick={onToggleSidebar}
        title={sidebarCollapsed ? 'Open panels' : 'Close panels'}
        className={`pc-glass pc-glass--dark pc-tile${
          sidebarCollapsed ? '' : ' pc-tile--active'
        }`}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          padding: '10px 12px',
          borderRadius: 14,
          fontFamily: 'var(--pc-font-display)',
          fontWeight: 700,
          fontSize: 10,
          letterSpacing: 'var(--pc-tr-caps)',
          textTransform: 'uppercase',
        }}
      >
        <Icon name="panels" size={16} />
      </button>
    </div>
  );
}
