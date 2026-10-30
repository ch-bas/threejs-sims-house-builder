'use client';

import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { askConfirm } from '../lib/confirm-dialog';
import {
  discardRecoveryCopy,
  downloadRawLayout,
  isRecoveryKey,
  readRecoveryCopies,
  readRecoveryCopy,
} from '../lib/persistence';
import { confirmReplace } from '../lib/restore-point';
import { PlanThumb } from './plan-thumb';
import type { RecoveryCopy } from '../lib/persistence';
import type { RoomLayout } from '../lib/types';

export interface RecoveryEntryProps {
  currentLayout: RoomLayout;
  /** Applies a house the undoable way and takes the restore point first, like a library load. */
  onLoad(layout: RoomLayout): void;
}

function countItems(layout: RoomLayout): number {
  return layout.floors.reduce((total, floor) => total + floor.items.length, 0);
}

function keptLabel(savedAt: number | null): string {
  return savedAt === null ? 'Kept earlier' : `Kept ${new Date(savedAt).toLocaleString()}`;
}

/**
 * The houses kept aside when a saved house couldn't be opened, or when the
 * error screen started fresh (#336). Listed in History so they can come
 * back; each is validated through the schema again on restore, never trusted.
 */
export function RecoveryEntry({ currentLayout, onLoad }: RecoveryEntryProps): JSX.Element | null {
  const [copies, setCopies] = useState<RecoveryCopy[]>([]);
  const [status, setStatus] = useState<string | null>(null);

  const refresh = useCallback(() => setCopies(readRecoveryCopies()), []);

  useEffect(() => {
    refresh();
    const onStorage = (event: StorageEvent): void => {
      if (event.key === null || isRecoveryKey(event.key)) refresh();
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [refresh]);

  if (copies.length === 0 && !status) return null;

  // The copy as shown, read again: null (with the reason on screen) when it
  // is gone, unreadable, or another tab replaced it since this list was
  // drawn — never apply a house other than the one the user is looking at.
  const readShown = (shown: RecoveryCopy): RoomLayout | null => {
    const fresh = readRecoveryCopy(shown.key);
    if (!fresh?.layout) {
      setStatus('That recovered copy is gone or can no longer be read.');
      refresh();
      return null;
    }
    if (fresh.raw !== shown.raw) {
      setStatus('That recovered copy changed since it was shown — check it and restore again.');
      refresh();
      return null;
    }
    return fresh.layout;
  };

  const handleRestore = async (shown: RecoveryCopy) => {
    if (!readShown(shown)) return;
    if (!(await confirmReplace(currentLayout, 'the recovered copy'))) return;
    // Read once more: the question gave another tab time to change it.
    const layout = readShown(shown);
    if (!layout) return;
    onLoad(layout);
    setStatus('Restored the recovered copy. Undo brings back the house it replaced.');
  };

  const handleDiscard = async (copy: RecoveryCopy) => {
    const ok = await askConfirm({
      title: 'Delete this recovered copy for good?',
      body: 'Download it first if you might want it.',
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!ok) return;
    if (!discardRecoveryCopy(copy.key)) {
      setStatus('Couldn’t delete the recovered copy — storage is blocked.');
      return;
    }
    setStatus(null);
    refresh();
  };

  return (
    <div className="space-y-1">
      {status && (
        <p role="status" className="text-xs text-muted-foreground">
          {status}
        </p>
      )}
      {copies.map((copy) => (
        <RecoveryCopyRow
          key={copy.key}
          copy={copy}
          onRestore={() => void handleRestore(copy)}
          onDiscard={() => void handleDiscard(copy)}
        />
      ))}
    </div>
  );
}

interface RecoveryCopyRowProps {
  copy: RecoveryCopy;
  onRestore(): void;
  onDiscard(): void;
}

function RecoveryCopyRow({ copy, onRestore, onDiscard }: RecoveryCopyRowProps): JSX.Element {
  const { layout } = copy;
  const loadThumb = useCallback(() => layout, [layout]);
  return (
    <div className="flex items-center gap-2 rounded border border-dashed p-2 text-xs">
      {layout && (
        <PlanThumb layout={loadThumb} width={96} height={64} className="rounded border bg-muted shrink-0" />
      )}
      <div className="flex-1 min-w-0">
        <div className="font-medium">Recovered copy</div>
        {layout ? (
          <div className="text-muted-foreground truncate">
            {layout.name} · {countItems(layout)} {countItems(layout) === 1 ? 'item' : 'items'}
          </div>
        ) : (
          <div className="text-muted-foreground">Can’t be opened as a house — download it to keep it.</div>
        )}
        <div className="text-muted-foreground/80">
          {keptLabel(copy.savedAt)}, when a saved house couldn’t be opened.
        </div>
        <div className="flex flex-wrap gap-1 mt-1">
          {layout && (
            <Button size="sm" variant="ghost" className="h-6 px-2" onClick={onRestore}>
              ↩️ Restore
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            className="h-6 px-2"
            onClick={() => downloadRawLayout(copy.raw, 'recovered-house.json')}
          >
            Download
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-6 px-2"
            onClick={onDiscard}
            aria-label="Delete the recovered copy"
          >
            Delete
          </Button>
        </div>
      </div>
    </div>
  );
}
