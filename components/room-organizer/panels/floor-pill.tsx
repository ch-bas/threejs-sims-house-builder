'use client';

import { useEditorViewActions, useRoomEditor, useViewSettings } from '../contexts';
import { MAX_FLOORS } from '../lib/constants';
import { Icon } from '../plotcraft/icon';
import { DISABLED_TILE } from './wall-display-pill';

/**
 * Compact floor selector that lives as a floating overlay near the top-right
 * of the lot. One click swaps floors — the full rename/reorder controls
 * still live in the sidebar's FloorSwitcher.
 */
export function FloorPill(): JSX.Element {
  const { layout, activeFloorIndex, actions } = useRoomEditor();
  const view = useViewSettings('showAllFloors', 'view2D');
  const { toggle } = useEditorViewActions();
  const floors = layout.floors;
  const canAdd = floors.length < MAX_FLOORS;
  // Top floor first — matches real-world expectations and FloorSwitcher.
  const orderedIndices = Array.from(
    { length: floors.length },
    (_, i) => floors.length - 1 - i
  );

  return (
    <div
      className="pointer-events-auto pc-glass pc-glass--dark pc-floor-pill"
      style={{
        padding: 6,
        display: 'flex',
        alignItems: 'center',
        gap: 6,
      }}
    >
      <div
        className="pc-hud-header pc-pill-label"
        style={{
          fontSize: 9,
          paddingLeft: 6,
          paddingRight: 4,
          display: 'inline-flex',
          alignItems: 'center',
          gap: 4,
          opacity: 0.85,
        }}
      >
        <Icon name="stairs" size={12} />
        Floor
      </div>

      <div
        style={{
          background: 'rgba(0, 0, 0, 0.20)',
          border: '1px solid rgba(255, 255, 255, 0.08)',
          borderRadius: 10,
          padding: 3,
          boxShadow: 'inset 0 2px 4px rgba(0, 0, 0, 0.30)',
          display: 'flex',
          gap: 3,
        }}
      >
        {orderedIndices.map((index) => {
          const floor = floors[index];
          if (!floor) return null;
          const isActive = activeFloorIndex === index;
          return (
            <button
              key={floor.id}
              type="button"
              onClick={() => actions.setActiveFloorIndex(index)}
              title={`${floor.name} · ${floor.items.length} item${floor.items.length === 1 ? '' : 's'}`}
              aria-current={isActive ? 'true' : undefined}
              className={`pc-tile${isActive ? ' pc-tile--active' : ''}`}
              style={{
                width: 32,
                height: 32,
                borderRadius: 7,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontFamily: 'var(--pc-font-display)',
                fontWeight: 800,
                fontSize: 13,
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              {index + 1}
            </button>
          );
        })}
      </div>

      <button
        type="button"
        onClick={() => actions.addFloor()}
        disabled={!canAdd}
        title={canAdd ? 'Add a floor' : `Maximum ${MAX_FLOORS} floors`}
        aria-label="Add floor"
        className="pc-tile"
        style={{
          width: 26,
          height: 26,
          borderRadius: 7,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          opacity: canAdd ? 1 : 0.35,
          cursor: canAdd ? 'pointer' : 'not-allowed',
        }}
      >
        <Icon name="plusminus" size={12} />
      </button>

      {floors.length > 1 && (
        <button
          type="button"
          onClick={() => toggle('showAllFloors')}
          // The plan shows one floor: off in 2D (#444).
          disabled={view.view2D}
          title={`Show all floors at once (lower floors render translucent)${view.view2D ? ' — switch back to 3D view' : ''}`}
          aria-pressed={view.showAllFloors}
          className={`pc-tile${view.showAllFloors ? ' pc-tile--active' : ''}`}
          style={{
            height: 26,
            padding: '0 8px',
            borderRadius: 7,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontFamily: 'var(--pc-font-display)',
            fontWeight: 800,
            fontSize: 9,
            letterSpacing: 'var(--pc-tr-caps)',
            textTransform: 'uppercase',
            ...(view.view2D ? DISABLED_TILE : {}),
          }}
        >
          All
        </button>
      )}
    </div>
  );
}
