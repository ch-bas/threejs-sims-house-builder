import { useCallback } from 'react';
import { useViewSettings } from '../contexts';
import { notifyRefused } from '../lib/editor-notices';
import { cueHaptic } from '../lib/haptics';
import { playSound } from '../lib/sounds';

/**
 * `refuse(message)` for panels that read the layout store rather than the
 * editor context (the catalogue strip, the floor switcher): the shared
 * refusal of `notifyRefused`, with the cue muted like `playCue` (#588,
 * #642) and the same buzz (#687). It subscribes to the two switches only, so
 * a layout edit doesn't re-render the panel through it.
 */
export function useRefusal(): (message: string) => void {
  const { soundsEnabled, hapticsEnabled } = useViewSettings('soundsEnabled', 'hapticsEnabled');
  return useCallback(
    (message: string) => {
      notifyRefused(message, (cue) => {
        if (soundsEnabled) playSound(cue);
        if (hapticsEnabled) cueHaptic(cue);
      });
    },
    [soundsEnabled, hapticsEnabled]
  );
}
