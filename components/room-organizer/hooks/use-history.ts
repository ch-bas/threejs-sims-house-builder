import { useCallback, useEffect, useRef, useState } from 'react';

export interface UseHistoryOptions {
  /** Debounce window for committing a snapshot, in milliseconds. */
  debounceMs?: number;
  /** Maximum number of snapshots to retain. */
  maxEntries?: number;
}

export interface UseHistoryResult {
  canUndo: boolean;
  canRedo: boolean;
  undo(): void;
  redo(): void;
  clear(): void;
}

/**
 * Snapshot-based undo/redo. Watches `value`, and when it settles (no further
 * changes for `debounceMs`), commits a snapshot to the past stack. `undo`
 * replays the most recent snapshot via `apply`; `redo` walks back forward.
 *
 * The hook is "external state" friendly — it doesn't own the state, the
 * caller does. That keeps it composable with reducers, contexts, etc.
 */
export function useHistory<T>(value: T, apply: (snapshot: T) => void, options: UseHistoryOptions = {}): UseHistoryResult {
  const { debounceMs = 600, maxEntries = 50 } = options;

  const [past, setPast] = useState<T[]>([]);
  const [future, setFuture] = useState<T[]>([]);
  const lastCommittedRef = useRef<T>(value);
  const skipNextRef = useRef(false);

  useEffect(() => {
    if (skipNextRef.current) {
      skipNextRef.current = false;
      lastCommittedRef.current = value;
      return undefined;
    }
    if (Object.is(value, lastCommittedRef.current)) return undefined;

    const timer = window.setTimeout(() => {
      setPast((prev) => {
        const next = [...prev, lastCommittedRef.current];
        return next.length > maxEntries ? next.slice(next.length - maxEntries) : next;
      });
      setFuture([]);
      lastCommittedRef.current = value;
    }, debounceMs);

    return () => window.clearTimeout(timer);
  }, [value, debounceMs, maxEntries]);

  const undo = useCallback(() => {
    setPast((prev) => {
      if (prev.length === 0) return prev;
      const last = prev[prev.length - 1];
      if (last === undefined) return prev;
      setFuture((nextFuture) => [...nextFuture, lastCommittedRef.current]);
      skipNextRef.current = true;
      lastCommittedRef.current = last;
      apply(last);
      return prev.slice(0, -1);
    });
  }, [apply]);

  const redo = useCallback(() => {
    setFuture((prev) => {
      if (prev.length === 0) return prev;
      const next = prev[prev.length - 1];
      if (next === undefined) return prev;
      setPast((nextPast) => [...nextPast, lastCommittedRef.current]);
      skipNextRef.current = true;
      lastCommittedRef.current = next;
      apply(next);
      return prev.slice(0, -1);
    });
  }, [apply]);

  const clear = useCallback(() => {
    setPast([]);
    setFuture([]);
    lastCommittedRef.current = value;
  }, [value]);

  return {
    canUndo: past.length > 0,
    canRedo: future.length > 0,
    undo,
    redo,
    clear,
  };
}
