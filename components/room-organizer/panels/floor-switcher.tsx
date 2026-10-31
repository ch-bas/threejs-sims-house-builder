'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useEditorViewActions, useViewSettings } from '../contexts';
import { layoutStore, useActiveFloorIndex, useLayoutActions, useLayoutStore } from '../hooks/use-layout-store';
import { useRefusal } from '../hooks/use-refusal';
import { floorCloneRefusal, HARD_BUDGET_SELL_BACK_NOTE, isHardBudgetOn } from '../lib/budget';
import { askConfirm } from '../lib/confirm-dialog';
import { MAX_FLOORS } from '../lib/constants';
import { formatMetres } from '../lib/format';
import { MAX_NAME_LENGTH } from '../lib/schema';
import { buildingHeight, storeyHeight } from '../lib/storeys';
import { Icon } from '../plotcraft/icon';
import { DISABLED_TILE } from './wall-display-pill';

export function FloorSwitcher(): JSX.Element {
  // Layout slices come from the store via atomic selectors; view/toggle stay on
  // the context (mixed consumption — the incremental migration path).
  const floors = useLayoutStore((s) => s.layout.floors);
  const hardBudget = useLayoutStore((s) => isHardBudgetOn(s.layout));
  const activeFloorIndex = useActiveFloorIndex();
  const actions = useLayoutActions();
  const view = useViewSettings('showAllFloors', 'view2D');
  const { toggle } = useEditorViewActions();
  const refuse = useRefusal();
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
            // The plan shows one floor: off in 2D (#444).
            disabled={view.view2D}
            className={`pc-tile${view.showAllFloors ? ' pc-tile--active' : ''}`}
            title={`Show all floors at once (other floors render translucent, or solid with all walls up)${view.view2D ? ' — switch back to 3D view' : ''}`}
            style={{
              height: 26,
              padding: '0 10px',
              borderRadius: 8,
              fontFamily: 'var(--pc-font-display)',
              fontWeight: 700,
              fontSize: 10,
              letterSpacing: 'var(--pc-tr-caps)',
              textTransform: 'uppercase',
              ...(view.view2D ? DISABLED_TILE : {}),
            }}
          >
            All
          </button>
          <button
            type="button"
            onClick={() => {
              // Hard budget: say why instead of the reducer's silent
              // refusal (#588).
              const source = floors[activeFloorIndex];
              const refusal = source ? floorCloneRefusal(layoutStore.getState().layout, source.name, source.items) : null;
              if (refusal !== null) {
                refuse(refusal);
                return;
              }
              actions.duplicateFloor(activeFloorIndex);
            }}
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
            <Icon name="plus" size={12} />
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
                    aria-label="Floor name"
                    value={draft}
                    maxLength={MAX_NAME_LENGTH}
                    onChange={(event) => setDraft(event.target.value)}
                    onClick={(event) => event.stopPropagation()}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        actions.renameFloor(index, draft.trim() || floor.name);
                        setRenaming(null);
                      } else if (event.key === 'Escape') {
                        // Handled here: cancel the rename without also closing
                        // the drawer this sits in (#152).
                        event.preventDefault();
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
                    {/* Stacked so the storey height (#289) doesn't crowd the
                        name off its line in the 320px drawer. */}
                    <span
                      className="pc-blurb"
                      style={{
                        fontSize: 10,
                        lineHeight: 1.2,
                        fontVariantNumeric: 'tabular-nums',
                        whiteSpace: 'nowrap',
                        textAlign: 'right',
                        display: 'flex',
                        flexDirection: 'column',
                        flexShrink: 0,
                      }}
                    >
                      <span>
                        {floor.items.length} item{floor.items.length === 1 ? '' : 's'}
                      </span>
                      <span>{formatMetres(storeyHeight(floor))}</span>
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
                  if (floor.items.length === 0) {
                    actions.removeFloor(index);
                    return;
                  }
                  void askConfirm({
                    title: `Remove “${floor.name}” and its ${floor.items.length} item${floor.items.length === 1 ? '' : 's'}?`,
                    body: `Undo brings the floor back.${hardBudget ? HARD_BUDGET_SELL_BACK_NOTE : ''}`,
                    confirmLabel: 'Remove floor',
                    danger: true,
                  }).then((ok) => {
                    if (!ok) return;
                    // By id: the floors may have moved while it asked.
                    const now = layoutStore.getState().layout.floors.findIndex((entry) => entry.id === floor.id);
                    if (now !== -1) actions.removeFloor(now);
                  });
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
      {/* Storeys have had their own heights since #202, so the footer quotes
          the real stack instead of a fixed "3m" that a 2.5 m ground floor
          contradicts (#289). */}
      <p
        className="pc-blurb"
        style={{ fontSize: 10, margin: 0 }}
      >
        Double-click a name to rename. Each floor stacks its storey height above the one below —{' '}
        {formatMetres(buildingHeight(floors))} to the eaves.
      </p>
    </div>
  );
}
