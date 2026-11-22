import { describe, expect, it } from 'vitest';
import { makeLayout } from '../lib/__testfixtures__/fixtures';
import { drawMeasurePreview } from './plan-measure';

/** A 2D context that records the text drawn and the dots, and ignores the rest. */
function recordingContext(): { ctx: CanvasRenderingContext2D; texts: string[]; dots: Array<{ x: number; y: number }> } {
  const texts: string[] = [];
  const dots: Array<{ x: number; y: number }> = [];
  const ctx = new Proxy(
    {},
    {
      get(_target, key) {
        if (key === 'fillText') return (text: string) => texts.push(text);
        if (key === 'arc') return (x: number, y: number) => dots.push({ x, y });
        return () => {};
      },
      set: () => true,
    }
  ) as unknown as CanvasRenderingContext2D;
  return { ctx, texts, dots };
}

describe('drawMeasurePreview (#921)', () => {
  const layout = makeLayout({ width: 8, height: 6 });

  it('writes the length between the two points in the unit asked for', () => {
    const { ctx, texts, dots } = recordingContext();
    drawMeasurePreview(ctx, layout, { points: [{ x: 0, z: 0 }, { x: 3, z: 4 }], tip: null, snapped: false }, 0, 0, 10, 'metric');
    expect(texts).toEqual(['5.00 m']);
    expect(dots).toEqual([{ x: 40, y: 30 }, { x: 70, y: 70 }]);
    const imperial = recordingContext();
    drawMeasurePreview(imperial.ctx, layout, { points: [{ x: 0, z: 0 }, { x: 3, z: 4 }], tip: null, snapped: false }, 0, 0, 10, 'imperial');
    expect(imperial.texts[0]).toContain('\'');
  });

  it('runs from the first point to the tip until the second is placed', () => {
    const { ctx, texts, dots } = recordingContext();
    drawMeasurePreview(ctx, layout, { points: [{ x: 0, z: 0 }], tip: { x: 1, z: 0 }, snapped: true }, 0, 0, 10, 'metric');
    expect(texts).toEqual(['1.00 m']);
    expect(dots).toHaveLength(2);
  });

  it('shows only the tip before the first point, with no length', () => {
    const { ctx, texts, dots } = recordingContext();
    drawMeasurePreview(ctx, layout, { points: [], tip: { x: 1, z: 0 }, snapped: false }, 0, 0, 10, 'metric');
    expect(texts).toEqual([]);
    expect(dots).toEqual([{ x: 50, y: 30 }]);
  });
});
