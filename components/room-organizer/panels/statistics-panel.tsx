'use client';

import { useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { CATEGORIES, CURRENCY_SYMBOL, DEFAULT_BUDGET } from '../lib/constants';
import { footprintArea, itemCountByCategory, totalCost } from '../lib/geometry';
import { useRoomEditor } from '../contexts';

export function StatisticsPanel(): JSX.Element {
  const { layout, collidingIds } = useRoomEditor();
  const budget = DEFAULT_BUDGET;
  const collisionsOnActiveFloor = collidingIds.size;

  const allItems = useMemo(() => layout.floors.flatMap((floor) => floor.items), [layout.floors]);

  const cost = useMemo(() => totalCost(allItems), [allItems]);
  const footprint = useMemo(() => footprintArea(allItems), [allItems]);
  const roomArea = layout.width * layout.height;
  const totalArea = roomArea * layout.floors.length;
  const density = totalArea > 0 ? Math.min(100, (footprint / totalArea) * 100) : 0;
  const counts = useMemo(() => itemCountByCategory(allItems), [allItems]);
  const budgetUsedRatio = budget > 0 ? Math.min(1, cost / budget) : 0;
  const overBudget = cost > budget;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">📊 Statistics</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-xs">
        <StatRow label="Items">{allItems.length}</StatRow>
        <StatRow label="Floors">{layout.floors.length}</StatRow>
        <StatRow label="Floor area">{roomArea.toFixed(1)} m²</StatRow>
        <StatRow label="Total area">{totalArea.toFixed(1)} m²</StatRow>
        <StatRow label="Furniture footprint">
          {footprint.toFixed(1)} m² ({density.toFixed(0)}%)
        </StatRow>
        <ProgressBar value={density / 100} label="Coverage" intent={density > 70 ? 'warning' : 'normal'} />

        {collisionsOnActiveFloor > 0 && (
          <StatRow label="Collisions" highlight>
            ⚠️ {collisionsOnActiveFloor}
          </StatRow>
        )}

        <div className="pt-2 border-t space-y-1">
          <StatRow label="Total cost" highlight={overBudget}>
            {CURRENCY_SYMBOL}
            {cost.toLocaleString()}
          </StatRow>
          <StatRow label="Budget">
            {CURRENCY_SYMBOL}
            {budget.toLocaleString()}
          </StatRow>
          <ProgressBar value={budgetUsedRatio} label="Budget" intent={overBudget ? 'danger' : 'normal'} />
        </div>

        {counts.size > 0 && (
          <div className="pt-2 border-t space-y-1">
            <p className="text-muted-foreground">By category</p>
            {CATEGORIES.filter((category) => counts.has(category.key)).map((category) => (
              <StatRow key={category.key} label={`${category.icon} ${category.label}`}>
                {counts.get(category.key) ?? 0}
              </StatRow>
            ))}
          </div>
        )}

        {layout.floors.length > 1 && (
          <div className="pt-2 border-t space-y-1">
            <p className="text-muted-foreground">By floor</p>
            {layout.floors.map((floor) => {
              const floorCost = totalCost(floor.items);
              return (
                <StatRow key={floor.id} label={floor.name}>
                  {floor.items.length} · {CURRENCY_SYMBOL}
                  {floorCost.toLocaleString()}
                </StatRow>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

interface StatRowProps {
  label: string;
  highlight?: boolean;
  children: React.ReactNode;
}

function StatRow({ label, highlight = false, children }: StatRowProps): JSX.Element {
  return (
    <div className="flex justify-between items-baseline">
      <span className="text-muted-foreground">{label}</span>
      <span className={highlight ? 'font-semibold text-red-600' : 'font-medium'}>{children}</span>
    </div>
  );
}

interface ProgressBarProps {
  value: number;
  label: string;
  intent: 'normal' | 'warning' | 'danger';
}

function ProgressBar({ value, intent }: ProgressBarProps): JSX.Element {
  const pct = Math.max(0, Math.min(1, value)) * 100;
  const tone =
    intent === 'danger' ? 'bg-red-500' : intent === 'warning' ? 'bg-amber-500' : 'bg-emerald-500';
  return (
    <div className="h-1.5 w-full bg-muted rounded-full overflow-hidden">
      <div className={`h-full ${tone} transition-all`} style={{ width: `${pct}%` }} />
    </div>
  );
}
