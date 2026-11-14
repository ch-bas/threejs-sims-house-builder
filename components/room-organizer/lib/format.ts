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
 * In feet and inches it is "8' 2"" to the inch whatever `decimals` asks for,
 * which is a metric precision; only `decimals` 0 (a rough distance, like an
 * off-plan marker's) rounds to the foot.
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

/**
 * A footprint in a narrow readout, the header's Room chip (#939): as
 * `formatSize` in metres, and without the inner spaces in feet and inches
 * (19'8" × 16'5"), so the header stays one row at 1440 px.
 */
export function formatSizeCompact(width: number, depth: number, unit: LengthUnit = displayUnit): string {
  if (unit === 'metric') return formatSize(width, depth, undefined, unit);
  const tight = (metres: number) => formatFeetAndInches(metres, false).replace("' ", "'");
  return `${tight(width)} × ${tight(depth)}`;
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

/** The unit's name in an input's label: "metres" or "feet". */
export function lengthUnitName(unit: LengthUnit = displayUnit): string {
  return unit === 'imperial' ? 'feet' : 'metres';
}

/**
 * What one arrow-key press moves a feet-and-inches field by, in metres: six
 * inches where the metric field steps half a metre, else an inch.
 */
export function imperialStep(metricStep: number): number {
  return (metricStep >= 0.25 ? 6 : 1) * METRES_PER_INCH;
}

/**
 * A length slider's step (#725): the metric step as it is, or whole inches in
 * feet and inches (3" for a step of 10 cm or more, else 1"), so the readout,
 * written to the inch, moves evenly.
 */
export function lengthSliderStep(metricStep: number, unit: LengthUnit = displayUnit): number {
  if (unit === 'metric') return metricStep;
  return (metricStep >= 0.1 ? 3 : 1) * METRES_PER_INCH;
}

/**
 * What a length input shows: "2.5" metres, or "8' 2"" in feet and inches,
 * which `parseLength` reads back. Compare the text before committing it: the
 * inch rounding must not move an untouched value.
 */
export function lengthInputValue(metres: number, unit: LengthUnit = displayUnit, decimals = 2): string {
  return unit === 'imperial' ? formatFeetAndInches(metres, false) : String(Number(metres.toFixed(decimals)));
}

// A number as typed: "3.5", ".5", "6 1/2", "1/2".
const AMOUNT = String.raw`(\d+\s+\d+\/\d+|\d+\/\d+|\d+(?:\.\d*)?|\.\d+)`;
const FEET_MARK = String.raw`(?:'|ft\.?|foot|feet)`;
const INCH_MARK = String.raw`(?:"|in\.?|inch|inches)`;
const METRIC = new RegExp(String.raw`^${AMOUNT}\s*(m|metres?|meters?|cm|mm)$`);
// 12'6", 12' 6 1/2", 12'-6", 12 ft 6 in; the inch mark after the inches is optional.
const FEET_INCHES = new RegExp(String.raw`^${AMOUNT}\s*${FEET_MARK}\s*(?:-\s*)?(?:${AMOUNT}\s*${INCH_MARK}?)?$`);
const INCHES = new RegExp(String.raw`^${AMOUNT}\s*${INCH_MARK}$`);
const BARE = new RegExp(String.raw`^${AMOUNT}$`);
const METRIC_SCALE: Record<string, number> = { cm: 0.01, mm: 0.001 };
// A comma that groups thousands: a digit before it, exactly three after.
const THOUSANDS_COMMA = /(?<=\d),(?=\d{3}(?!\d))/g;

/** "6 1/2" → 6.5, "1/2" → 0.5, "3.5" → 3.5; NaN for a zero denominator. */
function amount(text: string): number {
  const [whole, fraction] = text.includes('/') ? (text.includes(' ') ? text.split(/\s+/) : ['0', text]) : [text, undefined];
  if (fraction === undefined) return Number(whole);
  const [top = '', bottom = ''] = fraction.split('/');
  return Number(whole) + (Number(bottom) === 0 ? Number.NaN : Number(top) / Number(bottom));
}

/**
 * Curly and prime quotes as the two marks: ‘ ’ ′ are feet, “ ” ″ and two
 * single quotes (’’, '') are inches.
 */
function normaliseMarks(text: string): string {
  return text.replace(/[‘’′']{2}/g, '"').replace(/[‘’′]/g, "'").replace(/[“”″]/g, '"');
}

/**
 * Commas, or null when one can't be read safely (#725). A comma before
 * exactly three digits groups thousands when there is no decimal point
 * ("1,000 ft", "12,500 cm"); any other single comma is a decimal comma in
 * metres ("3,5 m") and refused in feet, where it would be a guess.
 */
function normaliseCommas(text: string, unit: LengthUnit): string | null {
  if (!text.includes(',')) return text;
  const commas = text.split(',').length - 1;
  if (!text.includes('.') && (text.match(THOUSANDS_COMMA)?.length ?? 0) === commas) return text.replace(THOUSANDS_COMMA, '');
  return unit === 'metric' && commas === 1 ? text.replace(',', '.') : null;
}

/**
 * A typed length in metres (#725), or null when it isn't one: `12'6"`,
 * `12' 6"`, `12'-6"`, `12' 6 1/2"`, `6 1/2"`, `12.5 ft`, `12 ft 6 in`,
 * `150"`, `3.5 m`, `350 cm`. A bare number is in the viewer's unit: metres,
 * or feet. A leading minus is kept. Twelve inches or more after feet
 * (`12'13"`) is refused, not carried.
 */
export function parseLength(text: string, unit: LengthUnit = displayUnit): number | null {
  let source = normaliseCommas(normaliseMarks(text.trim().toLowerCase()), unit);
  if (source === null) return null;
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
    metres = amount(value) * (METRIC_SCALE[name] ?? 1);
  } else if ((match = FEET_INCHES.exec(source))) {
    const [, feet = '', inches] = match;
    const inchCount = inches === undefined ? 0 : amount(inches);
    if (inchCount >= INCHES_PER_FOOT) return null;
    metres = amount(feet) * foot + inchCount * METRES_PER_INCH;
  } else if ((match = INCHES.exec(source))) {
    metres = amount(match[1] ?? '') * METRES_PER_INCH;
  } else if ((match = BARE.exec(source))) {
    metres = amount(match[1] ?? '') * (unit === 'imperial' ? foot : 1);
  }
  return metres !== null && Number.isFinite(metres) ? sign * metres : null;
}

/** Why a typed length was refused, with forms that work in the unit. */
export function lengthRefusal(text: string, unit: LengthUnit = displayUnit): string {
  const shown = text.trim().slice(0, 24);
  const examples = unit === 'imperial' ? `12' 6", 12.5 ft or 3.8 m` : '3.8 m, 380 cm or 12\' 6"';
  return `"${shown}" isn't a length this field can read: try ${examples}.`;
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
