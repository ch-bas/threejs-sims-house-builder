import { downloadBlob, downloadTextFile, exportFileName } from './plan-export/download';
import { MAX_LAYOUT_JSON_BYTES, parseStoredLayout } from './schema';
import { zoneContains } from './zones';
import type { FurnitureItem, RoomLayout, RoomZone } from './types';

export function downloadLayoutAsJson(layout: RoomLayout): void {
  downloadTextFile(exportFileName(layout.name, 'json'), 'application/json', JSON.stringify(layout, null, 2));
}

export async function readLayoutFromFile(file: File): Promise<RoomLayout> {
  // Checked before reading: a multi-hundred-MB file would otherwise be read
  // and parsed whole before the schema ever saw it (#332).
  if (file.size > MAX_LAYOUT_JSON_BYTES) {
    const limitMb = MAX_LAYOUT_JSON_BYTES / (1024 * 1024);
    throw new Error(
      `This file is ${(file.size / (1024 * 1024)).toFixed(1)} MB, far larger than any house layout (the limit is ${limitMb} MB), so it was not opened.`
    );
  }
  const text = await file.text();
  const parsed: unknown = JSON.parse(text);
  const layout = parseStoredLayout(parsed);
  if (!layout) {
    throw new Error('Invalid layout file: structure does not match the expected schema.');
  }
  return layout;
}

/** Longest-edge cap for a stored floor plan, in pixels. */
const MAX_IMAGE_EDGE = 1500;

export async function readImageAsDataUrl(file: File): Promise<string> {
  if (!file.type.startsWith('image/')) {
    throw new Error('Please upload an image file (PNG, JPG, etc.)');
  }
  const rawDataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read image'));
    reader.readAsDataURL(file);
  });

  // A full-resolution floor plan can easily be several MB of base64, which
  // exhausts the ~5MB localStorage budget and makes every save fail. Downscale
  // anything larger than MAX_IMAGE_EDGE on its long edge and re-encode as JPEG
  // so the stored layout stays well within budget.
  return downscaleDataUrl(rawDataUrl);
}

function downscaleDataUrl(dataUrl: string): Promise<string> {
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => {
      const longEdge = Math.max(image.width, image.height);
      if (longEdge <= MAX_IMAGE_EDGE || longEdge === 0) {
        resolve(dataUrl);
        return;
      }
      const scale = MAX_IMAGE_EDGE / longEdge;
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(image.width * scale);
      canvas.height = Math.round(image.height * scale);
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        resolve(dataUrl);
        return;
      }
      // JPEG has no alpha and composites transparency on black — a
      // transparent-background plan (typical CAD export) turned into
      // line-work on a black slab. Fill white first (#146).
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL('image/jpeg', 0.85));
    };
    // On decode failure, fall back to the original data URL rather than losing
    // the upload entirely.
    image.onerror = () => resolve(dataUrl);
    image.src = dataUrl;
  });
}

/**
 * Byte-order mark: without it Excel on Windows reads the UTF-8 file as the
 * local code page and garbles accents and emoji in item names (#430).
 */
const CSV_BOM = '﻿';

/** A CSV cell: text is formula-guarded and quoted as needed; numbers are written as is. */
type CsvCell = string | number;

function csvLine(cells: readonly CsvCell[]): string {
  return cells.map((cell) => (typeof cell === 'number' ? String(cell) : csvField(cell))).join(',');
}

function csvField(value: string): string {
  // Neutralize spreadsheet formula injection: a value beginning with =, +, -,
  // @, a tab or a CR is interpreted as a formula by Excel/Sheets, so an imported
  // layout with an item named `=HYPERLINK(...)` would execute on export.
  // Prefix a single quote to force it to a literal string. Numbers we write
  // ourselves (a negative coordinate) are CsvCell numbers and bypass this.
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  if (/[",\n\r]/.test(safe)) return `"${safe.replace(/"/g, '""')}"`;
  return safe;
}

/** Metres to the centimetre, kept a number so `-2` stays numeric. */
const metres = (value: number): number => Math.round(value * 100) / 100 || 0;

/** Money to the cent: 12.95 × 6 is 77.7, not 77.69999999999999. */
const cents = (value: number): number => Math.round(value * 100) / 100;

/** Plan rotation in degrees, 0 ≤ r < 360, to a tenth. */
function rotationDegrees(radians: number): number {
  const degrees = Math.round(((radians * 180) / Math.PI) * 10) / 10;
  const wrapped = ((degrees % 360) + 360) % 360;
  // 360 after rounding, and -0, both read as 0.
  return wrapped === 360 ? 0 : wrapped || 0;
}

/** The zones on the floor whose rectangle holds the item's centre, joined. */
function zoneNames(item: FurnitureItem, zones: readonly RoomZone[] | undefined): string {
  const position = item.position;
  if (!position || !zones) return '';
  return zones
    .filter((zone) => zoneContains(zone, position.x, position.z))
    .map((zone) => zone.name)
    .join('; ');
}

/**
 * One row per item on every floor (#430). The first nine columns are the
 * original ones, in their original order; placement, state and zone follow,
 * so a row tells three identical doors apart. Unplaced items leave X/Z blank.
 */
export function inventoryCsv(layout: RoomLayout): string {
  const lines = [
    csvLine([
      'Floor', 'Category', 'Type', 'Name', 'Width (m)', 'Depth (m)', 'Height (m)', 'Colour', 'Price',
      'X (m)', 'Z (m)', 'Rotation (deg)', 'Mirrored', 'Locked', 'Zone',
    ]),
  ];
  for (const floor of layout.floors) {
    for (const item of floor.items) {
      lines.push(
        csvLine([
          floor.name,
          item.category ?? '',
          item.type,
          item.name,
          item.width.toFixed(2),
          item.depth.toFixed(2),
          item.height.toFixed(2),
          item.color,
          item.price ?? 0,
          item.position ? metres(item.position.x) : '',
          item.position ? metres(item.position.z) : '',
          rotationDegrees(item.rotation ?? 0),
          item.mirrored === true ? 'yes' : 'no',
          item.locked === true ? 'yes' : 'no',
          zoneNames(item, floor.zones),
        ])
      );
    }
  }
  return CSV_BOM + lines.join('\r\n') + '\r\n';
}

/**
 * The grouped schedule (#430): one row per distinct product on each floor —
 * same category, type, name, size, colour and price — with its quantity and
 * line total, closed by a total row for the building.
 */
export function scheduleCsv(layout: RoomLayout): string {
  const lines = [
    csvLine(['Floor', 'Category', 'Type', 'Name', 'Width (m)', 'Depth (m)', 'Height (m)', 'Colour', 'Unit price', 'Qty', 'Total']),
  ];
  let allQty = 0;
  let allTotal = 0;
  for (const floor of layout.floors) {
    const rows = new Map<string, { cells: CsvCell[]; price: number; qty: number }>();
    for (const item of floor.items) {
      const price = item.price ?? 0;
      const cells: CsvCell[] = [
        floor.name,
        item.category ?? '',
        item.type,
        item.name,
        item.width.toFixed(2),
        item.depth.toFixed(2),
        item.height.toFixed(2),
        item.color,
        price,
      ];
      const key = JSON.stringify(cells);
      const row = rows.get(key);
      if (row) row.qty += 1;
      else rows.set(key, { cells, price, qty: 1 });
    }
    for (const { cells, price, qty } of rows.values()) {
      const total = cents(price * qty);
      lines.push(csvLine([...cells, qty, total]));
      allQty += qty;
      allTotal += total;
    }
  }
  lines.push(csvLine(['All floors', '', '', '', '', '', '', '', '', allQty, cents(allTotal)]));
  return CSV_BOM + lines.join('\r\n') + '\r\n';
}

export function downloadInventoryCsv(layout: RoomLayout): void {
  downloadTextFile(exportFileName(layout.name, 'csv', 'inventory'), 'text/csv;charset=utf-8', inventoryCsv(layout));
}

export function downloadScheduleCsv(layout: RoomLayout): void {
  downloadTextFile(exportFileName(layout.name, 'csv', 'schedule'), 'text/csv;charset=utf-8', scheduleCsv(layout));
}

/**
 * Export the whole building as a .glb (#373): every storey, the roof and
 * dormers, every wall uncut, nodes named — built from the layout into a
 * throwaway graph (three/building-export.ts), never cloned from the live
 * scene, which holds only what the current view shows. Everything built for
 * the file is disposed afterwards.
 */
export async function downloadLayoutAsGlb(layout: RoomLayout): Promise<void> {
  const [THREE, { GLTFExporter }, { buildExportBuilding, prepareExportBuilding }, { disposeObject }] = await Promise.all([
    import('../three/three-runtime'),
    import('three/examples/jsm/exporters/GLTFExporter.js'),
    import('../three/building-export'),
    import('../three/builder-utils'),
  ]);
  await prepareExportBuilding(THREE, layout);
  const building = buildExportBuilding(THREE, layout);
  try {
    const result = await new GLTFExporter().parseAsync(building, { binary: true });
    const binary = result instanceof ArrayBuffer;
    const blob = binary
      ? new Blob([result], { type: 'model/gltf-binary' })
      : new Blob([JSON.stringify(result)], { type: 'model/gltf+json' });
    downloadBlob(exportFileName(layout.name, binary ? 'glb' : 'gltf'), blob);
  } finally {
    disposeObject(building);
  }
}

/**
 * Trigger a PNG download of the canvas. Resolves to `true` on success and
 * `false` when `toBlob` yields null (e.g. a tainted canvas or an out-of-memory
 * encode) so the caller can surface a failure instead of a silent no-op.
 *
 * `background` is painted behind the canvas first: the 2D plan is
 * transparent outside the house (the lawn is the element's CSS background),
 * and a transparent PNG opens black in many viewers (#391).
 */
export function downloadCanvasAsPng(canvas: HTMLCanvasElement, fileName: string, background?: string): Promise<boolean> {
  let source = canvas;
  if (background) {
    const flat = document.createElement('canvas');
    flat.width = canvas.width;
    flat.height = canvas.height;
    const ctx = flat.getContext('2d');
    if (ctx) {
      ctx.fillStyle = background;
      ctx.fillRect(0, 0, flat.width, flat.height);
      ctx.drawImage(canvas, 0, 0);
      source = flat;
    }
  }
  return new Promise((resolve) => {
    source.toBlob((blob) => {
      if (!blob) {
        resolve(false);
        return;
      }
      downloadBlob(fileName, blob);
      resolve(true);
    }, 'image/png');
  });
}

