import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

export interface UseHistoryOptions {
  /** Debounce window for committing a snapshot, in milliseconds. */
  debounceMs?: number;
  /** Maximum number of snapshots to retain. */
  maxEntries?: number;
}

export interface UseHistoryResult<T = unknown> {
  canUndo: boolean;
  canRedo: boolean;
  undo(): void;
  redo(): void;
  /**
   * Drop both stacks and make `baseline` — the value now on screen, e.g. the
   * hydrated layout — the committed state, so nothing is left to undo.
   */
  clear(baseline: T): void;
  /**
   * Call right before a discrete action (delete, add, paste): commits any
   * pending edit as its own entry, and commits the action's change as soon as
   * it lands instead of merging it with whatever follows inside the debounce
   * window (#425). Streams (drag, sliders) keep the debounce.
   */
  commitNow(): void;
  /**
   * Forget `snapshot` and every entry newer than it, clear redo, and adopt the
   * next value change as the baseline. For abandoning a session that started
   * at `snapshot` (keyboard placement cancel, #356): call it, then apply the
   * replacement value, which must differ from the current one.
   */
  truncateTo(snapshot: T): void;
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
export function useHistory<T>(value: T, apply: (snapshot: T) => void, options: UseHistoryOptions = {}): UseHistoryResult<T> {
  const { debounceMs = 600, maxEntries = 50 } = options;

  const [stacks, setStacks] = useState<HistoryStacks<T>>({ past: [], future: [] });
  // Mirrors so event handlers read the current state without going through an
  // updater function; kept in sync both on render and on every manual write.
  const stacksRef = useRef(stacks);
  stacksRef.current = stacks;
  const valueRef = useRef(value);
  valueRef.current = value;
  const lastCommittedRef = useRef<T>(value);
  // Adopt the next value change as the baseline instead of diffing it. Only
  // armed from event handlers (undo/redo/truncateTo), whose apply lands in the
  // very next render — never from mount-time effects, where StrictMode's
  // effect replay could consume it against a stale value (#354).
  const skipNextRef = useRef(false);
  // Bumped by clear()/truncateTo(): a debounce timer scheduled before either
  // must not push a snapshot that predates it (#354).
  const generationRef = useRef(0);
  // Set by commitNow(): commit the next change immediately (#425).
  const discreteRef = useRef(false);
  const discreteTimerRef = useRef<number | undefined>(undefined);

  const commit = useCallback(
    (next: T) => {
      const past = [...stacksRef.current.past, lastCommittedRef.current];
      const trimmed = past.length > maxEntries ? past.slice(past.length - maxEntries) : past;
      stacksRef.current = { past: trimmed, future: [] };
      setStacks(stacksRef.current);
      lastCommittedRef.current = next;
    },
    [maxEntries]
  );

  useEffect(() => {
    if (skipNextRef.current) {
      skipNextRef.current = false;
      lastCommittedRef.current = value;
      return undefined;
    }
    if (Object.is(value, lastCommittedRef.current)) return undefined;

    if (discreteRef.current) {
      discreteRef.current = false;
      window.clearTimeout(discreteTimerRef.current);
      commit(value);
      return undefined;
    }

    const generation = generationRef.current;
    const timer = window.setTimeout(() => {
      if (generation !== generationRef.current) return;
      commit(value);
    }, debounceMs);

    return () => window.clearTimeout(timer);
  }, [value, debounceMs, commit]);

  useEffect(() => () => window.clearTimeout(discreteTimerRef.current), []);

  const undo = useCallback(() => {
    const { past, future } = stacksRef.current;

    // An edit still inside the debounce window hasn't been committed yet.
    // Undo it back to the last committed snapshot — without this, the pending
    // edit would be discarded and undo would jump one step too far. While
    // skipNextRef is armed the divergence is a not-yet-adopted baseline
    // (undo/redo), not a pending edit.
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

    // A fresh edit still inside the debounce window hasn't been committed yet,
    // and it will clear `future` when it commits. Redoing now would apply a
    // stale snapshot and destroy that pending edit. Mirror the undo-side
    // guard: while a pending edit exists, drop the stale future and treat redo
    // as a no-op. While skipNextRef is armed the divergence is a
    // not-yet-adopted baseline (undo/redo), not a pending edit.
    if (!skipNextRef.current && !Object.is(valueRef.current, lastCommittedRef.current)) {
      if (future.length > 0) {
        stacksRef.current = { past, future: [] };
        setStacks(stacksRef.current);
      }
      return;
    }

    if (future.length === 0) return;
    const next = future[future.length - 1];
    if (next === undefined) return;
    stacksRef.current = { past: [...past, lastCommittedRef.current], future: future.slice(0, -1) };
    setStacks(stacksRef.current);
    skipNextRef.current = true;
    lastCommittedRef.current = next;
    apply(next);
  }, [apply]);

  // The baseline is explicit rather than "whatever value arrives next": the
  // hydration dispatch and this call happen inside a mount effect, and
  // StrictMode (dev) replays the commit effect with the pre-hydration value
  // in between — a one-shot "adopt next" flag got consumed by that replay and
  // the default house landed on the undo stack (#354).
  const clear = useCallback((baseline: T) => {
    generationRef.current += 1;
    stacksRef.current = { past: [], future: [] };
    setStacks(stacksRef.current);
    skipNextRef.current = false;
    discreteRef.current = false;
    lastCommittedRef.current = baseline;
  }, []);

  const commitNow = useCallback(() => {
    if (!skipNextRef.current && !Object.is(valueRef.current, lastCommittedRef.current)) {
      generationRef.current += 1;
      commit(valueRef.current);
    }
    discreteRef.current = true;
    // A refused action (no value change) must not leave the flag armed for an
    // unrelated later edit.
    window.clearTimeout(discreteTimerRef.current);
    discreteTimerRef.current = window.setTimeout(() => {
      discreteRef.current = false;
    }, debounceMs);
  }, [commit, debounceMs]);

  const truncateTo = useCallback((snapshot: T) => {
    const { past } = stacksRef.current;
    const index = past.lastIndexOf(snapshot);
    // Not in `past`: either nothing newer was committed (it is still the
    // baseline) or it was trimmed off the bottom, so every entry is newer.
    const kept = index >= 0 ? past.slice(0, index) : Object.is(snapshot, lastCommittedRef.current) ? past : [];
    generationRef.current += 1;
    stacksRef.current = { past: kept, future: [] };
    setStacks(stacksRef.current);
    discreteRef.current = false;
    skipNextRef.current = true;
  }, []);

  // A pending uncommitted edit is undoable too (back to the last committed
  // snapshot), so canUndo can't rely on the past stack alone.
  const pendingEdit = !skipNextRef.current && !Object.is(value, lastCommittedRef.current);
  const canUndo = stacks.past.length > 0 || pendingEdit;
  // Symmetric to redo()'s guard: a pending edit invalidates the (stale) future
  // stack, so redo must report disabled until that edit commits.
  const canRedo = stacks.future.length > 0 && !pendingEdit;

  return useMemo(
    () => ({ canUndo, canRedo, undo, redo, clear, commitNow, truncateTo }),
    [canUndo, canRedo, undo, redo, clear, commitNow, truncateTo]
  );
}
