import { describe, expect, it } from 'vitest';
import { HAIR_STYLES, REGION, SKIN_TONES, hashSeed, lookForSeed, regionColours, regionOfBone } from './people-outfits';

describe('regionOfBone', () => {
  it('maps the mannequin bones to body regions', () => {
    expect(regionOfBone('DEF-head')).toBe(REGION.head);
    expect(regionOfBone('DEF-neck')).toBe(REGION.head);
    expect(regionOfBone('DEF-spine002')).toBe(REGION.torso);
    expect(regionOfBone('DEF-shoulderL')).toBe(REGION.torso);
    expect(regionOfBone('DEF-upper_armR')).toBe(REGION.upperArm);
    expect(regionOfBone('DEF-forearmL')).toBe(REGION.forearm);
    expect(regionOfBone('DEF-f_index02L')).toBe(REGION.hand);
    expect(regionOfBone('DEF-thumb01R')).toBe(REGION.hand);
    expect(regionOfBone('DEF-hips')).toBe(REGION.hips);
    expect(regionOfBone('DEF-thighL')).toBe(REGION.thigh);
    expect(regionOfBone('DEF-shinR')).toBe(REGION.shin);
    expect(regionOfBone('DEF-toeL')).toBe(REGION.foot);
  });
});

describe('lookForSeed', () => {
  it('is deterministic and varies between seeds', () => {
    expect(lookForSeed(7)).toEqual(lookForSeed(7));
    const looks = Array.from({ length: 20 }, (_, i) => lookForSeed(i));
    expect(new Set(looks.map((l) => l.top)).size).toBeGreaterThan(4);
    expect(new Set(looks.map((l) => l.hairStyle)).size).toBeGreaterThan(2);
    for (const look of looks) {
      expect(SKIN_TONES).toContain(look.skin);
      expect(HAIR_STYLES).toContain(look.hairStyle);
    }
  });

  it('hashes ids into seeds', () => {
    expect(hashSeed('person-1')).toBe(hashSeed('person-1'));
    expect(hashSeed('person-1')).not.toBe(hashSeed('person-2'));
  });
});

describe('regionColours', () => {
  it('dresses the body and bares forearms and shins when asked', () => {
    const look = { ...lookForSeed(1), shortSleeves: false, shorts: false };
    const covered = regionColours(look);
    expect(covered[REGION.forearm]).toBe(look.top);
    expect(covered[REGION.shin]).toBe(look.bottom);
    expect(covered[REGION.hand]).toBe(look.skin);
    const bare = regionColours({ ...look, shortSleeves: true, shorts: true });
    expect(bare[REGION.forearm]).toBe(look.skin);
    expect(bare[REGION.shin]).toBe(look.skin);
  });
});
