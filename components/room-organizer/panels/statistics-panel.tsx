'use client';

import { useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useLengthUnit, useRoomEditor } from '../contexts';
import { useActiveFloorIndex, useLayout } from '../hooks/use-layout-store';
import { budgetOf, budgetSpent, furnitureSpend } from '../lib/budget';
import { CATEGORIES, CURRENCY_SYMBOL } from '../lib/constants';
import { buildingArea } from '../lib/footprint';
import { formatArea } from '../lib/format';
import { footprintArea, itemCountByCategory } from '../lib/geometry';
import { householdLacks, NEED_KINDS, NEED_LACK_LABELS } from '../lib/npc-needs';
import { floorRooms, hasTooManyWalls, MAX_ROOM_WALLS } from '../lib/room-detect';
import { houseRoomScores, ROOM_CHECKS, ROOM_TYPE_LABELS, roomCheckLabel, type RoomType } from '../lib/room-score';
import { ENTRANCE_DOOR_ID, ENTRANCE_WALL_ID, entrancePlanOutline } from '../lib/street';
import { zoneContains, zoneStats } from '../lib/zones';

export function StatisticsPanel(): JSX.Element {
  // `layout` from the store selector; `collidingIds` stays on the context.
  const layout = useLayout();
  const unit = useLengthUnit();
  // The editor as the drawer holds it: frozen while the drawer is closed.
  const { collidingIds, layout: heldLayout, activeFloorIndex: heldFloorIndex } = useRoomEditor();
  const budget = budgetOf(layout);
  // Collisions are checked on the active floor only; everything else here
  // covers the whole house, and the labels say which is which (#438).
  const collisionsOnActiveFloor = collidingIds.size;
  const activeFloorIndex = useActiveFloorIndex();
  const activeFloorName = layout.floors[activeFloorIndex]?.name ?? 'this floor';

  // The porch door is structure, not furniture (#382).
  const allItems = useMemo(
    () => layout.floors.flatMap((floor) => floor.items).filter((item) => item.id !== ENTRANCE_DOOR_ID),
    [layout.floors]
  );

  // What the header and the library cards show: under the hard budget it
  // includes the write-off of what was sold back (#463e).
  const cost = budgetSpent(layout);
  // Per floor: a lamp upstairs doesn't stand on the desk below it (#462).
  const footprint = useMemo(
    () => layout.floors.reduce((sum, floor) => sum + footprintArea(floor.items), 0),
    [layout.floors]
  );
  const roomArea = buildingArea(layout);
  const totalArea = roomArea * layout.floors.length;
  const density = totalArea > 0 ? Math.min(100, (footprint / totalArea) * 100) : 0;
  const counts = useMemo(() => itemCountByCategory(allItems), [allItems]);
  const budgetUsedRatio = budget > 0 ? Math.min(1, cost / budget) : 0;
  const overBudget = cost > budget;
  // Per-room cost / count / area from the zones drawn on each floor (#155);
  // the floor name only disambiguates once there is more than one floor.
  const zoneRows = useMemo(
    () =>
      layout.floors.flatMap((floor, index) =>
        (floor.zones ?? []).map((zone) => ({
          key: `${floor.id}:${zone.id}`,
          label: layout.floors.length > 1 ? `${zone.name} · ${floor.name}` : zone.name,
          color: zone.color,
          ...zoneStats(zone, floor.items, entrancePlanOutline(layout, index)),
        }))
      ),
    [layout]
  );
  // What each zone is for and how nice it is (#613). From the held editor,
  // so a closed drawer holding this tab pays nothing on an edit; the active
  // storey's collisions are the editor's own set, so only other storeys
  // cost a collision pass, and those are cached.
  const scoreRows = useMemo(
    () =>
      houseRoomScores(heldLayout, { floorIndex: heldFloorIndex, ids: collidingIds }).map((score) => ({
        key: `${heldLayout.floors[score.floorIndex]?.id ?? score.floorIndex}:${score.zone.id}`,
        label: heldLayout.floors.length > 1 ? `${score.zone.name} · ${heldLayout.floors[score.floorIndex]?.name ?? ''}` : score.zone.name,
        ...score,
      })),
    [heldLayout, heldFloorIndex, collidingIds]
  );
  // What the walkers go without, storey by storey (#906): they keep to
  // their storey, so each one needs its own. From the held editor too.
  const lackRows = useMemo(() => {
    const several = heldLayout.floors.length > 1;
    return householdLacks(heldLayout)
      .filter((storey) => storey.lacks.length > 0)
      .map((storey) => {
        const floor = heldLayout.floors[storey.floorIndex];
        // A storey with nothing for them yet says so, not four lacks in a row.
        const text = storey.lacks.length === NEED_KINDS.length ? 'nothing yet' : storey.lacks.map((need) => NEED_LACK_LABELS[need]).join(', ');
        return {
          key: floor?.id ?? String(storey.floorIndex),
          text: several ? `${floor?.name ?? ''}: ${text}` : `${text.charAt(0).toUpperCase()}${text.slice(1)}`,
        };
      });
  }, [heldLayout]);
  const scoredRows = scoreRows.filter((row): row is (typeof scoreRows)[number] & { type: RoomType } => row.type !== null);
  // The rooms the walls close on each floor (#719), named after the zone
  // over them. A floor with no partitions is one room, which says nothing.
  const roomRows = useMemo(
    () =>
      layout.floors.flatMap((floor, index) => {
        if (!floor.interiorWalls?.some((wall) => wall.id !== ENTRANCE_WALL_ID)) return [];
        return floorRooms(layout, index).map((room, roomIndex) => {
          const name = floor.zones?.find((zone) => zoneContains(zone, room.anchor.x, room.anchor.z))?.name ?? `Room ${roomIndex + 1}`;
          return {
            key: `${floor.id}:${roomIndex}`,
            label: layout.floors.length > 1 ? `${name} · ${floor.name}` : name,
            area: room.area,
          };
        });
      }),
    [layout]
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">📊 Statistics</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-xs">
        <p className="text-muted-foreground">Whole house</p>
        <StatRow label="Items">{allItems.length}</StatRow>
        <StatRow label="Floors">{layout.floors.length}</StatRow>
        <StatRow label="Area per floor">{formatArea(roomArea, unit)}</StatRow>
        <StatRow label="Total floor area">{formatArea(totalArea, unit)}</StatRow>
        <StatRow label="Furniture footprint">
          {formatArea(footprint, unit)} ({density.toFixed(0)}%)
        </StatRow>
        <ProgressBar value={density / 100} label="Coverage" intent={density > 70 ? 'warning' : 'normal'} />

        {collisionsOnActiveFloor > 0 && (
          <StatRow label={`Collisions on ${activeFloorName}`} highlight>
            ⚠️ {collisionsOnActiveFloor}
          </StatRow>
        )}

        <div className="pt-2 border-t space-y-1">
          <StatRow label="Cost" highlight={overBudget}>
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

        {layout.floors.some(hasTooManyWalls) && (
          <p className="pt-2 border-t text-muted-foreground">Rooms aren’t listed on a floor with over {MAX_ROOM_WALLS} walls.</p>
        )}

        {roomRows.length > 0 && (
          <div className="pt-2 border-t space-y-1" aria-label="Rooms">
            <p className="text-muted-foreground">Rooms</p>
            {roomRows.map((row) => (
              <StatRow key={row.key} label={row.label}>
                {formatArea(row.area, unit)}
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
                  {row.cost.toLocaleString()} · {formatArea(row.area, unit)}
                </span>
              </div>
            ))}
          </div>
        )}

        {scoreRows.length > 0 && (
          <div className="pt-2 border-t space-y-1" role="group" aria-label="Room scores">
            <p className="text-muted-foreground">Room scores</p>
            {scoredRows.map((row) => (
              <div key={row.key}>
                <div className="flex justify-between items-baseline gap-2">
                  <span className="truncate text-muted-foreground">
                    {row.label} · {ROOM_TYPE_LABELS[row.type]}
                  </span>
                  <Stars count={row.stars} of={ROOM_CHECKS.length} />
                </div>
                {row.missing.length > 0 && (
                  <p className="text-muted-foreground">
                    For more stars: {ROOM_CHECKS.filter((check) => row.missing.includes(check.key)).map((check) => roomCheckLabel(check, unit)).join(', ')}
                  </p>
                )}
              </div>
            ))}
            {scoredRows.length < scoreRows.length && (
              <p className="text-muted-foreground">
                A zone becomes a room from its furniture: a bed, a sofa, a desk, a dining table, a fridge with a stove and a
                counter, or a toilet with a sink.
              </p>
            )}
          </div>
        )}

        <div className="pt-2 border-t space-y-1" role="group" aria-label="Household">
          <p className="text-muted-foreground">Household</p>
          {lackRows.length === 0 ? (
            <p>
              Walkers find somewhere to eat, rest and wash, and something to do{heldLayout.floors.length > 1 ? ' on every floor' : ''}.
            </p>
          ) : (
            <>
              <p>Walkers would go without:</p>
              {lackRows.map((row) => (
                <p key={row.key} className="font-medium">
                  {row.text}
                </p>
              ))}
            </>
          )}
        </div>

        {layout.floors.length > 1 && (
          <div className="pt-2 border-t space-y-1">
            <p className="text-muted-foreground">By floor</p>
            {layout.floors.map((floor) => {
              // The porch door is free here too, so the floors add up (#693).
              const floorCost = furnitureSpend({ floors: [floor] });
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

/** A room's score as filled and empty stars, read out as "3 of 5 stars". */
function Stars({ count, of }: { count: number; of: number }): JSX.Element {
  return (
    <span role="img" aria-label={`${count} of ${of} stars`} className="shrink-0 font-medium tracking-wider">
      {'★'.repeat(count)}
      <span className="text-muted-foreground">{'☆'.repeat(of - count)}</span>
    </span>
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
