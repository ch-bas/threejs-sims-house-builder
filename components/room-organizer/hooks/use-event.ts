import { useCallback, useInsertionEffect, useRef } from 'react';

/**
 * A callback whose identity never changes but which always runs the latest
 * `handler` — so a memoised child receiving it doesn't re-render each time the
 * handler's closure does (#3). For event handlers only: called during render
 * it would run the previous render's handler.
 */
export function useEvent<Args extends unknown[], Result>(handler: (...args: Args) => Result): (...args: Args) => Result {
  const handlerRef = useRef(handler);
  // Insertion effects run before every layout effect, so a child's layout
  // effect that calls the callback already sees this render's handler.
  useInsertionEffect(() => {
    handlerRef.current = handler;
  });
  return useCallback((...args: Args) => handlerRef.current(...args), []);
}
