'use client';

import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  deleteNamedLayout,
  layoutSlugExists,
  listSavedLayouts,
  loadNamedLayout,
  saveNamedLayout,
} from '../lib/library';
import type { RoomLayout, SavedLayoutEntry } from '../lib/types';

export interface LibraryPanelProps {
  currentLayout: RoomLayout;
  onLoad(layout: RoomLayout): void;
}

export function LibraryPanel({ currentLayout, onLoad }: LibraryPanelProps): JSX.Element {
  const [entries, setEntries] = useState<SavedLayoutEntry[]>([]);
  const [name, setName] = useState(currentLayout.name);

  const refresh = useCallback(() => {
    setEntries(listSavedLayouts());
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    setName(currentLayout.name);
  }, [currentLayout.name]);

  const handleSave = () => {
    const trimmed = name.trim();
    if (!trimmed) {
      window.alert('Please enter a name for this layout.');
      return;
    }
    if (layoutSlugExists(trimmed) && !window.confirm(`Overwrite the existing layout "${trimmed}"?`)) {
      return;
    }
    saveNamedLayout(currentLayout, trimmed);
    refresh();
  };

  const handleDelete = (entry: SavedLayoutEntry) => {
    if (!window.confirm(`Delete layout "${entry.name}"?`)) return;
    deleteNamedLayout(entry.id);
    refresh();
  };

  const handleLoad = (entry: SavedLayoutEntry) => {
    const loaded = loadNamedLayout(entry.id);
    if (!loaded) {
      window.alert('Failed to load layout — the entry may be corrupted.');
      refresh();
      return;
    }
    onLoad(loaded);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">📚 Saved Layouts</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex gap-2">
          <Input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Layout name"
            className="text-xs"
          />
          <Button onClick={handleSave} size="sm">
            💾 Save
          </Button>
        </div>
        {entries.length === 0 ? (
          <p className="text-xs text-muted-foreground py-2 text-center">No saved layouts yet.</p>
        ) : (
          <ul className="space-y-1 max-h-48 overflow-y-auto">
            {entries.map((entry) => (
              <li
                key={entry.id}
                className="flex items-center justify-between gap-2 rounded border p-2 text-xs"
              >
                <button
                  type="button"
                  onClick={() => handleLoad(entry)}
                  className="flex-1 text-left hover:underline"
                  title={`Saved ${new Date(entry.savedAt).toLocaleString()}`}
                >
                  <div className="font-medium">{entry.name}</div>
                  <div className="text-muted-foreground">
                    {entry.itemCount} item{entry.itemCount === 1 ? '' : 's'} · {new Date(entry.savedAt).toLocaleDateString()}
                  </div>
                </button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => handleDelete(entry)}
                  aria-label={`Delete ${entry.name}`}
                >
                  ✕
                </Button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
