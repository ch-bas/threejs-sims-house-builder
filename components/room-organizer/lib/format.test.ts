import { describe, expect, it } from 'vitest';
import { asLengthUnit, formatAge, formatAmount, formatArea, formatMetres, formatMoney, formatSize, formatSizeCompact, getDisplayUnit, imperialStep, lengthInputValue, lengthSliderStep, lengthUnitName, lengthUnitSymbol, lengthRefusal, parseLength, setDisplayUnit } from './format';

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

  it('writes a compact size for the header without inner spaces in feet, as formatSize in metres (#939)', () => {
    expect(formatSizeCompact(6, 5, 'imperial')).toBe(`19'8" × 16'5"`);
    expect(formatSizeCompact(30, 30, 'imperial')).toBe(`98'5" × 98'5"`);
    expect(formatSizeCompact(0.15, 3.048, 'imperial')).toBe(`6" × 10'0"`);
    for (const [w, d] of [[6, 5], [30, 30], [29.97, 12.5]] as const) {
      expect(formatSizeCompact(w, d, 'metric')).toBe(formatSize(w, d, undefined, 'metric'));
    }
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
    [`12’ 6”`, 12 * foot + 6 * inch],
    [`12‘ 6“`, 12 * foot + 6 * inch],
    [`12’6’’`, 12 * foot + 6 * inch],
    [`12'-6"`, 12 * foot + 6 * inch],
    [`12' - 6"`, 12 * foot + 6 * inch],
    [`12' 6 1/2"`, 12 * foot + 6.5 * inch],
    [`6 1/2"`, 6.5 * inch],
    [`1/2"`, 0.5 * inch],
    [`12' 11"`, 12 * foot + 11 * inch],
    ['1,000 ft', 1000 * foot],
    ['12,500 cm', 125],
    ['1,000,000 mm', 1000],
    [`12'`, 12 * foot],
    ['12.5 ft', 12.5 * foot],
    ['12.5ft', 12.5 * foot],
    ['12 ft 6 in', 12 * foot + 6 * inch],
    ['12 feet 6 inches', 12 * foot + 6 * inch],
    ['150"', 150 * inch],
    ['150 in', 150 * inch],
    [`6''`, 6 * inch],
    ['3.5 m', 3.5],
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

  it('reads a lone decimal comma in metres only, and never guesses in feet', () => {
    expect(parseLength('3,5 m', 'metric')).toBe(3.5);
    expect(parseLength('3,5', 'metric')).toBe(3.5);
    expect(parseLength('3,5 m', 'imperial')).toBeNull();
    expect(parseLength('12,5 ft', 'imperial')).toBeNull();
    expect(parseLength('1,000.5 ft', 'imperial')).toBeNull();
    expect(parseLength('1,2,3', 'metric')).toBeNull();
    // Three digits after a comma group thousands, in either unit.
    expect(parseLength('3,500', 'metric')).toBe(3500);
  });

  it.each(['', 'abc', '12 yards', `12'6"7`, '1.2.3', 'm', `'6"`, '--2', `12'13"`, `12' 12"`, '1/0"', `12'--6"`])('refuses %j', (text) => {
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

describe('length field helpers (#725)', () => {
  it('names the unit and steps six inches or one', () => {
    expect(lengthUnitName('metric')).toBe('metres');
    expect(lengthUnitName('imperial')).toBe('feet');
    expect(imperialStep(0.5)).toBeCloseTo(0.1524, 9);
    expect(imperialStep(0.1)).toBeCloseTo(0.0254, 9);
  });

  it('steps a length slider in whole inches in feet and inches', () => {
    expect(lengthSliderStep(0.5, 'metric')).toBe(0.5);
    expect(lengthSliderStep(0.1, 'imperial')).toBeCloseTo(3 * 0.0254, 9);
    expect(lengthSliderStep(0.05, 'imperial')).toBeCloseTo(0.0254, 9);
  });
});

describe('lengthRefusal (#725)', () => {
  it('quotes what was typed and offers forms in the unit', () => {
    expect(lengthRefusal(`12'13"`, 'imperial')).toBe(`"12'13"" isn't a length this field can read: try 12' 6", 12.5 ft or 3.8 m.`);
    expect(lengthRefusal('abc', 'metric')).toContain('3.8 m');
  });
});
