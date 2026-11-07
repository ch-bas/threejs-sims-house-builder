import { describe, expect, it, vi } from 'vitest';
import { DECORATIVE_FPS, createFrameBudget } from './frame-budget';

/** Tick `seconds` of animation frames at `hz`, `busy` or not; how many ticks ran the steps. */
function run(budget: ReturnType<typeof createFrameBudget>, clock: { now: number }, seconds: number, hz: number, busy = false): number {
  let repaints = 0;
  for (let i = 0; i < seconds * hz; i++) {
    clock.now += 1000 / hz;
    if (budget.tick(clock.now, busy)) repaints += 1;
  }
  return repaints;
}

describe('the decorative frame budget (#671)', () => {
  it('runs the steps at 30 a second on a 60 Hz or 120 Hz display, and asks for one repaint per run', () => {
    for (const hz of [60, 120]) {
      const budget = createFrameBudget();
      const clock = { now: 0 };
      const rain = vi.fn((_delta: number) => true);
      const walkers = vi.fn(() => true);
      budget.add(rain);
      budget.add(walkers);
      const repaints = run(budget, clock, 2, hz);
      expect(DECORATIVE_FPS).toBe(30);
      expect(repaints).toBeGreaterThanOrEqual(58);
      expect(repaints).toBeLessThanOrEqual(60);
      // Both steps share each run: their costs no longer stack.
      expect(rain).toHaveBeenCalledTimes(repaints);
      expect(walkers).toHaveBeenCalledTimes(repaints);
      // Each step gets the time since the last run.
      expect(rain.mock.calls.at(-1)?.[0]).toBeCloseTo(1 / 30, 3);
    }
  });

  it('runs every frame while the frame draws anyway (an orbit, a drag)', () => {
    const budget = createFrameBudget();
    const clock = { now: 0 };
    const step = vi.fn(() => true);
    budget.add(step);
    run(budget, clock, 1, 60, true);
    expect(step.mock.calls.length).toBeGreaterThanOrEqual(59);
  });

  it('asks for no repaint when no step changed anything, and costs nothing with no steps', () => {
    const budget = createFrameBudget();
    const clock = { now: 0 };
    expect(run(budget, clock, 1, 60)).toBe(0);
    const still = vi.fn(() => false);
    budget.add(still);
    expect(run(budget, clock, 1, 60)).toBe(0);
    expect(still).toHaveBeenCalled();
  });

  it('pauses while the page is hidden, and resumes without a jump', () => {
    // Focus doesn't matter: an unfocused window on a second monitor still animates.
    const doc = { hidden: false };
    const budget = createFrameBudget({ document: doc });
    const clock = { now: 0 };
    const step = vi.fn((_delta: number) => true);
    budget.add(step);
    run(budget, clock, 1, 60);
    const before = step.mock.calls.length;
    expect(before).toBeGreaterThan(25);
    doc.hidden = true;
    expect(run(budget, clock, 5, 60)).toBe(0);
    expect(step.mock.calls.length).toBe(before);
    doc.hidden = false;
    run(budget, clock, 1, 60);
    // The first run back steps one interval, not the five seconds away.
    expect(step.mock.calls[before]?.[0]).toBeLessThan(0.05);
  });

  it('caps a long gap at a tenth of a second and lets a step remove itself', () => {
    const budget = createFrameBudget();
    const deltas: number[] = [];
    const remove = budget.add((delta) => {
      deltas.push(delta);
      if (deltas.length === 2) remove();
      return true;
    });
    budget.tick(0, false);
    budget.tick(5000, false);
    budget.tick(5040, false);
    budget.tick(5080, false);
    expect(deltas).toEqual([0.1, 0.04]);
  });

  it('drops every step when disposed', () => {
    const budget = createFrameBudget();
    const step = vi.fn(() => true);
    budget.add(step);
    budget.dispose();
    budget.tick(0, true);
    budget.tick(100, true);
    expect(step).not.toHaveBeenCalled();
  });
});
