// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { HeaderStats, headerFitDrops, headerFitSteps, nextHeaderFit } from './header-stats';

describe('header stats fit (#939)', () => {
  afterEach(cleanup);

  it('gives way with the save status words first, then the chip captions', () => {
    expect(headerFitSteps(false)).toEqual(['saveLabel', 'chipLabels']);
    expect([...headerFitDrops(0, false)]).toEqual([]);
    expect([...headerFitDrops(1, false)]).toEqual(['saveLabel']);
    expect([...headerFitDrops(2, false)]).toEqual(['saveLabel', 'chipLabels']);
    expect([...headerFitDrops(9, false)]).toEqual(['saveLabel', 'chipLabels']);
  });

  it('never hides the words of a failed save', () => {
    expect(headerFitSteps(true)).toEqual(['chipLabels']);
    expect(headerFitDrops(1, true).has('saveLabel')).toBe(false);
    expect(headerFitDrops(2, true).has('saveLabel')).toBe(false);
  });

  it('steps on only while the row wraps and a step is left', () => {
    expect(nextHeaderFit(0, false, false)).toBe(0);
    expect(nextHeaderFit(0, true, false)).toBe(1);
    expect(nextHeaderFit(1, true, false)).toBe(2);
    expect(nextHeaderFit(2, true, false)).toBe(2);
    expect(nextHeaderFit(1, true, true)).toBe(1);
  });

  it('shows every caption and the save words when the row fits', () => {
    render(<HeaderStats />);
    expect(screen.getByText('Items:').className).not.toContain('sr-only');
    expect(screen.getByText('Auto-save on').className).not.toContain('sr-only');
  });
});
