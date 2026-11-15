import { useEffect, useRef, useState } from 'react';
import { offerBackupRestore } from '../lib/backup-file';
import { notify } from '../lib/editor-notices';
import { dragHasFiles, droppedFileKind, dropRefusal, MAX_SNIFFED_FILE_BYTES, modalBlocksFiles } from '../lib/file-drop';
import { layoutStore } from './use-layout-store';

export interface UseFileDropParams {
  /** Why the house can't be replaced now (EXPLORE, a shared tour, photo mode), or null. */
  lockedReason: string | null;
  /** The JSON import (`handleImport`): asks, snapshots, commits, applies, marks loaded. */
  openHouse(file: File): Promise<boolean>;
  /** A refusal with its cue (`notifyRefused`). */
  refuse(message: string): void;
}

/**
 * The page-wide drop target for house files (#934). While a drag that carries
 * files is over the page it reports `dragging` (the overlay shows), and every
 * file drop is caught, so the browser never navigates away from the editor to
 * show the file. One JSON file opens: a backup through the add-only restore,
 * anything else through the JSON import, which validates it. Drops inside
 * the page that a target already handled (`defaultPrevented`) are left alone.
 * While a dialog holds the page (the start chooser, a question) a drop is
 * refused; `blockedReason` says why, for the overlay.
 */
export function useFileDrop({ lockedReason, openHouse, refuse }: UseFileDropParams): { dragging: boolean; blockedReason: string | null } {
  const [dragging, setDragging] = useState(false);
  const [blockedReason, setBlockedReason] = useState<string | null>(null);
  const latest = useRef({ lockedReason, openHouse, refuse });
  latest.current = { lockedReason, openHouse, refuse };

  useEffect(() => {
    // dragenter and dragleave fire for every element crossed: count them.
    let depth = 0;
    let busy = false;
    const reset = (): void => {
      depth = 0;
      setDragging(false);
    };
    const blocked = (): string | null => latest.current.lockedReason ?? modalBlocksFiles(document);
    const onEnter = (event: DragEvent): void => {
      if (!event.dataTransfer || !dragHasFiles(event.dataTransfer.types)) return;
      depth += 1;
      setBlockedReason(blocked());
      setDragging(true);
    };
    const onLeave = (): void => {
      // Not filtered by type: a leave must always undo its enter.
      if (depth === 0) return;
      depth -= 1;
      if (depth === 0) setDragging(false);
    };
    const onOver = (event: DragEvent): void => {
      if (event.defaultPrevented || !event.dataTransfer || !dragHasFiles(event.dataTransfer.types)) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = blocked() ? 'none' : 'copy';
    };
    const onDrop = (event: DragEvent): void => {
      if (!event.dataTransfer || !dragHasFiles(event.dataTransfer.types)) return;
      reset();
      if (event.defaultPrevented) return;
      // Never let the browser open the file in place of the editor.
      event.preventDefault();
      const files = [...event.dataTransfer.files];
      const { openHouse: open, refuse: say } = latest.current;
      const refusal = busy ? 'A file is still opening.' : dropRefusal(files, blocked());
      if (refusal) {
        say(refusal);
        return;
      }
      const [file] = files;
      if (!file) return;
      busy = true;
      void openDropped(file, open).finally(() => {
        busy = false;
      });
    };
    window.addEventListener('dragenter', onEnter);
    window.addEventListener('dragleave', onLeave);
    window.addEventListener('dragover', onOver);
    window.addEventListener('drop', onDrop);
    window.addEventListener('dragend', reset);
    return () => {
      window.removeEventListener('dragenter', onEnter);
      window.removeEventListener('dragleave', onLeave);
      window.removeEventListener('dragover', onOver);
      window.removeEventListener('drop', onDrop);
      window.removeEventListener('dragend', reset);
    };
  }, []);

  return { dragging, blockedReason };
}

/** The parts of the File Handling API's `window.launchQueue` this uses (Chromium). */
interface LaunchParams {
  files?: readonly { kind?: string; getFile?(): Promise<File> }[];
}
interface LaunchQueue {
  setConsumer(consumer: (params: LaunchParams) => void): void;
}

/**
 * Files the installed app was opened with (#934): the manifest's
 * `file_handlers` makes it a handler for .json files on Chromium desktop, and
 * the launch queue hands them over, first on the window's load and later to
 * the open window (`launch_handler` focus-existing). They open exactly as a
 * dropped file does. Elsewhere there is no launch queue and this does nothing.
 */
export function useLaunchedFiles({ lockedReason, openHouse, refuse }: UseFileDropParams): void {
  const latest = useRef({ lockedReason, openHouse, refuse });
  latest.current = { lockedReason, openHouse, refuse };
  useEffect(() => {
    const queue = (window as unknown as { launchQueue?: LaunchQueue }).launchQueue;
    if (!queue || typeof queue.setConsumer !== 'function') return;
    queue.setConsumer((params) => {
      const handles = (params.files ?? []).filter((handle) => typeof handle.getFile === 'function');
      if (handles.length === 0) return;
      void Promise.all(handles.map((handle) => handle.getFile?.())).then(
        (files) => {
          const opened = files.filter((file): file is File => file instanceof File);
          const { lockedReason: locked, openHouse: open, refuse: say } = latest.current;
          const refusal = dropRefusal(opened, locked ?? modalBlocksFiles(document), 'open');
          if (refusal) {
            say(refusal);
            return;
          }
          const [file] = opened;
          if (file) void openDropped(file, open);
        },
        () => notify('Couldn’t read that file.', 'error')
      );
    });
    // A consumer can't be removed; it only ever opens files the user chose.
  }, []);
}

async function openDropped(file: File, openHouse: (file: File) => Promise<boolean>): Promise<void> {
  if (file.size <= MAX_SNIFFED_FILE_BYTES) {
    let text: string;
    try {
      text = await file.text();
    } catch {
      notify('Couldn’t read that file.', 'error');
      return;
    }
    if (droppedFileKind(text) === 'backup') {
      // The house on screen after the answer, not when it asked.
      await offerBackupRestore(text, file.name, () => layoutStore.getState().layout);
      return;
    }
  }
  await openHouse(file);
}
