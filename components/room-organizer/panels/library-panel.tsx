'use client';

import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { CURRENCY_SYMBOL } from '../lib/constants';
import { totalCost } from '../lib/geometry';
import {
  deleteNamedLayout,
  layoutSlugExists,
  listSavedLayouts,
  loadNamedLayout,
  saveNamedLayout,
} from '../lib/library';
import {
  PASTEBOARD_STORAGE_KEY,
  addReceivedLayout,
  listReceivedLayouts,
  removeReceivedLayout,
  shareHashFromText,
} from '../lib/pasteboard';
import { snapshotBeforeReplace } from '../lib/restore-point';
import { decodeShareUrl } from '../lib/share';
import {
  VERSION_HISTORY_STORAGE_KEY,
  floorPlanFingerprint,
  getSnapshot,
  listSnapshots,
} from '../lib/version-history';
import { PlanThumb } from './plan-thumb';
import type { PasteboardEntry } from '../lib/pasteboard';
import type { RoomLayout, SavedLayoutEntry } from '../lib/types';
import type { VersionSummary } from '../lib/version-history';

export interface LibraryPanelProps {
  currentLayout: RoomLayout;
  onLoad(layout: RoomLayout): void;
}

/** Row thumbnails (#303): wide enough to tell two houses apart, not a preview. */
const THUMB_WIDTH = 96;
const THUMB_HEIGHT = 64;

/** "just now" / "3 m ago" / "2 h ago" / "4 d ago" for the History rows. */
function formatAge(ms: number): string {
  if (ms < 60_000) return 'just now';
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)} m ago`;
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)} h ago`;
  return `${Math.floor(ms / 86_400_000)} d ago`;
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

function signed(delta: number, noun: string): string {
  return `${delta > 0 ? '+' : '−'}${plural(Math.abs(delta), noun)}`;
}

/** Two restore points of one house (#296): same id, or same name when neither has one. */
function sameHouse(a: VersionSummary, b: VersionSummary): boolean {
  if (a.layoutId !== null || b.layoutId !== null) return a.layoutId === b.layoutId;
  return a.name !== null && a.name === b.name;
}

/**
 * What a restore point changed relative to the one before it (#303),
 * computed from the two summaries alone — no layout is parsed. Null when
 * there is no older restore point of the same house to compare against.
 */
function describeChange(summary: VersionSummary, older: VersionSummary | undefined): string | null {
  if (!older || !sameHouse(summary, older)) return null;
  const parts: string[] = [];
  const items = summary.itemCount - older.itemCount;
  const floors = summary.floorCount - older.floorCount;
  if (items !== 0) parts.push(signed(items, 'item'));
  if (floors !== 0) parts.push(signed(floors, 'floor'));
  // Identical snapshots are never recorded twice (#297), so equal counts
  // still mean something changed — a move, a colour, the roof.
  return parts.length > 0 ? parts.join(' · ') : 'no items added or removed';
}

function layoutCost(layout: RoomLayout): number {
  return totalCost(layout.floors.flatMap((floor) => floor.items));
}

interface PasteStatus {
  kind: 'error' | 'info';
  text: string;
}

export function LibraryPanel({ currentLayout, onLoad }: LibraryPanelProps): JSX.Element {
  const [entries, setEntries] = useState<SavedLayoutEntry[]>([]);
  const [snapshots, setSnapshots] = useState<VersionSummary[]>([]);
  const [received, setReceived] = useState<PasteboardEntry[]>([]);
  const [name, setName] = useState(currentLayout.name);
  const [pasteText, setPasteText] = useState('');
  const [pasteStatus, setPasteStatus] = useState<PasteStatus | null>(null);
  const [pasting, setPasting] = useState(false);

  const refresh = useCallback(() => {
    setEntries(listSavedLayouts());
    setSnapshots(listSnapshots());
    setReceived(listReceivedLayouts());
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Another tab writes to the same ring (#296) or board; `key` is null on clear().
  useEffect(() => {
    const onStorage = (event: StorageEvent): void => {
      if (event.key === null || event.key === VERSION_HISTORY_STORAGE_KEY) setSnapshots(listSnapshots());
      if (event.key === null || event.key === PASTEBOARD_STORAGE_KEY) setReceived(listReceivedLayouts());
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
    // Restoring replaces the whole house too — keep a way back to the one
    // on screen beyond this session's undo stack (#298).
    snapshotBeforeReplace(currentLayout);
    // `onLoad` applies via the same undoable path as a library/template load
    // (applyLayout without history.clear, #222) — one Ctrl+Z away.
    onLoad(restored);
  };

  const handlePaste = async () => {
    const hash = shareHashFromText(pasteText);
    if (!hash) {
      setPasteStatus({
        kind: 'error',
        text: "That doesn't look like a share link — it should contain “#layout=…”.",
      });
      return;
    }
    setPasting(true);
    try {
      // The same hardened decode → schema pipeline the share-link loader uses.
      const layout = await decodeShareUrl(hash);
      if (!layout) {
        setPasteStatus({
          kind: 'error',
          text: "This link couldn't be read — it may be truncated, or made by a newer version of the app.",
        });
        return;
      }
      const result = addReceivedLayout(layout);
      if (!result) {
        setPasteStatus({
          kind: 'error',
          text: "Couldn't keep this house — browser storage is full. Remove some received houses or saved layouts and try again.",
        });
        return;
      }
      setPasteStatus(
        result.duplicate
          ? { kind: 'info', text: `“${result.entry.name}” is already on your paste-board.` }
          : { kind: 'info', text: `Added “${result.entry.name}”.` }
      );
      setPasteText('');
      refresh();
    } finally {
      setPasting(false);
    }
  };

  const handleLoadReceived = (entry: PasteboardEntry) => {
    // Same undoable path as a library load, with a way back beyond the undo
    // stack (#298) — the board keeps its copy, so this can be tried freely.
    snapshotBeforeReplace(currentLayout);
    onLoad(entry.layout);
  };

  const handleRemoveReceived = (entry: PasteboardEntry) => {
    if (!window.confirm(`Remove “${entry.name}” from the paste-board?`)) return;
    removeReceivedLayout(entry.id);
    refresh();
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
          <ul className="space-y-1 max-h-64 overflow-y-auto">
            {entries.map((entry) => (
              <LibraryRow
                // A re-save under the same name remounts the row so its
                // thumbnail reloads the new blob.
                key={`${entry.id}:${entry.savedAt}`}
                entry={entry}
                onLoad={() => handleLoad(entry)}
                onDelete={() => handleDelete(entry)}
              />
            ))}
          </ul>
        )}
        <div className="border-t pt-3 space-y-2">
          <div className="text-sm font-semibold">📮 Paste-board</div>
          <p className="text-xs text-muted-foreground">
            Houses friends shared with you. Paste a share link to keep it here without replacing
            your own house.
          </p>
          <form
            className="flex gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              void handlePaste();
            }}
          >
            <Input
              value={pasteText}
              onChange={(event) => {
                setPasteText(event.target.value);
                if (pasteStatus) setPasteStatus(null);
              }}
              placeholder="Paste a share link…"
              aria-label="Share link"
              className="text-xs"
              spellCheck={false}
            />
            <Button type="submit" size="sm" disabled={pasting || pasteText.trim() === ''}>
              {pasting ? 'Reading…' : 'Add'}
            </Button>
          </form>
          {pasteStatus && (
            <p
              role={pasteStatus.kind === 'error' ? 'alert' : 'status'}
              className={`text-xs ${pasteStatus.kind === 'error' ? 'text-destructive' : 'text-muted-foreground'}`}
            >
              {pasteStatus.text}
            </p>
          )}
          {received.length === 0 ? (
            <p className="text-xs text-muted-foreground py-2 text-center">No received houses yet.</p>
          ) : (
            <ul className="space-y-1 max-h-72 overflow-y-auto">
              {received.map((entry) => (
                <li key={entry.id} className="flex items-center gap-2 rounded border p-2 text-xs">
                  <PlanThumb
                    layout={entry.layout}
                    width={THUMB_WIDTH}
                    height={THUMB_HEIGHT}
                    className="rounded border bg-muted shrink-0"
                    label={`Plan of ${entry.name}`}
                  />
                  <div className="flex-1 min-w-0 space-y-1">
                    <div className="font-medium truncate" title={entry.name}>
                      {entry.name}
                    </div>
                    <div className="text-muted-foreground truncate">
                      {plural(entry.layout.floors.length, 'floor')} · {CURRENCY_SYMBOL}
                      {layoutCost(entry.layout).toLocaleString()}
                    </div>
                    <div className="flex gap-1">
                      <Button
                        size="sm"
                        variant="secondary"
                        className="h-6 px-2"
                        onClick={() => handleLoadReceived(entry)}
                        aria-label={`Load ${entry.name}`}
                      >
                        Load
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-6 px-2"
                        onClick={() => handleRemoveReceived(entry)}
                        aria-label={`Remove ${entry.name}`}
                      >
                        Remove
                      </Button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="border-t pt-3 space-y-2">
          <div className="text-sm font-semibold">🕘 History</div>
          <p className="text-xs text-muted-foreground">
            Automatic restore points, saved every few minutes while you build.
          </p>
          {snapshots.length === 0 ? (
            <p className="text-xs text-muted-foreground py-2 text-center">No restore points yet.</p>
          ) : (
            <ul className="space-y-1 max-h-64 overflow-y-auto">
              {snapshots.map((summary, index) => (
                <HistoryRow
                  key={summary.id}
                  summary={summary}
                  // Newest first, so the row below is the older neighbour.
                  change={describeChange(summary, snapshots[index + 1])}
                  onRestore={() => handleRestore(summary)}
                />
              ))}
            </ul>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

interface LibraryRowProps {
  entry: SavedLayoutEntry;
  onLoad(): void;
  onDelete(): void;
}

function LibraryRow({ entry, onLoad, onDelete }: LibraryRowProps): JSX.Element {
  // Read and validate the stored blob only once the row scrolls into view (#303).
  const load = useCallback(() => loadNamedLayout(entry.id), [entry.id]);
  return (
    <li className="flex items-center justify-between gap-2 rounded border p-2 text-xs">
      <PlanThumb
        layout={load}
        width={THUMB_WIDTH}
        height={THUMB_HEIGHT}
        className="rounded border bg-muted shrink-0"
      />
      <button
        type="button"
        onClick={onLoad}
        className="flex-1 min-w-0 text-left hover:underline"
        title={`Saved ${new Date(entry.savedAt).toLocaleString()}`}
      >
        <div className="font-medium truncate">{entry.name}</div>
        <div className="text-muted-foreground">
          {plural(entry.itemCount, 'item')} · {new Date(entry.savedAt).toLocaleDateString()}
        </div>
      </button>
      <Button size="sm" variant="ghost" onClick={onDelete} aria-label={`Delete ${entry.name}`}>
        ✕
      </Button>
    </li>
  );
}

interface HistoryRowProps {
  summary: VersionSummary;
  change: string | null;
  onRestore(): void;
}

function HistoryRow({ summary, change, onRestore }: HistoryRowProps): JSX.Element {
  // The ring is parsed lazily, per row, when it scrolls into view (#303) —
  // never all ten snapshots at once.
  const load = useCallback(() => getSnapshot(summary.id), [summary.id]);
  return (
    <li className="flex items-center gap-2 rounded border p-2 text-xs">
      <PlanThumb
        layout={load}
        width={THUMB_WIDTH}
        height={THUMB_HEIGHT}
        className="rounded border bg-muted shrink-0"
      />
      <div className="flex-1 min-w-0" title={new Date(summary.savedAt).toLocaleString()}>
        <div className="font-medium">{formatAge(Date.now() - summary.savedAt)}</div>
        <div className="text-muted-foreground truncate">{summary.name ?? 'Unknown house'}</div>
        <div className="text-muted-foreground">
          {plural(summary.itemCount, 'item')} · {plural(summary.floorCount, 'floor')}
        </div>
        {change && <div className="text-muted-foreground/80 truncate">{change}</div>}
        {/* Under the text, not beside it: the thumbnail already takes a third
            of the 320px drawer (#303). */}
        <Button
          size="sm"
          variant="ghost"
          className="h-6 px-2 mt-1"
          onClick={onRestore}
          aria-label={`Restore ${summary.name ?? 'version'} from ${new Date(summary.savedAt).toLocaleString()}`}
        >
          ↩️ Restore
        </Button>
      </div>
    </li>
  );
}
