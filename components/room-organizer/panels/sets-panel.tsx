'use client';

import { useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useRoomEditor } from '../contexts';
import {
  customSetToFurnitureSet,
  deleteCustomSet,
  listCustomSets,
  subscribeCustomSets,
  type CustomFurnitureSet,
} from '../lib/custom-sets';
import { FURNITURE_SETS, buildFurnitureSet, type FurnitureSet } from '../lib/furniture-sets';

export interface SetsPanelProps {
  onAddSet(set: FurnitureSet): void;
}

export function SetsPanel({ onAddSet }: SetsPanelProps): JSX.Element {
  const { layout } = useRoomEditor();

  // Custom sets (#302) live in localStorage; the viewport chip saves them
  // from outside this panel, so re-read on its change signal.
  const [customSets, setCustomSets] = useState<CustomFurnitureSet[]>(() => listCustomSets());
  useEffect(() => subscribeCustomSets(() => setCustomSets(listCustomSets())), []);

  // Custom sets place through the same `FurnitureSet` shape as the built-ins.
  const customTiles = useMemo(
    () => customSets.map((custom) => ({ custom, set: customSetToFurnitureSet(custom) })),
    [customSets]
  );
  const sets = useMemo<readonly FurnitureSet[]>(
    () => [...FURNITURE_SETS, ...customTiles.map((tile) => tile.set)],
    [customTiles]
  );

  // A refused set used to be a silent no-op — the button just looked broken
  // (#135). Probe each set against the current room (pure + cheap: 4-5 items
  // per set) so tiles that can't place are disabled with a reason, including
  // sets that fit by size but would self-collide when squeezed in (#127).
  const placeable = useMemo(() => {
    const result = new Map<string, boolean>();
    for (const set of sets) {
      const probe = buildFurnitureSet(set, {
        idPrefix: 'probe',
        roomWidth: layout.width,
        roomDepth: layout.height,
      });
      result.set(set.key, probe.length > 0);
    }
    return result;
  }, [sets, layout.width, layout.height]);

  const renderTile = (set: FurnitureSet, onDelete?: () => void): JSX.Element => {
    const fits = placeable.get(set.key) ?? true;
    return (
      <div key={set.key} className="relative">
        <button
          type="button"
          disabled={!fits}
          onClick={() => fits && onAddSet(set)}
          title={fits ? undefined : 'The room is too small for this set'}
          className="w-full text-left p-2 rounded border hover:bg-accent transition-colors text-xs disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent"
        >
          <div className="flex items-center gap-2 font-medium">
            <span>{set.icon}</span>
            {set.label}
          </div>
          <div className="text-muted-foreground mt-0.5">
            {fits ? set.description : 'Room too small'}
          </div>
        </button>
        {onDelete && (
          <button
            type="button"
            onClick={onDelete}
            aria-label={`Delete set "${set.label}"`}
            title="Delete this saved set"
            className="absolute top-1 right-1 h-5 w-5 rounded text-xs text-muted-foreground hover:text-destructive hover:bg-accent"
          >
            ×
          </button>
        )}
      </div>
    );
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">📦 Furniture Sets</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 gap-2">
          {FURNITURE_SETS.map((set) => renderTile(set))}
        </div>
        {customTiles.length > 0 && (
          <>
            <div className="text-xs font-medium text-muted-foreground mt-3 mb-1">Your sets</div>
            <div className="grid grid-cols-1 gap-2">
              {customTiles.map(({ custom, set }) =>
                renderTile(set, () => {
                  if (!window.confirm(`Delete set "${custom.name}"?`)) return;
                  deleteCustomSet(custom.id);
                })
              )}
            </div>
          </>
        )}
        <p className="text-[11px] text-muted-foreground mt-2">
          Select two or more items and use “Save as set” on the selection chip to add your own.
        </p>
      </CardContent>
    </Card>
  );
}
