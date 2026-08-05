import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

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

interface HistoryStacks<T> {
  readonly past: readonly T[];
  readonly future: readonly T[];
}

/**
 * Snapshot-based undo/redo. Watches `value`, and when it settles (no further
 * changes for `debounceMs`), commits a snapshot to the past stack. `undo`
 * replays the most recent snapshot via `apply`; `redo` walks back forward.
 *
 * The hook is "external state" friendly — it doesn't own the state, the
 * caller does. That keeps it composable with reducers, contexts, etc.
 *
 * Both stacks live in one state value, and undo/redo compute the next stacks
 * outside the setState updater — StrictMode double-invokes updaters, so side
 * effects inside them (apply, ref writes) would corrupt the stacks in dev.
 */
export function useHistory<T>(value: T, apply: (snapshot: T) => void, options: UseHistoryOptions = {}): UseHistoryResult {
  const { debounceMs = 600, maxEntries = 50 } = options;

  const [stacks, setStacks] = useState<HistoryStacks<T>>({ past: [], future: [] });
  // Mirrors so event handlers read the current state without going through an
  // updater function; kept in sync both on render and on every manual write.
  const stacksRef = useRef(stacks);
  stacksRef.current = stacks;
  const valueRef = useRef(value);
  valueRef.current = value;
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
      const past = [...stacksRef.current.past, lastCommittedRef.current];
      const trimmed = past.length > maxEntries ? past.slice(past.length - maxEntries) : past;
      stacksRef.current = { past: trimmed, future: [] };
      setStacks(stacksRef.current);
      lastCommittedRef.current = value;
    }, debounceMs);

    return () => window.clearTimeout(timer);
  }, [value, debounceMs, maxEntries]);

  const undo = useCallback(() => {
    const { past, future } = stacksRef.current;

    // An edit still inside the debounce window hasn't been committed yet.
    // Undo it back to the last committed snapshot — without this, the pending
    // edit would be discarded and undo would jump one step too far. While
    // skipNextRef is armed the divergence is a not-yet-adopted baseline
    // (hydration, undo/redo), not a pending edit.
    if (!skipNextRef.current && !Object.is(valueRef.current, lastCommittedRef.current)) {
      stacksRef.current = { past, future: [...future, valueRef.current] };
      setStacks(stacksRef.current);
      skipNextRef.current = true;
      apply(lastCommittedRef.current);
      return;
    }

    if (past.length === 0) return;
    const last = past[past.length - 1];
    if (last === undefined) return;
    stacksRef.current = { past: past.slice(0, -1), future: [...future, lastCommittedRef.current] };
    setStacks(stacksRef.current);
    skipNextRef.current = true;
    lastCommittedRef.current = last;
    apply(last);
  }, [apply]);

  const redo = useCallback(() => {
    const { past, future } = stacksRef.current;
    if (future.length === 0) return;
    const next = future[future.length - 1];
    if (next === undefined) return;
    stacksRef.current = { past: [...past, lastCommittedRef.current], future: future.slice(0, -1) };
    setStacks(stacksRef.current);
    skipNextRef.current = true;
    lastCommittedRef.current = next;
    apply(next);
  }, [apply]);

  // Call this alongside (or right after) applying a new baseline value, e.g.
  // hydration. `skipNextRef` makes the commit effect adopt the upcoming value
  // as the baseline instead of diffing it against the stale one — otherwise
  // undo right after hydration would revert to the pre-hydration state.
  const clear = useCallback(() => {
    stacksRef.current = { past: [], future: [] };
    setStacks(stacksRef.current);
    skipNextRef.current = true;
  }, []);

  // A pending uncommitted edit is undoable too (back to the last committed
  // snapshot), so canUndo can't rely on the past stack alone.
  const canUndo =
    stacks.past.length > 0 || (!skipNextRef.current && !Object.is(value, lastCommittedRef.current));
  const canRedo = stacks.future.length > 0;

  return useMemo(
    () => ({ canUndo, canRedo, undo, redo, clear }),
    [canUndo, canRedo, undo, redo, clear]
  );
}
