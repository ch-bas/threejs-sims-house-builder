import type * as ThreeNS from 'three';
import { type BuilderContext, mesh } from '../builder-utils';

export function buildLamp({ THREE, item, hasCollision, baseColor, opacity }: BuilderContext): ThreeNS.Group {
  const group = new THREE.Group();

  const base = mesh(
    THREE,
    new THREE.CylinderGeometry(item.width * 0.8, item.width, item.height * 0.1, 16),
    new THREE.MeshStandardMaterial({
      color: 0x444444,
      roughness: 0.5,
      metalness: 0.6,
      transparent: hasCollision,
      opacity,
    })
  );
  base.position.y = item.height * 0.05;
  group.add(base);

  const stand = mesh(
    THREE,
    new THREE.CylinderGeometry(item.width * 0.1, item.width * 0.1, item.height * 0.7, 12),
    new THREE.MeshStandardMaterial({
      color: baseColor,
      roughness: 0.6,
      metalness: 0.4,
      transparent: hasCollision,
      opacity,
    })
  );
  stand.position.y = item.height * 0.45;
  group.add(stand);

  const shade = mesh(
    THREE,
    new THREE.ConeGeometry(item.width * 1.2, item.height * 0.3, 16, 1, true),
    new THREE.MeshStandardMaterial({
      color: hasCollision ? 0xff0000 : 0xfff8dc,
      roughness: 0.9,
      transparent: true,
      opacity: hasCollision ? 0.7 : 0.8,
      emissive: 0xffff88,
      emissiveIntensity: 0.3,
    })
  );
  shade.position.y = item.height * 0.9;
  group.add(shade);

  return group;
}

export function buildPendantLight({ THREE, item, hasCollision, baseColor, opacity }: BuilderContext): ThreeNS.Group {
  const group = new THREE.Group();
  const cordMat = new THREE.MeshStandardMaterial({
    color: 0x222222,
    roughness: 0.8,
    transparent: hasCollision,
    opacity,
  });
  const shadeMat = new THREE.MeshStandardMaterial({
    color: baseColor,
    roughness: 0.6,
    metalness: 0.3,
    emissive: baseColor,
    emissiveIntensity: 0.25,
    transparent: hasCollision,
    opacity,
  });
  const bulbMat = new THREE.MeshStandardMaterial({
    color: 0xfff8c0,
    roughness: 0.1,
    emissive: 0xfff066,
    emissiveIntensity: 0.6,
    transparent: hasCollision,
    opacity,
  });

  // Ceiling rosette / canopy.
  const canopy = mesh(
    THREE,
    new THREE.CylinderGeometry(item.width * 0.18, item.width * 0.16, 0.04, 12),
    shadeMat
  );
  canopy.position.y = item.height - 0.02;
  group.add(canopy);

  // Cord hanging down — most of the item height.
  const cordLength = item.height * 0.55;
  const cord = mesh(
    THREE,
    new THREE.CylinderGeometry(0.012, 0.012, cordLength, 8),
    cordMat
  );
  cord.position.y = item.height - 0.04 - cordLength / 2;
  group.add(cord);

  // Bowl-shaped shade — open cone (using a cylinder with tapered radii).
  const shade = mesh(
    THREE,
    new THREE.CylinderGeometry(item.width * 0.4, item.width * 0.55, item.height * 0.18, 16, 1, true),
    shadeMat
  );
  shade.position.y = item.height * 0.32;
  group.add(shade);

  // A glowing bulb visible just inside the shade.
  const bulb = mesh(THREE, new THREE.SphereGeometry(item.width * 0.18, 12, 10), bulbMat);
  bulb.position.y = item.height * 0.35;
  group.add(bulb);

  return group;
}

export function buildLamppost({ THREE, item, hasCollision, baseColor, opacity }: BuilderContext): ThreeNS.Group {
  const group = new THREE.Group();
  const metalMat = new THREE.MeshStandardMaterial({ color: baseColor, roughness: 0.4, metalness: 0.6, transparent: hasCollision, opacity });
  const glassMat = new THREE.MeshStandardMaterial({
    color: 0xfff59d,
    roughness: 0.1,
    metalness: 0.0,
    emissive: 0xfff176,
    emissiveIntensity: 0.4,
    transparent: hasCollision,
    opacity,
  });

  const base = mesh(THREE, new THREE.CylinderGeometry(item.width * 0.4, item.width * 0.5, item.height * 0.05, 12), metalMat);
  base.position.y = item.height * 0.025;
  group.add(base);
  const post = mesh(THREE, new THREE.CylinderGeometry(item.width * 0.08, item.width * 0.10, item.height * 0.85, 10), metalMat);
  post.position.y = item.height * 0.475;
  group.add(post);
  const cap = mesh(THREE, new THREE.SphereGeometry(item.width * 0.32, 14, 12), glassMat);
  cap.position.y = item.height * 0.93;
  group.add(cap);
  const hat = mesh(THREE, new THREE.ConeGeometry(item.width * 0.36, item.height * 0.08, 12), metalMat);
  hat.position.y = item.height * 1.0;
  group.add(hat);
  return group;
}
