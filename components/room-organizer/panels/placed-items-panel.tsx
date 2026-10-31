'use client';

import { useEffect, useMemo, useRef, useState, type FocusEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { useRoomEditor } from '../contexts';
import { useSelection } from '../contexts';

export interface PlacedItemsPanelProps {
  onRotate(id: string): void;
  onRemove(id: string): void;
}

export function PlacedItemsPanel({
  onRotate,
  onRemove,
}: PlacedItemsPanelProps): JSX.Element {
  const { activeFloor, collidingIds } = useRoomEditor();
  const { selectedItemId, selectOnly } = useSelection();
  const items = activeFloor.items;
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return items;
    return items.filter((item) => item.name.toLowerCase().includes(normalized) || item.type.toLowerCase().includes(normalized));
  }, [items, query]);

  // A removal takes the focused row with it (or the popover it opened), so the
  // keyboard carries on from the row that took its place (#634, #638). Only if
  // the list had focus last, and focus really dropped to <body>.
  const panelRef = useRef<HTMLDivElement>(null);
  const listHadFocus = useRef(false);
  const shown = useRef({ floorId: activeFloor.id, ids: filtered.map((item) => item.id) });
  useEffect(() => {
    const before = shown.current;
    const ids = filtered.map((item) => item.id);
    shown.current = { floorId: activeFloor.id, ids };
    if (before.floorId !== activeFloor.id || !listHadFocus.current) return;
    const removedAt = before.ids.findIndex((id) => !items.some((item) => item.id === id));
    const active = document.activeElement;
    if (removedAt === -1 || (active && active !== document.body)) return;
    const panel = panelRef.current;
    const rows = panel?.querySelectorAll<HTMLElement>('[data-placed-item-id] > button');
    // Not the filter field: focusing it would pop up a phone's keyboard.
    const next = rows?.[Math.min(removedAt, rows.length - 1)] ?? panel?.querySelector<HTMLElement>('h3');
    next?.focus();
  }, [activeFloor.id, filtered, items]);
  const trackListFocus = (event: FocusEvent<HTMLDivElement>) => {
    const to = event.relatedTarget;
    // To nowhere is the row unmounting; to a companion is a step away from it.
    if (to instanceof Element && !to.closest('[data-focus-companion]')) listHadFocus.current = false;
  };

  return (
    <Card ref={panelRef}>
      <CardHeader className="space-y-2">
        <CardTitle tabIndex={-1}>Placed Items ({items.length})</CardTitle>
        {/* Keep the input visible while a query is set, or deleting items
            below the threshold would trap the panel in "no items match". */}
        {(items.length > 4 || query !== '') && (
          <Input
            aria-label="Filter placed items"
            placeholder="Filter items…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="text-xs"
          />
        )}
      </CardHeader>
      <CardContent>
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground">No items yet</p>
        ) : filtered.length === 0 ? (
          <p className="text-xs text-muted-foreground">No items match this filter.</p>
        ) : (
          <div
            className="space-y-2 max-h-64 overflow-y-auto"
            onFocus={() => {
              listHadFocus.current = true;
            }}
            onBlur={trackListFocus}
          >
            {filtered.map((item) => {
              const isColliding = collidingIds.has(item.id);
              return (
              <div
                key={item.id}
                data-placed-item-id={item.id}
                className={`flex items-center justify-between p-2 rounded border ${
                  selectedItemId === item.id
                    ? 'border-primary bg-primary/10'
                    : isColliding
                      ? 'border-red-400 bg-red-500/10'
                      : 'border-border'
                }`}
                onClick={() => selectOnly(item.id)}
              >
                {/* The row's keyboard handle (#434): Tab reaches it and
                    Enter/Space select, through the row's click handler. */}
                <button
                  type="button"
                  aria-current={selectedItemId === item.id ? 'true' : undefined}
                  className="text-sm flex items-center gap-2 text-left rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span aria-hidden="true">{item.icon}</span>
                  <span>{item.name}</span>
                  {item.locked && <span role="img" aria-label="Locked">🔒</span>}
                  {item.mirrored && <span role="img" aria-label="Mirrored">↔️</span>}
                  {isColliding && <span role="img" aria-label="Collision" title="Collides or out of bounds">⚠️</span>}
                </button>
                <div className="flex gap-1">
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={item.locked}
                    title={item.locked ? 'Locked — unlock to rotate' : undefined}
                    onClick={(event) => {
                      event.stopPropagation();
                      onRotate(item.id);
                    }}
                    aria-label={`Rotate ${item.name}`}
                  >
                    ↻
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={(event) => {
                      event.stopPropagation();
                      onRemove(item.id);
                    }}
                    aria-label={`Remove ${item.name}`}
                  >
                    ✕
                  </Button>
                </div>
              </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
