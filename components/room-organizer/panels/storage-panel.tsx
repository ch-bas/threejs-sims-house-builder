'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { NOT_WHILE_EXPLORING, useExploring } from '../hooks/use-exploring';
import {
  BACKUP_FAILURE_TEXT,
  backupFileName,
  createBackup,
  describeRestore,
  parseBackup,
  restoreBackup,
  summarizeBackup,
  type BackupBundle,
  type BackupSummary,
  type RestoreMode,
} from '../lib/backup';
import { subscribeCustomSets } from '../lib/custom-sets';
import { notify } from '../lib/editor-notices';
import { deleteNamedLayout, listSavedLayouts } from '../lib/library';
import { localStorageOrNull } from '../lib/persistence';
import { downloadTextFile } from '../lib/plan-export/download';
import {
  STORAGE_QUOTA_CHARS,
  STORAGE_TENANTS,
  TENANT_LABELS,
  formatStorageSize,
  measureStorage,
  type StorageTenant,
  type StorageUsage,
} from '../lib/storage-meter';
import { clearSnapshots, subscribeSnapshots } from '../lib/version-history';
import type { RoomLayout } from '../lib/types';

export interface StoragePanelProps {
  currentLayout: RoomLayout;
  /**
   * Open the backup's house over the current one. The caller takes the
   * restore point, the undo step and the achievements rule, as every
   * whole-house load does.
   */
  onRestoreHouse(layout: RoomLayout): void;
  /** The library changed behind the Saved Layouts panel's back. */
  onStorageChanged(): void;
}

/** Meter colours per tenant; `other` stays grey — it isn't ours to free. */
const TENANT_COLOURS: Record<StorageTenant, string> = {
  main: 'bg-emerald-500',
  library: 'bg-sky-500',
  restorePoints: 'bg-violet-500',
  recovery: 'bg-amber-500',
  pasteboard: 'bg-pink-500',
  customSets: 'bg-teal-500',
  settings: 'bg-slate-400',
  other: 'bg-zinc-300',
};

/** The autosave is debounced; measuring sooner would show the save before it. */
const REMEASURE_AFTER_EDIT_MS = 2_000;

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

/** What a backup holds, leaving out the parts it has none of. */
function describeContents(summary: BackupSummary): string {
  const parts = [
    summary.hasHouse ? 'a house' : null,
    summary.library > 0 ? plural(summary.library, 'saved layout') : null,
    summary.restorePoints > 0 ? plural(summary.restorePoints, 'restore point') : null,
    summary.received > 0 ? plural(summary.received, 'received house') : null,
    summary.customSets > 0 ? plural(summary.customSets, 'custom set') : null,
  ].filter((part): part is string => part !== null);
  return parts.length > 0 ? parts.join(', ') : 'only settings';
}

interface PendingRestore {
  fileName: string;
  bundle: BackupBundle;
}

export function StoragePanel({ currentLayout, onRestoreHouse, onStorageChanged }: StoragePanelProps): JSX.Element {
  const exploring = useExploring();
  const editHint = exploring ? NOT_WHILE_EXPLORING : undefined;
  const [usage, setUsage] = useState<StorageUsage>(() => measureStorage(null));
  const [names, setNames] = useState<Map<string, string>>(new Map());
  const [pending, setPending] = useState<PendingRestore | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const measure = useCallback(() => {
    setUsage(measureStorage(localStorageOrNull()));
    setNames(new Map(listSavedLayouts().map((entry) => [entry.id, entry.name])));
  }, []);

  useEffect(() => {
    measure();
    const onStorage = (): void => measure();
    window.addEventListener('storage', onStorage);
    const unsubscribeSnapshots = subscribeSnapshots(measure);
    const unsubscribeSets = subscribeCustomSets(measure);
    return () => {
      window.removeEventListener('storage', onStorage);
      unsubscribeSnapshots();
      unsubscribeSets();
    };
  }, [measure]);

  useEffect(() => {
    const timer = window.setTimeout(measure, REMEASURE_AFTER_EDIT_MS);
    return () => window.clearTimeout(timer);
  }, [currentLayout, measure]);

  const changed = (): void => {
    measure();
    onStorageChanged();
  };

  const handleClearRestorePoints = (): void => {
    // TODO(#649): in-app confirm dialog.
    if (!window.confirm('Delete every restore point? Saved layouts and the open house are kept.')) return;
    clearSnapshots();
    changed();
    notify('Restore points deleted.', 'success');
  };

  const handleDeleteLibraryHouse = (slot: string): void => {
    const name = names.get(slot) ?? slot;
    // TODO(#649): in-app confirm dialog.
    if (!window.confirm(`Delete the saved layout “${name}”? This can’t be undone.`)) return;
    if (deleteNamedLayout(slot)) notify(`Deleted “${name}”.`, 'success');
    else notify(`Couldn’t delete “${name}”.`, 'error');
    changed();
  };

  const handleBackup = (): void => {
    const bundle = createBackup(currentLayout);
    downloadTextFile(backupFileName(), 'application/json', JSON.stringify(bundle));
  };

  const handleFile = (event: React.ChangeEvent<HTMLInputElement>): void => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    void file.text().then(
      (text) => {
        const parsed = parseBackup(text);
        if (!parsed.ok) {
          notify(BACKUP_FAILURE_TEXT[parsed.reason], 'error');
          return;
        }
        setPending({ fileName: file.name, bundle: parsed.bundle });
      },
      () => notify('Couldn’t read that file.', 'error')
    );
  };

  const handleRestore = (mode: RestoreMode): void => {
    if (!pending) return;
    const summary = summarizeBackup(pending.bundle);
    if (mode === 'replace') {
      const replaced = [summary.hasHouse ? 'the open house' : null, 'your saved layouts', 'received houses', 'custom sets']
        .filter((part): part is string => part !== null)
        .join(', ');
      // TODO(#649): in-app confirm dialog.
      const ok = window.confirm(
        `Replace ${replaced} and settings with the backup’s? Saved layouts the backup doesn’t have are deleted. ` +
          `${summary.hasHouse ? 'The open house is kept as a restore point. ' : ''}Restore points are kept.`
      );
      if (!ok) return;
    }
    const report = restoreBackup(pending.bundle, mode, currentLayout);
    if (report.house) onRestoreHouse(report.house);
    setPending(null);
    changed();
    notify(describeRestore(report), report.failed > 0 ? 'error' : 'success');
  };

  const used = usage.total;
  const fill = Math.min(1, used / STORAGE_QUOTA_CHARS);
  const restorePointChars = usage.byTenant.restorePoints;
  const pendingSummary = pending ? summarizeBackup(pending.bundle) : null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">💽 Storage &amp; backup</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground">
            {formatStorageSize(used)} of about {formatStorageSize(STORAGE_QUOTA_CHARS)} used in this browser
          </p>
          <div
            role="meter"
            aria-label="Browser storage used"
            aria-valuemin={0}
            aria-valuemax={STORAGE_QUOTA_CHARS}
            aria-valuenow={used}
            aria-valuetext={`${formatStorageSize(used)} of about ${formatStorageSize(STORAGE_QUOTA_CHARS)}`}
            className="flex h-2 w-full overflow-hidden rounded-full bg-muted"
          >
            {STORAGE_TENANTS.map((tenant) =>
              usage.byTenant[tenant] > 0 ? (
                <div
                  key={tenant}
                  className={TENANT_COLOURS[tenant]}
                  // At least a sliver, so a small part still shows on the bar.
                  style={{ width: `${(usage.byTenant[tenant] / Math.max(used, STORAGE_QUOTA_CHARS)) * 100}%`, minWidth: 2 }}
                />
              ) : null
            )}
          </div>
          {fill > 0.85 && (
            <p className="text-xs text-red-600">Storage is nearly full — saves may start failing. Free some space below.</p>
          )}
        </div>

        <ul className="space-y-1 text-xs" aria-label="Storage by part">
          {STORAGE_TENANTS.filter((tenant) => usage.byTenant[tenant] > 0).map((tenant) => (
            <li key={tenant} className="flex items-center gap-2">
              <span aria-hidden className={`inline-block h-2 w-2 shrink-0 rounded-full ${TENANT_COLOURS[tenant]}`} />
              <span className="flex-1">{TENANT_LABELS[tenant]}</span>
              <span className="tabular-nums text-muted-foreground">{formatStorageSize(usage.byTenant[tenant])}</span>
            </li>
          ))}
        </ul>

        {usage.libraryHouses.length > 0 && (
          <div className="space-y-1">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Saved layouts</p>
            <ul className="space-y-1 text-xs">
              {usage.libraryHouses.map(({ slot, chars }) => (
                <li key={slot} className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate" title={names.get(slot) ?? slot}>
                    {names.get(slot) ?? slot}
                  </span>
                  <span className="tabular-nums text-muted-foreground">{formatStorageSize(chars)}</span>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-6 px-2 text-xs"
                    aria-label={`Delete saved layout ${names.get(slot) ?? slot}`}
                    disabled={exploring}
                    title={editHint ?? 'Delete this saved layout…'}
                    onClick={() => handleDeleteLibraryHouse(slot)}
                  >
                    🗑
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        )}

        <Button
          variant="outline"
          size="sm"
          className="w-full text-xs"
          disabled={restorePointChars === 0 || exploring}
          title={editHint}
          onClick={handleClearRestorePoints}
        >
          🧹 Delete all restore points{restorePointChars > 0 ? ` (${formatStorageSize(restorePointChars)})` : ''}
        </Button>

        <div className="space-y-2">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Backup</p>
          <div className="grid grid-cols-2 gap-2">
            <Button
              variant="outline"
              size="sm"
              className="text-xs"
              title="Download the house, saved layouts, restore points, sets and settings as one file"
              onClick={handleBackup}
            >
              ⬇ Back up all
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="text-xs"
              disabled={exploring}
              title={editHint ?? 'Bring back everything from a backup file'}
              onClick={() => fileInputRef.current?.click()}
            >
              ⬆ Restore…
            </Button>
          </div>
          {pending && pendingSummary && (
            <div role="group" aria-label="Restore backup" className="space-y-2 rounded-md border p-2 text-xs">
              <p>
                “{pending.fileName}” holds{' '}
                {describeContents(pendingSummary)}.
              </p>
              <p className="text-muted-foreground">
                Merge adds what this browser lacks and replaces nothing. Replace makes the open house and saved
                layouts the backup’s.
              </p>
              <div className="grid grid-cols-3 gap-1">
                <Button size="sm" className="text-xs" disabled={exploring} onClick={() => handleRestore('merge')}>
                  Merge
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="text-xs text-red-600"
                  disabled={exploring}
                  onClick={() => handleRestore('replace')}
                >
                  Replace…
                </Button>
                <Button variant="outline" size="sm" className="text-xs" onClick={() => setPending(null)}>
                  Cancel
                </Button>
              </div>
            </div>
          )}
        </div>

        <input ref={fileInputRef} type="file" accept=".json,application/json" onChange={handleFile} className="hidden" />
      </CardContent>
    </Card>
  );
}
