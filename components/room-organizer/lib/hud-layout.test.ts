import { describe, expect, it } from 'vitest';
import { catalogFitsItsTiles, catalogPageSize, COMPACT_DOCK_QUERY, scrollCue, welcomeTips } from './hud-layout';

describe('catalogFitsItsTiles', () => {
  it('drops the empty slots and the pager on touch when one page holds it all', () => {
    expect(catalogFitsItsTiles(1, true)).toBe(true);
  });
  it('keeps the pager when there is a second page', () => {
    expect(catalogFitsItsTiles(2, true)).toBe(false);
  });
  it('keeps the fixed grid for a mouse', () => {
    expect(catalogFitsItsTiles(1, false)).toBe(false);
  });
});

describe('catalogPageSize', () => {
  it('keeps the paged grid on desktop', () => {
    expect(catalogPageSize(23, false, 8)).toBe(8);
  });
  it('puts every item on one scrolling row when docked', () => {
    expect(catalogPageSize(23, true, 8)).toBe(23);
    expect(catalogPageSize(0, true, 8)).toBe(1);
  });
});

describe('scrollCue', () => {
  it('reports content hidden past either edge', () => {
    expect(scrollCue(0, 600, 800)).toEqual({ scrollable: true, before: false, after: true });
    expect(scrollCue(150, 600, 800)).toEqual({ scrollable: true, before: true, after: true });
    expect(scrollCue(200, 600, 800)).toEqual({ scrollable: true, before: true, after: false });
  });
  it('is quiet when everything fits, sub-pixel slack included', () => {
    expect(scrollCue(0, 600, 600)).toEqual({ scrollable: false, before: false, after: false });
    expect(scrollCue(0.5, 600, 600.5)).toEqual({ scrollable: false, before: false, after: false });
  });
});

describe('welcomeTips', () => {
  it('drops the keyboard and modifier tips on touch devices (#429)', () => {
    const touch = welcomeTips(true).map((tip) => `${tip.title} ${tip.body}`).join(' ');
    expect(touch).not.toMatch(/Ctrl|⌘|WASD|Press G|arrow keys|Click/);
    expect(touch).toMatch(/pinch/i);
    expect(welcomeTips(false).map((tip) => tip.title)).toContain('Multi-select');
  });
});

it('docks the HUD on portrait phones and on landscape phones', () => {
  expect(COMPACT_DOCK_QUERY).toBe('(max-width: 768px), (max-width: 1100px) and (max-height: 500px)');
});
