'use client';

import { useEffect, useRef, type RefObject } from 'react';
import { useRoomEditor } from '../contexts';
import { toggleViewOption, type ViewOptionKey } from '../lib/view-options';
import { Icon, type PlotcraftIconName } from '../plotcraft/icon';

interface ViewOption {
  key: ViewOptionKey;
  label: string;
  hint: string;
  icon: PlotcraftIconName;
}

const GROUPS: ReadonlyArray<{ title: string; options: readonly ViewOption[] }> = [
  {
    title: 'View',
    options: [
      { key: 'measurementMode', label: 'Distance tool', hint: 'Click two floor points in 3D', icon: 'ruler' },
      { key: 'showItemLabels', label: 'Item labels', hint: 'Names above items in 3D', icon: 'tag' },
      { key: 'showHeatmap', label: 'Cost heatmap', hint: 'Tints the 2D plan by price', icon: 'coin' },
      { key: 'showOutdoor', label: 'Outdoor scenery', hint: 'Garden, trees and street', icon: 'tree' },
    ],
  },
  {
    title: 'Snapping',
    options: [
      { key: 'snapToWall', label: 'Snap to walls', hint: 'Pull dragged items flush', icon: 'wall' },
      { key: 'snapToItems', label: 'Snap to items', hint: 'Line up with neighbours', icon: 'magnet' },
    ],
  },
];

export interface ViewOptionsMenuProps {
  id: string;
  /** The button that opened the menu: a press on it toggles, not dismisses. */
  anchorRef: RefObject<HTMLElement>;
  onClose(): void;
}

/**
 * The View menu (#341): switches for the view features and snapping modes
 * that had state and renderers but no control. Opens above the mode panel;
 * Escape or a press anywhere else closes it — that press still reaches the
 * canvas, so the first distance point can be the click that dismisses it.
 */
export function ViewOptionsMenu({ id, anchorRef, onClose }: ViewOptionsMenuProps): JSX.Element {
  const { view, setView } = useRoomEditor();
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (menuRef.current?.contains(target) || anchorRef.current?.contains(target)) return;
      onClose();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      onClose();
      anchorRef.current?.focus();
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    // Capture, so Escape closes the menu before the editor deselects.
    window.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('keydown', onKeyDown, true);
    };
  }, [anchorRef, onClose]);

  return (
    <div
      ref={menuRef}
      id={id}
      role="group"
      aria-label="View options"
      className="pc-glass pc-glass--dark pc-view-menu"
      style={{
        position: 'absolute',
        right: 0,
        bottom: 'calc(100% + 8px)',
        width: 248,
        maxWidth: 'calc(100vw - 16px)',
        padding: 10,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        zIndex: 40,
      }}
    >
      {GROUPS.map((group) => (
        <div key={group.title} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div className="pc-hud-header" style={{ fontSize: 9, opacity: 0.8, padding: '0 4px' }}>
            {group.title}
          </div>
          <div className="pc-glass--inset" style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            {group.options.map((option) => (
              <ViewSwitch
                key={option.key}
                option={option}
                on={view[option.key]}
                onToggle={() => setView((current) => toggleViewOption(current, option.key))}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function ViewSwitch({
  option,
  on,
  onToggle,
}: {
  option: ViewOption;
  on: boolean;
  onToggle(): void;
}): JSX.Element {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={onToggle}
      title={option.hint}
      className={`pc-tile${on ? ' pc-tile--active' : ''}`}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        width: '100%',
        padding: '6px 8px',
        borderRadius: 8,
        textAlign: 'left',
        cursor: 'pointer',
      }}
    >
      <Icon name={option.icon} size={18} style={{ flexShrink: 0 }} />
      <span style={{ flex: 1, minWidth: 0 }}>
        <span
          style={{
            display: 'block',
            fontFamily: 'var(--pc-font-display)',
            fontWeight: 700,
            fontSize: 12,
          }}
        >
          {option.label}
        </span>
        <span className="pc-blurb" style={{ display: 'block', fontSize: 10, lineHeight: 1.3 }}>
          {option.hint}
        </span>
      </span>
      <span
        aria-hidden
        style={{
          flexShrink: 0,
          width: 26,
          height: 14,
          borderRadius: 999,
          padding: 2,
          background: on ? 'var(--pc-cyan-glow-deep)' : 'rgba(0, 0, 0, 0.30)',
          border: '1px solid rgba(255, 255, 255, 0.35)',
          display: 'flex',
          justifyContent: on ? 'flex-end' : 'flex-start',
          boxSizing: 'content-box',
        }}
      >
        <span style={{ width: 14, height: 14, borderRadius: 999, background: 'var(--pc-paper)' }} />
      </span>
    </button>
  );
}
