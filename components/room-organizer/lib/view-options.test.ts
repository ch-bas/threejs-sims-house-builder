import { describe, expect, it } from 'vitest';
import { makeViewSettings as makeView } from './__testfixtures__/fixtures';
import { toggleViewOption, VIEW_OPTION_KEYS } from './view-options';

describe('toggleViewOption (#341)', () => {
  it('flips each key both ways', () => {
    for (const key of VIEW_OPTION_KEYS) {
      const before = makeView();
      const on = toggleViewOption(before, key);
      expect(on[key]).toBe(!before[key]);
      expect(toggleViewOption(on, key)[key]).toBe(before[key]);
    }
  });

  it('switching the distance tool on leaves 2D and parks the other floor-click modes', () => {
    const next = toggleViewOption(makeView({ view2D: true, drawWallMode: true, drawZoneMode: true }), 'measurementMode');
    expect(next).toMatchObject({ measurementMode: true, view2D: false, drawWallMode: false, drawZoneMode: false });
  });

  it('switching the distance tool off changes nothing else', () => {
    const before = makeView({ measurementMode: true, view2D: false });
    expect(toggleViewOption(before, 'measurementMode')).toEqual({ ...before, measurementMode: false });
  });

  it('switching the heatmap on shows the 2D plan; off keeps the current view', () => {
    expect(toggleViewOption(makeView(), 'showHeatmap')).toMatchObject({ showHeatmap: true, view2D: true });
    const off = toggleViewOption(makeView({ showHeatmap: true, view2D: true }), 'showHeatmap');
    expect(off).toMatchObject({ showHeatmap: false, view2D: true });
  });

  it('leaves the view alone for the plain display and snapping switches', () => {
    for (const key of ['showItemLabels', 'showOutdoor', 'snapToWall', 'snapToItems'] as const) {
      const before = makeView({ view2D: true, drawWallMode: true });
      expect(toggleViewOption(before, key)).toEqual({ ...before, [key]: !before[key] });
    }
  });
});
