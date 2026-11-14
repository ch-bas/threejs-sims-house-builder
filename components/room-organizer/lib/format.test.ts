import { describe, expect, it } from 'vitest';
import { asLengthUnit, formatAge, formatAmount, formatArea, formatMetres, formatMoney, formatSize, getDisplayUnit, lengthInputValue, lengthUnitSymbol, parseLength, setDisplayUnit } from './format';

describe('formatMetres', () => {
  it('puts a space before the unit', () => {
    expect(formatMetres(2, 2)).toBe('2.00 m');
    expect(formatMetres(4, 1)).toBe('4.0 m');
  });

  it('prints the number as it is without a precision, to the centimetre', () => {
    expect(formatMetres(8)).toBe('8 m');
    expect(formatMetres(2.5)).toBe('2.5 m');
    expect(formatMetres(0.1 + 0.2)).toBe('0.3 m');
  });
});

describe('formatSize', () => {
  it('writes both sides with their unit', () => {
    expect(formatSize(8, 6)).toBe('8 m × 6 m');
    expect(formatSize(1.2, 0.6, 2)).toBe('1.20 m × 0.60 m');
  });
});

describe('formatAge', () => {
  it('never reads like metres', () => {
    expect(formatAge(3 * 60_000)).toBe('3 min ago');
    expect(formatAge(2 * 3_600_000)).toBe('2 h ago');
    expect(formatAge(86_400_000)).toBe('1 day ago');
    expect(formatAge(4 * 86_400_000)).toBe('4 days ago');
  });

  it('says "just now" under a minute, or under five seconds when seconds count', () => {
    expect(formatAge(30_000)).toBe('just now');
    expect(formatAge(3_000, { seconds: true })).toBe('just now');
    expect(formatAge(30_000, { seconds: true })).toBe('30 s ago');
  });
});

describe('money (#609)', () => {
  it('groups amounts one fixed way, whatever the locale', () => {
    expect(formatAmount(25_000)).toBe('25,000');
    expect(formatAmount(1234.6)).toBe('1,235');
    expect(formatMoney(1200)).toBe('$1,200');
    expect(formatMoney(-1200)).toBe('−$1,200');
    expect(formatMoney(960, { signed: true })).toBe('+$960');
  });

  it('shortens a million and up when compact', () => {
    expect(formatMoney(999_999, { compact: true })).toBe('$999,999');
    expect(formatMoney(100_000_000, { compact: true })).toBe('$100M');
    expect(formatMoney(1_250_000, { compact: true })).toBe('$1.25M');
    expect(formatMoney(-2_000_000, { compact: true })).toBe('−$2M');
  });
});

describe('feet and inches (#725)', () => {
  it('writes lengths to the inch, carrying twelve inches to a foot', () => {
    expect(formatMetres(2.5, undefined, 'imperial')).toBe(`8' 2"`);
    expect(formatMetres(8, 2, 'imperial')).toBe(`26' 3"`);
    expect(formatMetres(0.3048 * 3 - 0.001, 1, 'imperial')).toBe(`3' 0"`);
    expect(formatMetres(0.15, 2, 'imperial')).toBe('6"');
    expect(formatMetres(0, 2, 'imperial')).toBe('0"');
    expect(formatMetres(-1, 2, 'imperial')).toBe(`-3' 3"`);
  });

  it('rounds to the foot with no decimals', () => {
    expect(formatMetres(8.3, 0, 'imperial')).toBe(`27'`);
    expect(formatMetres(0.1, 0, 'imperial')).toBe(`0'`);
  });

  it('writes sizes and areas in the unit', () => {
    expect(formatSize(8, 6, undefined, 'imperial')).toBe(`26' 3" × 19' 8"`);
    expect(formatArea(12.5, 'metric')).toBe('12.5 m²');
    expect(formatArea(12.5, 'imperial')).toBe('135 sq ft');
    expect(formatArea(200, 'imperial')).toBe('2,153 sq ft');
  });

  it('follows the display unit when none is passed, metres by default', () => {
    expect(getDisplayUnit()).toBe('metric');
    setDisplayUnit('imperial');
    try {
      expect(formatMetres(2.5)).toBe(`8' 2"`);
      expect(formatArea(1)).toBe('11 sq ft');
      expect(lengthUnitSymbol()).toBe('ft');
      expect(formatMetres(2.5, undefined, 'metric')).toBe('2.5 m');
    } finally {
      setDisplayUnit('metric');
    }
    expect(formatMetres(2.5)).toBe('2.5 m');
  });

  it('reads only the two unit names', () => {
    expect(asLengthUnit('imperial')).toBe('imperial');
    expect(asLengthUnit('feet')).toBeNull();
    expect(asLengthUnit(null)).toBeNull();
  });
});

describe('parseLength (#725)', () => {
  const foot = 0.3048;
  const inch = 0.0254;

  it.each([
    [`12'6"`, 12 * foot + 6 * inch],
    [`12' 6"`, 12 * foot + 6 * inch],
    [`12'6`, 12 * foot + 6 * inch],
    [`12'6''`, 12 * foot + 6 * inch],
    [`12′ 6″`, 12 * foot + 6 * inch],
    [`12'`, 12 * foot],
    ['12.5 ft', 12.5 * foot],
    ['12.5ft', 12.5 * foot],
    ['12 ft 6 in', 12 * foot + 6 * inch],
    ['12 feet 6 inches', 12 * foot + 6 * inch],
    ['150"', 150 * inch],
    ['150 in', 150 * inch],
    [`6''`, 6 * inch],
    ['3.5 m', 3.5],
    ['3,5 m', 3.5],
    ['350 cm', 3.5],
    ['3500 mm', 3.5],
    ['.5 m', 0.5],
    ['  4 M ', 4],
    ['-1.5 m', -1.5],
  ])('reads %s', (text, metres) => {
    expect(parseLength(text, 'metric')).toBeCloseTo(metres, 9);
    expect(parseLength(text, 'imperial')).toBeCloseTo(metres, 9);
  });

  it('reads a bare number in the unit shown', () => {
    expect(parseLength('2.5', 'metric')).toBe(2.5);
    expect(parseLength('10', 'imperial')).toBeCloseTo(10 * foot, 9);
  });

  it.each(['', 'abc', '12 yards', `12'6"7`, '1.2.3', 'm', `'6"`, '--2'])('refuses %j', (text) => {
    expect(parseLength(text, 'metric')).toBeNull();
    expect(parseLength(text, 'imperial')).toBeNull();
  });

  it('reads back what an input shows', () => {
    for (const metres of [0.15, 2.5, 8, 12.34]) {
      expect(parseLength(lengthInputValue(metres, 'metric'), 'metric')).toBeCloseTo(metres, 2);
      expect(Math.abs((parseLength(lengthInputValue(metres, 'imperial'), 'imperial') ?? NaN) - metres)).toBeLessThanOrEqual(inch / 2);
    }
  });
});
