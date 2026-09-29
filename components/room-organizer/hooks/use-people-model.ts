import { useEffect, useState } from 'react';
import { getPeopleModel, loadPeopleModel } from '../three/people-model';

type ThreeModule = typeof import('three');

/**
 * Fetches people.glb the first time it's needed — a person placed in the
 * layout, or the walkers switched on — so layouts without people never pay
 * for the download. Returns true once the rigged model is available; the
 * scene effects depend on it to swap the procedural figures out.
 */
export function usePeopleModel(
  threeModuleRef: React.MutableRefObject<ThreeModule | null>,
  isReady: boolean,
  needed: boolean
): boolean {
  const [ready, setReady] = useState(() => getPeopleModel() !== null);

  useEffect(() => {
    if (ready || !isReady || !needed) return undefined;
    const THREE = threeModuleRef.current;
    if (!THREE) return undefined;
    let cancelled = false;
    void loadPeopleModel(THREE).then((model) => {
      if (!cancelled && model) setReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, [ready, isReady, needed, threeModuleRef]);

  return ready;
}
