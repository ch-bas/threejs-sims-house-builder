// Renderer counters for the `?debug` overlay (#192). Structural types keep
// this file free of three; WebGLRenderer.info satisfies RendererInfoLike.

export interface RendererInfoLike {
  render: { calls: number; triangles: number; frame: number };
  memory: { geometries: number; textures: number };
  programs: readonly unknown[] | null;
}

export interface RendererStats {
  calls: number;
  triangles: number;
  geometries: number;
  textures: number;
  programs: number;
  frame: number;
}

export function emptyRendererStats(): RendererStats {
  return { calls: 0, triangles: 0, geometries: 0, textures: 0, programs: 0, frame: 0 };
}

/** `?debug`, `?debug=1`, `?debug=true`: anything but an explicit off. */
export function diagnosticsRequested(search: string): boolean {
  const value = new URLSearchParams(search).get('debug');
  return value !== null && value !== '0' && value !== 'false';
}

/**
 * Copy the counters into `into` and report whether any changed. Runs after
 * every rendered frame while the overlay is on, so it allocates nothing.
 */
export function readRendererStats(info: RendererInfoLike, into: RendererStats): boolean {
  const programs = info.programs?.length ?? 0;
  const changed =
    into.calls !== info.render.calls ||
    into.triangles !== info.render.triangles ||
    into.geometries !== info.memory.geometries ||
    into.textures !== info.memory.textures ||
    into.programs !== programs ||
    into.frame !== info.render.frame;
  if (!changed) return false;
  into.calls = info.render.calls;
  into.triangles = info.render.triangles;
  into.geometries = info.memory.geometries;
  into.textures = info.memory.textures;
  into.programs = programs;
  into.frame = info.render.frame;
  return true;
}

export function formatRendererStats(stats: RendererStats): string {
  return (
    `draw calls ${stats.calls} · triangles ${stats.triangles.toLocaleString('en-US')}\n` +
    `geometries ${stats.geometries} · textures ${stats.textures} · programs ${stats.programs}\n` +
    `frames rendered ${stats.frame}`
  );
}
