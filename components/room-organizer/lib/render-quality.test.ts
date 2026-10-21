import { describe, expect, it } from 'vitest';
import { isPhone, qualityProfile } from './render-quality';

describe('render quality profile', () => {
  it('keeps the desktop cap of 2 for mouse devices, whatever the screen', () => {
    expect(qualityProfile({ coarsePointer: false, screenShortSide: 900, devicePixelRatio: 2 }).pixelRatio).toBe(2);
    expect(qualityProfile({ coarsePointer: false, screenShortSide: 900, devicePixelRatio: 3 }).pixelRatio).toBe(2);
    expect(qualityProfile({ coarsePointer: false, screenShortSide: 900, devicePixelRatio: 1 }).pixelRatio).toBe(1);
    // A narrow desktop window is still a desktop: the screen, not the window, decides.
    expect(qualityProfile({ coarsePointer: false, screenShortSide: 390, devicePixelRatio: 2 }).pixelRatio).toBe(2);
  });

  it('keeps tablets on the desktop cap', () => {
    expect(isPhone({ coarsePointer: true, screenShortSide: 744 })).toBe(false);
    expect(qualityProfile({ coarsePointer: true, screenShortSide: 768, devicePixelRatio: 2 }).pixelRatio).toBe(2);
  });

  it('caps phones at 1.5, landscape or portrait', () => {
    expect(qualityProfile({ coarsePointer: true, screenShortSide: 390, devicePixelRatio: 3 }).pixelRatio).toBe(1.5);
    expect(qualityProfile({ coarsePointer: true, screenShortSide: 412, devicePixelRatio: 2.625 }).pixelRatio).toBe(1.5);
    expect(qualityProfile({ coarsePointer: true, screenShortSide: 320, devicePixelRatio: 2 }).pixelRatio).toBe(1.5);
  });

  it('never raises a low device pixel ratio', () => {
    expect(qualityProfile({ coarsePointer: true, screenShortSide: 360, devicePixelRatio: 1 }).pixelRatio).toBe(1);
    expect(qualityProfile({ coarsePointer: true, screenShortSide: 360, devicePixelRatio: 0 }).pixelRatio).toBe(1);
  });
});
