'use client';

import { useMemo, useState } from 'react';
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

  return (
    <Card>
      <CardHeader className="space-y-2">
        <CardTitle>Placed Items ({items.length})</CardTitle>
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
          <div className="space-y-2 max-h-64 overflow-y-auto">
            {filtered.map((item) => {
              const isColliding = collidingIds.has(item.id);
              return (
              <div
                key={item.id}
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
