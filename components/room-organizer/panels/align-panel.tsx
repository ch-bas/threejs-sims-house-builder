'use client';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { AlignEdge, DistributeAxis } from '../lib/alignment';

const ALIGN_BUTTONS: ReadonlyArray<{ edge: AlignEdge; label: string }> = [
  { edge: 'min-x', label: '◧ Left' },
  { edge: 'center-x', label: '┃ Centre X' },
  { edge: 'max-x', label: 'Right ◨' },
  { edge: 'min-z', label: 'Top ▲' },
  { edge: 'center-z', label: '━ Centre Z' },
  { edge: 'max-z', label: 'Bottom ▼' },
];

export interface AlignPanelProps {
  selectionCount: number;
  onAlign(edge: AlignEdge): void;
  onDistribute(axis: DistributeAxis): void;
}

export function AlignPanel({ selectionCount, onAlign, onDistribute }: AlignPanelProps): JSX.Element {
  const canDistribute = selectionCount >= 3;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">📐 Align ({selectionCount} selected)</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-3 gap-1">
          {ALIGN_BUTTONS.map((button) => (
            <Button
              key={button.edge}
              size="sm"
              variant="outline"
              className="text-[10px] h-8"
              onClick={() => onAlign(button.edge)}
            >
              {button.label}
            </Button>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-1">
          <Button
            size="sm"
            variant="outline"
            className="text-[10px] h-8"
            disabled={!canDistribute}
            onClick={() => onDistribute('x')}
            title="Distribute centres evenly along X"
          >
            ↔ Distribute X
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="text-[10px] h-8"
            disabled={!canDistribute}
            onClick={() => onDistribute('z')}
            title="Distribute centres evenly along Z"
          >
            ↕ Distribute Z
          </Button>
        </div>
        {!canDistribute && (
          <p className="text-[10px] text-muted-foreground">Select 3 or more items to distribute.</p>
        )}
      </CardContent>
    </Card>
  );
}
