import { describe, expect, it } from 'vitest';
import { makeLayout } from './__testfixtures__/fixtures';
import { drawnFloorPlanImage, isFloorPlanMode, planIsDrawing } from './floor-plan-fit';
import { parseStoredLayout } from './schema';
import { decodeShareUrl, encodeShareUrl } from './share';

const IMAGE = 'data:image/png;base64,AAAA';

describe('planIsDrawing (#920)', () => {
  it('a traced plan is the drawing unless it is an underlay', () => {
    expect(planIsDrawing(makeLayout())).toBe(false);
    expect(planIsDrawing(makeLayout({ floorPlanMode: 'underlay' }))).toBe(false);
    expect(planIsDrawing(makeLayout({ floorPlanImage: IMAGE }))).toBe(true);
    expect(planIsDrawing(makeLayout({ floorPlanImage: IMAGE, floorPlanMode: 'drawing' }))).toBe(true);
    expect(planIsDrawing(makeLayout({ floorPlanImage: IMAGE, floorPlanMode: 'underlay' }))).toBe(false);
  });

  it('only the ground floor of a drawing wears the image in 3D', () => {
    const drawing = makeLayout({ floorPlanImage: IMAGE });
    expect(drawnFloorPlanImage(drawing, 0)).toBe(IMAGE);
    expect(drawnFloorPlanImage(drawing, 1)).toBeNull();
    expect(drawnFloorPlanImage({ ...drawing, floorPlanMode: 'underlay' }, 0)).toBeNull();
    expect(drawnFloorPlanImage(makeLayout(), 0)).toBeNull();
  });

  it('knows the modes', () => {
    expect(isFloorPlanMode('drawing')).toBe(true);
    expect(isFloorPlanMode('underlay')).toBe(true);
    for (const bad of ['Underlay', '', null, 1, {}]) expect(isFloorPlanMode(bad)).toBe(false);
  });
});

describe('floorPlanMode in a stored house (#920)', () => {
  it('an old save loads unchanged, without the key', () => {
    const old = makeLayout({ floorPlanImage: IMAGE, floorPlanOpacity: 0.4 });
    const parsed = parseStoredLayout(old);
    expect(parsed).toEqual(old);
    expect(parsed && 'floorPlanMode' in parsed).toBe(false);
  });

  it('keeps either mode as stored', () => {
    expect(parseStoredLayout(makeLayout({ floorPlanImage: IMAGE, floorPlanMode: 'underlay' }))?.floorPlanMode).toBe('underlay');
    expect(parseStoredLayout(makeLayout({ floorPlanImage: IMAGE, floorPlanMode: 'drawing' }))?.floorPlanMode).toBe('drawing');
  });

  it('drops an unknown mode and keeps the house, the image the drawing again', () => {
    for (const bad of ['tracing', 3, null, { mode: 'underlay' }]) {
      const parsed = parseStoredLayout({ ...makeLayout({ floorPlanImage: IMAGE }), floorPlanMode: bad });
      expect(parsed, JSON.stringify(bad)).not.toBeNull();
      expect(parsed && 'floorPlanMode' in parsed).toBe(false);
      expect(parsed && planIsDrawing(parsed)).toBe(true);
    }
  });
});

describe('a share link (#920)', () => {
  it('leaves the mode behind with the image, so a kept copy uploads as the drawing', async () => {
    const { url } = await encodeShareUrl(makeLayout({ floorPlanImage: IMAGE, floorPlanMode: 'underlay' }), 'https://example.com/app');
    const decoded = await decodeShareUrl(url.slice(url.indexOf('#')));
    expect(decoded).not.toBeNull();
    expect(decoded && ('floorPlanMode' in decoded || 'floorPlanImage' in decoded)).toBe(false);
  });
});
