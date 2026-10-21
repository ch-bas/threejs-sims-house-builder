import { describe, expect, it } from 'vitest';
import { topBarSlot, type SlotRect } from './top-bar-slot';

const rect = (left: number, top: number, right: number, bottom: number): SlotRect => ({ left, top, right, bottom });
/** Five 44px touch buttons, 4px apart. */
const ROW = 5 * 44 + 4 * 4;

describe('topBarSlot', () => {
  it('spans from after the badge to before the pills', () => {
    // iPhone SE landscape: sidebar toggle, then the floor and wall pills.
    expect(topBarSlot([rect(8, 8, 52, 52)], [rect(304, 8, 402, 62), rect(408, 8, 560, 62)], ROW, 568, 8)).toEqual({ start: 60, end: 296, top: null });
  });

  it('follows the badge when it shows the house name', () => {
    expect(topBarSlot([rect(16, 16, 222, 70), rect(230, 24, 272, 62)], [rect(649, 16, 802, 70)], ROW, 1101, 8)).toEqual({ start: 280, end: 641, top: null });
  });

  it('ignores boxes a breakpoint hides', () => {
    expect(topBarSlot([rect(0, 0, 0, 0), rect(8, 8, 52, 52)], [rect(0, 0, 0, 0), rect(400, 8, 560, 62)], ROW, 568, 8)).toEqual({ start: 60, end: 392, top: null });
  });

  it('is bounded by the first row of pills only', () => {
    // The wall pill wrapped under a wide floor pill.
    const pills = [rect(300, 8, 560, 62), rect(100, 68, 560, 122)];
    expect(topBarSlot([rect(8, 8, 52, 52)], pills, 200, 568, 8)).toEqual({ start: 60, end: 292, top: null });
  });

  it('drops below the pills when the strip is too narrow for the row', () => {
    // A four-floor building on iPhone SE landscape.
    const pills = [rect(126, 8, 402, 62), rect(408, 8, 560, 62)];
    expect(topBarSlot([rect(8, 8, 52, 52)], pills, ROW, 568, 8)).toEqual({ start: 60, end: 560, top: 70 });
    // Below every row of pills, when they wrap.
    expect(topBarSlot([rect(8, 8, 52, 52)], [rect(126, 8, 560, 62), rect(300, 68, 560, 122)], ROW, 568, 8).top).toBe(130);
  });

  it('runs to the edge without pills', () => {
    expect(topBarSlot([rect(8, 8, 52, 52)], [], ROW, 568, 8)).toEqual({ start: 60, end: 560, top: null });
  });
});
