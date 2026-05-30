import type * as ThreeNS from 'three';
import { type BuilderContext, mesh, cornerPositions, lightenHex } from '../builder-utils';

export function buildChair({ THREE, item, hasCollision, baseColor, opacity }: BuilderContext): ThreeNS.Group {
  const group = new THREE.Group();
  const seatMat = new THREE.MeshStandardMaterial({
    color: baseColor,
    roughness: 0.7,
    metalness: 0.1,
    transparent: hasCollision,
    opacity,
  });

  const seat = mesh(THREE, new THREE.BoxGeometry(item.width, item.height * 0.1, item.depth), seatMat);
  seat.position.y = item.height * 0.5;
  group.add(seat);

  const back = mesh(THREE, new THREE.BoxGeometry(item.width, item.height * 0.5, item.depth * 0.1), seatMat);
  back.position.set(0, item.height * 0.75, -item.depth * 0.45);
  group.add(back);

  const legMat = new THREE.MeshStandardMaterial({ color: 0x654321, roughness: 0.8, transparent: hasCollision, opacity });
  const legGeo = new THREE.CylinderGeometry(0.03, 0.03, item.height * 0.5, 8);
  for (const [x, y, z] of cornerPositions(item.width * 0.4, item.height * 0.25, item.depth * 0.4)) {
    const leg = mesh(THREE, legGeo, legMat);
    leg.position.set(x, y, z);
    group.add(leg);
  }

  return group;
}

export function buildArmchair({ THREE, item, hasCollision, baseColor, opacity }: BuilderContext): ThreeNS.Group {
  const group = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: baseColor, roughness: 0.85, transparent: hasCollision, opacity });

  const seat = mesh(THREE, new THREE.BoxGeometry(item.width, item.height * 0.45, item.depth * 0.85), mat);
  seat.position.y = item.height * 0.35;
  group.add(seat);

  const back = mesh(THREE, new THREE.BoxGeometry(item.width, item.height * 0.65, item.depth * 0.18), mat);
  back.position.set(0, item.height * 0.7, -item.depth * 0.42);
  group.add(back);

  const armGeo = new THREE.BoxGeometry(item.width * 0.15, item.height * 0.5, item.depth * 0.75);
  for (const dx of [-1, 1]) {
    const arm = mesh(THREE, armGeo, mat);
    arm.position.set(dx * item.width * 0.42, item.height * 0.45, 0);
    group.add(arm);
  }
  return group;
}

export function buildBench({ THREE, item, hasCollision, baseColor, opacity }: BuilderContext): ThreeNS.Group {
  const group = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: baseColor, roughness: 0.7, transparent: hasCollision, opacity });
  const seat = mesh(THREE, new THREE.BoxGeometry(item.width, item.height * 0.18, item.depth), mat);
  seat.position.y = item.height * 0.91;
  group.add(seat);

  const legGeo = new THREE.BoxGeometry(item.width * 0.08, item.height * 0.82, item.depth * 0.6);
  for (const dx of [-1, 1]) {
    const leg = mesh(THREE, legGeo, mat);
    leg.position.set(dx * item.width * 0.42, item.height * 0.41, 0);
    group.add(leg);
  }
  return group;
}

export function buildSofa({ THREE, item, hasCollision, baseColor, opacity }: BuilderContext): ThreeNS.Group {
  const group = new THREE.Group();
  const sofaMat = new THREE.MeshStandardMaterial({ color: baseColor, roughness: 0.8, transparent: hasCollision, opacity });

  const shape = item.sofaShape ?? 'standard';

  if (shape === 'standard') {
    const seat = mesh(THREE, new THREE.BoxGeometry(item.width, item.height * 0.5, item.depth * 0.8), sofaMat);
    seat.position.y = item.height * 0.4;
    group.add(seat);

    const back = mesh(THREE, new THREE.BoxGeometry(item.width, item.height * 0.6, item.depth * 0.15), sofaMat);
    back.position.set(0, item.height * 0.7, -item.depth * 0.4);
    group.add(back);

    const armGeo = new THREE.BoxGeometry(item.width * 0.1, item.height * 0.4, item.depth * 0.7);
    for (const dx of [-1, 1]) {
      const arm = mesh(THREE, armGeo, sofaMat);
      arm.position.set(dx * item.width * 0.45, item.height * 0.5, 0);
      group.add(arm);
    }

    // Seat cushions — one per "person seat" (divide the sofa into pillows).
    const cushionMat = new THREE.MeshStandardMaterial({
      color: lightenHex(item.color, 0.15),
      roughness: 0.85,
      transparent: hasCollision,
      opacity,
    });
    const cushionCount = Math.max(2, Math.min(4, Math.round(item.width / 0.8)));
    const cushionWidth = (item.width * 0.92) / cushionCount;
    for (let i = 0; i < cushionCount; i += 1) {
      const cushion = mesh(
        THREE,
        new THREE.BoxGeometry(cushionWidth * 0.92, item.height * 0.18, item.depth * 0.65),
        cushionMat
      );
      cushion.position.set(
        (i + 0.5 - cushionCount / 2) * cushionWidth,
        item.height * 0.71,
        item.depth * 0.05
      );
      group.add(cushion);
    }

    // A throw pillow at each end on top of the seat for a cozy touch.
    const pillowColors: ReadonlyArray<number> = [0xf2d488, 0xeb9d6b, 0x9ec6c0];
    for (const dx of [-1, 1]) {
      const color = pillowColors[(dx + 1) / 2 % pillowColors.length]!;
      const pillowMat = new THREE.MeshStandardMaterial({
        color,
        roughness: 0.9,
        transparent: hasCollision,
        opacity,
      });
      const pillow = mesh(
        THREE,
        new THREE.BoxGeometry(item.width * 0.18, item.height * 0.22, item.depth * 0.18),
        pillowMat
      );
      pillow.position.set(dx * item.width * 0.32, item.height * 0.82, -item.depth * 0.22);
      pillow.rotation.z = dx * 0.18;
      group.add(pillow);
    }
  } else if (shape === 'L-shape') {
    const mainSeat = mesh(THREE, new THREE.BoxGeometry(item.width * 0.7, item.height * 0.5, item.depth * 0.8), sofaMat);
    mainSeat.position.set(-item.width * 0.15, item.height * 0.4, 0);
    group.add(mainSeat);

    const mainBack = mesh(THREE, new THREE.BoxGeometry(item.width * 0.7, item.height * 0.6, item.depth * 0.15), sofaMat);
    mainBack.position.set(-item.width * 0.15, item.height * 0.7, -item.depth * 0.4);
    group.add(mainBack);

    const sideSeat = mesh(THREE, new THREE.BoxGeometry(item.width * 0.4, item.height * 0.5, item.depth * 0.8), sofaMat);
    sideSeat.position.set(item.width * 0.3, item.height * 0.4, 0);
    group.add(sideSeat);

    const sideBack = mesh(THREE, new THREE.BoxGeometry(item.width * 0.15, item.height * 0.6, item.depth * 0.6), sofaMat);
    sideBack.position.set(item.width * 0.425, item.height * 0.7, -item.depth * 0.1);
    group.add(sideBack);

    const leftArm = mesh(THREE, new THREE.BoxGeometry(item.width * 0.1, item.height * 0.4, item.depth * 0.7), sofaMat);
    leftArm.position.set(-item.width * 0.45, item.height * 0.5, 0);
    group.add(leftArm);
  } else {
    const backSeat = mesh(THREE, new THREE.BoxGeometry(item.width * 0.6, item.height * 0.5, item.depth * 0.7), sofaMat);
    backSeat.position.set(0, item.height * 0.4, -item.depth * 0.15);
    group.add(backSeat);

    const mainBack = mesh(THREE, new THREE.BoxGeometry(item.width * 0.6, item.height * 0.6, item.depth * 0.15), sofaMat);
    mainBack.position.set(0, item.height * 0.7, -item.depth * 0.475);
    group.add(mainBack);

    const sideSeatGeo = new THREE.BoxGeometry(item.width * 0.25, item.height * 0.5, item.depth * 0.7);
    const sideBackGeo = new THREE.BoxGeometry(item.width * 0.15, item.height * 0.6, item.depth * 0.7);
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
      new THREE.BoxGeometry(item.width * 0.4, item.height * 0.3, item.depth * 0.4),
      sofaMat
    );
    cushion.position.set(0, item.height * 0.35, item.depth * 0.25);
    group.add(cushion);
  }

  return group;
}
