'use client';

import { useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useRoomEditor } from '../contexts';
import { useLayout } from '../hooks/use-layout-store';
import { CATEGORIES, CURRENCY_SYMBOL, DEFAULT_BUDGET } from '../lib/constants';
import { footprintArea, itemCountByCategory, totalCost } from '../lib/geometry';
import { ENTRANCE_DOOR_ID } from '../lib/street';
import { zoneStats } from '../lib/zones';

export function StatisticsPanel(): JSX.Element {
  // `layout` from the store selector; `collidingIds` stays on the context.
  const layout = useLayout();
  const { collidingIds } = useRoomEditor();
  const budget = DEFAULT_BUDGET;
  const collisionsOnActiveFloor = collidingIds.size;

  // The porch door is structure, not furniture (#382).
  const allItems = useMemo(
    () => layout.floors.flatMap((floor) => floor.items).filter((item) => item.id !== ENTRANCE_DOOR_ID),
    [layout.floors]
  );

  const cost = useMemo(() => totalCost(allItems), [allItems]);
  const footprint = useMemo(() => footprintArea(allItems), [allItems]);
  const roomArea = layout.width * layout.height;
  const totalArea = roomArea * layout.floors.length;
  const density = totalArea > 0 ? Math.min(100, (footprint / totalArea) * 100) : 0;
  const counts = useMemo(() => itemCountByCategory(allItems), [allItems]);
  const budgetUsedRatio = budget > 0 ? Math.min(1, cost / budget) : 0;
  const overBudget = cost > budget;
  // Per-room cost / count / area from the zones drawn on each floor (#155);
  // the floor name only disambiguates once there is more than one floor.
  const zoneRows = useMemo(
    () =>
      layout.floors.flatMap((floor) =>
        (floor.zones ?? []).map((zone) => ({
          key: `${floor.id}:${zone.id}`,
          label: layout.floors.length > 1 ? `${zone.name} · ${floor.name}` : zone.name,
          color: zone.color,
          ...zoneStats(zone, floor.items),
        }))
      ),
    [layout.floors]
  );

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

        {zoneRows.length > 0 && (
          <div className="pt-2 border-t space-y-1" aria-label="By zone">
            <p className="text-muted-foreground">By zone</p>
            {zoneRows.map((row) => (
              <div key={row.key} className="flex justify-between items-baseline gap-2">
                <span className="flex min-w-0 items-center gap-1.5 text-muted-foreground">
                  <span
                    aria-hidden="true"
                    className="inline-block h-2.5 w-2.5 shrink-0 rounded-sm"
                    style={{ backgroundColor: row.color }}
                  />
                  <span className="truncate">{row.label}</span>
                </span>
                <span className="shrink-0 font-medium">
                  {row.itemCount} · {CURRENCY_SYMBOL}
                  {row.cost.toLocaleString()} · {row.area.toFixed(1)} m²
                </span>
              </div>
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

function ProgressBar({ value, label, intent }: ProgressBarProps): JSX.Element {
  const pct = Math.max(0, Math.min(1, value)) * 100;
  const tone =
    intent === 'danger' ? 'bg-red-500' : intent === 'warning' ? 'bg-amber-500' : 'bg-emerald-500';
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(pct)}
      className="h-1.5 w-full bg-muted rounded-full overflow-hidden"
    >
      <div className={`h-full ${tone} transition-all`} style={{ width: `${pct}%` }} />
    </div>
  );
}
