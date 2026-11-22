import { describe, expect, it } from 'vitest';
import { makeFloor, makeLayout } from '../lib/__testfixtures__/fixtures';
import { drawMeasurePreview, drawPinnedDimensions, hitPinnedDimension } from './plan-measure';

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

describe('pinned dimensions on the plan (#921)', () => {
  const layout = makeLayout({ width: 8, height: 6 });
  const floor = makeFloor({ dimensions: [{ id: 'p', a: { x: -2, z: 0 }, b: { x: 2, z: 0 } }, { id: 'short', a: { x: 0, z: 2 }, b: { x: 0.1, z: 2 } }] });

  it('writes each pin’s length', () => {
    const { ctx, texts } = recordingContext();
    drawPinnedDimensions(ctx, layout, floor, 0, 0, 50, 'metric');
    expect(texts).toEqual(['4.00 m', '0.10 m']);
  });

  it('a press along a pin takes it; near its ends it measures instead', () => {
    // 50 px a metre: 0.02 m per px.
    expect(hitPinnedDimension(floor, { x: 0, z: 0.1 }, 0.02)?.id).toBe('p');
    expect(hitPinnedDimension(floor, { x: 1.9, z: 0 }, 0.02)).toBeNull();
    expect(hitPinnedDimension(floor, { x: 0, z: 0.5 }, 0.02)).toBeNull();
  });

  it('a short pin is taken by its middle', () => {
    expect(hitPinnedDimension(floor, { x: 0.05, z: 2.05 }, 0.02)?.id).toBe('short');
    expect(hitPinnedDimension(floor, { x: 0.3, z: 2 }, 0.02)).toBeNull();
  });
});
