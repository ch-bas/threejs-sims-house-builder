/**
 * The first-frame hold while the first scene's shaders compile (#730). The
 * renderer's `compileAsync` is passed in as `compile`, so this module stays
 * free of Three.js. The hold ends exactly once: when the compile settles,
 * when it fails, when `limitMs` have passed, or when the returned cleanup
 * runs. Whichever comes first calls `release`; the others do nothing.
 */
export function holdForShaderWarmup(compile: () => Promise<unknown>, release: () => void, limitMs: number): () => void {
  let held = true;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const end = (): void => {
    if (!held) return;
    held = false;
    if (timer !== undefined) clearTimeout(timer);
    release();
  };
  timer = setTimeout(end, limitMs);
  try {
    compile().then(end, end);
  } catch {
    end();
  }
  return end;
}
