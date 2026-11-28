import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { MAX_ITEMS, MAX_LINE, pickBullets, shortLine, whatsNewFor, whatsNewFromFile } from '../scripts/whats-new.mjs';

// The build-time lines of the "What's new" card (#931).

const CHANGELOG = `# Changelog

## [Unreleased]

### Added
- Something not released yet

## [1.3.1] - 2026-01-03

### Fixed
- A fix only

## [1.3.0] - 2026-01-02

Intro paragraph.

### Added
- Measure on the plan: points snap to corners ([#921](https://example.org/921))
- In EXPLORE, \`E\` switches a TV on

### Changed
- A change, not an addition

## [1.2.0] - 2026-01-01

### Added — Living house
- Older
`;

describe('whatsNewFor', () => {
  it('takes the Added lines of the section for the version', () => {
    expect(whatsNewFor(CHANGELOG, '1.3.0')).toEqual({
      version: '1.3.0',
      items: ['Measure on the plan: points snap to corners', 'In EXPLORE, E switches a TV on'],
    });
  });

  it('skips Unreleased and a release without Added lines, reads a heading with a suffix, never looks ahead', () => {
    expect(whatsNewFor(CHANGELOG, '1.3.1')?.version).toBe('1.3.0');
    expect(whatsNewFor(CHANGELOG, '1.2.5')).toEqual({ version: '1.2.0', items: ['Older'] });
    expect(whatsNewFor(CHANGELOG, '1.1.0')).toBeNull();
    expect(whatsNewFor(CHANGELOG, 'soon')).toBeNull();
    expect(whatsNewFor('', '1.0.0')).toBeNull();
  });

  it('a missing changelog means no card, not a failed build', () => {
    const missing = () => {
      throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    };
    expect(whatsNewFromFile(missing, '1.3.0')).toBeNull();
    expect(whatsNewFromFile(() => CHANGELOG, '1.3.0')?.version).toBe('1.3.0');
  });

  it('reads the real changelog: lines from both halves of a two-milestone release, short, plain text', () => {
    const changelog = readFileSync(new URL('../CHANGELOG.md', import.meta.url), 'utf8');
    const found = whatsNewFor(changelog, '1.38.0');
    expect(found?.items).toHaveLength(MAX_ITEMS);
    expect(found?.items.some((item) => item.startsWith('Measure on the 2D plan'))).toBe(true);
    expect(found?.items.some((item) => /walker|EXPLORE/i.test(item))).toBe(true);
    for (const item of found?.items ?? []) {
      expect(item.length).toBeLessThanOrEqual(MAX_LINE);
      expect(item).not.toMatch(/[[\]()`#*]/);
    }
  });
});

describe('pickBullets', () => {
  it('spreads five picks across a long section, in order', () => {
    const bullets = Array.from({ length: 10 }, (_, i) => `b${i}`);
    expect(pickBullets(bullets)).toEqual(['b0', 'b2', 'b4', 'b6', 'b8']);
    expect(pickBullets(['a', 'b'])).toEqual(['a', 'b']);
  });

  it('counts bullets under one bold lead as one area', () => {
    const bullets = ['**Walkers:** sit', '**Walkers:** dance', '**Photo mode:** presets', 'Plain one'];
    expect(pickBullets(bullets)).toEqual(['**Walkers:** sit', '**Photo mode:** presets', 'Plain one']);
  });
});

describe('shortLine', () => {
  it('drops links, asides, code and bold marks; keeps a short line whole', () => {
    expect(shortLine('**Photo mode** (View options): save a PNG; and more ([#626](u))')).toBe('Photo mode: save a PNG; and more');
  });

  it('cuts a long line at a word with an ellipsis, never at a clause', () => {
    const clauses = `${'a'.repeat(60)}, ${'b'.repeat(20)}, ${'c'.repeat(40)}`;
    expect(shortLine(clauses).endsWith('…')).toBe(true);
    const words = Array.from({ length: 30 }, () => 'word').join(' ');
    const cut = shortLine(words);
    expect(cut.endsWith('…')).toBe(true);
    expect(cut.length).toBeLessThanOrEqual(MAX_LINE);
  });
});
