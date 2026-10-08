import { mountBand, PENDANT_SHADE_FRACTION, pendantBulbY } from '../../lib/mount-band';
import { FLOOR_HEIGHT_METERS } from '../../lib/types';
import { type BuilderContext, material, mesh } from '../builder-utils';
import type * as ThreeNS from 'three';

export function buildLamp({ THREE, item, hasCollision, baseColor, opacity }: BuilderContext): ThreeNS.Group {
  const group = new THREE.Group();

  const base = mesh(
    THREE,
    new THREE.CylinderGeometry(item.width * 0.35, item.width * 0.42, item.height * 0.1, 16),
    material(THREE, 0x444444, hasCollision, opacity, { roughness: 0.5, metalness: 0.6 })
  );
  base.position.y = item.height * 0.05;
  group.add(base);

  const stand = mesh(
    THREE,
    new THREE.CylinderGeometry(item.width * 0.1, item.width * 0.1, item.height * 0.7, 12),
    material(THREE, baseColor, hasCollision, opacity, { roughness: 0.6, metalness: 0.4 })
  );
  stand.position.y = item.height * 0.45;
  group.add(stand);

  // A drum shade within the item's footprint and height (#388). It is open
  // top and bottom, so both faces render: from below, at walkthrough eye
  // height, the inside of the shade is what you see.
  const shadeHeight = item.height * 0.3;
  const shade = mesh(
    THREE,
    new THREE.CylinderGeometry(item.width * 0.3, item.width * 0.5, shadeHeight, 16, 1, true),
    new THREE.MeshStandardMaterial({
      color: hasCollision ? 0xff0000 : 0xfff8dc,
      roughness: 0.9,
      transparent: true,
      opacity: hasCollision ? 0.7 : 0.8,
      emissive: 0xffff88,
      emissiveIntensity: 0.3,
      side: THREE.DoubleSide,
    })
  );
  shade.position.y = item.height - shadeHeight / 2;
  group.add(shade);

  return group;
}

const PENDANT_CANOPY_GAP = 0.005;

/**
 * A pendant hangs from the ceiling of its storey (#470): `storeyHeight`
 * (classic 3 m when the caller doesn't know it) minus its drop, the band
 * `mountBand` reports for collision, the walker and the selection outline.
 */
export function buildPendantLight({ THREE, item, hasCollision, baseColor, opacity, storeyHeight }: BuilderContext): ThreeNS.Group {
  const group = new THREE.Group();
  const cordMat = material(THREE, 0x222222, hasCollision, opacity, { roughness: 0.8 });
  const shadeMat = material(THREE, baseColor, hasCollision, opacity, {
    roughness: 0.6,
    metalness: 0.3,
    emissive: baseColor,
    emissiveIntensity: 0.25,
    side: THREE.DoubleSide,
  });
  const bulbMat = material(THREE, 0xfff8c0, hasCollision, opacity, { roughness: 0.1, emissive: 0xfff066, emissiveIntensity: 0.6 });

  const ceiling = storeyHeight ?? FLOOR_HEIGHT_METERS;
  const band = mountBand(item, ceiling);
  const drop = band.top - band.bottom;
  // Modelled from the shade's rim at y=0 up to the ceiling at y=drop.
  const hung = new THREE.Group();
  hung.position.y = band.bottom;
  group.add(hung);

  // Ceiling rosette / canopy, a hair under the ceiling so its top isn't
  // coplanar with the slab of the storey above.
  const canopyGap = Math.min(PENDANT_CANOPY_GAP, drop * 0.05);
  const canopyHeight = Math.min(0.04, drop * 0.1);
  const canopy = mesh(
    THREE,
    new THREE.CylinderGeometry(item.width * 0.18, item.width * 0.16, canopyHeight, 12),
    shadeMat
  );
  canopy.position.y = drop - canopyGap - canopyHeight / 2;
  hung.add(canopy);

  // Bowl-shaped shade at the bottom of the drop — open, so both faces render.
  const shadeHeight = drop * PENDANT_SHADE_FRACTION;
  const shade = mesh(
    THREE,
    new THREE.CylinderGeometry(item.width * 0.36, item.width * 0.5, shadeHeight, 16, 1, true),
    shadeMat
  );
  shade.position.y = shadeHeight / 2;
  hung.add(shade);

  // Cord from the canopy down to the shade.
  const cordLength = Math.max(0, drop - canopyGap - canopyHeight - shadeHeight);
  if (cordLength > 0) {
    const cord = mesh(THREE, new THREE.CylinderGeometry(0.012, 0.012, cordLength, 8), cordMat);
    cord.position.y = shadeHeight + cordLength / 2;
    hung.add(cord);
  }

  // A glowing bulb just inside the shade.
  const bulb = mesh(THREE, new THREE.SphereGeometry(Math.min(item.width * 0.18, shadeHeight * 0.45), 12, 10), bulbMat);
  bulb.position.y = pendantBulbY(item, ceiling) - band.bottom;
  hung.add(bulb);

  return group;
}

export function buildLamppost({ THREE, item, hasCollision, baseColor, opacity }: BuilderContext): ThreeNS.Group {
  const group = new THREE.Group();
  const metalMat = material(THREE, baseColor, hasCollision, opacity, { roughness: 0.4, metalness: 0.6 });
  const glassMat = material(THREE, 0xfff59d, hasCollision, opacity, { roughness: 0.1, metalness: 0.0, emissive: 0xfff176, emissiveIntensity: 0.4 });

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
