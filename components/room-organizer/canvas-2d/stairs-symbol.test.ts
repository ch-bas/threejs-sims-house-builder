import { describe, expect, it } from 'vitest';
import { makeFloor, makeItem, makeLayout } from '../lib/__testfixtures__/fixtures';
import { STAIR_STEP_COUNT } from '../lib/stairs';
import { drawStairsSymbol, drawStairwellHoles } from './stairs-symbol';

type Call = { op: string; args: number[] };

/**
 * A recording 2D context: every path op lands in `calls` so a test can read
 * the geometry back without a real canvas (jsdom has none).
 */
function recordingContext(): { ctx: CanvasRenderingContext2D; calls: Call[]; dashes: number[][]; texts: string[] } {
  const calls: Call[] = [];
  const dashes: number[][] = [];
  const texts: string[] = [];
  const record =
    (op: string) =>
    (...args: number[]) => {
      calls.push({ op, args });
    };
  const ctx = {
    save: () => {},
    restore: () => {},
    beginPath: () => {},
    closePath: () => {},
    stroke: () => {},
    fill: () => {},
    moveTo: record('moveTo'),
    lineTo: record('lineTo'),
    arc: record('arc'),
    setLineDash: (segments: number[]) => dashes.push(segments),
    fillText: (text: string) => texts.push(text),
    lineWidth: 1,
  } as unknown as CanvasRenderingContext2D;
  return { ctx, calls, dashes, texts };
}

// An 8×8 m room drawn at 50 px/m from (60, 60): world (x, z) → (260 + 50x, 260 + 50z).
const layout = makeLayout();
const view = { scale: 50, offsetX: 60, offsetY: 60 };
const straight = makeItem({ id: 's', type: 'stairs', width: 1.2, depth: 2.4, height: 3, position: { x: 0, z: 0 } });
const winder = makeItem({ id: 'w', type: 'stairs', width: 2, depth: 2.6, height: 3, stairsShape: 'winder', position: { x: 1, z: 2 } });

const points = (calls: Call[], op: string) => calls.filter((c) => c.op === op).map((c) => c.args);

describe('drawStairsSymbol (#290)', () => {
  it('draws the treads and an arrow from the foot to the head of a straight flight', () => {
    const { ctx, calls } = recordingContext();
    drawStairsSymbol(ctx, straight, layout, view);
    // 14 treads share 13 nosings: 43 tread segments, then the arrow's shaft and two barbs.
    const moves = points(calls, 'moveTo');
    expect(moves).toHaveLength(14 * 4 - 13 + 1 + 2);
    // The arrow starts on the first tread at the top of the plan (local −z) and its foot dot sits there.
    const shaftStart = moves[14 * 4 - 13]!;
    expect(shaftStart[0]).toBeCloseTo(260);
    expect(shaftStart[1]).toBeCloseTo(260 - 60 + (120 / STAIR_STEP_COUNT) * 0.5);
    const dot = points(calls, 'arc')[0]!;
    expect(dot[0]).toBeCloseTo(shaftStart[0]!);
    expect(dot[1]).toBeCloseTo(shaftStart[1]!);
    // Its head is on the last tread, at the bottom.
    const barbTips = points(calls, 'lineTo').slice(-2);
    for (const [, y] of barbTips) expect(y).toBeCloseTo(260 + 60 - (120 / STAIR_STEP_COUNT) * 0.5);
  });

  it('honours rotation: a quarter turn lays the flight along the plan’s x axis', () => {
    const { ctx, calls } = recordingContext();
    drawStairsSymbol(ctx, { ...straight, rotation: Math.PI / 2 }, layout, view);
    const ys = new Set(calls.flatMap((c) => (c.op === 'moveTo' || c.op === 'lineTo' ? [c.args[1]!.toFixed(3)] : [])));
    // Every tread line and the arrow lie within the 1.2 m width, now along z.
    for (const y of ys) expect(Math.abs(Number(y) - 260)).toBeLessThanOrEqual(30 + 1e-6);
    const barbTips = points(calls, 'lineTo').slice(-2);
    // Local +z (the climb) turns to world +x: the head is on the right.
    for (const [x] of barbTips) expect(x).toBeGreaterThan(260 + 50);
  });

  it('distinguishes a mirrored winder: the arrow climbs the other side', () => {
    const plain = recordingContext();
    const mirrored = recordingContext();
    drawStairsSymbol(plain.ctx, winder, layout, view);
    drawStairsSymbol(mirrored.ctx, { ...winder, mirrored: true }, layout, view);
    const start = (calls: Call[]) => points(calls, 'arc')[0]!;
    // Stair centre at world (1, 2) → (310, 360). The plain winder's foot is on the −x half.
    expect(start(plain.calls)[0]).toBeLessThan(310);
    expect(start(mirrored.calls)[0]).toBeGreaterThan(310);
    expect(start(mirrored.calls)[0]).toBeCloseTo(620 - start(plain.calls)[0]!);
    expect(start(mirrored.calls)[1]).toBeCloseTo(start(plain.calls)[1]!);
    // The two symbols never coincide, though both cover the same footprint.
    expect(points(plain.calls, 'moveTo')).not.toEqual(points(mirrored.calls, 'moveTo'));
  });

  it('keeps only the arrow when the treads would pack tighter than the minimap can show', () => {
    const { ctx, calls } = recordingContext();
    drawStairsSymbol(ctx, straight, layout, { scale: 8, offsetX: 4, offsetY: 4 });
    // 2.4 m × 8 px/m over 14 treads is 1.4 px a tread: no nosings, just the shaft and barbs.
    expect(points(calls, 'moveTo')).toHaveLength(3);
  });

  it('draws nothing for an unplaced item', () => {
    const { ctx, calls } = recordingContext();
    const { position: _placed, ...unplaced } = straight;
    drawStairsSymbol(ctx, unplaced, layout, view);
    expect(calls).toHaveLength(0);
  });
});

describe('drawStairwellHoles (#290)', () => {
  const ground = makeFloor({ id: 'g', items: [straight, winder] });
  const first = makeFloor({ id: 'f', name: 'First Floor' });
  const building = makeLayout({ floors: [ground, first] });

  it('draws one dashed outline per stair below, and nothing on the ground floor', () => {
    const upstairs = recordingContext();
    drawStairwellHoles(upstairs.ctx, building, 1, view);
    // The straight flight's rectangle (4 corners) and the winder's L (6).
    expect(points(upstairs.calls, 'moveTo')).toHaveLength(2);
    expect(points(upstairs.calls, 'lineTo')).toHaveLength(3 + 5);
    expect(upstairs.dashes[0]).toEqual([6, 4]);
    expect(upstairs.texts).toEqual(['open below', 'open below']);

    const downstairs = recordingContext();
    drawStairwellHoles(downstairs.ctx, building, 0, view);
    expect(downstairs.calls).toHaveLength(0);
    const detached = recordingContext();
    drawStairwellHoles(detached.ctx, building, -1, view);
    expect(detached.calls).toHaveLength(0);
  });

  it('places the hole where the floor builder cuts it', () => {
    const { ctx, calls } = recordingContext();
    drawStairwellHoles(ctx, makeLayout({ floors: [makeFloor({ items: [straight] }), first] }), 1, view);
    const corners = [points(calls, 'moveTo')[0]!, ...points(calls, 'lineTo')];
    const xs = corners.map(([x]) => x!);
    const ys = corners.map(([, y]) => y!);
    // 1.3 m wide (1.2 m + 5 cm margin a side) about world x = 0, ending at the head of the flight.
    expect(Math.min(...xs)).toBeCloseTo(260 - 32.5);
    expect(Math.max(...xs)).toBeCloseTo(260 + 32.5);
    expect(Math.max(...ys)).toBeCloseTo(260 + 60 + 2.5);
    expect(Math.min(...ys)).toBeGreaterThan(260 - 60);
  });
});
