import { describe, expect, it } from 'vitest';
import { makeItem, makeLayout } from '../lib/__testfixtures__/fixtures';
import { applyTheme, THEME_LIST } from '../lib/themes';
import { COLOR_SWATCHES } from '../panels/color-swatch-picker';
import { contrastRatio, drawOpeningSymbol, relativeLuminance, symbolInk, traceOpeningGaps } from './opening-symbol';

type Call = { op: string; args: number[]; style?: string };

function recordingContext(): { ctx: CanvasRenderingContext2D; calls: Call[] } {
  const calls: Call[] = [];
  const record =
    (op: string) =>
    (...args: number[]) => {
      calls.push({ op, args, style: String((ctx as unknown as { fillStyle: string }).fillStyle) });
    };
  const ctx = {
    save: () => {},
    restore: () => {},
    beginPath: () => {},
    closePath: () => {},
    stroke: record('stroke'),
    fill: record('fill'),
    moveTo: record('moveTo'),
    lineTo: record('lineTo'),
    arc: record('arc'),
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    lineCap: 'butt',
    lineJoin: 'miter',
  } as unknown as CanvasRenderingContext2D;
  return { ctx, calls };
}

// An 8×8 m room at 50 px/m from (60, 60): world (x, z) → (260 + 50x, 260 + 50z).
const layout = makeLayout();
const view = { scale: 50, offsetX: 60, offsetY: 60 };
const FLOOR = '#d8c7a8';
/** A door in the north wall: rotation 0, so it opens towards +z. */
const door = makeItem({ id: 'd', type: 'door', width: 0.9, depth: 0.12, position: { x: 0, z: -3.94 } });
const NORTH_DOOR_Y = 260 + 50 * -3.94;

const arcOf = (calls: Call[]) => calls.find((c) => c.op === 'arc')!.args;
const sweepEnd = ([cx, cy, r, , end]: number[]) => [cx! + r! * Math.cos(end!), cy! + r! * Math.sin(end!)];

describe('drawOpeningSymbol (#576)', () => {
  it('reads at 3:1 or better on every floor swatch and theme (dark floors too)', () => {
    const floors = [...COLOR_SWATCHES, ...THEME_LIST.map((theme) => applyTheme(makeLayout(), theme.key).floors[0]!.floorColor), '#2C3E50', '#000000', '#ffffff', '#777777', '#7f7f7f'];
    for (const color of floors) {
      const ink = relativeLuminance(symbolInk(color))!;
      expect(contrastRatio(ink, relativeLuminance(color)!), color).toBeGreaterThanOrEqual(3);
    }
  });

  it('strokes in that ink, and keeps the dark ink for a colour it cannot read', () => {
    const { ctx } = recordingContext();
    drawOpeningSymbol(ctx, door, '#2C3E50', layout, view);
    expect(ctx.strokeStyle).toBe(symbolInk('#2C3E50'));
    expect(symbolInk('#2C3E50')).not.toBe(symbolInk('tomato'));
  });

  it('hinges a door at local −X, its leaf opening into the room', () => {
    const { ctx, calls } = recordingContext();
    drawOpeningSymbol(ctx, door, FLOOR, layout, view);
    const [cx, cy, radius, start, , ccw] = arcOf(calls) as [number, number, number, number, number, unknown];
    expect(cx).toBeCloseTo(260 - 22.5, 6);
    expect(cy).toBeCloseTo(NORTH_DOOR_Y, 6);
    expect(radius).toBeCloseTo(45, 6);
    // Starts at the far jamb, ends square to the wall, into the room (canvas +y).
    expect(cx + radius * Math.cos(start)).toBeCloseTo(260 + 22.5, 6);
    const [ex, ey] = sweepEnd(arcOf(calls));
    expect(ex).toBeCloseTo(cx, 6);
    expect(ey).toBeCloseTo(NORTH_DOOR_Y + 45, 6);
    // The short way round: through the room, not through the wall.
    expect(ccw).toBe(false);
  });

  it('moves the hinge to the other jamb on a mirrored door (#386)', () => {
    const { ctx, calls } = recordingContext();
    drawOpeningSymbol(ctx, { ...door, mirrored: true }, FLOOR, layout, view);
    const [cx, , , , , ccw] = arcOf(calls);
    expect(cx).toBeCloseTo(260 + 22.5, 6);
    expect(ccw).toBe(true);
  });

  it('opens into the room on every wall', () => {
    const walls = [
      { rotation: 0, position: { x: 0, z: -3.94 } },
      { rotation: Math.PI, position: { x: 0, z: 3.94 } },
      { rotation: Math.PI / 2, position: { x: -3.94, z: 0 } },
      { rotation: -Math.PI / 2, position: { x: 3.94, z: 0 } },
    ];
    for (const wall of walls) {
      const { ctx, calls } = recordingContext();
      drawOpeningSymbol(ctx, { ...door, ...wall }, FLOOR, layout, view);
      const [ex, ey] = sweepEnd(arcOf(calls));
      const [wx, wz] = [(ex! - 260) / 50, (ey! - 260) / 50];
      // The open leaf's tip is nearer the centre than the door is.
      expect(Math.hypot(wx, wz)).toBeLessThan(Math.hypot(wall.position.x, wall.position.z));
    }
  });

  it('keeps the gap wide enough to cut the wall line on a small plan', () => {
    const { ctx, calls } = recordingContext();
    traceOpeningGaps(ctx, [door], layout, { ...view, scale: 10 });
    const ys = calls.filter((c) => c.op === 'moveTo' || c.op === 'lineTo').map((c) => c.args[1]!);
    expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(7, 6);
  });

  it('draws a window as a framed gap with a line down the middle and no arc', () => {
    const { ctx, calls } = recordingContext();
    const window = makeItem({ id: 'w', type: 'window', width: 1.4, depth: 0.12, position: { x: 0, z: -3.94 } });
    drawOpeningSymbol(ctx, window, FLOOR, layout, view);
    expect(calls.some((c) => c.op === 'arc')).toBe(false);
    const last = calls.filter((c) => c.op === 'moveTo' || c.op === 'lineTo').slice(-2);
    expect(last.map((c) => c.args[0])).toEqual([260 - 35, 260 + 35]);
    expect(last.map((c) => c.args[1])).toEqual([NORTH_DOOR_Y, NORTH_DOOR_Y]);
  });

  it('skips an unplaced item', () => {
    const { ctx, calls } = recordingContext();
    const { position: _unplaced, ...unplaced } = door;
    drawOpeningSymbol(ctx, unplaced, FLOOR, layout, view);
    expect(calls).toEqual([]);
  });
});
