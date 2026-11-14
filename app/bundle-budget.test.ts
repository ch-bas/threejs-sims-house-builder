import { describe, expect, it } from 'vitest';
import budgetFile from '../scripts/bundle-budget.json';
import { budgetFor, measure, overBudget, pageScripts, report, verdict } from '../scripts/check-bundle.mjs';

// The post-build size check (#732).

const sizes = {
  'static/chunks/webpack-1.js': 2_000,
  'static/chunks/main-app-2.js': 500,
  'static/chunks/polyfills-3.js': 40_000,
  'static/chunks/766.a.js': 230_000,
  'static/chunks/121.b.js': 9_000,
  'static/chunks/app/page-4.js': 3_000,
  'static/css/x.css': 10_000,
  'static/css/y.css': 3_000,
};

describe('pageScripts', () => {
  it('reads chunk scripts under any prefix and skips the nomodule polyfills', () => {
    const html =
      `<script src="/base/_next/static/chunks/webpack-1.js" async=""></script>` +
      `<script src="/base/_next/static/chunks/polyfills-3.js" noModule=""></script>` +
      `<script src="/_next/static/chunks/main-app-2.js" async=""></script>` +
      `<script src="/base/_next/static/chunks/webpack-1.js"></script>` +
      `<script>self.__next_f.push([1])</script>`;
    expect(pageScripts(html)).toEqual(['static/chunks/webpack-1.js', 'static/chunks/main-app-2.js']);
  });
});

describe('measure', () => {
  const firstLoad = ['static/chunks/webpack-1.js', 'static/chunks/main-app-2.js', 'static/chunks/766.a.js'];

  it('sums the first load, finds the largest chunk and sums the CSS', () => {
    const measured = measure(sizes, firstLoad);
    expect(measured.firstLoadJs.bytes).toBe(232_500);
    expect(measured.firstLoadJs.files[0]).toBe('static/chunks/766.a.js');
    expect(measured.largestChunk).toEqual({ bytes: 230_000, files: ['static/chunks/766.a.js'] });
    expect(measured.css.bytes).toBe(13_000);
  });

  it('refuses a first-load file the export lacks', () => {
    expect(() => measure(sizes, ['static/chunks/gone.js'])).toThrow(/gone\.js/);
  });

  it('flags only the metrics over budget and names their largest files', () => {
    const measured = measure(sizes, firstLoad);
    const budget = { firstLoadJs: 240_000, largestChunk: 200_000, css: 13_000 };
    expect(overBudget(measured, budget)).toEqual(['largestChunk']);
    const table = report(measured, budget, sizes);
    expect(table).toContain('**over**');
    expect(table).toContain('`chunks/766.a.js` 224.6 KB');
  });

  it('sets budgets above today with the headroom, rounded up to a kilobyte', () => {
    const budget = budgetFor(measure(sizes, firstLoad), 0.03);
    expect(budget.css).toBe(14 * 1024);
    expect(overBudget(measure(sizes, firstLoad), budget)).toEqual([]);
  });
});

describe('verdict', () => {
  it('fails over budget when enforcing', () => {
    expect(verdict(['css'], false)).toEqual({ annotation: expect.stringMatching(/^::error title=Bundle budget::CSS over budget/), exitCode: 1 });
  });

  it('only warns over budget when report-only', () => {
    expect(verdict(['firstLoadJs', 'css'], true)).toEqual({
      annotation: expect.stringMatching(/^::warning title=Bundle budget::First-load JS, CSS over budget/),
      exitCode: 0,
    });
  });

  it('says nothing within budget', () => {
    expect(verdict([], false)).toBeNull();
  });
});

describe('bundle-budget.json', () => {
  it('has a positive budget for every metric', () => {
    for (const value of Object.values(budgetFile.budget)) expect(value).toBeGreaterThan(0);
    expect(Object.keys(budgetFile.budget).sort()).toEqual(['css', 'firstLoadJs', 'largestChunk']);
  });
});
