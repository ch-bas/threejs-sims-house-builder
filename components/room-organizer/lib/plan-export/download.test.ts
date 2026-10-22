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
    const hostile = [
      '../../etc/passwd', 'a\\b/c', 'plan.html', 'evil‮gpj.exe', 'tab\there\nnew', '<script>"x"</script>',
      'Дом‮/../мечты', '東京\u0000の家', 'x‏y⁦z',
    ];
    for (const name of hostile) {
      expect(exportFileName(name, 'json')).toMatch(/^[\p{L}\p{M}\p{N}]+(-[\p{L}\p{M}\p{N}]+)*\.json$/u);
    }
    expect(exportFileName('plan.html', 'json')).toBe('plan-html.json');
    expect(exportFileName('evil‮gpj.exe', 'json')).toBe('evil-gpj-exe.json');
  });

  it('keeps letters and digits of every script', () => {
    expect(exportFileName('Дом мечты', 'json')).toBe('дом-мечты.json');
    expect(exportFileName('東京の家', 'png', '2階')).toBe('東京の家-2階.png');
    expect(exportFileName('بيت الأحلام', 'csv')).toBe('بيت-الأحلام.csv');
    expect(exportFileName('Ferienhaus Müller', 'glb')).toBe('ferienhaus-muller.glb');
    // Hangul and kana voicing marks come back composed.
    expect(slugify('우리 집 がく')).toBe('우리-집-がく');
  });

  it('drops emoji, falling back when nothing else is left', () => {
    expect(exportFileName('🏠️🌳', 'json')).toBe('layout.json');
    expect(exportFileName('Casa 🏠️ 1️⃣', 'json')).toBe('casa-1.json');
  });

  it('suffixes the basenames Windows reserves', () => {
    expect(exportFileName('CON', 'json')).toBe('con-house.json');
    expect(exportFileName('nul', 'csv')).toBe('nul-house.csv');
    expect(exportFileName('COM1', 'glb')).toBe('com1-house.glb');
    expect(exportFileName('Con', 'csv', 'inventory')).toBe('con-inventory.csv');
  });

  it('falls back to "layout" and drops empty parts', () => {
    expect(exportFileName('', 'glb')).toBe('layout.glb');
    expect(exportFileName('***', 'png', '***')).toBe('layout.png');
    expect(exportFileName('Home', 'png', '')).toBe('home.png');
  });

  it('caps a very long name in bytes, never mid-character', () => {
    const latin = exportFileName('a very long house name '.repeat(20), 'json');
    expect(new TextEncoder().encode(latin).length).toBeLessThanOrEqual(105);
    expect(latin).not.toMatch(/-\.json$/);
    const cjk = slugify('東京の家'.repeat(40));
    expect(new TextEncoder().encode(cjk).length).toBeLessThanOrEqual(100);
    expect(cjk).toBe('東京の家'.repeat(40).slice(0, 33));
  });
});
