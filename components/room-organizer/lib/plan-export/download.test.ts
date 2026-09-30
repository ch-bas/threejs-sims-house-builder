import { describe, expect, it } from 'vitest';
import { makeFloor, makeLayout } from '../__testfixtures__/fixtures';
import { planExportFileName, slugify } from './download';

describe('slugify', () => {
  it('lowercases and dashes non-alphanumerics', () => {
    expect(slugify('My Home')).toBe('my-home');
    expect(slugify('First Floor (v2)')).toBe('first-floor-v2');
  });

  it('strips accents via NFKD', () => {
    expect(slugify('Étage Bébé')).toBe('etage-bebe');
  });

  it('falls back when nothing survives', () => {
    expect(slugify('***')).toBe('plan');
    expect(slugify('', 'floor')).toBe('floor');
  });
});

describe('planExportFileName', () => {
  it('joins slugified layout and floor names with the extension', () => {
    const layout = makeLayout();
    expect(planExportFileName(layout, makeFloor(), 'svg')).toBe('my-home-ground-floor.svg');
    expect(planExportFileName(layout, makeFloor({ name: '1st Floor' }), 'dxf')).toBe('my-home-1st-floor.dxf');
  });
});
