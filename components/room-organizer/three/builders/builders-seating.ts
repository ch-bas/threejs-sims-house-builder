import { type BuilderContext, EDGE, mesh, cornerPositions, lightenHex, softBox } from '../builder-utils';
import { surfaceMaterial } from '../furniture-materials';
import type * as ThreeNS from 'three';

/** How far an upholstered base's plinth sits in from the seat above it. */
const PLINTH_INSET = 0.06;

/**
 * The dark recessed base under an upholstered seat, from the floor up: the
 * seats start 10 cm or more above it, so they hovered with nothing under them.
 */
function addPlinth(
  ctx: BuilderContext,
  group: ThreeNS.Group,
  width: number,
  depth: number,
  height: number,
  x = 0,
  z = 0
): void {
  const { THREE } = ctx;
  const plinth = mesh(
    THREE,
    softBox(THREE, width - PLINTH_INSET * 2, height, depth - PLINTH_INSET * 2, EDGE.wood),
    surfaceMaterial(ctx, 0x2a211b, 'woodOiled')
  );
  plinth.position.set(x, height / 2, z);
  group.add(plinth);
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
  addPlinth(ctx, group, item.width, item.depth * 0.85, item.height * 0.15);

  const seat = mesh(THREE, softBox(THREE, item.width, item.height * 0.45, item.depth * 0.85, EDGE.upholstery), mat);
  seat.position.y = item.height * 0.35;
  group.add(seat);

  const back = mesh(THREE, softBox(THREE, item.width, item.height * 0.65, item.depth * 0.18, EDGE.upholstery), mat);
  back.position.set(0, item.height * 0.7, -item.depth * 0.42);
  group.add(back);

  const armGeo = softBox(THREE, item.width * 0.15, item.height * 0.5, item.depth * 0.75, EDGE.upholstery);
  for (const dx of [-1, 1]) {
    const arm = mesh(THREE, armGeo, mat);
    arm.position.set(dx * item.width * 0.42, item.height * 0.45, 0);
    group.add(arm);
  }
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

  const shape = item.sofaShape ?? 'standard';
  const plinthHeight = item.height * 0.17;

  if (shape === 'standard') {
    addPlinth(ctx, group, item.width, item.depth * 0.8, plinthHeight);
    const seat = mesh(THREE, softBox(THREE, item.width, item.height * 0.5, item.depth * 0.8, EDGE.upholstery), sofaMat);
    seat.position.y = item.height * 0.4;
    group.add(seat);

    const back = mesh(THREE, softBox(THREE, item.width, item.height * 0.6, item.depth * 0.15, EDGE.upholstery), sofaMat);
    back.position.set(0, item.height * 0.7, -item.depth * 0.4);
    group.add(back);

    const armGeo = softBox(THREE, item.width * 0.1, item.height * 0.4, item.depth * 0.7, EDGE.upholstery);
    for (const dx of [-1, 1]) {
      const arm = mesh(THREE, armGeo, sofaMat);
      arm.position.set(dx * item.width * 0.45, item.height * 0.5, 0);
      group.add(arm);
    }

    // Seat cushions — one per "person seat" (divide the sofa into pillows).
    const cushionMat = surfaceMaterial(ctx, lightenHex(item.color, 0.15), 'fabric', { detailed: true });
    const cushionCount = Math.max(2, Math.min(4, Math.round(item.width / 0.8)));
    const cushionWidth = (item.width * 0.92) / cushionCount;
    for (let i = 0; i < cushionCount; i += 1) {
      const cushion = mesh(
        THREE,
        softBox(THREE, cushionWidth * 0.92, item.height * 0.18, item.depth * 0.65, EDGE.cushion, { puff: 0.3 }),
        cushionMat
      );
      cushion.position.set(
        (i + 0.5 - cushionCount / 2) * cushionWidth,
        item.height * 0.71,
        item.depth * 0.05
      );
      group.add(cushion);
    }

    // A throw pillow at each end, leaning on the back.
    const pillowColors: ReadonlyArray<number> = [0xf2d488, 0xeb9d6b, 0x9ec6c0];
    for (const dx of [-1, 1]) {
      const color = pillowColors[(dx + 1) / 2 % pillowColors.length]!;
      const pillowMat = surfaceMaterial(ctx, color, 'fabric', { detailed: true });
      const pillow = mesh(
        THREE,
        softBox(THREE, item.width * 0.2, item.height * 0.3, 0.13, EDGE.cushion, { puff: 0.45 }),
        pillowMat
      );
      pillow.position.set(dx * item.width * 0.32, item.height * 0.92, -item.depth * 0.2);
      pillow.rotation.set(-0.3, dx * 0.12, dx * 0.08);
      group.add(pillow);
    }
  } else if (shape === 'L-shape') {
    addPlinth(ctx, group, item.width, item.depth * 0.8, plinthHeight);
    const mainSeat = mesh(THREE, softBox(THREE, item.width * 0.7, item.height * 0.5, item.depth * 0.8, EDGE.upholstery), sofaMat);
    mainSeat.position.set(-item.width * 0.15, item.height * 0.4, 0);
    group.add(mainSeat);

    const mainBack = mesh(THREE, softBox(THREE, item.width * 0.7, item.height * 0.6, item.depth * 0.15, EDGE.upholstery), sofaMat);
    mainBack.position.set(-item.width * 0.15, item.height * 0.7, -item.depth * 0.4);
    group.add(mainBack);

    const sideSeat = mesh(THREE, softBox(THREE, item.width * 0.4, item.height * 0.5, item.depth * 0.8, EDGE.upholstery), sofaMat);
    sideSeat.position.set(item.width * 0.3, item.height * 0.4, 0);
    group.add(sideSeat);

    const sideBack = mesh(THREE, softBox(THREE, item.width * 0.15, item.height * 0.6, item.depth * 0.6, EDGE.upholstery), sofaMat);
    sideBack.position.set(item.width * 0.425, item.height * 0.7, -item.depth * 0.1);
    group.add(sideBack);

    const leftArm = mesh(THREE, softBox(THREE, item.width * 0.1, item.height * 0.4, item.depth * 0.7, EDGE.upholstery), sofaMat);
    leftArm.position.set(-item.width * 0.45, item.height * 0.5, 0);
    group.add(leftArm);
  } else {
    addPlinth(ctx, group, item.width * 0.6, item.depth * 0.7, plinthHeight, 0, -item.depth * 0.15);
    for (const dx of [-1, 1]) {
      addPlinth(ctx, group, item.width * 0.25, item.depth * 0.7, plinthHeight, dx * item.width * 0.375, item.depth * 0.15);
    }
    const backSeat = mesh(THREE, softBox(THREE, item.width * 0.6, item.height * 0.5, item.depth * 0.7, EDGE.upholstery), sofaMat);
    backSeat.position.set(0, item.height * 0.4, -item.depth * 0.15);
    group.add(backSeat);

    const mainBack = mesh(THREE, softBox(THREE, item.width * 0.6, item.height * 0.6, item.depth * 0.15, EDGE.upholstery), sofaMat);
    mainBack.position.set(0, item.height * 0.7, -item.depth * 0.475);
    group.add(mainBack);

    const sideSeatGeo = softBox(THREE, item.width * 0.25, item.height * 0.5, item.depth * 0.7, EDGE.upholstery);
    const sideBackGeo = softBox(THREE, item.width * 0.15, item.height * 0.6, item.depth * 0.7, EDGE.upholstery);
    for (const dx of [-1, 1]) {
      const seat = mesh(THREE, sideSeatGeo, sofaMat);
      seat.position.set(dx * item.width * 0.375, item.height * 0.4, item.depth * 0.15);
      group.add(seat);

      const back = mesh(THREE, sideBackGeo, sofaMat);
      back.position.set(dx * item.width * 0.45, item.height * 0.7, item.depth * 0.15);
      group.add(back);
    }

    const cushion = mesh(
      THREE,
      softBox(THREE, item.width * 0.4, item.height * 0.3, item.depth * 0.4, EDGE.cushion, { puff: 0.3 }),
      sofaMat
    );
    cushion.position.set(0, item.height * 0.35, item.depth * 0.25);
    group.add(cushion);
  }

  return group;
}
