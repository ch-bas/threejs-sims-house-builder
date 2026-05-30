'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { MAX_FLOORS } from '../lib/constants';
import { Icon } from '../plotcraft/icon';
import { useRoomEditor } from '../contexts';

export function FloorSwitcher(): JSX.Element {
  const { layout, activeFloorIndex, actions, view, toggle } = useRoomEditor();
  const floors = layout.floors;
  const [renaming, setRenaming] = useState<number | null>(null);
  const [draft, setDraft] = useState('');

  const canAdd = floors.length < MAX_FLOORS;
  const canRemove = floors.length > 1;

  // Render top-to-bottom (highest floor first) — matches real-world expectations.
  const orderedIndices = Array.from(
    { length: floors.length },
    (_, i) => floors.length - 1 - i
  );

  return (
    <div
      className="pc-glass pc-glass--dark"
      style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 10 }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <h3
          className="pc-hud-header"
          style={{ fontSize: 12, margin: 0, display: 'inline-flex', alignItems: 'center', gap: 6 }}
        >
          <Icon name="stairs" size={14} />
          Floors
        </h3>
        <div style={{ display: 'flex', gap: 4 }}>
          <button
            type="button"
            onClick={() => toggle('showAllFloors')}
            className={`pc-tile${view.showAllFloors ? ' pc-tile--active' : ''}`}
            title="Show all floors at once (lower floors render translucent)"
            style={{
              height: 26,
              padding: '0 10px',
              borderRadius: 8,
              fontFamily: 'var(--pc-font-display)',
              fontWeight: 700,
              fontSize: 10,
              letterSpacing: 'var(--pc-tr-caps)',
              textTransform: 'uppercase',
            }}
          >
            All
          </button>
          <button
            type="button"
            onClick={() => actions.duplicateFloor(activeFloorIndex)}
            disabled={!canAdd}
            className="pc-tile"
            title={canAdd ? 'Duplicate the active floor' : `Maximum ${MAX_FLOORS} floors`}
            style={{
              height: 26,
              padding: '0 8px',
              borderRadius: 8,
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              fontFamily: 'var(--pc-font-display)',
              fontWeight: 700,
              fontSize: 10,
              letterSpacing: 'var(--pc-tr-caps)',
              textTransform: 'uppercase',
              opacity: canAdd ? 1 : 0.35,
              cursor: canAdd ? 'pointer' : 'not-allowed',
            }}
          >
            <Icon name="copy" size={12} />
            Clone
          </button>
          <button
            type="button"
            onClick={() => actions.addFloor()}
            disabled={!canAdd}
            className="pc-tile"
            title={canAdd ? 'Add a new empty floor' : `Maximum ${MAX_FLOORS} floors`}
            style={{
              height: 26,
              padding: '0 8px',
              borderRadius: 8,
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              fontFamily: 'var(--pc-font-display)',
              fontWeight: 700,
              fontSize: 10,
              letterSpacing: 'var(--pc-tr-caps)',
              textTransform: 'uppercase',
              opacity: canAdd ? 1 : 0.35,
              cursor: canAdd ? 'pointer' : 'not-allowed',
            }}
          >
            <Icon name="plusminus" size={12} />
            Floor
          </button>
        </div>
      </div>

      <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
        {orderedIndices.map((index) => {
          const floor = floors[index];
          if (!floor) return null;
          const isActive = activeFloorIndex === index;
          const isRenaming = renaming === index;

          return (
            <li
              key={floor.id}
              style={{ display: 'flex', alignItems: 'center', gap: 4 }}
            >
              <button
                type="button"
                onClick={() => actions.setActiveFloorIndex(index)}
                className={`pc-tile${isActive ? ' pc-tile--active' : ''}`}
                aria-current={isActive ? 'true' : undefined}
                style={{
                  flex: 1,
                  textAlign: 'left',
                  padding: '6px 10px',
                  borderRadius: 8,
                }}
              >
                {isRenaming ? (
                  <Input
                    autoFocus
                    value={draft}
                    onChange={(event) => setDraft(event.target.value)}
                    onClick={(event) => event.stopPropagation()}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        actions.renameFloor(index, draft.trim() || floor.name);
                        setRenaming(null);
                      } else if (event.key === 'Escape') {
                        setRenaming(null);
                      }
                    }}
                    onBlur={() => {
                      actions.renameFloor(index, draft.trim() || floor.name);
                      setRenaming(null);
                    }}
                    className="h-6 text-xs"
                  />
                ) : (
                  <span
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 8,
                    }}
                    onDoubleClick={(event) => {
                      event.stopPropagation();
                      setRenaming(index);
                      setDraft(floor.name);
                    }}
                  >
                    <span
                      style={{
                        fontFamily: 'var(--pc-font-display)',
                        fontWeight: 700,
                        fontSize: 12,
                      }}
                    >
                      {floor.name}
                    </span>
                    <span
                      className="pc-blurb"
                      style={{
                        fontSize: 10,
                        fontVariantNumeric: 'tabular-nums',
                      }}
                    >
                      {floor.items.length} item{floor.items.length === 1 ? '' : 's'}
                    </span>
                  </span>
                )}
              </button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setRenaming(index);
                  setDraft(floor.name);
                }}
                aria-label={`Rename ${floor.name}`}
                className="h-7 w-7 p-0 text-slate-200 hover:text-white hover:bg-white/10"
                title="Rename"
              >
                ✎
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  if (!canRemove) return;
                  if (
                    floor.items.length === 0 ||
                    window.confirm(`Remove "${floor.name}" and its ${floor.items.length} item(s)?`)
                  ) {
                    actions.removeFloor(index);
                  }
                }}
                disabled={!canRemove}
                aria-label={`Remove ${floor.name}`}
                className="h-7 w-7 p-0 text-slate-200 hover:text-white hover:bg-white/10"
                title="Remove floor"
              >
                <Icon name="close" size={12} />
              </Button>
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => actions.reorderFloor(index, index + 1)}
                  disabled={index >= floors.length - 1}
                  aria-label={`Move ${floor.name} up`}
                  className="h-3.5 w-5 p-0 leading-none text-slate-200 hover:bg-white/10"
                  title="Move up"
                >
                  <Icon name="arrowU" size={10} />
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => actions.reorderFloor(index, index - 1)}
                  disabled={index <= 0}
                  aria-label={`Move ${floor.name} down`}
                  className="h-3.5 w-5 p-0 leading-none text-slate-200 hover:bg-white/10"
                  title="Move down"
                >
                  <Icon name="arrowD" size={10} />
                </Button>
              </div>
            </li>
          );
        })}
      </ul>
      <p
        className="pc-blurb"
        style={{ fontSize: 10, margin: 0 }}
      >
        Double-click a name to rename. Each floor stacks 3m above the one below.
      </p>
    </div>
  );
}
