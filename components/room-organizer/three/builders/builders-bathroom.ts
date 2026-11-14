import { type BuilderContext, EDGE, material, mergeParts, mesh, softBox } from '../builder-utils';
import { surfaceMaterial } from '../furniture-materials';
import { addBasinWater, addRectBasin } from './builders-outdoor';
import type * as ThreeNS from 'three';

export function buildToilet(ctx: BuilderContext): ThreeNS.Group {
  const { THREE, item, baseColor } = ctx;
  const group = new THREE.Group();
  const mat = surfaceMaterial(ctx, baseColor, 'ceramic');

  const bowl = mesh(THREE, new THREE.CylinderGeometry(item.width * 0.5, item.width * 0.5, item.height * 0.45, 16), mat);
  bowl.position.y = item.height * 0.225;
  group.add(bowl);

  const tank = mesh(THREE, new THREE.BoxGeometry(item.width, item.height * 0.45, item.depth * 0.3), mat);
  tank.position.set(0, item.height * 0.7, -item.depth * 0.35);
  group.add(tank);

  const seat = mesh(THREE, new THREE.CylinderGeometry(item.width * 0.55, item.width * 0.55, item.height * 0.07, 16), mat);
  seat.position.y = item.height * 0.5;
  group.add(seat);
  return group;
}

export function buildBathtub(ctx: BuilderContext): ThreeNS.Group {
  const { THREE, item, hasCollision, baseColor } = ctx;
  const group = new THREE.Group();
  const mat = surfaceMaterial(ctx, baseColor, 'ceramic');
  const linerMat = surfaceMaterial(ctx, 0xeceff1, 'ceramic');
  const waterMat = new THREE.MeshStandardMaterial({
    color: hasCollision ? 0xff0000 : 0x4fc3f7,
    roughness: 0.2,
    transparent: true,
    opacity: 0.55,
  });

  // Hollow tub, filled to three quarters, so the water shows (#365).
  const rim = Math.min(0.08, item.width * 0.1, item.depth * 0.1);
  const floorThickness = item.height * 0.12;
  const { innerWidth, innerDepth } = addRectBasin(THREE, group, item, rim, floorThickness, mat, linerMat);
  addBasinWater(
    THREE,
    group,
    (h) => new THREE.BoxGeometry(innerWidth, h, innerDepth),
    waterMat,
    floorThickness,
    item.height * 0.75
  );
  return group;
}

export function buildShower({ THREE, item, hasCollision, baseColor, opacity }: BuilderContext): ThreeNS.Group {
  const group = new THREE.Group();
  const glassMat = new THREE.MeshStandardMaterial({ color: baseColor, roughness: 0.1, metalness: 0, transparent: true, opacity: hasCollision ? 0.7 : 0.35 });
  const trayMat = material(THREE, 0xeceff1, hasCollision, opacity, { roughness: 0.5 });
  const headMat = material(THREE, 0xb0bec5, hasCollision, opacity, { metalness: 1, roughness: 0.2 });

  const tray = mesh(THREE, new THREE.BoxGeometry(item.width, item.height * 0.05, item.depth), trayMat);
  tray.position.y = item.height * 0.025;
  group.add(tray);

  const cube = mesh(THREE, new THREE.BoxGeometry(item.width, item.height * 0.95, item.depth), glassMat);
  cube.position.y = item.height * 0.525;
  // Glass: the shadow pass ignores opacity, so the enclosure threw a solid
  // 2 m block of shade (#551). The tray and the shower head still cast.
  cube.castShadow = false;
  group.add(cube);

  const head = mesh(THREE, new THREE.CylinderGeometry(item.width * 0.12, item.width * 0.12, 0.05, 16), headMat);
  head.position.set(0, item.height * 0.93, -item.depth * 0.4);
  group.add(head);
  return group;
}

/** How far a washing machine's door stands proud of its front. */
const WASHER_DOOR_DEPTH = 0.03;

/**
 * A front-loading washing machine (#621): the cabinet in the item's colour,
 * a round door with a dark porthole, and a control strip along the top, the
 * door inside the item's depth.
 */
export function buildWasher(ctx: BuilderContext): ThreeNS.Group {
  const { THREE, item, baseColor } = ctx;
  const group = new THREE.Group();
  const bodyDepth = item.depth - WASHER_DOOR_DEPTH;
  group.add(
    mesh(THREE, softBox(THREE, item.width, item.height, bodyDepth, EDGE.wood).translate(0, item.height / 2, -WASHER_DOOR_DEPTH / 2), surfaceMaterial(ctx, baseColor, 'painted'))
  );

  const front = item.depth / 2 - WASHER_DOOR_DEPTH;
  const doorRadius = Math.min(item.width, item.height * 0.8) * 0.36;
  const doorY = item.height * 0.45;
  const rim = new THREE.CylinderGeometry(doorRadius, doorRadius, WASHER_DOOR_DEPTH * 0.6, 32)
    .rotateX(Math.PI / 2)
    .translate(0, doorY, front + WASHER_DOOR_DEPTH * 0.3);
  group.add(mesh(THREE, rim, surfaceMaterial(ctx, 0xb0bec5, 'brushedMetal')));

  const glass = new THREE.CylinderGeometry(doorRadius * 0.72, doorRadius * 0.72, WASHER_DOOR_DEPTH * 0.4, 32)
    .rotateX(Math.PI / 2)
    .translate(0, doorY, front + WASHER_DOOR_DEPTH * 0.8);
  const strip = softBox(THREE, item.width * 0.9, item.height * 0.08, 0.01, 0.003).translate(0, item.height * 0.9, front + 0.005);
  group.add(mesh(THREE, mergeParts(THREE, [glass, strip]), surfaceMaterial(ctx, 0x263238, 'plastic')));
  return group;
}
