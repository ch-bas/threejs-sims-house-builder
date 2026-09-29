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
import {
  VERSION_HISTORY_STORAGE_KEY,
  floorPlanFingerprint,
  getSnapshot,
  listSnapshots,
} from '../lib/version-history';
import type { RoomLayout, SavedLayoutEntry } from '../lib/types';
import type { VersionSummary } from '../lib/version-history';

export interface LibraryPanelProps {
  currentLayout: RoomLayout;
  onLoad(layout: RoomLayout): void;
}

/** "just now" / "3 m ago" / "2 h ago" / "4 d ago" for the History rows. */
function formatAge(ms: number): string {
  if (ms < 60_000) return 'just now';
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)} m ago`;
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)} h ago`;
  return `${Math.floor(ms / 86_400_000)} d ago`;
}

export function LibraryPanel({ currentLayout, onLoad }: LibraryPanelProps): JSX.Element {
  const [entries, setEntries] = useState<SavedLayoutEntry[]>([]);
  const [snapshots, setSnapshots] = useState<VersionSummary[]>([]);
  const [name, setName] = useState(currentLayout.name);

  const refresh = useCallback(() => {
    setEntries(listSavedLayouts());
    setSnapshots(listSnapshots());
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Another tab writes to the same ring (#296); `key` is null on clear().
  useEffect(() => {
    const onStorage = (event: StorageEvent): void => {
      if (event.key !== null && event.key !== VERSION_HISTORY_STORAGE_KEY) return;
      setSnapshots(listSnapshots());
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

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
    const result = saveNamedLayout(currentLayout, trimmed);
    if (!result) {
      window.alert(
        'Could not save the layout — browser storage is full. Delete some saved layouts or remove the floor-plan image and try again.'
      );
      return;
    }
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

  const handleRestore = (summary: VersionSummary) => {
    const snapshot = getSnapshot(summary.id);
    if (!snapshot) {
      window.alert('Failed to restore this version — it may have been evicted or corrupted.');
      refresh();
      return;
    }
    // Snapshots are stored without the floor-plan image to spare the
    // localStorage quota (#231). The current image is put back only when it
    // is the very image the snapshot was taken with — matching on the house
    // isn't enough, since unrenamed houses all share one name (#296).
    const restored: RoomLayout =
      currentLayout.floorPlanImage &&
      summary.floorPlanFingerprint !== null &&
      summary.floorPlanFingerprint === floorPlanFingerprint(currentLayout.floorPlanImage)
        ? { ...snapshot, floorPlanImage: currentLayout.floorPlanImage }
        : snapshot;
    // `onLoad` applies via the same undoable path as a library/template load
    // (applyLayout without history.clear, #222) — one Ctrl+Z away.
    onLoad(restored);
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
        <div className="border-t pt-3 space-y-2">
          <div className="text-sm font-semibold">🕘 History</div>
          <p className="text-xs text-muted-foreground">
            Automatic restore points, saved every few minutes while you build.
          </p>
          {snapshots.length === 0 ? (
            <p className="text-xs text-muted-foreground py-2 text-center">No restore points yet.</p>
          ) : (
            <ul className="space-y-1 max-h-48 overflow-y-auto">
              {snapshots.map((summary) => (
                <li
                  key={summary.id}
                  className="flex items-center justify-between gap-2 rounded border p-2 text-xs"
                >
                  <div className="flex-1" title={new Date(summary.savedAt).toLocaleString()}>
                    <div className="font-medium">{formatAge(Date.now() - summary.savedAt)}</div>
                    <div className="text-muted-foreground truncate">
                      {summary.name ?? 'Unknown house'}
                    </div>
                    <div className="text-muted-foreground">
                      {summary.itemCount} item{summary.itemCount === 1 ? '' : 's'} · {summary.floorCount} floor{summary.floorCount === 1 ? '' : 's'}
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => handleRestore(summary)}
                    aria-label={`Restore ${summary.name ?? 'version'} from ${new Date(summary.savedAt).toLocaleString()}`}
                  >
                    ↩️ Restore
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
