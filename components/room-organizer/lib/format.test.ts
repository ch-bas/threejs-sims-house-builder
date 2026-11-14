import { describe, expect, it } from 'vitest';
import { formatAge, formatAmount, formatMetres, formatMoney, formatSize } from './format';

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
