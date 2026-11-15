'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { layoutStore } from '../hooks/use-layout-store';
import { subscribeBackupRestored } from '../lib/backup-file';
import { budgetSpent } from '../lib/budget';
import { askConfirm } from '../lib/confirm-dialog';
import { CURRENCY_SYMBOL } from '../lib/constants';
import { formatAge, formatClock } from '../lib/format';
import {
  countUnreadableSavedLayouts,
  deleteNamedLayout,
  keepRoomShortfall,
  layoutSlugExists,
  librarySaveFailureMessage,
  listSavedLayouts,
  loadNamedLayout,
  saveNamedLayout,
} from '../lib/library';
import {
  MAX_RECEIVED_LAYOUTS,
  PASTEBOARD_STORAGE_KEY,
  addReceivedLayout,
  countUnreadableReceivedLayouts,
  listReceivedLayouts,
  removeReceivedLayout,
  shareHashFromText,
} from '../lib/pasteboard';
import { confirmReplace, subscribeHouseReplaced } from '../lib/restore-point';
import { newerLibraryNote } from '../lib/saved-by';
import { MAX_NAME_LENGTH } from '../lib/schema';
import { isShareHashWithinBudget, readShareHash, shareFailureMessage } from '../lib/share';
import {
  KEEP_REFUSAL_TEXT,
  KEPT_LABEL_MAX_LENGTH,
  VERSION_HISTORY_STORAGE_KEY,
  VERSION_KEPT_STORAGE_KEY,
  floorPlanFingerprint,
  getKeptVersion,
  getSnapshot,
  keepLayout,
  keepSnapshot,
  listKeptVersions,
  listSnapshots,
  renameKeptVersion,
  snapshotBelongsTo,
  snapshotIsLayout,
  snapshotsShareHouse,
  subscribeSnapshots,
  unkeepOutcome,
  unkeepVersion,
} from '../lib/version-history';
import { PlanThumb } from './plan-thumb';
import { RecoveryEntry } from './recovery-entry';
import type { ConfirmOptions } from '../lib/confirm-dialog';
import type { PasteboardEntry } from '../lib/pasteboard';
import type { RoomLayout, SavedLayoutEntry } from '../lib/types';
import type { KeepResult, KeptVersionSummary, UnkeepPlan, VersionSummary } from '../lib/version-history';

export interface LibraryPanelProps {
  currentLayout: RoomLayout;
  /**
   * Replace the house with `layout`. Takes the forced restore point of the
   * outgoing house itself, so the handlers here don't (#352).
   */
  onLoad(layout: RoomLayout): void;
}

/** Row thumbnails (#303): wide enough to tell two houses apart, not a preview. */
const THUMB_WIDTH = 96;
const THUMB_HEIGHT = 64;

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

function signed(delta: number, noun: string): string {
  return `${delta > 0 ? '+' : '−'}${plural(Math.abs(delta), noun)}`;
}

/**
 * What a restore point changed relative to the one before it (#303),
 * computed from the two summaries alone — no layout is parsed. Null when
 * there is no older restore point of the same house to compare against.
 */
function describeChange(summary: VersionSummary, older: VersionSummary | undefined): string | null {
  if (!older || !snapshotsShareHouse(summary, older)) return null;
  const parts: string[] = [];
  const items = summary.itemCount - older.itemCount;
  const floors = summary.floorCount - older.floorCount;
  if (items !== 0) parts.push(signed(items, 'item'));
  if (floors !== 0) parts.push(signed(floors, 'floor'));
  // Identical snapshots are never recorded twice (#297), so equal counts
  // still mean something changed — a move, a colour, the roof.
  return parts.length > 0 ? parts.join(' · ') : 'no items added or removed';
}

/** "the oldest restore point, from 14:05" / "the 2 oldest restore points, from 14:05 on". */
function clearedPoints(clears: readonly number[]): string {
  const [first] = clears;
  if (first === undefined) return '';
  return clears.length === 1
    ? `the oldest restore point, from ${formatClock(first)}`
    : `the ${clears.length} oldest restore points, from ${formatClock(first)} on`;
}

/** The question before an Unpin (#935), saying what will happen. */
function unkeepQuestion(label: string, plan: UnkeepPlan): ConfirmOptions {
  if (plan.outcome === 'deleted') {
    return {
      title: `Delete “${label}”?`,
      body: 'History is full of newer restore points, so once it is no longer kept it is deleted. This can’t be undone.',
      confirmLabel: 'Delete',
      danger: true,
    };
  }
  return {
    title: `Stop keeping “${label}”?`,
    body:
      plan.clears.length > 0
        ? `It goes back among the restore points, and ${clearedPoints(plan.clears)}, will be cleared to make room.`
        : 'It goes back among the restore points, which are cleared oldest first as new ones come in.',
    confirmLabel: 'Stop keeping',
    danger: true,
  };
}

function samePlan(a: UnkeepPlan, b: UnkeepPlan): boolean {
  return a.outcome === b.outcome && a.clears.join() === b.clears.join();
}

function unkeptNote(label: string, plan: UnkeepPlan & { lost?: true }): string {
  if (plan.lost) return `“${label}” is no longer kept, and couldn’t go back among the restore points: storage filled up meanwhile.`;
  if (plan.outcome === 'deleted') return `Deleted “${label}”: it was older than every restore point History holds.`;
  const cleared = plan.clears.length > 0 ? ` To make room, ${clearedPoints(plan.clears)}, ${plan.clears.length === 1 ? 'was' : 'were'} cleared.` : '';
  return `No longer kept: “${label}” is back among the restore points.${cleared}`;
}

/** The header's figure (#463e): porch door excluded, sale losses included under the hard budget. */
function layoutCost(layout: RoomLayout): number {
  return budgetSpent(layout);
}

interface PasteStatus {
  kind: 'error' | 'info';
  text: string;
}

type LoadSection = 'saved' | 'received' | 'history';

/**
 * What the last load from this panel put on screen (#364), or why a save,
 * load or restore failed: inline, never a blocking alert (#607).
 */
interface LoadedNote {
  section: LoadSection;
  text: string;
  error?: true;
}

function LoadedStatus({ note, section }: { note: LoadedNote | null; section: LoadSection }): JSX.Element | null {
  if (note?.section !== section) return null;
  return (
    <p role={note.error ? 'alert' : 'status'} className={`text-xs ${note.error ? 'text-destructive' : 'text-muted-foreground'}`}>
      {note.text}
    </p>
  );
}

export function LibraryPanel({ currentLayout, onLoad }: LibraryPanelProps): JSX.Element {
  const [entries, setEntries] = useState<SavedLayoutEntry[]>([]);
  const [snapshots, setSnapshots] = useState<VersionSummary[]>([]);
  const [kept, setKept] = useState<KeptVersionSummary[]>([]);
  // Where focus goes once a Keep or Unpin re-renders the list: the button
  // that had it is gone (#935).
  const [focusTarget, setFocusTarget] = useState<{ kept: string } | 'heading' | null>(null);
  const historyHeadingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (focusTarget !== 'heading') return;
    // After the confirm dialog hands focus back to the opener, now gone.
    const timer = window.setTimeout(() => {
      historyHeadingRef.current?.focus();
      setFocusTarget(null);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [focusTarget]);
  const [received, setReceived] = useState<PasteboardEntry[]>([]);
  // Counted when the lists are re-read from storage, not on every render:
  // this panel re-renders on each layout edit (#340, #348).
  const [unreadableSaved, setUnreadableSaved] = useState(0);
  const [unreadableReceived, setUnreadableReceived] = useState(0);
  const [name, setName] = useState(currentLayout.name);
  const [pasteText, setPasteText] = useState('');
  const [pasteStatus, setPasteStatus] = useState<PasteStatus | null>(null);
  const [pasting, setPasting] = useState(false);
  const [loaded, setLoaded] = useState<LoadedNote | null>(null);

  const refresh = useCallback(() => {
    setEntries(listSavedLayouts());
    setUnreadableSaved(countUnreadableSavedLayouts());
    setSnapshots(listSnapshots());
    setKept(listKeptVersions());
    setReceived(listReceivedLayouts());
    setUnreadableReceived(countUnreadableReceivedLayouts());
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Another tab writes to the same ring (#296) or board; `key` is null on clear().
  useEffect(() => {
    const onStorage = (event: StorageEvent): void => {
      if (event.key === null || event.key === VERSION_HISTORY_STORAGE_KEY) setSnapshots(listSnapshots());
      if (event.key === null || event.key === VERSION_KEPT_STORAGE_KEY) setKept(listKeptVersions());
      if (event.key === null || event.key === PASTEBOARD_STORAGE_KEY) {
        setReceived(listReceivedLayouts());
        setUnreadableReceived(countUnreadableReceivedLayouts());
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  // This tab's own restore points — autosave cadence, and the forced one
  // every replacement takes — have no `storage` event (#367).
  useEffect(
    () =>
      subscribeSnapshots(() => {
        setSnapshots(listSnapshots());
        setKept(listKeptVersions());
      }),
    []
  );
  // A backup dropped on the page restores behind this panel's back (#934).
  useEffect(() => subscribeBackupRestored(refresh), [refresh]);

  // A note about an earlier load is out of date once another house comes in;
  // a load from this panel writes its own note after this (#647).
  useEffect(() => subscribeHouseReplaced(() => setLoaded(null)), []);

  // The newest restore point when it is the house on screen, as the first
  // autosave after a load leaves it: restoring it would do nothing, so it is
  // not listed until the house moves on (#647). Counts first: only a likely
  // match pays for reading the snapshot, on a panel that renders on each edit.
  const [newest] = snapshots;
  const liveSnapshotId = useMemo(() => {
    if (!newest || !snapshotBelongsTo(newest, currentLayout)) return null;
    const items = currentLayout.floors.reduce((sum, floor) => sum + floor.items.length, 0);
    if (newest.floorCount !== currentLayout.floors.length || newest.itemCount !== items) return null;
    return snapshotIsLayout(newest.id, currentLayout) ? newest.id : null;
  }, [newest, currentLayout]);

  // A layout effect: while the drawer is closed its contexts are held (#3), so
  // a rename made then reaches this field only on open, and it must land
  // before that first paint.
  useLayoutEffect(() => {
    setName(currentLayout.name);
  }, [currentLayout.name]);

  const handleSave = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setLoaded({ section: 'saved', text: 'Enter a name for this layout first.', error: true });
      return;
    }
    if (
      layoutSlugExists(trimmed) &&
      !(await askConfirm({
        title: `Overwrite the saved layout “${trimmed}”?`,
        body: 'The copy saved under that name is replaced by the house on screen.',
        confirmLabel: 'Overwrite',
        danger: true,
      }))
    ) {
      return;
    }
    const result = saveNamedLayout(currentLayout, trimmed);
    if (!result.ok) {
      setLoaded({ section: 'saved', text: librarySaveFailureMessage(result.reason, currentLayout), error: true });
      return;
    }
    // A save that worked clears the reason an earlier one failed.
    setLoaded((note) => (note?.error ? null : note));
    refresh();
  };

  const handleDelete = async (entry: SavedLayoutEntry) => {
    const ok = await askConfirm({
      title: `Delete the saved layout “${entry.name}”?`,
      body: 'Saved layouts live in this browser only, so this can’t be undone.',
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!ok) return;
    deleteNamedLayout(entry.id);
    refresh();
  };

  const handleLoad = async (entry: SavedLayoutEntry) => {
    const loaded = loadNamedLayout(entry.id);
    if (!loaded) {
      setLoaded({ section: 'saved', text: `Couldn’t open “${entry.name}” — the saved copy can’t be read.`, error: true });
      refresh();
      return;
    }
    if (!(await confirmReplace(currentLayout, `“${entry.name}”`))) return;
    // Read again: another tab may have saved over it while it asked.
    const fresh = loadNamedLayout(entry.id);
    if (!fresh) {
      setLoaded({ section: 'saved', text: `Couldn’t open “${entry.name}” — the saved copy can’t be read.`, error: true });
      refresh();
      return;
    }
    onLoad(fresh);
    // Written by a newer version (#933): say what may be missing.
    const newer = newerLibraryNote(entry.savedBy);
    setLoaded({ section: 'saved', text: `Loaded “${entry.name}”.${newer ? ` ${newer}` : ''} Undo brings back the house it replaced.` });
  };

  const handleRestore = async (summary: VersionSummary, read: (id: string) => RoomLayout | null = getSnapshot) => {
    const house = summary.name === null ? 'the restore point' : `“${summary.name}”`;
    if (!(await confirmReplace(currentLayout, `${house} from ${formatClock(summary.savedAt)}`))) return;
    const snapshot = read(summary.id);
    if (!snapshot) {
      setLoaded({
        section: 'history',
        text: 'Couldn’t restore this version — it was cleared to make room, or can’t be read.',
        error: true,
      });
      refresh();
      return;
    }
    // Snapshots are stored without the floor-plan image to spare the
    // localStorage quota (#231). The current image is put back only when it
    // is the very image the snapshot was taken with — matching on the house
    // isn't enough, since unrenamed houses all share one name (#296).
    // The house on screen after the answer, not when it asked.
    const shown = layoutStore.getState().layout;
    const restored: RoomLayout =
      shown.floorPlanImage &&
      summary.floorPlanFingerprint !== null &&
      summary.floorPlanFingerprint === floorPlanFingerprint(shown.floorPlanImage)
        ? { ...snapshot, floorPlanImage: shown.floorPlanImage }
        : snapshot;
    // `onLoad` takes the forced restore point of the house on screen (#298,
    // #352) and applies via the same undoable path as a library/template
    // load (applyLayout without history.clear, #222) — one Ctrl+Z away.
    onLoad(restored);
    setLoaded({
      section: 'history',
      text: `Restored ${summary.name ?? 'the house'} from ${formatAge(Date.now() - summary.savedAt)}. Undo brings back the house it replaced.`,
    });
  };

  // Kept versions (#935): pinned out of the ring, so they outlive it. A keep
  // is refused when it would leave the open house no room to save.
  const roomCheck = (chars: number) => keepRoomShortfall(layoutStore.getState().layout, chars);

  const afterKeep = (result: KeepResult, note: string) => {
    refresh();
    if (result.ok) {
      setLoaded({ section: 'history', text: note });
      setFocusTarget({ kept: result.id });
    } else {
      setLoaded({ section: 'history', text: KEEP_REFUSAL_TEXT[result.reason], error: true });
      // The row stays; the button keeps focus.
    }
  };

  const handleKeep = (summary: VersionSummary) => {
    afterKeep(keepSnapshot(summary.id, { roomCheck }), 'Kept. It stays at the top of History until you stop keeping it.');
  };

  const handleKeepCurrent = () => {
    afterKeep(
      keepLayout(layoutStore.getState().layout, { roomCheck }),
      'Kept the house as it is now. It stays at the top of History until you stop keeping it.'
    );
  };

  const handleUnkeep = async (version: KeptVersionSummary) => {
    const plan = unkeepOutcome(version.id);
    if (plan === null) {
      refresh();
      return;
    }
    const ok = await askConfirm(unkeepQuestion(version.label, plan));
    if (!ok) return;
    // The ring may have moved on while the question was up (an autosave,
    // another tab): what was agreed to must still be what happens.
    const now = unkeepOutcome(version.id);
    if (now === null || !samePlan(plan, now)) {
      refresh();
      setLoaded({
        section: 'history',
        text: `History changed while you were deciding, so “${version.label}” is still kept. Try again.`,
        error: true,
      });
      return;
    }
    const result = unkeepVersion(version.id);
    refresh();
    setFocusTarget('heading');
    if (result.removed) {
      setLoaded({ section: 'history', text: unkeptNote(version.label, result) });
      return;
    }
    setLoaded({
      section: 'history',
      text:
        result.reason === 'missing'
          ? `“${version.label}” was no longer kept.`
          : result.reason === 'no-room'
            ? `“${version.label}” stays kept: browser storage is too full to put it back among the restore points.`
            : `“${version.label}” stays kept: the browser’s storage is blocked.`,
      error: true,
    });
  };

  const handleRenameKept = (version: KeptVersionSummary, label: string): boolean => {
    const ok = renameKeptVersion(version.id, label);
    if (!ok) setLoaded({ section: 'history', text: 'Enter a name for this version first.', error: true });
    else setLoaded((note) => (note?.error ? null : note));
    refresh();
    return ok;
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
    // Refused before decoding: a hash this long is no house, and inflating
    // it could take the tab down (#332).
    if (!isShareHashWithinBudget(hash)) {
      setPasteStatus({
        kind: 'error',
        text: 'This link is far larger than any house, so it was not opened.',
      });
      return;
    }
    setPasting(true);
    try {
      // The same hardened decode → schema pipeline the share-link loader uses.
      const decoded = await readShareHash(hash);
      if (!decoded.ok) {
        // Says which: cut off, or from a newer app (#607).
        setPasteStatus({ kind: 'error', text: shareFailureMessage(decoded.reason) });
        return;
      }
      const layout = decoded.layout;
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
          : {
              kind: 'info',
              text:
                result.dropped.length > 0
                  ? `Added “${result.entry.name}”. The board keeps ${MAX_RECEIVED_LAYOUTS} houses, so the oldest, “${result.dropped.join('”, “')}”, was removed.`
                  : `Added “${result.entry.name}”.`,
            }
      );
      setPasteText('');
      refresh();
    } finally {
      setPasting(false);
    }
  };

  const handleLoadReceived = async (entry: PasteboardEntry) => {
    if (!(await confirmReplace(currentLayout, `“${entry.name}”`))) return;
    // Same undoable path as a library load; `onLoad` takes the restore point
    // (#298, #352). The board keeps its copy, so this can be tried freely.
    onLoad(entry.layout);
    setLoaded({ section: 'received', text: `Loaded “${entry.name}”. Undo brings back the house it replaced.` });
  };

  const handleRemoveReceived = async (entry: PasteboardEntry) => {
    const ok = await askConfirm({
      title: `Remove “${entry.name}” from the paste-board?`,
      body: 'The link it came from still opens it.',
      confirmLabel: 'Remove',
      danger: true,
    });
    if (!ok) return;
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
            maxLength={MAX_NAME_LENGTH}
            onChange={(event) => setName(event.target.value)}
            aria-label="Layout name"
            placeholder="Layout name"
            className="text-xs"
          />
          <Button onClick={() => void handleSave()} size="sm">
            💾 Save
          </Button>
        </div>
        <LoadedStatus note={loaded} section="saved" />
        {unreadableSaved > 0 && (
          <p role="status" className="text-xs text-muted-foreground">
            {plural(unreadableSaved, 'saved house')} couldn’t be read — kept in storage, not deleted.
          </p>
        )}
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
                onLoad={() => void handleLoad(entry)}
                onDelete={() => void handleDelete(entry)}
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
          <LoadedStatus note={loaded} section="received" />
          {unreadableReceived > 0 && (
            <p role="status" className="text-xs text-muted-foreground">
              {plural(unreadableReceived, 'received house')} couldn’t be read — kept in storage, not
              deleted.
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
                        onClick={() => void handleLoadReceived(entry)}
                        aria-label={`Load ${entry.name}`}
                      >
                        Load
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-6 px-2"
                        onClick={() => void handleRemoveReceived(entry)}
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
          <div className="flex items-center justify-between gap-2">
            <h3 ref={historyHeadingRef} tabIndex={-1} className="text-sm font-semibold outline-none">
              🕘 History
            </h3>
            <Button
              size="sm"
              variant="outline"
              className="h-7 px-2 text-xs"
              onClick={handleKeepCurrent}
              title="Keep the house as it is now: it stays until you stop keeping it"
            >
              📌 Keep this version
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Automatic restore points, saved every few minutes while you build. Keep one to hold on to it.
          </p>
          <LoadedStatus note={loaded} section="history" />
          <RecoveryEntry currentLayout={currentLayout} onLoad={onLoad} />
          {kept.length > 0 && (
            <ul className="space-y-1" aria-label="Kept versions">
              {kept.map((version) => (
                <KeptRow
                  key={version.id}
                  version={version}
                  takeFocus={focusTarget !== null && focusTarget !== 'heading' && focusTarget.kept === version.id}
                  onFocused={() => setFocusTarget(null)}
                  onRestore={() => void handleRestore(version, getKeptVersion)}
                  onRename={(label) => handleRenameKept(version, label)}
                  onUnkeep={() => void handleUnkeep(version)}
                />
              ))}
            </ul>
          )}
          {snapshots.every((summary) => summary.id === liveSnapshotId) ? (
            <p className="text-xs text-muted-foreground py-2 text-center">
              {snapshots.length === 0 ? 'No restore points yet.' : 'Nothing older than the house on screen yet.'}
            </p>
          ) : (
            <ul className="space-y-1 max-h-64 overflow-y-auto">
              {snapshots.map((summary, index) =>
                summary.id === liveSnapshotId ? null : (
                  <HistoryRow
                    key={summary.id}
                    summary={summary}
                    // Newest first, so the row below is the older neighbour.
                    change={describeChange(summary, snapshots[index + 1])}
                    onRestore={() => void handleRestore(summary)}
                    onKeep={() => handleKeep(summary)}
                  />
                )
              )}
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
  onKeep(): void;
}

function HistoryRow({ summary, change, onRestore, onKeep }: HistoryRowProps): JSX.Element {
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
        <Button
          size="sm"
          variant="ghost"
          className="h-6 px-2 mt-1"
          onClick={onKeep}
          title="Keep this version: it stays until you stop keeping it"
          aria-label={`Keep ${summary.name ?? 'version'} from ${new Date(summary.savedAt).toLocaleString()}`}
        >
          📌 Keep
        </Button>
      </div>
    </li>
  );
}

interface KeptRowProps {
  version: KeptVersionSummary;
  /** Move focus to this row's first control (after a Keep), then call `onFocused`. */
  takeFocus: boolean;
  onFocused(): void;
  onRestore(): void;
  /** False when the name was refused: the field stays open. */
  onRename(label: string): boolean;
  onUnkeep(): void;
}

function KeptRow({ version, takeFocus, onFocused, onRestore, onRename, onUnkeep }: KeptRowProps): JSX.Element {
  const load = useCallback(() => getKeptVersion(version.id), [version.id]);
  const [draft, setDraft] = useState<string | null>(null);
  const restoreRef = useRef<HTMLButtonElement>(null);
  const renameRef = useRef<HTMLButtonElement>(null);
  // Set when the field closes: focus goes back to Rename, never to <body>.
  const refocusRename = useRef(false);
  const when = new Date(version.savedAt).toLocaleString();

  useEffect(() => {
    if (!takeFocus) return;
    restoreRef.current?.focus();
    onFocused();
  }, [takeFocus, onFocused]);

  useEffect(() => {
    if (draft !== null || !refocusRename.current) return;
    refocusRename.current = false;
    renameRef.current?.focus();
  }, [draft]);

  const close = (): void => {
    refocusRename.current = true;
    setDraft(null);
  };
  const save = (): void => {
    if (draft !== null && onRename(draft)) close();
  };
  return (
    <li className="flex items-center gap-2 rounded border border-primary/40 bg-primary/5 p-2 text-xs">
      <PlanThumb layout={load} width={THUMB_WIDTH} height={THUMB_HEIGHT} className="rounded border bg-muted shrink-0" />
      <div className="flex-1 min-w-0" title={when}>
        {draft === null ? (
          <div className="font-medium truncate">📌 {version.label}</div>
        ) : (
          <Input
            value={draft}
            maxLength={KEPT_LABEL_MAX_LENGTH}
            autoFocus
            aria-label="Name of this kept version"
            className="h-7 text-xs"
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.repeat) return;
              if (event.key === 'Enter') {
                event.preventDefault();
                save();
              } else if (event.key === 'Escape') {
                event.preventDefault();
                event.stopPropagation();
                close();
              }
            }}
          />
        )}
        <div className="text-muted-foreground truncate">
          {version.name ?? 'Unknown house'} · {formatAge(Date.now() - version.savedAt)}
        </div>
        <div className="text-muted-foreground">
          {plural(version.itemCount, 'item')} · {plural(version.floorCount, 'floor')}
        </div>
        <div className="mt-1 flex flex-wrap gap-x-1">
          {draft === null ? (
            <>
              <Button ref={restoreRef} size="sm" variant="ghost" className="h-6 px-2" onClick={onRestore} aria-label={`Restore ${version.label} from ${when}`}>
                ↩️ Restore
              </Button>
              <Button ref={renameRef} size="sm" variant="ghost" className="h-6 px-2" onClick={() => setDraft(version.label)} aria-label={`Rename ${version.label}`}>
                ✏️ Rename
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-6 px-2"
                onClick={onUnkeep}
                title="Stop keeping: it goes back among the restore points"
                aria-label={`Stop keeping ${version.label}`}
              >
                Unpin
              </Button>
            </>
          ) : (
            <>
              <Button size="sm" variant="ghost" className="h-6 px-2" onClick={save}>
                Save
              </Button>
              <Button size="sm" variant="ghost" className="h-6 px-2" onClick={close}>
                Cancel
              </Button>
            </>
          )}
        </div>
      </div>
    </li>
  );
}
