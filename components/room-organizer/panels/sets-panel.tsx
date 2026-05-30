'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { FURNITURE_SETS, type FurnitureSet } from '../lib/furniture-sets';

export interface SetsPanelProps {
  onAddSet(set: FurnitureSet): void;
}

export function SetsPanel({ onAddSet }: SetsPanelProps): JSX.Element {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">📦 Furniture Sets</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 gap-2">
          {FURNITURE_SETS.map((set) => (
            <button
              key={set.key}
              type="button"
              onClick={() => onAddSet(set)}
              className="text-left p-2 rounded border hover:bg-accent transition-colors text-xs"
            >
              <div className="flex items-center gap-2 font-medium">
                <span>{set.icon}</span>
                {set.label}
              </div>
              <div className="text-muted-foreground mt-0.5">{set.description}</div>
            </button>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
