import type * as ThreeNS from 'three';
import { type BuilderContext, mesh, lightenHex } from '../builder-utils';

export function buildBed({ THREE, item, hasCollision, baseColor, opacity }: BuilderContext): ThreeNS.Group {
  const group = new THREE.Group();
  const woodMat = new THREE.MeshStandardMaterial({ color: 0x8b4513, roughness: 0.8, transparent: hasCollision, opacity });
  const sheetMat = new THREE.MeshStandardMaterial({ color: baseColor, roughness: 0.9, transparent: hasCollision, opacity });
  const pillowMat = new THREE.MeshStandardMaterial({ color: 0xfafafa, roughness: 0.95, transparent: hasCollision, opacity });
  const throwMat = new THREE.MeshStandardMaterial({
    color: lightenHex(item.color, -0.18),
    roughness: 0.95,
    transparent: hasCollision,
    opacity,
  });

  // Headboard at the head end (-z).
  const headboard = mesh(
    THREE,
    new THREE.BoxGeometry(item.width, item.height * 0.85, item.depth * 0.08),
    woodMat
  );
  headboard.position.set(0, item.height * 0.425, -item.depth * 0.5);
  group.add(headboard);

  // Wooden bed frame.
  const frame = mesh(
    THREE,
    new THREE.BoxGeometry(item.width, item.height * 0.3, item.depth),
    woodMat
  );
  frame.position.y = item.height * 0.15;
  group.add(frame);

  // Mattress with sheet colour.
  const mattress = mesh(
    THREE,
    new THREE.BoxGeometry(item.width * 0.96, item.height * 0.32, item.depth * 0.96),
    sheetMat
  );
  mattress.position.y = item.height * 0.46;
  group.add(mattress);

  // Folded throw blanket across the foot of the bed (+z end).
  const blanket = mesh(
    THREE,
    new THREE.BoxGeometry(item.width * 0.96, item.height * 0.10, item.depth * 0.30),
    throwMat
  );
  blanket.position.set(0, item.height * 0.66, item.depth * 0.30);
  group.add(blanket);

  // Two pillows at the headboard.
  const pillowGeo = new THREE.BoxGeometry(item.width * 0.42, item.height * 0.16, item.depth * 0.24);
  for (const dx of [-1, 1] as const) {
    const pillow = mesh(THREE, pillowGeo, pillowMat);
    pillow.position.set(dx * item.width * 0.22, item.height * 0.72, -item.depth * 0.32);
    pillow.rotation.z = dx * 0.04;
    group.add(pillow);
  }

  return group;
}

export function buildNightstand({ THREE, item, hasCollision, baseColor, opacity }: BuilderContext): ThreeNS.Group {
  const group = new THREE.Group();
  const woodMat = new THREE.MeshStandardMaterial({ color: baseColor, roughness: 0.7, transparent: hasCollision, opacity });
  const drawerMat = new THREE.MeshStandardMaterial({ color: baseColor, roughness: 0.6, transparent: hasCollision, opacity });

  const body = mesh(THREE, new THREE.BoxGeometry(item.width, item.height, item.depth), woodMat);
  body.position.y = item.height / 2;
  group.add(body);

  const drawerGeo = new THREE.BoxGeometry(item.width * 0.85, item.height * 0.35, item.depth * 0.02);
  for (const y of [item.height * 0.65, item.height * 0.25]) {
    const drawer = mesh(THREE, drawerGeo, drawerMat);
    drawer.position.set(0, y, item.depth * 0.51);
    group.add(drawer);
  }

  const handleGeo = new THREE.SphereGeometry(0.03, 8, 8);
  const handleMat = new THREE.MeshStandardMaterial({
    color: 0x888888,
    metalness: 0.8,
    roughness: 0.2,
    transparent: hasCollision,
    opacity,
  });
  for (const y of [item.height * 0.65, item.height * 0.25]) {
    const handle = mesh(THREE, handleGeo, handleMat);
    handle.position.set(0, y, item.depth * 0.53);
    group.add(handle);
  }

  return group;
}

export function buildDresser({ THREE, item, hasCollision, baseColor, opacity }: BuilderContext): ThreeNS.Group {
  const group = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: baseColor, roughness: 0.7, transparent: hasCollision, opacity });
  const accentMat = new THREE.MeshStandardMaterial({ color: 0x424242, metalness: 0.6, roughness: 0.3, transparent: hasCollision, opacity });

  const body = mesh(THREE, new THREE.BoxGeometry(item.width, item.height, item.depth), mat);
  body.position.y = item.height / 2;
  group.add(body);

  const drawerGeo = new THREE.BoxGeometry(item.width * 0.9, item.height * 0.25, item.depth * 0.03);
  const handleGeo = new THREE.BoxGeometry(item.width * 0.15, 0.03, 0.04);
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
