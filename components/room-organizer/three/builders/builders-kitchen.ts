import type * as ThreeNS from 'three';
import { type BuilderContext, mesh } from '../builder-utils';

export function buildFridge({ THREE, item, hasCollision, baseColor, opacity }: BuilderContext): ThreeNS.Group {
  const group = new THREE.Group();
  const bodyMat = new THREE.MeshStandardMaterial({ color: baseColor, roughness: 0.35, metalness: 0.6, transparent: hasCollision, opacity });
  const accentMat = new THREE.MeshStandardMaterial({ color: 0x424242, metalness: 0.8, roughness: 0.3, transparent: hasCollision, opacity });

  const body = mesh(THREE, new THREE.BoxGeometry(item.width, item.height, item.depth), bodyMat);
  body.position.y = item.height / 2;
  group.add(body);

  // Freezer/fridge split
  const splitGap = mesh(THREE, new THREE.BoxGeometry(item.width * 0.95, 0.03, item.depth * 0.05), accentMat);
  splitGap.position.set(0, item.height * 0.55, item.depth * 0.51);
  group.add(splitGap);

  const handleGeo = new THREE.CylinderGeometry(0.015, 0.015, item.height * 0.35, 8);
  for (const y of [item.height * 0.78, item.height * 0.28]) {
    const handle = mesh(THREE, handleGeo, accentMat);
    handle.position.set(item.width * 0.42, y, item.depth * 0.55);
    group.add(handle);
  }
  return group;
}

export function buildStove({ THREE, item, hasCollision, baseColor, opacity }: BuilderContext): ThreeNS.Group {
  const group = new THREE.Group();
  const bodyMat = new THREE.MeshStandardMaterial({ color: baseColor, roughness: 0.5, metalness: 0.5, transparent: hasCollision, opacity });
  const burnerMat = new THREE.MeshStandardMaterial({ color: 0x212121, roughness: 0.3, metalness: 0.7, transparent: hasCollision, opacity });
  const doorMat = new THREE.MeshStandardMaterial({ color: 0x616161, roughness: 0.2, metalness: 0.8, transparent: hasCollision, opacity });

  const body = mesh(THREE, new THREE.BoxGeometry(item.width, item.height, item.depth), bodyMat);
  body.position.y = item.height / 2;
  group.add(body);

  // burner tops
  const burnerGeo = new THREE.CylinderGeometry(item.width * 0.18, item.width * 0.18, 0.02, 16);
  for (const [dx, dz] of [[-0.25, -0.25], [0.25, -0.25], [-0.25, 0.25], [0.25, 0.25]] as const) {
    const burner = mesh(THREE, burnerGeo, burnerMat);
    burner.position.set(dx * item.width, item.height * 1.005, dz * item.depth);
    group.add(burner);
  }

  // oven door window
  const window = mesh(
    THREE,
    new THREE.BoxGeometry(item.width * 0.75, item.height * 0.45, item.depth * 0.04),
    doorMat
  );
  window.position.set(0, item.height * 0.3, item.depth * 0.52);
  group.add(window);
  return group;
}

export function buildSink({ THREE, item, hasCollision, baseColor, opacity }: BuilderContext): ThreeNS.Group {
  const group = new THREE.Group();
  const baseMat = new THREE.MeshStandardMaterial({ color: baseColor, roughness: 0.5, transparent: hasCollision, opacity });
  const metalMat = new THREE.MeshStandardMaterial({ color: 0xb0bec5, metalness: 0.9, roughness: 0.15, transparent: hasCollision, opacity });

  const counter = mesh(THREE, new THREE.BoxGeometry(item.width, item.height * 0.95, item.depth), baseMat);
  counter.position.y = item.height * 0.475;
  group.add(counter);

  // basin
  const basin = mesh(
    THREE,
    new THREE.BoxGeometry(item.width * 0.7, item.height * 0.1, item.depth * 0.65),
    new THREE.MeshStandardMaterial({ color: 0x212121, roughness: 0.4, transparent: hasCollision, opacity })
  );
  basin.position.set(0, item.height * 0.99, 0);
  group.add(basin);

  // tap
  const tapBase = mesh(THREE, new THREE.CylinderGeometry(0.03, 0.04, 0.18, 12), metalMat);
  tapBase.position.set(0, item.height * 1.05, -item.depth * 0.35);
  group.add(tapBase);

  const spout = mesh(THREE, new THREE.CylinderGeometry(0.02, 0.02, item.depth * 0.4, 12), metalMat);
  spout.rotation.x = Math.PI / 2;
  spout.position.set(0, item.height * 1.15, -item.depth * 0.15);
  group.add(spout);
  return group;
}

export function buildCounter({ THREE, item, hasCollision, baseColor, opacity }: BuilderContext): ThreeNS.Group {
  const group = new THREE.Group();
  const baseMat = new THREE.MeshStandardMaterial({ color: 0xf5f5f5, roughness: 0.7, transparent: hasCollision, opacity });
  const topMat = new THREE.MeshStandardMaterial({ color: baseColor, roughness: 0.4, metalness: 0.1, transparent: hasCollision, opacity });

  const base = mesh(THREE, new THREE.BoxGeometry(item.width, item.height * 0.92, item.depth), baseMat);
  base.position.y = item.height * 0.46;
  group.add(base);

  const top = mesh(THREE, new THREE.BoxGeometry(item.width * 1.02, item.height * 0.05, item.depth * 1.02), topMat);
  top.position.y = item.height * 0.945;
  group.add(top);
  return group;
}
