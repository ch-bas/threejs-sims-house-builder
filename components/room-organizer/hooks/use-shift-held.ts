import { useEffect, useState } from 'react';

/** Whether Shift is down, while `enabled`. A lost window focus lets it go: the keyup won't come. */
export function useShiftHeld(enabled: boolean): boolean {
  const [held, setHeld] = useState(false);
  useEffect(() => {
    if (!enabled) return undefined;
    const onKey = (event: KeyboardEvent): void => setHeld(event.shiftKey);
    const release = (): void => setHeld(false);
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKey);
    window.addEventListener('blur', release);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKey);
      window.removeEventListener('blur', release);
      setHeld(false);
    };
  }, [enabled]);
  return held;
}
