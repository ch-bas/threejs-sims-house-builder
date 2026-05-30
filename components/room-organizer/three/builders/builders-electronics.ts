import type * as ThreeNS from 'three';
import { type BuilderContext, mesh } from '../builder-utils';

export function buildTV({ THREE, item, hasCollision, baseColor, opacity }: BuilderContext): ThreeNS.Group {
  const group = new THREE.Group();

  const base = mesh(
    THREE,
    new THREE.BoxGeometry(item.width, item.height * 0.6, item.depth),
    new THREE.MeshStandardMaterial({ color: baseColor, roughness: 0.6, metalness: 0.2, transparent: hasCollision, opacity })
  );
  base.position.y = item.height * 0.3;
  group.add(base);

  const screen = mesh(
    THREE,
    new THREE.BoxGeometry(item.width * 0.7, item.height * 0.8, item.depth * 0.1),
    new THREE.MeshStandardMaterial({
      color: hasCollision ? 0xff0000 : 0x1a1a1a,
      roughness: 0.1,
      metalness: 0.8,
      transparent: hasCollision,
      opacity,
    })
  );
  screen.position.set(0, item.height * 0.9, -item.depth * 0.35);
  group.add(screen);

  const bezel = mesh(
    THREE,
    new THREE.BoxGeometry(item.width * 0.75, item.height * 0.85, item.depth * 0.08),
    new THREE.MeshStandardMaterial({ color: 0x333333, roughness: 0.5, metalness: 0.6, transparent: hasCollision, opacity })
  );
  bezel.position.set(0, item.height * 0.9, -item.depth * 0.36);
  group.add(bezel);

  return group;
}

export function buildComputer({ THREE, item, hasCollision, baseColor, opacity }: BuilderContext): ThreeNS.Group {
  const group = new THREE.Group();
  const bodyMat = new THREE.MeshStandardMaterial({ color: baseColor, roughness: 0.5, metalness: 0.4, transparent: hasCollision, opacity });
  const screenMat = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.1, metalness: 0.9, emissive: 0x0d47a1, emissiveIntensity: 0.4, transparent: hasCollision, opacity });

  const tower = mesh(THREE, new THREE.BoxGeometry(item.width * 0.4, item.height * 0.8, item.depth * 0.7), bodyMat);
  tower.position.set(-item.width * 0.25, item.height * 0.4, 0);
  group.add(tower);

  const monitor = mesh(THREE, new THREE.BoxGeometry(item.width * 0.85, item.height * 0.6, item.depth * 0.1), screenMat);
  monitor.position.set(item.width * 0.1, item.height * 0.85, item.depth * 0.1);
  group.add(monitor);

  const stand = mesh(THREE, new THREE.BoxGeometry(item.width * 0.15, item.height * 0.25, item.depth * 0.3), bodyMat);
  stand.position.set(item.width * 0.1, item.height * 0.45, item.depth * 0.1);
  group.add(stand);
  return group;
}

export function buildWiFi({ THREE, item, hasCollision, baseColor, opacity }: BuilderContext): ThreeNS.Group {
  const group = new THREE.Group();

  const body = mesh(
    THREE,
    new THREE.BoxGeometry(item.width, item.height, item.depth),
    new THREE.MeshStandardMaterial({ color: baseColor, roughness: 0.4, metalness: 0.3, transparent: hasCollision, opacity })
  );
  body.position.y = item.height / 2;
  group.add(body);

  const antennaMat = new THREE.MeshStandardMaterial({
    color: 0x333333,
    roughness: 0.5,
    metalness: 0.6,
    transparent: hasCollision,
    opacity,
  });
  const antennaGeo = new THREE.CylinderGeometry(0.01, 0.01, item.height * 3, 8);
  for (const dx of [-item.width * 0.3, item.width * 0.3]) {
    const antenna = mesh(THREE, antennaGeo, antennaMat);
    antenna.position.set(dx, item.height * 1.7, 0);
    antenna.rotation.z = dx < 0 ? -0.3 : 0.3;
    group.add(antenna);
  }

  const ledGeo = new THREE.SphereGeometry(0.015, 8, 8);
  const ledMat = new THREE.MeshStandardMaterial({
    color: 0x00ff00,
    emissive: 0x00ff00,
    emissiveIntensity: 0.8,
    transparent: hasCollision,
    opacity,
  });
  for (let i = 0; i < 3; i++) {
    const led = mesh(THREE, ledGeo, ledMat);
    led.position.set(-item.width * 0.2 + i * item.width * 0.2, item.height * 0.6, item.depth * 0.51);
    group.add(led);
  }

  return group;
}

export function buildRouter({ THREE, item, hasCollision, baseColor, opacity }: BuilderContext): ThreeNS.Group {
  const group = new THREE.Group();

  const body = mesh(
    THREE,
    new THREE.BoxGeometry(item.width, item.height, item.depth),
    new THREE.MeshStandardMaterial({ color: baseColor, roughness: 0.4, metalness: 0.2, transparent: hasCollision, opacity })
  );
  body.position.y = item.height / 2;
  group.add(body);

  const antennaMat = new THREE.MeshStandardMaterial({
    color: 0x1a1a1a,
    roughness: 0.6,
    metalness: 0.5,
    transparent: hasCollision,
    opacity,
  });
  const antennaGeo = new THREE.CylinderGeometry(0.008, 0.008, item.height * 4, 8);
  const antennaXs = [-item.width * 0.35, -item.width * 0.15, item.width * 0.15, item.width * 0.35];
  antennaXs.forEach((x, index) => {
    const antenna = mesh(THREE, antennaGeo, antennaMat);
    antenna.position.set(x, item.height * 2.2, 0);
    antenna.rotation.z = index % 2 === 0 ? -0.2 : 0.2;
    group.add(antenna);
  });

  const ledMat = new THREE.MeshStandardMaterial({
    color: 0x00ff00,
    emissive: 0x00ff00,
    emissiveIntensity: 0.6,
    transparent: hasCollision,
    opacity,
  });
  const ledGeo = new THREE.SphereGeometry(0.012, 8, 8);
  for (let i = 0; i < 5; i++) {
    const led = mesh(THREE, ledGeo, ledMat);
    led.position.set(-item.width * 0.3 + i * item.width * 0.15, item.height * 0.6, item.depth * 0.51);
    group.add(led);
  }

  const portMat = new THREE.MeshStandardMaterial({
    color: 0xffd700,
    roughness: 0.3,
    metalness: 0.7,
    transparent: hasCollision,
    opacity,
  });
  const portGeo = new THREE.BoxGeometry(0.02, 0.015, 0.01);
  for (let i = 0; i < 4; i++) {
    const port = mesh(THREE, portGeo, portMat);
    port.position.set(-item.width * 0.25 + i * item.width * 0.17, item.height * 0.5, -item.depth * 0.51);
    group.add(port);
  }

  return group;
}

export function buildCCTV({ THREE, item, hasCollision, baseColor, opacity }: BuilderContext): ThreeNS.Group {
  const group = new THREE.Group();

  const base = mesh(
    THREE,
    new THREE.CylinderGeometry(item.width * 0.3, item.width * 0.4, item.height * 0.2, 16),
    new THREE.MeshStandardMaterial({ color: baseColor, roughness: 0.5, metalness: 0.4, transparent: hasCollision, opacity })
  );
  base.position.y = item.height * 0.1;
  group.add(base);

  const body = mesh(
    THREE,
    new THREE.CylinderGeometry(item.width * 0.5, item.width * 0.5, item.height * 0.6, 16),
    new THREE.MeshStandardMaterial({ color: baseColor, roughness: 0.4, metalness: 0.5, transparent: hasCollision, opacity })
  );
  body.position.y = item.height * 0.55;
  body.rotation.z = Math.PI / 2;
  group.add(body);

  const lens = mesh(
    THREE,
    new THREE.CylinderGeometry(item.width * 0.3, item.width * 0.35, item.height * 0.15, 16),
    new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.1, metalness: 0.9, transparent: hasCollision, opacity })
  );
  lens.position.set(item.width * 0.3, item.height * 0.55, 0);
  lens.rotation.z = Math.PI / 2;
  group.add(lens);

  const led = mesh(
    THREE,
    new THREE.SphereGeometry(0.01, 8, 8),
    new THREE.MeshStandardMaterial({
      color: 0xff0000,
      emissive: 0xff0000,
      emissiveIntensity: 0.8,
      transparent: hasCollision,
      opacity,
    })
  );
  led.position.set(-item.width * 0.3, item.height * 0.65, 0);
  group.add(led);

  const irMat = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.8, transparent: hasCollision, opacity });
  const irGeo = new THREE.SphereGeometry(0.008, 8, 8);
  for (const offset of [-0.015, 0, 0.015]) {
    const ir = mesh(THREE, irGeo, irMat);
    ir.position.set(item.width * 0.35, item.height * 0.55, offset);
    group.add(ir);
  }

  return group;
}
