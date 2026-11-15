import {
  BACKUP_FAILURE_TEXT,
  describeRestore,
  parseBackup,
  restoreBackup,
  summarizeBackup,
  type BackupSummary,
} from './backup';
import { askConfirm } from './confirm-dialog';
import { createChannel, notify } from './editor-notices';
import type { RoomLayout } from './types';

/**
 * Restoring a backup file, from Storage & backup's Restore button or a file
 * dropped on the page (#934): one question, one add-only restore
 * (lib/backup.ts), one notice.
 */

const restored = createChannel<void>();

/**
 * Calls `listener` after a backup restored anything: the storage meter and
 * the saved-layout lists re-read, whichever way the file came in (#934).
 */
export function subscribeBackupRestored(listener: () => void): () => void {
  return restored.subscribe(listener);
}

export function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

/** What a backup holds, leaving out the parts it has none of. */
export function describeContents(summary: BackupSummary): string {
  const parts = [
    summary.hasHouse ? 'a house' : null,
    summary.library > 0 ? plural(summary.library, 'saved layout') : null,
    summary.restorePoints > 0 ? plural(summary.restorePoints, 'restore point') : null,
    summary.keptVersions > 0 ? plural(summary.keptVersions, 'kept version') : null,
    summary.received > 0 ? plural(summary.received, 'received house') : null,
    summary.customSets > 0 ? plural(summary.customSets, 'custom set') : null,
  ].filter((part): part is string => part !== null);
  const held = parts.length > 0 ? parts.join(', ') : 'only settings';
  return summary.invalid > 0 ? `${held}; ${plural(summary.invalid, 'part')} can’t be read` : held;
}

/**
 * Asks, then restores the backup in `text`. `current` is read after the
 * answer, so the house on screen then is the one kept. Resolves true when
 * anything was restored.
 */
export async function offerBackupRestore(text: string, fileName: string, current: () => RoomLayout): Promise<boolean> {
  const parsed = parseBackup(text);
  if (!parsed.ok) {
    notify(BACKUP_FAILURE_TEXT[parsed.reason], 'error');
    return false;
  }
  const ok = await askConfirm({
    title: `Restore from “${fileName}”?`,
    body: `It holds ${describeContents(summarizeBackup(parsed.bundle))}. Restoring adds what this browser lacks and never replaces or deletes your houses, sets or settings; the open house stays as it is. Older restore points may give way to make room.`,
    confirmLabel: 'Restore',
  });
  if (!ok) return false;
  const report = restoreBackup(parsed.bundle, current());
  const missed =
    report.invalid > 0 ||
    report.skipped.received.length > 0 ||
    report.skipped.customSets + report.skipped.restorePoints + report.skipped.keptVersions + report.skipped.recoveryCopies > 0;
  notify(describeRestore(report), report.failed.length > 0 ? 'error' : missed ? 'info' : 'success');
  restored.emit(undefined);
  return true;
}
