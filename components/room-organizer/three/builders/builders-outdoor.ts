import { type BuilderContext, material, mesh } from '../builder-utils';
import type * as ThreeNS from 'three';

export function buildFence({ THREE, item, hasCollision, baseColor, opacity }: BuilderContext): ThreeNS.Group {
  const group = new THREE.Group();
  const mat = material(THREE, baseColor, hasCollision, opacity, { roughness: 0.9 });

  const railTop = mesh(THREE, new THREE.BoxGeometry(item.width, 0.05, item.depth * 0.4), mat);
  railTop.position.y = item.height * 0.85;
  group.add(railTop);

  const railBottom = mesh(THREE, new THREE.BoxGeometry(item.width, 0.05, item.depth * 0.4), mat);
  railBottom.position.y = item.height * 0.2;
  group.add(railBottom);

  const slatCount = Math.max(4, Math.round(item.width / 0.18));
  const slatGeo = new THREE.BoxGeometry(item.width / slatCount * 0.6, item.height * 0.9, item.depth * 0.3);
  for (let i = 0; i < slatCount; i++) {
    const slat = mesh(THREE, slatGeo, mat);
    slat.position.set(-item.width / 2 + (i + 0.5) * (item.width / slatCount), item.height * 0.5, 0);
    group.add(slat);
  }
  return group;
}

/** Water stands this far below a basin's rim. */
const WATER_BELOW_RIM = 0.01;

/**
 * A hollow rectangular basin — four rim walls round a floor slab — so the
 * water inside is visible from above (#365: a solid box hid it).
 * Returns the inner width and depth.
 */
export function addRectBasin(
  THREE: BuilderContext['THREE'],
  group: ThreeNS.Group,
  item: BuilderContext['item'],
  rim: number,
  floorThickness: number,
  rimMat: ThreeNS.Material,
  floorMat: ThreeNS.Material
): { innerWidth: number; innerDepth: number } {
  const { width, depth, height } = item;
  const innerWidth = Math.max(0, width - rim * 2);
  const innerDepth = Math.max(0, depth - rim * 2);
  const longGeo = new THREE.BoxGeometry(width, height, rim);
  for (const sign of [-1, 1]) {
    const wall = mesh(THREE, longGeo, rimMat);
    wall.position.set(0, height / 2, sign * (depth / 2 - rim / 2));
    group.add(wall);
  }
  const shortGeo = new THREE.BoxGeometry(rim, height, innerDepth);
  for (const sign of [-1, 1]) {
    const wall = mesh(THREE, shortGeo, rimMat);
    wall.position.set(sign * (width / 2 - rim / 2), height / 2, 0);
    group.add(wall);
  }
  const floor = mesh(THREE, new THREE.BoxGeometry(innerWidth, floorThickness, innerDepth), floorMat);
  floor.position.y = floorThickness / 2;
  group.add(floor);
  return { innerWidth, innerDepth };
}

/** Water filling a basin from `floorTop` to just under the rim; null when there's no room. */
export function addBasinWater(
  THREE: BuilderContext['THREE'],
  group: ThreeNS.Group,
  geometryAt: (waterHeight: number) => ThreeNS.BufferGeometry,
  waterMat: ThreeNS.Material,
  floorTop: number,
  rimTop: number
): ThreeNS.Mesh | null {
  const waterHeight = rimTop - WATER_BELOW_RIM - floorTop;
  if (waterHeight <= 0) return null;
  const water = mesh(THREE, geometryAt(waterHeight), waterMat);
  water.position.y = floorTop + waterHeight / 2;
  water.castShadow = false;
  group.add(water);
  return water;
}

export function buildPool({ THREE, item, hasCollision, baseColor, opacity }: BuilderContext): ThreeNS.Group {
  const group = new THREE.Group();
  const tileMat = material(THREE, 0xeceff1, hasCollision, opacity, { roughness: 0.7 });
  const waterMat = new THREE.MeshStandardMaterial({
    color: baseColor,
    roughness: 0.15,
    metalness: 0.05,
    transparent: true,
    opacity: 0.7,
  });

  // Coping round the edge; the item colour is the water inside it.
  const rim = Math.min(0.25, item.width * 0.08, item.depth * 0.08);
  const floorThickness = item.height * 0.15;
  const { innerWidth, innerDepth } = addRectBasin(THREE, group, item, rim, floorThickness, tileMat, tileMat);
  addBasinWater(
    THREE,
    group,
    (h) => new THREE.BoxGeometry(innerWidth, h, innerDepth),
    waterMat,
    floorThickness,
    item.height
  );
  return group;
}

export function buildBbq({ THREE, item, hasCollision, baseColor, opacity }: BuilderContext): ThreeNS.Group {
  const group = new THREE.Group();
  const bodyMat = material(THREE, baseColor, hasCollision, opacity, { roughness: 0.5, metalness: 0.5 });
  const handleMat = material(THREE, 0x212121, hasCollision, opacity, { roughness: 0.6 });

  // Base on wheels
  const cart = mesh(
    THREE,
    new THREE.BoxGeometry(item.width, item.height * 0.35, item.depth),
    bodyMat
  );
  cart.position.y = item.height * 0.35;
  group.add(cart);
  // Dome lid
  const lid = mesh(
    THREE,
    new THREE.SphereGeometry(item.width * 0.55, 12, 10, 0, Math.PI * 2, 0, Math.PI / 2),
    bodyMat
  );
  lid.position.y = item.height * 0.5;
  group.add(lid);
  // Handle
  const handle = mesh(
    THREE,
    new THREE.CylinderGeometry(0.04, 0.04, item.width * 0.3, 8),
    handleMat
  );
  handle.rotation.z = Math.PI / 2;
  handle.position.set(0, item.height * 0.95, item.depth * 0.45);
  group.add(handle);
  // Chimney
  const chimney = mesh(
    THREE,
    new THREE.CylinderGeometry(0.05, 0.05, item.height * 0.2, 8),
    bodyMat
  );
  chimney.position.set(0, item.height * 1.05, 0);
  group.add(chimney);
  return group;
}

export function buildMailbox({ THREE, item, hasCollision, baseColor, opacity }: BuilderContext): ThreeNS.Group {
  const group = new THREE.Group();
  const postMat = material(THREE, 0x5d4037, hasCollision, opacity, { roughness: 0.85 });
  const boxMat = material(THREE, baseColor, hasCollision, opacity, { roughness: 0.5, metalness: 0.3 });
  const flagMat = material(THREE, 0xd32f2f, hasCollision, opacity, { roughness: 0.6 });

  const post = mesh(THREE, new THREE.BoxGeometry(0.08, item.height * 0.7, 0.08), postMat);
  post.position.y = item.height * 0.35;
  group.add(post);
  const box = mesh(THREE, new THREE.BoxGeometry(item.width, item.height * 0.28, item.depth), boxMat);
  box.position.y = item.height * 0.83;
  group.add(box);
  // Dome top
  const dome = mesh(
    THREE,
    new THREE.CylinderGeometry(item.depth / 2, item.depth / 2, item.width, 12, 1, false, 0, Math.PI),
    boxMat
  );
  dome.rotation.z = Math.PI / 2;
  dome.position.y = item.height * 0.98;
  group.add(dome);
  const flag = mesh(THREE, new THREE.BoxGeometry(0.04, 0.18, 0.18), flagMat);
  flag.position.set(item.width / 2 + 0.05, item.height * 0.92, 0);
  group.add(flag);
  return group;
}

export function buildBirdbath({ THREE, item, hasCollision, baseColor, opacity }: BuilderContext): ThreeNS.Group {
  const group = new THREE.Group();
  const stoneMat = material(THREE, baseColor, hasCollision, opacity, { roughness: 0.85 });
  const waterMat = new THREE.MeshStandardMaterial({ color: 0x4fc3f7, roughness: 0.2, metalness: 0.1, transparent: true, opacity: 0.85 });

  const base = mesh(THREE, new THREE.CylinderGeometry(item.width * 0.35, item.width * 0.5, item.height * 0.18, 16), stoneMat);
  base.position.y = item.height * 0.09;
  group.add(base);
  const post = mesh(THREE, new THREE.CylinderGeometry(item.width * 0.13, item.width * 0.16, item.height * 0.6, 14), stoneMat);
  post.position.y = item.height * 0.48;
  group.add(post);
  const bowl = mesh(THREE, new THREE.CylinderGeometry(item.width * 0.5, item.width * 0.42, item.height * 0.14, 16), stoneMat);
  bowl.position.y = item.height * 0.85;
  group.add(bowl);
  const water = mesh(THREE, new THREE.CylinderGeometry(item.width * 0.44, item.width * 0.38, 0.02, 16), waterMat);
  water.position.y = item.height * 0.93;
  group.add(water);
  return group;
}

export function buildSteppingStone({ THREE, item, hasCollision, baseColor, opacity }: BuilderContext): ThreeNS.Group {
  const group = new THREE.Group();
  const stoneMat = material(THREE, baseColor, hasCollision, opacity, { roughness: 0.95 });
  const stone = mesh(
    THREE,
    new THREE.CylinderGeometry(item.width * 0.5, item.width * 0.48, item.height, 14),
    stoneMat
  );
  stone.position.y = item.height / 2;
  group.add(stone);
  return group;
}

export function buildGardenBench({ THREE, item, hasCollision, baseColor, opacity }: BuilderContext): ThreeNS.Group {
  const group = new THREE.Group();
  const woodMat = material(THREE, baseColor, hasCollision, opacity, { roughness: 0.85 });
  const metalMat = material(THREE, 0x37474f, hasCollision, opacity, { roughness: 0.5, metalness: 0.7 });

  const seat = mesh(THREE, new THREE.BoxGeometry(item.width, 0.06, item.depth * 0.65), woodMat);
  seat.position.y = item.height * 0.5;
  group.add(seat);
  const back = mesh(THREE, new THREE.BoxGeometry(item.width, item.height * 0.45, 0.06), woodMat);
  back.position.set(0, item.height * 0.72, -item.depth * 0.3);
  group.add(back);
  // Cast-iron legs at both ends.
  for (const sign of [-1, 1] as const) {
    const leg = mesh(THREE, new THREE.BoxGeometry(0.06, item.height * 0.5, item.depth * 0.7), metalMat);
    leg.position.set(sign * (item.width / 2 - 0.05), item.height * 0.25, 0);
    group.add(leg);
  }
  return group;
}

export function buildPicnicTable({ THREE, item, hasCollision, baseColor, opacity }: BuilderContext): ThreeNS.Group {
  const group = new THREE.Group();
  const woodMat = material(THREE, baseColor, hasCollision, opacity, { roughness: 0.9 });

  const top = mesh(THREE, new THREE.BoxGeometry(item.width, 0.08, item.depth * 0.5), woodMat);
  top.position.y = item.height;
  group.add(top);
  for (const sign of [-1, 1] as const) {
    const bench = mesh(THREE, new THREE.BoxGeometry(item.width, 0.06, item.depth * 0.2), woodMat);
    bench.position.set(0, item.height * 0.55, sign * (item.depth / 2 - item.depth * 0.1));
    group.add(bench);
    const leg = mesh(THREE, new THREE.BoxGeometry(item.width * 0.85, 0.06, 0.06), woodMat);
    leg.position.set(0, item.height * 0.1, sign * (item.depth / 2 - item.depth * 0.1));
    leg.rotation.x = Math.PI / 2;
    group.add(leg);
  }
  // A-frame supports
  for (const sign of [-1, 1] as const) {
    const support = mesh(THREE, new THREE.BoxGeometry(0.08, item.height, item.depth * 0.6), woodMat);
    support.position.set(sign * (item.width / 2 - 0.1), item.height / 2, 0);
    group.add(support);
  }
  return group;
}

export function buildPond({ THREE, item, hasCollision, baseColor, opacity }: BuilderContext): ThreeNS.Group {
  const group = new THREE.Group();
  const rockMat = material(THREE, 0x6d4c41, hasCollision, opacity, { roughness: 0.95 });
  const waterMat = new THREE.MeshStandardMaterial({
    color: baseColor,
    roughness: 0.15,
    metalness: 0.1,
    transparent: true,
    opacity: 0.85,
  });

  // A ring of rocks round a shallow bed, hollow so the water shows (#365).
  // Built round, then stretched to the item's depth.
  const outerRadius = item.width / 2;
  // A 12 cm rock rim, but never more than 40 % of a small pond's radius.
  const innerRadius = outerRadius - Math.min(0.12, outerRadius * 0.4);
  const ringShape = new THREE.Shape();
  ringShape.absarc(0, 0, outerRadius, 0, Math.PI * 2, false);
  const hole = new THREE.Path();
  hole.absarc(0, 0, innerRadius, 0, Math.PI * 2, true);
  ringShape.holes.push(hole);
  const ringGeo = new THREE.ExtrudeGeometry(ringShape, { depth: item.height, bevelEnabled: false, curveSegments: 24 });
  ringGeo.rotateX(-Math.PI / 2);
  const ring = mesh(THREE, ringGeo, rockMat);
  ring.scale.z = item.depth / item.width;
  group.add(ring);

  const bedThickness = item.height * 0.2;
  const bed = mesh(THREE, new THREE.CylinderGeometry(innerRadius, innerRadius, bedThickness, 24), rockMat);
  bed.position.y = bedThickness / 2;
  bed.scale.z = item.depth / item.width;
  group.add(bed);

  const water = addBasinWater(
    THREE,
    group,
    (h) => new THREE.CylinderGeometry(innerRadius, innerRadius, h, 24),
    waterMat,
    bedThickness,
    item.height
  );
  if (water) water.scale.z = item.depth / item.width;
  // A handful of cattails poking out
  const stemMat = material(THREE, 0x33691e, hasCollision, opacity, { roughness: 0.9 });
  const bulbMat = material(THREE, 0x4e342e, hasCollision, opacity, { roughness: 0.9 });
  const cattails: ReadonlyArray<readonly [number, number]> = [[0.30, 0.25], [-0.32, -0.20], [0.05, -0.30]];
  for (const [px, pz] of cattails) {
    const stem = mesh(THREE, new THREE.CylinderGeometry(0.015, 0.020, 0.7, 6), stemMat);
    stem.position.set(item.width * px, item.height + 0.35, item.depth * pz);
    group.add(stem);
    const bulb = mesh(THREE, new THREE.CylinderGeometry(0.04, 0.04, 0.12, 8), bulbMat);
    bulb.position.set(item.width * px, item.height + 0.7, item.depth * pz);
    group.add(bulb);
  }
  return group;
}
