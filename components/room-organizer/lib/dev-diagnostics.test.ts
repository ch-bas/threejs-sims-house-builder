import { describe, expect, it } from 'vitest';
import { diagnosticsRequested, emptyRendererStats, formatRendererStats, readRendererStats, type RendererInfoLike } from './dev-diagnostics';

function info(calls: number, frame: number): RendererInfoLike {
  return { render: { calls, triangles: 12_345, frame }, memory: { geometries: 40, textures: 9 }, programs: [{}, {}, {}] };
}

describe('dev diagnostics (#192)', () => {
  it('is off unless the page asks for it', () => {
    expect(diagnosticsRequested('')).toBe(false);
    expect(diagnosticsRequested('?view=2d')).toBe(false);
    expect(diagnosticsRequested('?debug')).toBe(true);
    expect(diagnosticsRequested('?debug=1')).toBe(true);
    expect(diagnosticsRequested('?x=1&debug=true')).toBe(true);
    expect(diagnosticsRequested('?debug=0')).toBe(false);
    expect(diagnosticsRequested('?debug=false')).toBe(false);
  });

  it('reports a change only when a counter moved', () => {
    const stats = emptyRendererStats();
    expect(readRendererStats(info(80, 1), stats)).toBe(true);
    expect(stats).toEqual({ calls: 80, triangles: 12_345, geometries: 40, textures: 9, programs: 3, frame: 1 });
    expect(readRendererStats(info(80, 1), stats)).toBe(false);
    expect(readRendererStats(info(80, 2), stats)).toBe(true);
    expect(readRendererStats({ ...info(80, 2), programs: null }, stats)).toBe(true);
    expect(stats.programs).toBe(0);
  });

  it('formats every counter', () => {
    const stats = emptyRendererStats();
    readRendererStats(info(80, 7), stats);
    expect(formatRendererStats(stats)).toBe(
      'draw calls 80 · triangles 12,345\ngeometries 40 · textures 9 · programs 3\nframes rendered 7'
    );
  });
});
