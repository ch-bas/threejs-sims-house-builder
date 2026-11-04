import { describe, expect, it } from 'vitest';
import { autoTier, isPhone, loadQualityChoice, qualityProfile, saveQualityChoice, type QualityChoice } from './render-quality';

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

describe('quality tiers (#760)', () => {
  const desktop = { coarsePointer: false, screenShortSide: 900, devicePixelRatio: 2 };
  const tablet = { coarsePointer: true, screenShortSide: 768, devicePixelRatio: 2 };
  const phone = { coarsePointer: true, screenShortSide: 390, devicePixelRatio: 3 };

  it('picks the tier from the device class', () => {
    expect(autoTier(desktop)).toBe('high');
    expect(autoTier(tablet)).toBe('medium');
    expect(autoTier(phone)).toBe('low');
  });

  it('spends less on every field going down', () => {
    const [low, medium, high] = (['low', 'medium', 'high'] as const).map((tier) => qualityProfile(desktop, tier));
    expect(low!.shadowMapSize).toBeLessThan(medium!.shadowMapSize);
    expect(medium!.shadowMapSize).toBeLessThan(high!.shadowMapSize);
    expect(low!.groundTile).toBeLessThan(medium!.groundTile);
    expect(low!.maxAnisotropy).toBeLessThan(medium!.maxAnisotropy);
    expect(low!.pixelRatio).toBeLessThan(medium!.pixelRatio);
  });

  it('keeps the pre-tier shadow map and anisotropy on auto, on every device (#760)', () => {
    for (const device of [desktop, tablet, phone]) {
      const auto = qualityProfile(device);
      expect([auto.shadowMapSize, auto.shadowRadius, auto.maxAnisotropy]).toEqual([2048, 3, Infinity]);
    }
    expect(qualityProfile(desktop, 'high').shadowMapSize).toBe(4096);
    expect(qualityProfile(phone, 'low').shadowMapSize).toBe(1024);
  });

  it('leaves the costly scenery out on low only', () => {
    expect(qualityProfile(phone).richScenery).toBe(false);
    expect(qualityProfile(tablet).richScenery).toBe(true);
    expect(qualityProfile(desktop).richScenery).toBe(true);
    expect(qualityProfile(desktop, 'low').richScenery).toBe(false);
  });

  it('lets the choice override the device, and never raises the ratio past the display', () => {
    expect(qualityProfile(phone, 'high').tier).toBe('high');
    expect(qualityProfile(phone, 'high').pixelRatio).toBe(2);
    expect(qualityProfile({ ...desktop, devicePixelRatio: 1 }, 'high').pixelRatio).toBe(1);
    expect(qualityProfile(desktop, 'low').tier).toBe('low');
  });

  it('remembers a choice, and reads anything else as auto', () => {
    const values = new Map<string, string>();
    const storage = { getItem: (k: string) => values.get(k) ?? null, setItem: (k: string, v: string) => void values.set(k, v) } as unknown as Storage;
    expect(loadQualityChoice(storage)).toBe('auto');
    saveQualityChoice('low' as QualityChoice, storage);
    expect(loadQualityChoice(storage)).toBe('low');
    values.set('render-quality', 'ultra');
    expect(loadQualityChoice(storage)).toBe('auto');
  });
});
