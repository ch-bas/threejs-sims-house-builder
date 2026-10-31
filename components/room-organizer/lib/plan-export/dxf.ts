/**
 * DXF floor-plan export (#230). Hand-rolled plain-text DXF — no
 * dependencies, no DOM. Group codes and values each on their own line.
 *
 * Choices:
 * - Units are metres 1:1 ($INSUNITS = 6); world origin moves to the room's
 *   corner and the CAD Y axis points up, so Y = depth/2 − z and the plan
 *   reads like the 2D top-down view.
 * - The file is a complete AutoCAD 2000 (AC1015) document, the version that
 *   introduced LWPOLYLINE (#397): HEADER ($ACADVER, $HANDSEED, $INSUNITS,
 *   $EXTMIN/$EXTMAX), an empty CLASSES section, all nine symbol tables with
 *   the records R2000 requires (BYBLOCK/BYLAYER/CONTINUOUS linetypes, layer
 *   0, STANDARD text and dimension styles, the ACAD appid, the model and
 *   paper space block records), the two layout BLOCKs, the ENTITIES, and an
 *   OBJECTS section with the root dictionary and ACAD_GROUP. Every table,
 *   record, block and entity carries a unique hex handle (group 5, 105 for
 *   DIMSTYLE), its owner (330) and its subclass markers (100). Checked with
 *   ezdxf: loads without repairs and audits with zero fixes and errors.
 * - Walls and furniture footprints are closed LWPOLYLINEs (flag 70 = 1).
 * - Openings are LINE jamb ticks + a centre line, doors add the swing ARC,
 *   hinged on the jamb the 3D door is (mirroring swaps it, #386).
 * - Labels are horizontal TEXT (rotating text helps nobody in CAD).
 * - STAIR-CUT carries the hatch over the treads under a stairwell (#631).
 * - ZONES carries each room zone as a closed LWPOLYLINE with its name and area
 *   as TEXT along the top edge, where the SVG puts them (#571).
 * - COVERAGE carries Wi-Fi/CCTV rings as CIRCLEs and camera wedges as an
 *   ARC plus two LINEs (#420), trimmed to the frame the SVG clips to (the
 *   plan content plus at most 5 m of coverage), so the two formats agree and
 *   a 30 m lens can't swamp the drawing extents; DIMENSIONS carries LINE + TEXT dimension
 *   strings (true DIMENSION entities need anonymous blocks), and with
 *   `openingDimensions` a chain per exterior wall (#630); the north arrow
 *   sits on LABELS (#424).
 * - `buildingToDxf` lays every floor out side by side, ground floor first,
 *   on the same layers at the same 1:1 scale, each with its own title (#405).
 */

import { stripXmlIllegal } from '../html-escape';
import { planDrawOrder } from '../plan-order';
import { entrancePlanOutline, planFloorIndex, type EntrancePlanOutline } from '../street';
import { zoneArea } from '../zones';
import {
  buildingFrameBounds,
  clipArc,
  clipSegment,
  coverageRings,
  interiorWallDimensions,
  itemWorldCorners,
  doorSwing,
  openingAxes,
  planContentBounds,
  planFrameBounds,
  polarPoint,
  splitPlanItems,
  stairArrow,
  stairCutHatch,
  stairTreadSegments,
  stairwellOutlines,
  visionWedges,
  wallOpeningDimensions,
  type CoverageMode,
  type OpeningChain,
  type PlacedItem,
  type PlanBounds,
  type PlanPoint,
} from './plan-geometry';
import type { FloorLayout, RoomLayout } from '../types';

export const DXF_LAYERS = [
  'WALLS',
  'INTERIOR',
  'OPENINGS',
  'FURNITURE',
  'LABELS',
  'STAIRWELL',
  'COVERAGE',
  'DIMENSIONS',
  'ZONES',
  'STAIR-CUT',
] as const;

export type DxfLayer = (typeof DXF_LAYERS)[number];

/** ACI colour per layer (7 white, 8 grey, 5 blue, 3 green, 2 yellow, 1 red, 4 cyan, 6 magenta, 30 orange). */
const LAYER_COLOURS: Record<DxfLayer, number> = {
  WALLS: 7,
  INTERIOR: 8,
  OPENINGS: 5,
  FURNITURE: 3,
  LABELS: 2,
  STAIRWELL: 1,
  COVERAGE: 4,
  DIMENSIONS: 6,
  ZONES: 30,
  'STAIR-CUT': 8,
};

export interface DxfExportOptions {
  /**
   * Wi-Fi/CCTV rings and camera wedges on the COVERAGE layer (#420). On by
   * default, trimmed to the same frame as the SVG — up to
   * `COVERAGE_MARGIN_M` past the plan content; `'full'` keeps all of it;
   * `false` leaves the layer out.
   */
  coverage?: boolean | 'full';
  /** Room and interior-wall dimension strings on the DIMENSIONS layer (default on, #424). */
  dimensions?: boolean;
  /** A chain of dimensions along each exterior wall with an opening, on DIMENSIONS (default off, #630); needs `dimensions`. */
  openingDimensions?: boolean;
}

/** Perpendicular jamb-tick length at each end of an opening, in metres. */
const OPENING_TICK_M = 0.25;
/** TEXT heights in metres. */
const LABEL_TEXT_HEIGHT = 0.18;
const TITLE_TEXT_HEIGHT = 0.35;
const DIMENSION_TEXT_HEIGHT = 0.15;
/** Below a zone's top edge: its name's baseline and its area's, metres (the SVG's two lines at 50 px/m). */
const ZONE_NAME_DROP_M = 0.3;
const ZONE_AREA_DROP_M = 0.54;
/** Gap between the plan content and a room dimension line, metres. */
const DIMENSION_OFFSET_M = 0.4;
/** Offset of an interior wall's dimension line off its centreline, metres. */
const WALL_DIMENSION_OFFSET_M = 0.2;
/** Half-length of a dimension tick, metres. */
const DIMENSION_TICK_M = 0.08;
/** Band the opening chains add between the plan content and what stood there, metres, for two label rows (#630). */
const OPENING_CHAIN_BAND_M = 0.6;
/** Further out per label row of an opening chain, metres. */
const OPENING_CHAIN_ROW_M = 0.2;
/** Clear space between two floors laid side by side, metres (#405). */
const FLOOR_GAP_M = 3;

/** A CAD-space point: metres, Y up. */
type CadPoint = readonly [number, number];

/**
 * Accumulates the ENTITIES of a document, hands out handles, and tracks the
 * drawing extents — then wraps them in the R2000 sections on `finish`.
 */
class DxfDocument {
  private nextHandle = 1;
  private readonly entities: string[] = [];
  private minX = Infinity;
  private minY = Infinity;
  private maxX = -Infinity;
  private maxY = -Infinity;

  // Fixed handles, allocated up front so entities can name their owner.
  private readonly rootDictionary = this.handle();
  private readonly groupDictionary = this.handle();
  private readonly tableHandles = {
    VPORT: this.handle(),
    LTYPE: this.handle(),
    LAYER: this.handle(),
    STYLE: this.handle(),
    VIEW: this.handle(),
    UCS: this.handle(),
    APPID: this.handle(),
    DIMSTYLE: this.handle(),
    BLOCK_RECORD: this.handle(),
  };
  private readonly modelSpaceRecord = this.handle();
  private readonly paperSpaceRecord = this.handle();

  private handle(): string {
    return (this.nextHandle++).toString(16).toUpperCase();
  }

  private touch(x: number, y: number): void {
    if (x < this.minX) this.minX = x;
    if (x > this.maxX) this.maxX = x;
    if (y < this.minY) this.minY = y;
    if (y > this.maxY) this.maxY = y;
  }

  /** Common entity head: type, handle, owner (model space), layer. */
  private head(type: string, layer: string, out: string[]): void {
    pair(out, 0, type);
    pair(out, 5, this.handle());
    pair(out, 330, this.modelSpaceRecord);
    pair(out, 100, 'AcDbEntity');
    pair(out, 8, layer);
  }

  line(layer: DxfLayer, from: CadPoint, to: CadPoint): void {
    const out = this.entities;
    this.head('LINE', layer, out);
    pair(out, 100, 'AcDbLine');
    pair(out, 10, fmt(from[0]));
    pair(out, 20, fmt(from[1]));
    pair(out, 11, fmt(to[0]));
    pair(out, 21, fmt(to[1]));
    this.touch(from[0], from[1]);
    this.touch(to[0], to[1]);
  }

  polyline(layer: DxfLayer, points: readonly CadPoint[], closed: boolean): void {
    const out = this.entities;
    this.head('LWPOLYLINE', layer, out);
    pair(out, 100, 'AcDbPolyline');
    pair(out, 90, points.length);
    pair(out, 70, closed ? 1 : 0);
    for (const [x, y] of points) {
      pair(out, 10, fmt(x));
      pair(out, 20, fmt(y));
      this.touch(x, y);
    }
  }

  circle(layer: DxfLayer, center: CadPoint, radius: number): void {
    const out = this.entities;
    this.head('CIRCLE', layer, out);
    pair(out, 100, 'AcDbCircle');
    pair(out, 10, fmt(center[0]));
    pair(out, 20, fmt(center[1]));
    pair(out, 40, fmt(radius));
    this.touch(center[0] - radius, center[1] - radius);
    this.touch(center[0] + radius, center[1] + radius);
  }

  /** A CCW arc from `startDeg` to `endDeg` (CAD angles). */
  arc(layer: DxfLayer, center: CadPoint, radius: number, startDeg: number, endDeg: number): void {
    const out = this.entities;
    this.head('ARC', layer, out);
    pair(out, 100, 'AcDbCircle');
    pair(out, 10, fmt(center[0]));
    pair(out, 20, fmt(center[1]));
    pair(out, 40, fmt(radius));
    pair(out, 100, 'AcDbArc');
    pair(out, 50, fmt(normalizeDeg(startDeg)));
    pair(out, 51, fmt(normalizeDeg(endDeg)));
    // The arc's extent: its end points and every axis crossing inside the sweep.
    const start = normalizeDeg(startDeg);
    const sweep = normalizeDeg(endDeg - startDeg);
    const at = (deg: number): void => {
      const rad = (deg * Math.PI) / 180;
      this.touch(center[0] + Math.cos(rad) * radius, center[1] + Math.sin(rad) * radius);
    };
    at(start);
    at(start + sweep);
    for (const axis of [0, 90, 180, 270]) {
      if (normalizeDeg(axis - start) <= sweep) at(axis);
    }
  }

  /**
   * TEXT at `at`; `centred` aligns it on the point (horizontally, and
   * vertically for `middle`); `rotationDeg` turns it CCW.
   */
  text(
    layer: DxfLayer,
    at: CadPoint,
    height: number,
    value: string,
    align: 'left' | 'centre' | 'middle' = 'left',
    rotationDeg = 0
  ): void {
    const out = this.entities;
    this.head('TEXT', layer, out);
    pair(out, 100, 'AcDbText');
    pair(out, 10, fmt(at[0]));
    pair(out, 20, fmt(at[1]));
    pair(out, 40, fmt(height));
    pair(out, 1, sanitizeText(value));
    if (rotationDeg !== 0) pair(out, 50, fmt(normalizeDeg(rotationDeg)));
    if (align !== 'left') {
      pair(out, 72, 1);
      pair(out, 11, fmt(at[0]));
      pair(out, 21, fmt(at[1]));
    }
    pair(out, 100, 'AcDbText');
    if (align === 'middle') pair(out, 73, 2);
    this.touch(at[0], at[1]);
  }

  /** The finished document: HEADER, CLASSES, TABLES, BLOCKS, ENTITIES, OBJECTS, EOF. */
  finish(): string {
    const hasExtents = this.minX <= this.maxX;
    const ext = hasExtents
      ? { minX: this.minX, minY: this.minY, maxX: this.maxX, maxY: this.maxY }
      : { minX: 0, minY: 0, maxX: 0, maxY: 0 };
    const tables = this.tables(ext);
    const blocks = this.blocks();
    const objects = this.objects();

    const out: string[] = [];
    // HEADER last-built, first-written: $HANDSEED must exceed every handle.
    pair(out, 0, 'SECTION');
    pair(out, 2, 'HEADER');
    pair(out, 9, '$ACADVER');
    pair(out, 1, 'AC1015');
    pair(out, 9, '$HANDSEED');
    pair(out, 5, this.handle());
    pair(out, 9, '$INSUNITS');
    pair(out, 70, 6); // metres
    pair(out, 9, '$MEASUREMENT');
    pair(out, 70, 1); // metric
    pair(out, 9, '$EXTMIN');
    pair(out, 10, fmt(ext.minX));
    pair(out, 20, fmt(ext.minY));
    pair(out, 30, fmt(0));
    pair(out, 9, '$EXTMAX');
    pair(out, 10, fmt(ext.maxX));
    pair(out, 20, fmt(ext.maxY));
    pair(out, 30, fmt(0));
    pair(out, 0, 'ENDSEC');

    pair(out, 0, 'SECTION');
    pair(out, 2, 'CLASSES');
    pair(out, 0, 'ENDSEC');

    out.push(...tables, ...blocks);

    pair(out, 0, 'SECTION');
    pair(out, 2, 'ENTITIES');
    out.push(...this.entities);
    pair(out, 0, 'ENDSEC');

    out.push(...objects);
    pair(out, 0, 'EOF');
    return out.join('\n');
  }

  private tables(ext: { minX: number; minY: number; maxX: number; maxY: number }): string[] {
    const out: string[] = [];
    pair(out, 0, 'SECTION');
    pair(out, 2, 'TABLES');

    const table = (name: keyof DxfDocument['tableHandles'], count: number, body: (owner: string) => void): void => {
      const owner = this.tableHandles[name];
      pair(out, 0, 'TABLE');
      pair(out, 2, name);
      pair(out, 5, owner);
      pair(out, 330, '0');
      pair(out, 100, 'AcDbSymbolTable');
      pair(out, 70, count);
      body(owner);
      pair(out, 0, 'ENDTAB');
    };
    const record = (type: string, owner: string, subclass: string, name: string, handleCode = 5): void => {
      pair(out, 0, type);
      pair(out, handleCode, this.handle());
      pair(out, 330, owner);
      pair(out, 100, 'AcDbSymbolTableRecord');
      pair(out, 100, subclass);
      pair(out, 2, name);
      pair(out, 70, 0);
    };

    // The active viewport opens on the drawing extents.
    table('VPORT', 1, (owner) => {
      const width = Math.max(ext.maxX - ext.minX, 1);
      const height = Math.max(ext.maxY - ext.minY, 1);
      record('VPORT', owner, 'AcDbViewportTableRecord', '*ACTIVE');
      pair(out, 10, fmt(0));
      pair(out, 20, fmt(0));
      pair(out, 11, fmt(1));
      pair(out, 21, fmt(1));
      pair(out, 12, fmt((ext.minX + ext.maxX) / 2));
      pair(out, 22, fmt((ext.minY + ext.maxY) / 2));
      pair(out, 40, fmt(height * 1.1));
      pair(out, 41, fmt(width / height));
    });
    table('LTYPE', 3, (owner) => {
      for (const [name, description] of [
        ['BYBLOCK', ''],
        ['BYLAYER', ''],
        ['CONTINUOUS', 'Solid line'],
      ] as const) {
        record('LTYPE', owner, 'AcDbLinetypeTableRecord', name);
        pair(out, 3, description);
        pair(out, 72, 65);
        pair(out, 73, 0);
        pair(out, 40, fmt(0));
      }
    });
    table('LAYER', DXF_LAYERS.length + 1, (owner) => {
      for (const layer of ['0', ...DXF_LAYERS] as const) {
        record('LAYER', owner, 'AcDbLayerTableRecord', layer);
        pair(out, 62, layer === '0' ? 7 : LAYER_COLOURS[layer]);
        pair(out, 6, 'CONTINUOUS');
      }
    });
    table('STYLE', 1, (owner) => {
      record('STYLE', owner, 'AcDbTextStyleTableRecord', 'STANDARD');
      pair(out, 40, fmt(0));
      pair(out, 41, fmt(1));
      pair(out, 50, fmt(0));
      pair(out, 71, 0);
      pair(out, 42, fmt(LABEL_TEXT_HEIGHT));
      pair(out, 3, 'txt');
    });
    table('VIEW', 0, () => {});
    table('UCS', 0, () => {});
    table('APPID', 1, (owner) => {
      record('APPID', owner, 'AcDbRegAppTableRecord', 'ACAD');
    });
    table('DIMSTYLE', 1, (owner) => {
      // The DIMSTYLE table carries a second subclass; its records use group 105 for the handle.
      pair(out, 100, 'AcDbDimStyleTable');
      pair(out, 71, 0);
      record('DIMSTYLE', owner, 'AcDbDimStyleTableRecord', 'STANDARD', 105);
    });
    table('BLOCK_RECORD', 2, (owner) => {
      for (const [name, handle] of [
        ['*MODEL_SPACE', this.modelSpaceRecord],
        ['*PAPER_SPACE', this.paperSpaceRecord],
      ] as const) {
        pair(out, 0, 'BLOCK_RECORD');
        pair(out, 5, handle);
        pair(out, 330, owner);
        pair(out, 100, 'AcDbSymbolTableRecord');
        pair(out, 100, 'AcDbBlockTableRecord');
        pair(out, 2, name);
      }
    });
    pair(out, 0, 'ENDSEC');
    return out;
  }

  private blocks(): string[] {
    const out: string[] = [];
    pair(out, 0, 'SECTION');
    pair(out, 2, 'BLOCKS');
    for (const [name, owner, paper] of [
      ['*MODEL_SPACE', this.modelSpaceRecord, false],
      ['*PAPER_SPACE', this.paperSpaceRecord, true],
    ] as const) {
      pair(out, 0, 'BLOCK');
      pair(out, 5, this.handle());
      pair(out, 330, owner);
      pair(out, 100, 'AcDbEntity');
      if (paper) pair(out, 67, 1);
      pair(out, 8, '0');
      pair(out, 100, 'AcDbBlockBegin');
      pair(out, 2, name);
      pair(out, 70, 0);
      pair(out, 10, fmt(0));
      pair(out, 20, fmt(0));
      pair(out, 30, fmt(0));
      pair(out, 3, name);
      pair(out, 1, '');
      pair(out, 0, 'ENDBLK');
      pair(out, 5, this.handle());
      pair(out, 330, owner);
      pair(out, 100, 'AcDbEntity');
      if (paper) pair(out, 67, 1);
      pair(out, 8, '0');
      pair(out, 100, 'AcDbBlockEnd');
    }
    pair(out, 0, 'ENDSEC');
    return out;
  }

  private objects(): string[] {
    const out: string[] = [];
    pair(out, 0, 'SECTION');
    pair(out, 2, 'OBJECTS');
    pair(out, 0, 'DICTIONARY');
    pair(out, 5, this.rootDictionary);
    pair(out, 330, '0');
    pair(out, 100, 'AcDbDictionary');
    pair(out, 281, 1);
    pair(out, 3, 'ACAD_GROUP');
    pair(out, 350, this.groupDictionary);
    pair(out, 0, 'DICTIONARY');
    pair(out, 5, this.groupDictionary);
    pair(out, 330, this.rootDictionary);
    pair(out, 100, 'AcDbDictionary');
    pair(out, 281, 1);
    pair(out, 0, 'ENDSEC');
    return out;
  }
}

function pair(out: string[], code: number, value: string | number): void {
  out.push(String(code), String(value));
}

/** Render one floor of a building as a DXF R2000 document (metres, 1:1). */
export function layoutToDxf(layout: RoomLayout, floor: FloorLayout, options: DxfExportOptions = {}): string {
  const doc = new DxfDocument();
  emitFloor(doc, layout, floor, 0, options);
  return doc.finish();
}

/**
 * The whole building as one DXF (#405): every floor on the same layers at
 * 1:1, ground floor first, laid out left to right at the building frame's
 * width plus a 3 m gap, each under its own title.
 */
export function buildingToDxf(layout: RoomLayout, options: DxfExportOptions = {}): string {
  const doc = new DxfDocument();
  // Every floor shares the building's frame (as `buildingToSvg` does), laid
  // out at a fixed pitch, so the rooms line up and no floor's coverage
  // runs into its neighbour.
  const frame = buildingFrameBounds(layout, dxfCoverageMode(options));
  const pitch = frame.maxX - frame.minX + FLOOR_GAP_M;
  layout.floors.forEach((floor, index) => emitFloor(doc, layout, floor, index * pitch, options, frame));
  return doc.finish();
}

/** The plan-geometry coverage mode for these options. */
function dxfCoverageMode(options: DxfExportOptions): CoverageMode {
  if (options.coverage === false) return 'off';
  return options.coverage === 'full' ? 'full' : 'capped';
}

/**
 * Everything one floor draws, with the room's SW corner at CAD (offsetX, 0);
 * coverage is trimmed to `frame` (default: the floor's own frame).
 */
function emitFloor(
  doc: DxfDocument,
  layout: RoomLayout,
  floor: FloorLayout,
  offsetX: number,
  options: DxfExportOptions,
  frame?: PlanBounds
): void {
  // World (metres, origin at room centre, z down) → CAD (origin at the room's
  // SW corner in CAD terms, Y up).
  const cad = (x: number, z: number): CadPoint => [x + layout.width / 2 + offsetX, layout.height / 2 - z];
  const content = planContentBounds(layout, floor);

  emitZones(doc, floor, entrancePlanOutline(layout, planFloorIndex(layout.floors, floor)), cad);

  // Room outline: one closed polyline around the footprint. Hidden walls stay
  // in the export — the footprint is real even when the 2D view fades a wall.
  // A recessed entrance (#285) notches the north edge: the polyline goes in
  // along the east cheek, across the recess's back and out along the west
  // cheek — eight vertices. (The back wall's centreline is on INTERIOR too,
  // like the 2D view draws it; its door is an ordinary opening.)
  const hw = layout.width / 2;
  const hd = layout.height / 2;
  const recess = entrancePlanOutline(layout, planFloorIndex(layout.floors, floor));
  const northEdge: CadPoint[] = recess
    ? [cad(recess.x1, recess.frontZ), cad(recess.x1, recess.backZ), cad(recess.x0, recess.backZ), cad(recess.x0, recess.frontZ)]
    : [];
  doc.polyline('WALLS', [cad(-hw, hd), cad(hw, hd), cad(hw, -hd), ...northEdge, cad(-hw, -hd)], true);

  // Interior walls: centrelines (the 0.16 m thickness is a render style).
  for (const wall of floor.interiorWalls ?? []) {
    doc.line('INTERIOR', cad(wall.x1, wall.z1), cad(wall.x2, wall.z2));
  }

  const floorIndex = layout.floors.findIndex((candidate) => candidate === floor || candidate.id === floor.id);
  // The stairwell the floor below cuts through this slab (#290): its own
  // layer, so CAD users can hatch or hide the void independently.
  for (const outline of stairwellOutlines(layout, floorIndex)) {
    doc.polyline(
      'STAIRWELL',
      outline.map((p) => cad(p.x, p.z)),
      true
    );
  }

  if (options.coverage !== false) emitCoverage(doc, floor, frame ?? planFrameBounds(layout, floor, dxfCoverageMode(options)), cad);

  // Same bottom-to-top layer order as the on-screen plan (#286).
  const { openings, furniture } = splitPlanItems(planDrawOrder(floor.items));
  for (const item of openings) emitOpening(doc, item, cad);
  for (const item of furniture) {
    doc.polyline(
      'FURNITURE',
      itemWorldCorners(item).map((corner) => cad(corner.x, corner.z)),
      true
    );
    doc.text('LABELS', cad(item.position.x, item.position.z), LABEL_TEXT_HEIGHT, item.name, 'centre');
    if (item.type === 'stairs') emitStairs(doc, item, cad);
  }
  // The treads under the hole (#631): their own layer, so CAD users can hide the hatch.
  for (const { from, to } of stairCutHatch(layout, floor)) {
    doc.line('STAIR-CUT', cad(from.x, from.z), cad(to.x, to.z));
  }

  const showChains = options.dimensions !== false && options.openingDimensions === true;
  const chains = showChains ? wallOpeningDimensions(layout, floor) : [];
  const topRow = Math.max(0, ...chains.flatMap((chain) => chain.segments.map((segment) => segment.labelRow)));
  const chainBand = showChains ? OPENING_CHAIN_BAND_M + OPENING_CHAIN_ROW_M * Math.max(0, topRow - 1) : 0;
  if (options.dimensions !== false) emitDimensions(doc, layout, floor, content, cad, chainBand);
  for (const chain of chains) emitOpeningChain(doc, chain, content, cad);
  const [northEastX, northEastY] = cad(content.maxX, content.minZ);
  emitNorthArrow(doc, [northEastX + chainBand, northEastY]);

  // Floor title above the plan content (the north wall, unless something stands beyond it).
  const [titleX] = cad(-hw, 0);
  doc.text('LABELS', [titleX, northEastY + 0.5 + chainBand], TITLE_TEXT_HEIGHT, `${layout.name} - ${floor.name}`);
}

/** Room zones (#571): the outline, then name and area on two lines, like the SVG's `renderZones`. */
function emitZones(doc: DxfDocument, floor: FloorLayout, recess: EntrancePlanOutline | null, cad: (x: number, z: number) => CadPoint): void {
  for (const zone of floor.zones ?? []) {
    const left = zone.x;
    const right = zone.x + zone.w;
    const top = zone.z;
    const bottom = zone.z + zone.d;
    doc.polyline('ZONES', [cad(left, top), cad(right, top), cad(right, bottom), cad(left, bottom)], true);
    const centre = zone.x + zone.w / 2;
    doc.text('ZONES', cad(centre, top + ZONE_NAME_DROP_M), LABEL_TEXT_HEIGHT, zone.name, 'centre');
    doc.text('ZONES', cad(centre, top + ZONE_AREA_DROP_M), DIMENSION_TEXT_HEIGHT, `${zoneArea(zone, recess).toFixed(1)} m²`, 'centre');
  }
}

/**
 * A stair's plan symbol (#290) beside its footprint: tread nosings as LINEs
 * and the up-arrow as an open LWPOLYLINE along the walk line plus two barb
 * LINEs at the head — all on FURNITURE, since they belong to the item.
 */
function emitStairs(doc: DxfDocument, item: PlacedItem, cad: (x: number, z: number) => CadPoint): void {
  for (const { from, to } of stairTreadSegments(item)) {
    doc.line('FURNITURE', cad(from.x, from.z), cad(to.x, to.z));
  }
  const { shaft, head } = stairArrow(item);
  if (shaft.length < 2) return;
  doc.polyline(
    'FURNITURE',
    shaft.map((p) => cad(p.x, p.z)),
    false
  );
  for (const { from, to } of head) {
    doc.line('FURNITURE', cad(from.x, from.z), cad(to.x, to.z));
  }
}

function emitOpening(doc: DxfDocument, item: PlacedItem, cad: (x: number, z: number) => CadPoint): void {
  const { along, into } = openingAxes(item);
  const half = item.width / 2;
  const tick = OPENING_TICK_M / 2;
  const pos = item.position;
  const endA = { x: pos.x - along.x * half, z: pos.z - along.z * half };
  const endB = { x: pos.x + along.x * half, z: pos.z + along.z * half };

  // Jamb ticks across the wall at both ends of the opening.
  for (const end of [endA, endB]) {
    doc.line('OPENINGS', cad(end.x - into.x * tick, end.z - into.z * tick), cad(end.x + into.x * tick, end.z + into.z * tick));
  }

  if (item.type === 'door') {
    // Swing: `doorSwing`'s leaf, plus the quarter arc from the closed to the
    // open position. In CAD coords `along` sits at angle θ and `into` at
    // θ − 90°: from the −X jamb the closed leaf points along θ and the CCW
    // arc runs θ−90 → θ; from the +X jamb of a mirrored door it points back
    // along θ+180 and the arc runs θ+180 → θ+270.
    const { hinge, leafTip } = doorSwing(item);
    doc.line('OPENINGS', cad(hinge.x, hinge.z), cad(leafTip.x, leafTip.z));
    const thetaDeg = ((item.rotation ?? 0) * 180) / Math.PI;
    const [start, end] = item.mirrored ? [thetaDeg + 180, thetaDeg + 270] : [thetaDeg - 90, thetaDeg];
    doc.arc('OPENINGS', cad(hinge.x, hinge.z), item.width, start, end);
  } else {
    // Window: the double-line symbol's centre line along the wall.
    doc.line('OPENINGS', cad(endA.x, endA.z), cad(endB.x, endB.z));
  }
}

/**
 * The coverage layer (#420): three CIRCLEs per Wi-Fi or CCTV unit and, per
 * camera, its wedge as an ARC with two LINEs back to the lens (a CIRCLE for a
 * 360° camera). Plan angles turn clockwise and CAD's counter-clockwise, so a
 * plan sweep start → end is the CCW CAD arc −end → −start.
 */
function emitCoverage(doc: DxfDocument, floor: FloorLayout, frame: PlanBounds, cad: (x: number, z: number) => CadPoint): void {
  // Trimmed to the same frame the SVG clips to (#420): what lies inside it
  // as CIRCLE (when whole) or ARC pieces, and the wedge sides as LINEs.
  const circleOrArcs = (center: PlanPoint, radius: number, start: number, sweep: number): void => {
    const pieces = clipArc(center, radius, start, sweep, frame);
    const whole = sweep >= 2 * Math.PI - 1e-9 && pieces.length === 1 && pieces[0]![1] - pieces[0]![0] >= sweep - 1e-9;
    if (whole) {
      doc.circle('COVERAGE', cad(center.x, center.z), radius);
      return;
    }
    for (const [from, to] of pieces) doc.arc('COVERAGE', cad(center.x, center.z), radius, toDeg(-to), toDeg(-from));
  };
  for (const { center, radii } of coverageRings(floor.items)) {
    for (const radius of radii) circleOrArcs(center, radius, 0, 2 * Math.PI);
  }
  for (const wedge of visionWedges(floor.items)) {
    if (wedge.full) {
      circleOrArcs(wedge.apex, wedge.radius, 0, 2 * Math.PI);
      continue;
    }
    for (const angle of [wedge.startAngle, wedge.endAngle]) {
      const side = clipSegment(wedge.apex, polarPoint(wedge.apex, wedge.radius, angle), frame);
      if (side) doc.line('COVERAGE', cad(side.from.x, side.from.z), cad(side.to.x, side.to.z));
    }
    circleOrArcs(wedge.apex, wedge.radius, wedge.startAngle, wedge.endAngle - wedge.startAngle);
  }
}

/**
 * Dimension strings as LINE + TEXT (#424): the room's width below the plan
 * content and its depth left of it, with extension lines back to the walls,
 * and one string per interior wall offset off its centreline.
 */
function emitDimensions(
  doc: DxfDocument,
  layout: RoomLayout,
  floor: FloorLayout,
  content: PlanBounds,
  cad: (x: number, z: number) => CadPoint,
  chainBand: number
): void {
  const [x0, y0] = cad(-layout.width / 2, layout.height / 2);
  const [x1, y1] = cad(layout.width / 2, -layout.height / 2);
  const [contentLeft, contentBottom] = cad(content.minX, content.maxZ);
  const tick = DIMENSION_TICK_M;

  // Width, along the bottom.
  const wy = contentBottom - DIMENSION_OFFSET_M - chainBand;
  doc.line('DIMENSIONS', [x0, y0], [x0, wy - tick]);
  doc.line('DIMENSIONS', [x1, y0], [x1, wy - tick]);
  dimension(doc, [x0, wy], [x1, wy], layout.width, [0, -1]);

  // Depth, up the left side.
  const dx = contentLeft - DIMENSION_OFFSET_M - chainBand;
  doc.line('DIMENSIONS', [x0, y0], [dx - tick, y0]);
  doc.line('DIMENSIONS', [x0, y1], [dx - tick, y1]);
  dimension(doc, [dx, y0], [dx, y1], layout.height, [-1, 0]);

  for (const dim of interiorWallDimensions(floor)) {
    const from = cad(dim.from.x, dim.from.z);
    const to = cad(dim.to.x, dim.to.z);
    // The side plan-geometry chose, shared with the SVG: world (x, z) → CAD (x, −z).
    const outward: CadPoint = [dim.normal.x, -dim.normal.z];
    const nx = outward[0] * WALL_DIMENSION_OFFSET_M;
    const ny = outward[1] * WALL_DIMENSION_OFFSET_M;
    dimension(doc, [from[0] + nx, from[1] + ny], [to[0] + nx, to[1] + ny], dim.lengthM, outward, dim.labelShiftM);
  }
}

/** One wall's opening chain (#630), as the SVG draws it: just past the content, extension lines back to the wall. */
function emitOpeningChain(doc: DxfDocument, chain: OpeningChain, content: PlanBounds, cad: (x: number, z: number) => CadPoint): void {
  const { outward: world, segments } = chain;
  const horizontal = world.x === 0;
  const edge = horizontal ? (world.z < 0 ? content.minZ : content.maxZ) : world.x < 0 ? content.minX : content.maxX;
  const outward: CadPoint = [world.x, -world.z];
  const onLine = (p: PlanPoint, by = 0): CadPoint => {
    const step = DIMENSION_OFFSET_M + by;
    const point = horizontal ? cad(p.x, edge) : cad(edge, p.z);
    return [point[0] + outward[0] * step, point[1] + outward[1] * step];
  };
  for (const stop of [segments[0]!.from, ...segments.map((segment) => segment.to)]) {
    doc.line('DIMENSIONS', cad(stop.x, stop.z), onLine(stop, DIMENSION_TICK_M));
  }
  for (const segment of segments) {
    const gap = DIMENSION_TEXT_HEIGHT + segment.labelRow * OPENING_CHAIN_ROW_M;
    dimension(doc, onLine(segment.from), onLine(segment.to), segment.lengthM, outward, 0, gap);
  }
}

/**
 * One dimension line with perpendicular end ticks and its length as TEXT
 * `labelGap` beside it on the `outward` side (a CAD unit vector), kept
 * upright, slid `labelShiftM` off centre towards `to`.
 */
function dimension(
  doc: DxfDocument,
  from: CadPoint,
  to: CadPoint,
  lengthM: number,
  outward: CadPoint,
  labelShiftM = 0,
  labelGap = DIMENSION_TEXT_HEIGHT
): void {
  const len = Math.hypot(to[0] - from[0], to[1] - from[1]);
  if (len === 0) return;
  const ux = (to[0] - from[0]) / len;
  const uy = (to[1] - from[1]) / len;
  const tx = -uy * DIMENSION_TICK_M;
  const ty = ux * DIMENSION_TICK_M;
  doc.line('DIMENSIONS', from, to);
  doc.line('DIMENSIONS', [from[0] - tx, from[1] - ty], [from[0] + tx, from[1] + ty]);
  doc.line('DIMENSIONS', [to[0] - tx, to[1] - ty], [to[0] + tx, to[1] + ty]);
  let rotation = toDeg(Math.atan2(uy, ux));
  // Readable from the bottom or the right of the sheet.
  if (rotation > 90 + 1e-6) rotation -= 180;
  else if (rotation <= -90 + 1e-6) rotation += 180;
  const label: CadPoint = [
    (from[0] + to[0]) / 2 + outward[0] * labelGap + ux * labelShiftM,
    (from[1] + to[1]) / 2 + outward[1] * labelGap + uy * labelShiftM,
  ];
  const metres = (Math.round(lengthM * 100) / 100).toFixed(2);
  doc.text('DIMENSIONS', label, DIMENSION_TEXT_HEIGHT, `${metres} m`, 'middle', rotation);
}

/**
 * North arrow (#424): north is −z, the street side — CAD +Y. A closed arrow
 * head with an N above it, just outside the content's NE corner.
 */
function emitNorthArrow(doc: DxfDocument, contentNorthEast: CadPoint): void {
  const cx = contentNorthEast[0] + 0.8;
  const top = contentNorthEast[1];
  const tip: CadPoint = [cx, top];
  doc.polyline('LABELS', [tip, [cx + 0.18, top - 0.6], [cx, top - 0.45], [cx - 0.18, top - 0.6]], true);
  doc.text('LABELS', [cx, top + 0.25], 0.25, 'N', 'middle');
}

function toDeg(radians: number): number {
  return (radians * 180) / Math.PI;
}

function normalizeDeg(deg: number): number {
  return ((deg % 360) + 360) % 360;
}

/** Fixed 3-dp precision, never "-0.000". */
function fmt(value: number): string {
  const fixed = value.toFixed(3);
  return fixed === '-0.000' ? '0.000' : fixed;
}

/**
 * Make a string safe as a DXF TEXT value:
 * - control characters (incl. newlines) would corrupt the group pairs → space;
 * - lone surrogates and U+FFFE/F are not text, so no `\\U+` escape for them (#549);
 * - AC1015 is read with the ANSI code page, so raw UTF-8 above ASCII garbles
 *   ("Maison d'été" → "Maison d'Ã©tÃ©"): every code point above 0x7E goes
 *   out as the `\U+XXXX` escape CAD readers expand; astral characters have
 *   no BMP escape and become `?` (#288);
 * - `%%` introduces a TEXT control code (`%%u` underline, `%%d` degree), so
 *   every `%` is written as the `%%%` escape for a literal percent sign —
 *   "%%u" becomes "%%%%%%u", which readers render as "%%u".
 */
function sanitizeText(value: string): string {
  let out = '';
  // eslint-disable-next-line no-control-regex
  for (const char of stripXmlIllegal(value.replace(/[\r\n\u0000-\u001f]/g, ' '))) {
    const code = char.codePointAt(0) ?? 0x3f;
    if (char === '%') out += '%%%';
    else if (code <= 0x7e) out += char;
    else if (code <= 0xffff) out += `\\U+${code.toString(16).toUpperCase().padStart(4, '0')}`;
    else out += '?';
  }
  return out;
}
