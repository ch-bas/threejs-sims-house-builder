import { type BuilderContext, material, mesh } from '../builder-utils';
import type * as ThreeNS from 'three';

export function buildToilet({ THREE, item, hasCollision, baseColor, opacity }: BuilderContext): ThreeNS.Group {
  const group = new THREE.Group();
  const mat = material(THREE, baseColor, hasCollision, opacity, { roughness: 0.3 });

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

export function buildBathtub({ THREE, item, hasCollision, baseColor, opacity }: BuilderContext): ThreeNS.Group {
  const group = new THREE.Group();
  const mat = material(THREE, baseColor, hasCollision, opacity, { roughness: 0.25, metalness: 0.05 });
  const waterMat = new THREE.MeshStandardMaterial({
    color: 0x4fc3f7,
    roughness: 0.2,
    transparent: true,
    opacity: 0.55,
  });

  const outer = mesh(THREE, new THREE.BoxGeometry(item.width, item.height, item.depth), mat);
  outer.position.y = item.height / 2;
  group.add(outer);

  const inner = mesh(
    THREE,
    new THREE.BoxGeometry(item.width * 0.88, item.height * 0.7, item.depth * 0.8),
    material(THREE, 0xeceff1, hasCollision, opacity, { roughness: 0.4 })
  );
  inner.position.y = item.height * 0.7;
  group.add(inner);

  const water = mesh(THREE, new THREE.BoxGeometry(item.width * 0.85, 0.04, item.depth * 0.78), waterMat);
  water.position.y = item.height * 0.95;
  group.add(water);
  return group;
}

export function buildShower({ THREE, item, hasCollision, baseColor, opacity }: BuilderContext): ThreeNS.Group {
  const group = new THREE.Group();
  const glassMat = new THREE.MeshStandardMaterial({ color: baseColor, roughness: 0.1, metalness: 0.1, transparent: true, opacity: hasCollision ? 0.7 : 0.35 });
  const trayMat = material(THREE, 0xeceff1, hasCollision, opacity, { roughness: 0.5 });
  const headMat = material(THREE, 0xb0bec5, hasCollision, opacity, { metalness: 0.9, roughness: 0.2 });

  const tray = mesh(THREE, new THREE.BoxGeometry(item.width, item.height * 0.05, item.depth), trayMat);
  tray.position.y = item.height * 0.025;
  group.add(tray);

  const cube = mesh(THREE, new THREE.BoxGeometry(item.width, item.height * 0.95, item.depth), glassMat);
  cube.position.y = item.height * 0.525;
  group.add(cube);

  const head = mesh(THREE, new THREE.CylinderGeometry(item.width * 0.12, item.width * 0.12, 0.05, 16), headMat);
  head.position.set(0, item.height * 0.93, -item.depth * 0.4);
  group.add(head);
  return group;
}
