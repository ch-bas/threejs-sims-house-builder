import { CURRENCY_SYMBOL } from './constants';

/**
 * The one way the UI writes lengths and ages (#438): a space before the unit,
 * as in "2.00 m", and ages spelled so they can't be read as metres.
 *
 * Lengths (#725): geometry is always metres; only what is shown follows the
 * viewer's unit, `metric` or `imperial` (feet and inches, as in 8' 2").
 */

export type LengthUnit = 'metric' | 'imperial';

export const LENGTH_UNITS: readonly LengthUnit[] = ['metric', 'imperial'];

const METRES_PER_INCH = 0.0254;
const INCHES_PER_FOOT = 12;
const SQ_FEET_PER_SQ_METRE = 1 / (METRES_PER_INCH * INCHES_PER_FOOT) ** 2;

// The unit the editor shows, mirrored here by the view store (#725) so a
// string written far from React (a reducer refusal, the printed plan) follows
// it too. Per browser, never per house; an argument still wins.
let displayUnit: LengthUnit = 'metric';

export function setDisplayUnit(unit: LengthUnit): void {
  displayUnit = unit;
}

export function getDisplayUnit(): LengthUnit {
  return displayUnit;
}

/** A stored unit name, or null for anything else. */
export function asLengthUnit(value: unknown): LengthUnit | null {
  return LENGTH_UNITS.find((unit) => unit === value) ?? null;
}

/**
 * "8' 2"", to the inch; `6"` under a foot. `wholeFeet` rounds to the foot
 * ("27'"), for a rough distance.
 */
function formatFeetAndInches(metres: number, wholeFeet: boolean): string {
  const sign = metres < 0 ? '-' : '';
  const inches = Math.abs(metres) / METRES_PER_INCH;
  if (wholeFeet) {
    const feet = Math.round(inches / INCHES_PER_FOOT);
    return feet === 0 ? `0'` : `${sign}${feet}'`;
  }
  const total = Math.round(inches);
  if (total === 0) return '0"';
  const feet = Math.floor(total / INCHES_PER_FOOT);
  const rest = total - feet * INCHES_PER_FOOT;
  return feet === 0 ? `${sign}${rest}"` : `${sign}${feet}' ${rest}"`;
}

/**
 * "2.00 m". `decimals` omitted prints the number as it is ("8 m", "2.5 m").
 * In feet and inches it is "8' 2"" to the inch; `decimals` 0 rounds to the foot.
 */
export function formatMetres(value: number, decimals?: number, unit: LengthUnit = displayUnit): string {
  if (unit === 'imperial') return formatFeetAndInches(value, decimals === 0);
  const text = decimals === undefined ? String(Number(value.toFixed(2))) : value.toFixed(decimals);
  return `${text} m`;
}

/** "8 m × 6 m": a footprint or an item's plan size. */
export function formatSize(width: number, depth: number, decimals?: number, unit: LengthUnit = displayUnit): string {
  return `${formatMetres(width, decimals, unit)} × ${formatMetres(depth, decimals, unit)}`;
}

/** "12.5 m²", or "135 sq ft": an area given in square metres. */
export function formatArea(squareMetres: number, unit: LengthUnit = displayUnit): string {
  if (unit === 'imperial') return `${formatAmount(areaInUnit(squareMetres, unit))} sq ft`;
  return `${squareMetres.toFixed(1)} m²`;
}

/** An area given in square metres, as a number in the unit's area: m² or sq ft. */
export function areaInUnit(squareMetres: number, unit: LengthUnit = displayUnit): number {
  return unit === 'imperial' ? squareMetres * SQ_FEET_PER_SQ_METRE : squareMetres;
}

/** "m²" or "sq ft". */
export function areaUnitSymbol(unit: LengthUnit = displayUnit): string {
  return unit === 'imperial' ? 'sq ft' : 'm²';
}

/** The short name of the unit an input takes: "m" or "ft". */
export function lengthUnitSymbol(unit: LengthUnit = displayUnit): string {
  return unit === 'imperial' ? 'ft' : 'm';
}

/**
 * What a length input shows: "2.5" metres, or "8' 2"" in feet and inches,
 * which `parseLength` reads back. Compare the text before committing it: the
 * inch rounding must not move an untouched value.
 */
export function lengthInputValue(metres: number, unit: LengthUnit = displayUnit, decimals = 2): string {
  return unit === 'imperial' ? formatFeetAndInches(metres, false) : String(Number(metres.toFixed(decimals)));
}

const NUMBER = String.raw`(\d+(?:\.\d*)?|\.\d+)`;
const FEET_MARK = String.raw`(?:'|′|’|ft\.?|foot|feet)`;
const INCH_MARK = String.raw`(?:"|″|”|''|in\.?|inch|inches)`;
const METRIC = new RegExp(String.raw`^${NUMBER}\s*(m|metres?|meters?|cm|mm)$`);
const FEET_INCHES = new RegExp(String.raw`^${NUMBER}\s*${FEET_MARK}\s*(?:${NUMBER}\s*${INCH_MARK}?)?$`);
const INCHES = new RegExp(String.raw`^${NUMBER}\s*${INCH_MARK}$`);
const BARE = new RegExp(String.raw`^${NUMBER}$`);
const METRIC_SCALE: Record<string, number> = { cm: 0.01, mm: 0.001 };

/**
 * A typed length in metres (#725), or null when it isn't one: `12'6"`,
 * `12' 6"`, `12.5 ft`, `12 ft 6 in`, `150"`, `3.5 m`, `350 cm`. A bare number
 * is in the viewer's unit: metres, or feet. A leading minus is kept.
 */
export function parseLength(text: string, unit: LengthUnit = displayUnit): number | null {
  let source = text.trim().toLowerCase().replace(/,/g, '.');
  let sign = 1;
  if (source.startsWith('-') || source.startsWith('−')) {
    sign = -1;
    source = source.slice(1).trim();
  }
  const foot = METRES_PER_INCH * INCHES_PER_FOOT;
  let metres: number | null = null;
  let match: RegExpExecArray | null;
  if ((match = METRIC.exec(source))) {
    const [, value = '', name = ''] = match;
    metres = Number(value) * (METRIC_SCALE[name] ?? 1);
  } else if ((match = FEET_INCHES.exec(source))) {
    const [, feet = '', inches] = match;
    metres = Number(feet) * foot + (inches === undefined ? 0 : Number(inches) * METRES_PER_INCH);
  } else if ((match = INCHES.exec(source))) {
    metres = Number(match[1]) * METRES_PER_INCH;
  } else if ((match = BARE.exec(source))) {
    metres = Number(match[1]) * (unit === 'imperial' ? foot : 1);
  }
  return metres !== null && Number.isFinite(metres) ? sign * metres : null;
}

/** "14:05" today, "28 Oct, 14:05" on another day, in the viewer's locale and time zone. */
export function formatClock(at: number, now: number = Date.now()): string {
  const date = new Date(at);
  const time = { hour: '2-digit', minute: '2-digit' } as const;
  return date.toDateString() === new Date(now).toDateString()
    ? date.toLocaleTimeString([], time)
    : date.toLocaleString([], { day: 'numeric', month: 'short', ...time });
}

/** "just now", "40 s ago", "3 min ago", "2 h ago", "4 days ago". */
export function formatAge(ms: number, options: { seconds?: boolean } = {}): string {
  const threshold = options.seconds ? 5_000 : 60_000;
  if (ms < threshold) return 'just now';
  if (ms < 60_000) return `${Math.floor(ms / 1000)} s ago`;
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)} min ago`;
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)} h ago`;
  const days = Math.floor(ms / 86_400_000);
  return `${days} ${days === 1 ? 'day' : 'days'} ago`;
}

/** "25,000": a whole amount, grouped the same way whatever the browser's locale (#609). */
export function formatAmount(value: number): string {
  return Math.round(value).toLocaleString('en-GB');
}

/**
 * "$1,200", "−$1,200", or with `signed` "+$960". With `compact`, a million
 * and up shortens to "$1.25M", so a big amount fits a narrow readout.
 */
export function formatMoney(amount: number, options: { signed?: boolean; compact?: boolean } = {}): string {
  const sign = amount < 0 ? '−' : options.signed ? '+' : '';
  const size = Math.abs(amount);
  const text = options.compact && size >= 1_000_000 ? `${Number((size / 1_000_000).toFixed(2))}M` : formatAmount(size);
  return `${sign}${CURRENCY_SYMBOL}${text}`;
}
