'use client';

import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  RECOVERY_STORAGE_KEY,
  discardRecoveryCopy,
  downloadRawLayout,
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

/**
 * The house kept under the recovery key when it couldn't be opened, or when
 * the error screen started fresh (#336). Listed in History so it can come
 * back; it is validated through the schema again on restore, never trusted.
 */
export function RecoveryEntry({ currentLayout, onLoad }: RecoveryEntryProps): JSX.Element | null {
  const [copy, setCopy] = useState<RecoveryCopy | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  const refresh = useCallback(() => setCopy(readRecoveryCopy()), []);
  const loadThumb = useCallback(() => copy?.layout ?? null, [copy]);

  useEffect(() => {
    refresh();
    const onStorage = (event: StorageEvent): void => {
      if (event.key === null || event.key === RECOVERY_STORAGE_KEY) refresh();
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [refresh]);

  if (!copy) return null;
  const { layout } = copy;

  const handleRestore = () => {
    const fresh = readRecoveryCopy();
    if (!fresh?.layout) {
      setStatus('The recovered copy is gone or can no longer be read.');
      setCopy(fresh);
      return;
    }
    if (!confirmReplace(currentLayout, 'the recovered copy')) return;
    onLoad(fresh.layout);
    setStatus('Restored the recovered copy. Undo brings back the house it replaced.');
  };

  const handleDiscard = () => {
    if (!window.confirm('Delete the recovered copy for good? Download it first if you might want it.')) return;
    if (!discardRecoveryCopy()) {
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
      <div className="flex items-center gap-2 rounded border border-dashed p-2 text-xs">
        {layout && (
          <PlanThumb
            layout={loadThumb}
            width={96}
            height={64}
            className="rounded border bg-muted shrink-0"
          />
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
          <div className="text-muted-foreground/80">Kept when a saved house couldn’t be opened.</div>
          <div className="flex flex-wrap gap-1 mt-1">
            {layout && (
              <Button size="sm" variant="ghost" className="h-6 px-2" onClick={handleRestore}>
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
              onClick={handleDiscard}
              aria-label="Delete the recovered copy"
            >
              Delete
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
