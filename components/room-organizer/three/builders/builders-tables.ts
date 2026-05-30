import type * as ThreeNS from 'three';
import { type BuilderContext, mesh, cornerPositions } from '../builder-utils';

export function buildTableOrDesk({ THREE, item, hasCollision, baseColor, opacity }: BuilderContext): ThreeNS.Group {
  const group = new THREE.Group();
  const woodMat = new THREE.MeshStandardMaterial({
    color: baseColor,
    roughness: 0.6,
    metalness: 0.1,
    transparent: hasCollision,
    opacity,
  });

  const top = mesh(THREE, new THREE.BoxGeometry(item.width, item.height * 0.1, item.depth), woodMat);
  top.position.y = item.height * 0.95;
  group.add(top);

  const legGeo = new THREE.BoxGeometry(item.width * 0.08, item.height * 0.9, item.depth * 0.08);
  for (const [x, y, z] of cornerPositions(item.width * 0.4, item.height * 0.45, item.depth * 0.4)) {
    const leg = mesh(THREE, legGeo, woodMat);
    leg.position.set(x, y, z);
    group.add(leg);
  }

  if (item.type === 'desk') {
    const drawer = mesh(
      THREE,
      new THREE.BoxGeometry(item.width * 0.4, item.height * 0.15, item.depth * 0.8),
      woodMat
    );
    drawer.position.set(item.width * 0.25, item.height * 0.7, 0);
    group.add(drawer);

    const handle = mesh(
      THREE,
      new THREE.CylinderGeometry(0.02, 0.02, item.width * 0.1, 8),
      new THREE.MeshStandardMaterial({
        color: 0x444444,
        metalness: 0.8,
        roughness: 0.2,
        transparent: hasCollision,
        opacity,
      })
    );
    handle.position.set(item.width * 0.25, item.height * 0.7, item.depth * 0.42);
    handle.rotation.z = Math.PI / 2;
    group.add(handle);
  }

  return group;
}
