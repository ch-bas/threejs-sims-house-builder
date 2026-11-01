import { type BuilderContext, EDGE, mesh, lightenHex, softBox } from '../builder-utils';
import { surfaceMaterial } from '../furniture-materials';
import type * as ThreeNS from 'three';

export function buildBed(ctx: BuilderContext): ThreeNS.Group {
  const { THREE, item, baseColor } = ctx;
  const group = new THREE.Group();
  const woodMat = surfaceMaterial(ctx, 0x8b4513, 'woodOiled', { detailed: true });
  const sheetMat = surfaceMaterial(ctx, baseColor, 'fabric', { detailed: true });
  const pillowMat = surfaceMaterial(ctx, 0xfafafa, 'fabric', { detailed: true });
  const throwMat = surfaceMaterial(ctx, lightenHex(item.color, -0.18), 'fabric', { detailed: true });

  // Headboard at the head end (-z).
  const headboard = mesh(
    THREE,
    softBox(THREE, item.width, item.height * 0.85, item.depth * 0.08, EDGE.wood),
    woodMat
  );
  headboard.position.set(0, item.height * 0.425, -item.depth * 0.5);
  group.add(headboard);

  // Wooden bed frame.
  const frame = mesh(
    THREE,
    softBox(THREE, item.width, item.height * 0.3, item.depth, EDGE.wood),
    woodMat
  );
  frame.position.y = item.height * 0.15;
  group.add(frame);

  // Mattress with sheet colour.
  const mattress = mesh(
    THREE,
    softBox(THREE, item.width * 0.96, item.height * 0.32, item.depth * 0.96, EDGE.upholstery),
    sheetMat
  );
  mattress.position.y = item.height * 0.46;
  group.add(mattress);

  // Folded throw blanket across the foot of the bed (+z end).
  const blanket = mesh(
    THREE,
    softBox(THREE, item.width * 0.96, item.height * 0.10, item.depth * 0.30, EDGE.upholstery),
    throwMat
  );
  blanket.position.set(0, item.height * 0.66, item.depth * 0.30);
  group.add(blanket);

  // Two pillows at the headboard.
  const pillowGeo = softBox(THREE, item.width * 0.42, item.height * 0.16, item.depth * 0.24, EDGE.cushion, { puff: 0.35 });
  for (const dx of [-1, 1] as const) {
    const pillow = mesh(THREE, pillowGeo, pillowMat);
    pillow.position.set(dx * item.width * 0.22, item.height * 0.72, -item.depth * 0.32);
    pillow.rotation.z = dx * 0.04;
    group.add(pillow);
  }

  return group;
}

export function buildNightstand(ctx: BuilderContext): ThreeNS.Group {
  const { THREE, item, baseColor } = ctx;
  const group = new THREE.Group();
  const woodMat = surfaceMaterial(ctx, baseColor, 'woodOiled', { detailed: true });
  const drawerMat = surfaceMaterial(ctx, baseColor, 'woodLacquered', { detailed: true });

  const body = mesh(THREE, softBox(THREE, item.width, item.height, item.depth, EDGE.wood), woodMat);
  body.position.y = item.height / 2;
  group.add(body);

  const drawerGeo = softBox(THREE, item.width * 0.85, item.height * 0.35, item.depth * 0.02, EDGE.wood);
  for (const y of [item.height * 0.65, item.height * 0.25]) {
    const drawer = mesh(THREE, drawerGeo, drawerMat);
    drawer.position.set(0, y, item.depth * 0.51);
    group.add(drawer);
  }

  const handleGeo = new THREE.SphereGeometry(0.03, 8, 8);
  const handleMat = surfaceMaterial(ctx, 0x888888, 'brushedMetal');
  for (const y of [item.height * 0.65, item.height * 0.25]) {
    const handle = mesh(THREE, handleGeo, handleMat);
    handle.position.set(0, y, item.depth * 0.53);
    group.add(handle);
  }

  return group;
}

export function buildDresser(ctx: BuilderContext): ThreeNS.Group {
  const { THREE, item, baseColor } = ctx;
  const group = new THREE.Group();
  const mat = surfaceMaterial(ctx, baseColor, 'woodLacquered', { detailed: true });
  const accentMat = surfaceMaterial(ctx, 0x424242, 'brushedMetal');

  const body = mesh(THREE, softBox(THREE, item.width, item.height, item.depth, EDGE.wood), mat);
  body.position.y = item.height / 2;
  group.add(body);

  const drawerGeo = softBox(THREE, item.width * 0.9, item.height * 0.25, item.depth * 0.03, EDGE.wood);
  const handleGeo = softBox(THREE, item.width * 0.15, 0.03, 0.04, EDGE.wood);
  for (let i = 0; i < 3; i++) {
    const y = item.height * 0.18 + i * item.height * 0.3;
    const drawer = mesh(THREE, drawerGeo, mat);
    drawer.position.set(0, y, item.depth * 0.51);
    group.add(drawer);

    const handle = mesh(THREE, handleGeo, accentMat);
    handle.position.set(0, y, item.depth * 0.535);
    group.add(handle);
  }
  return group;
}
