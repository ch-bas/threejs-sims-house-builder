'use client';

import { useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useRoomEditor } from '../contexts';
import { FURNITURE_SETS, buildFurnitureSet, type FurnitureSet } from '../lib/furniture-sets';

export interface SetsPanelProps {
  onAddSet(set: FurnitureSet): void;
}

export function SetsPanel({ onAddSet }: SetsPanelProps): JSX.Element {
  const { layout } = useRoomEditor();

  // A refused set used to be a silent no-op — the button just looked broken
  // (#135). Probe each set against the current room (pure + cheap: 4-5 items
  // per set) so tiles that can't place are disabled with a reason, including
  // sets that fit by size but would self-collide when squeezed in (#127).
  const placeable = useMemo(() => {
    const result = new Map<string, boolean>();
    for (const set of FURNITURE_SETS) {
      const probe = buildFurnitureSet(set, {
        idPrefix: 'probe',
        roomWidth: layout.width,
        roomDepth: layout.height,
      });
      result.set(set.key, probe.length > 0);
    }
    return result;
  }, [layout.width, layout.height]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">📦 Furniture Sets</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 gap-2">
          {FURNITURE_SETS.map((set) => {
            const fits = placeable.get(set.key) ?? true;
            return (
              <button
                key={set.key}
                type="button"
                disabled={!fits}
                onClick={() => fits && onAddSet(set)}
                title={fits ? undefined : 'The room is too small for this set'}
                className="text-left p-2 rounded border hover:bg-accent transition-colors text-xs disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent"
              >
                <div className="flex items-center gap-2 font-medium">
                  <span>{set.icon}</span>
                  {set.label}
                </div>
                <div className="text-muted-foreground mt-0.5">
                  {fits ? set.description : 'Room too small'}
                </div>
              </button>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
