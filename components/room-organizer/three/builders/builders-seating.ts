import { type BuilderContext, EDGE, mergeParts, mesh, cornerPositions, lightenHex, softBox } from '../builder-utils';
import { surfaceMaterial } from '../furniture-materials';
import type * as ThreeNS from 'three';

/** How far an upholstered base's plinth sits in from the seat above it. */
const PLINTH_INSET = 0.06;

/** A softBox part placed in the item's frame, for `mergeParts`. */
function part(THREE: BuilderContext['THREE'], w: number, h: number, d: number, radius: number, x: number, y: number, z: number): ThreeNS.BufferGeometry {
  return softBox(THREE, w, h, d, radius).translate(x, y, z);
}

/**
 * The dark recessed base under an upholstered seat, from the floor up: the
 * seats start 10 cm or more above it, so they hovered with nothing under them.
 * Each footprint is [width, depth, x, z]; together they are one draw call.
 */
function addPlinth(
  ctx: BuilderContext,
  group: ThreeNS.Group,
  height: number,
  footprints: ReadonlyArray<readonly [number, number, number, number]>
): void {
  const { THREE } = ctx;
  const parts = footprints.map(([width, depth, x, z]) =>
    part(THREE, width - PLINTH_INSET * 2, height, depth - PLINTH_INSET * 2, EDGE.wood, x, height / 2, z)
  );
  group.add(mesh(THREE, mergeParts(THREE, parts), surfaceMaterial(ctx, 0x2a211b, 'woodOiled')));
}

export function buildChair(ctx: BuilderContext): ThreeNS.Group {
  const { THREE, item, baseColor } = ctx;
  const group = new THREE.Group();
  const seatMat = surfaceMaterial(ctx, baseColor, 'woodOiled', { detailed: true });

  const seat = mesh(THREE, softBox(THREE, item.width, item.height * 0.1, item.depth, EDGE.wood), seatMat);
  seat.position.y = item.height * 0.5;
  group.add(seat);

  const back = mesh(THREE, softBox(THREE, item.width, item.height * 0.5, item.depth * 0.1, EDGE.wood), seatMat);
  back.position.set(0, item.height * 0.75, -item.depth * 0.45);
  group.add(back);

  const legMat = surfaceMaterial(ctx, 0x654321, 'woodOiled');
  const legGeo = new THREE.CylinderGeometry(0.03, 0.03, item.height * 0.5, 8);
  for (const [x, y, z] of cornerPositions(item.width * 0.4, item.height * 0.25, item.depth * 0.4)) {
    const leg = mesh(THREE, legGeo, legMat);
    leg.position.set(x, y, z);
    group.add(leg);
  }

  return group;
}

export function buildArmchair(ctx: BuilderContext): ThreeNS.Group {
  const { THREE, item, baseColor } = ctx;
  const group = new THREE.Group();
  const mat = surfaceMaterial(ctx, baseColor, 'leather', { detailed: true });
  addPlinth(ctx, group, item.height * 0.15, [[item.width, item.depth * 0.85, 0, 0]]);

  // Seat, back and arms share the leather: one draw call (#755). The back
  // stays inside the item's box.
  const { width: w, depth: d, height: h } = item;
  const upholstery = [
    part(THREE, w, h * 0.45, d * 0.85, EDGE.upholstery, 0, h * 0.35, 0),
    part(THREE, w, h * 0.65, d * 0.18, EDGE.upholstery, 0, h * 0.675, -d * 0.41),
    ...[-1, 1].map((dx) => part(THREE, w * 0.15, h * 0.5, d * 0.75, EDGE.upholstery, dx * w * 0.42, h * 0.45, 0)),
  ];
  group.add(mesh(THREE, mergeParts(THREE, upholstery), mat));
  return group;
}

export function buildBench(ctx: BuilderContext): ThreeNS.Group {
  const { THREE, item, baseColor } = ctx;
  const group = new THREE.Group();
  const mat = surfaceMaterial(ctx, baseColor, 'woodOiled', { detailed: true });
  const seat = mesh(THREE, softBox(THREE, item.width, item.height * 0.18, item.depth, EDGE.wood), mat);
  seat.position.y = item.height * 0.91;
  group.add(seat);

  const legGeo = softBox(THREE, item.width * 0.08, item.height * 0.82, item.depth * 0.6, EDGE.wood);
  for (const dx of [-1, 1]) {
    const leg = mesh(THREE, legGeo, mat);
    leg.position.set(dx * item.width * 0.42, item.height * 0.41, 0);
    group.add(leg);
  }
  return group;
}

export function buildSofa(ctx: BuilderContext): ThreeNS.Group {
  const { THREE, item, baseColor } = ctx;
  const group = new THREE.Group();
  const sofaMat = surfaceMaterial(ctx, baseColor, 'fabric', { detailed: true });
  const { width: w, depth: d, height: h } = item;
  const U = EDGE.upholstery;

  const shape = item.sofaShape ?? 'standard';
  const plinthHeight = h * 0.17;
  // Every part in the sofa's own fabric draws as one mesh (#755).
  const addBody = (parts: ThreeNS.BufferGeometry[]): void => {
    group.add(mesh(THREE, mergeParts(THREE, parts), sofaMat));
  };

  if (shape === 'standard') {
    addPlinth(ctx, group, plinthHeight, [[w, d * 0.8, 0, 0]]);
    addBody([
      part(THREE, w, h * 0.5, d * 0.8, U, 0, h * 0.4, 0),
      part(THREE, w, h * 0.6, d * 0.15, U, 0, h * 0.7, -d * 0.4),
      ...[-1, 1].map((dx) => part(THREE, w * 0.1, h * 0.4, d * 0.7, U, dx * w * 0.45, h * 0.5, 0)),
    ]);

    // Seat cushions — one per "person seat" (divide the sofa into pillows).
    const cushionMat = surfaceMaterial(ctx, lightenHex(item.color, 0.15), 'fabric', { detailed: true });
    const cushionCount = Math.max(2, Math.min(4, Math.round(w / 0.8)));
    const cushionWidth = (w * 0.92) / cushionCount;
    const cushions = Array.from({ length: cushionCount }, (_, i) =>
      softBox(THREE, cushionWidth * 0.92, h * 0.18, d * 0.65, EDGE.cushion, { puff: 0.3 }).translate(
        (i + 0.5 - cushionCount / 2) * cushionWidth,
        h * 0.71,
        d * 0.05
      )
    );
    group.add(mesh(THREE, mergeParts(THREE, cushions), cushionMat));

    // A throw pillow at each end, leaning on the back, its top no higher
    // than the sofa's.
    const pillowColors: ReadonlyArray<number> = [0xf2d488, 0xeb9d6b, 0x9ec6c0];
    for (const dx of [-1, 1]) {
      const color = pillowColors[(dx + 1) / 2 % pillowColors.length]!;
      const pillowMat = surfaceMaterial(ctx, color, 'fabric', { detailed: true });
      // Turned in the geometry, Z then Y then X, as Euler (-0.3, dx·0.12, dx·0.08) would.
      const geometry = softBox(THREE, w * 0.2, h * 0.3, 0.13, EDGE.cushion, { puff: 0.45 })
        .rotateZ(dx * 0.08)
        .rotateY(dx * 0.12)
        .rotateX(-0.3);
      geometry.computeBoundingBox();
      const lift = Math.min(h * 0.92, h - (geometry.boundingBox?.max.y ?? 0));
      const pillow = mesh(THREE, geometry, pillowMat);
      pillow.position.set(dx * w * 0.32, lift, -d * 0.2);
      group.add(pillow);
    }
  } else if (shape === 'L-shape') {
    addPlinth(ctx, group, plinthHeight, [[w, d * 0.8, 0, 0]]);
    addBody([
      part(THREE, w * 0.7, h * 0.5, d * 0.8, U, -w * 0.15, h * 0.4, 0),
      part(THREE, w * 0.7, h * 0.6, d * 0.15, U, -w * 0.15, h * 0.7, -d * 0.4),
      part(THREE, w * 0.4, h * 0.5, d * 0.8, U, w * 0.3, h * 0.4, 0),
      part(THREE, w * 0.15, h * 0.6, d * 0.6, U, w * 0.425, h * 0.7, -d * 0.1),
      part(THREE, w * 0.1, h * 0.4, d * 0.7, U, -w * 0.45, h * 0.5, 0),
    ]);
  } else {
    addPlinth(ctx, group, plinthHeight, [
      [w * 0.6, d * 0.7, 0, -d * 0.15],
      [w * 0.25, d * 0.7, -w * 0.375, d * 0.15],
      [w * 0.25, d * 0.7, w * 0.375, d * 0.15],
    ]);
    addBody([
      part(THREE, w * 0.6, h * 0.5, d * 0.7, U, 0, h * 0.4, -d * 0.15),
      part(THREE, w * 0.6, h * 0.6, d * 0.15, U, 0, h * 0.7, -d * 0.425),
      ...[-1, 1].flatMap((dx) => [
        part(THREE, w * 0.25, h * 0.5, d * 0.7, U, dx * w * 0.375, h * 0.4, d * 0.15),
        part(THREE, w * 0.15, h * 0.6, d * 0.7, U, dx * w * 0.425, h * 0.7, d * 0.15),
      ]),
      softBox(THREE, w * 0.4, h * 0.3, d * 0.4, EDGE.cushion, { puff: 0.3 }).translate(0, h * 0.35, d * 0.25),
    ]);
  }
  return group;
}
