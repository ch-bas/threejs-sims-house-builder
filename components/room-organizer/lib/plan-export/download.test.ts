import { describe, expect, it } from 'vitest';
import { makeFloor, makeLayout } from '../__testfixtures__/fixtures';
import { exportFileName, planExportFileName, slugify } from './download';

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

  it('falls back per piece', () => {
    expect(planExportFileName(makeLayout({ name: '' }), makeFloor({ name: '' }), 'svg')).toBe('layout-floor.svg');
  });
});

describe('exportFileName (#427)', () => {
  it('slugifies the house name and every part', () => {
    const name = "Maison d'été (Test) & Co 100%";
    expect(exportFileName(name, 'json')).toBe('maison-d-ete-test-co-100.json');
    expect(exportFileName(name, 'csv', 'inventory')).toBe('maison-d-ete-test-co-100-inventory.csv');
    expect(exportFileName(name, 'png', 'Rez-de-chaussée')).toBe('maison-d-ete-test-co-100-rez-de-chaussee.png');
  });

  it('never lets a name carry a path, a fake extension, control or bidi characters', () => {
    for (const hostile of ['../../etc/passwd', 'a\\b/c', 'plan.html', 'evil‮gpj.exe', 'tab\there\nnew', '<script>"x"</script>']) {
      expect(exportFileName(hostile, 'json')).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*\.json$/);
    }
    expect(exportFileName('plan.html', 'json')).toBe('plan-html.json');
  });

  it('falls back to "layout" and drops empty parts', () => {
    expect(exportFileName('', 'glb')).toBe('layout.glb');
    expect(exportFileName('我的家', 'png', '***')).toBe('layout.png');
    expect(exportFileName('Home', 'png', '')).toBe('home.png');
  });

  it('caps a very long name', () => {
    const fileName = exportFileName('a very long house name '.repeat(20), 'json');
    expect(fileName.length).toBeLessThanOrEqual(85);
    expect(fileName).not.toMatch(/-\.json$/);
  });
});
