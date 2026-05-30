import type * as ThreeNS from 'three';
import { type BuilderContext, mesh, lightenHex, buildOrganicBlob } from '../builder-utils';

export function buildPlant({ THREE, item, hasCollision, baseColor, opacity }: BuilderContext): ThreeNS.Group {
  const group = new THREE.Group();

  const pot = mesh(
    THREE,
    new THREE.CylinderGeometry(item.width * 0.6, item.width * 0.8, item.height * 0.3, 16),
    new THREE.MeshStandardMaterial({ color: 0xa0522d, roughness: 0.8, transparent: hasCollision, opacity })
  );
  pot.position.y = item.height * 0.15;
  group.add(pot);

  const foliageMat = new THREE.MeshStandardMaterial({
    color: baseColor,
    roughness: 0.9,
    transparent: hasCollision,
    opacity,
  });
  const foliage = mesh(THREE, new THREE.SphereGeometry(item.width * 0.8, 12, 12), foliageMat);
  foliage.position.y = item.height * 0.6;
  group.add(foliage);

  const leafGeo = new THREE.SphereGeometry(item.width * 0.4, 8, 8);
  const positions: ReadonlyArray<readonly [number, number, number]> = [
    [item.width * 0.6, item.height * 0.7, 0],
    [-item.width * 0.6, item.height * 0.65, 0],
    [0, item.height * 0.8, item.width * 0.5],
  ];
  for (const [x, y, z] of positions) {
    const leaf = mesh(THREE, leafGeo, foliageMat);
    leaf.position.set(x, y, z);
    group.add(leaf);
  }

  return group;
}

export function buildFlowerpot({ THREE, item, hasCollision, baseColor, opacity }: BuilderContext): ThreeNS.Group {
  const group = new THREE.Group();
  const potMat = new THREE.MeshStandardMaterial({ color: baseColor, roughness: 0.6, transparent: hasCollision, opacity });
  const flowerMat = new THREE.MeshStandardMaterial({ color: 0xff80ab, roughness: 0.8, transparent: hasCollision, opacity });

  const pot = mesh(THREE, new THREE.CylinderGeometry(item.width * 0.5, item.width * 0.4, item.height * 0.6, 12), potMat);
  pot.position.y = item.height * 0.3;
  group.add(pot);

  for (const offset of [[-0.05, 0.6, 0], [0.05, 0.65, 0], [0, 0.7, 0]] as const) {
    const flower = mesh(THREE, new THREE.SphereGeometry(item.width * 0.25, 8, 8), flowerMat);
    flower.position.set(offset[0]!, item.height * offset[1]!, offset[2]!);
    group.add(flower);
  }
  return group;
}

export function buildTree({ THREE, item, hasCollision, baseColor, opacity }: BuilderContext): ThreeNS.Group {
  const group = new THREE.Group();
  const trunkMat = new THREE.MeshStandardMaterial({
    color: 0x5d4037,
    roughness: 0.95,
    transparent: hasCollision,
    opacity,
  });

  // Tapered trunk with a small flare at the base.
  const trunkH = item.height * 0.4;
  const trunk = mesh(
    THREE,
    new THREE.CylinderGeometry(item.width * 0.08, item.width * 0.14, trunkH, 12),
    trunkMat
  );
  trunk.position.y = trunkH / 2;
  group.add(trunk);
  const flare = mesh(
    THREE,
    new THREE.CylinderGeometry(item.width * 0.17, item.width * 0.21, item.height * 0.04, 10),
    trunkMat
  );
  flare.position.y = item.height * 0.02;
  group.add(flare);

  // A few short branches angling up before the canopy.
  const branchMat = trunkMat;
  for (let b = 0; b < 3; b += 1) {
    const angle = (b / 3) * Math.PI * 2 + b * 0.4;
    const branch = mesh(
      THREE,
      new THREE.CylinderGeometry(item.width * 0.025, item.width * 0.05, item.width * 0.45, 6),
      branchMat
    );
    branch.rotation.z = Math.PI / 2 - 0.55;
    branch.rotation.y = angle;
    branch.position.set(
      Math.cos(angle) * item.width * 0.20,
      trunkH - 0.05,
      Math.sin(angle) * item.width * 0.20
    );
    group.add(branch);
  }

  // Foliage cluster — lumpy icosahedron blobs in two tones, flat-shaded.
  const leafColor = baseColor;
  const leafAlt = lightenHex(typeof baseColor === 'string' ? baseColor : '#3e7a2e', 0.18);
  const r = item.width * 0.55;
  const cy = item.height * 0.62;
  const blobs: ReadonlyArray<readonly [number, number, number, number, boolean]> = [
    [ 0.0,  0.0,  0.0, 1.0,  true],
    [-0.55, -0.12,  0.10, 0.66, false],
    [ 0.45, -0.05, -0.18, 0.72, false],
    [-0.18,  0.45,  0.05, 0.60, true ],
    [ 0.15,  0.30, -0.32, 0.58, false],
    [-0.05,  0.20,  0.48, 0.62, true ],
  ];
  blobs.forEach(([bx, by, bz, br, light], i) => {
    const blob = buildOrganicBlob(
      THREE,
      r * br,
      light ? leafAlt : (leafColor as ThreeNS.ColorRepresentation),
      hasCollision,
      opacity,
      i * 17 + 3
    );
    blob.position.set(bx * r, cy + by * r, bz * r);
    group.add(blob);
  });

  return group;
}

export function buildPineTree({ THREE, item, hasCollision, baseColor, opacity }: BuilderContext): ThreeNS.Group {
  const group = new THREE.Group();
  const trunkMat = new THREE.MeshStandardMaterial({
    color: 0x4e342e,
    roughness: 0.9,
    transparent: hasCollision,
    opacity,
  });

  // Tapered trunk peeking out from the bottom of the foliage.
  const trunkH = item.height * 0.22;
  const trunk = mesh(
    THREE,
    new THREE.CylinderGeometry(item.width * 0.07, item.width * 0.13, trunkH, 12),
    trunkMat
  );
  trunk.position.y = trunkH / 2;
  group.add(trunk);

  // Five stacked cones — alternating shades, flat-shaded, with 16 segments
  // for a rounder silhouette than the previous 12.
  const baseHex = typeof baseColor === 'string' ? baseColor : '#2b5a2a';
  const altHex = lightenHex(baseHex, 0.20);
  const tiers = [
    { y: 0.21, r: 0.60, h: 0.32, alt: false },
    { y: 0.40, r: 0.50, h: 0.28, alt: true  },
    { y: 0.58, r: 0.40, h: 0.26, alt: false },
    { y: 0.74, r: 0.28, h: 0.22, alt: true  },
    { y: 0.86, r: 0.16, h: 0.18, alt: false },
  ];
  for (const t of tiers) {
    const mat = new THREE.MeshStandardMaterial({
      color: t.alt ? altHex : (baseColor as ThreeNS.ColorRepresentation),
      roughness: 0.95,
      flatShading: true,
      transparent: hasCollision,
      opacity,
    });
    const cone = mesh(
      THREE,
      new THREE.ConeGeometry(item.width * t.r, item.height * t.h, 16),
      mat
    );
    cone.position.y = item.height * t.y + (item.height * t.h) / 2;
    group.add(cone);
  }
  return group;
}

export function buildBush({ THREE, item, hasCollision, baseColor, opacity }: BuilderContext): ThreeNS.Group {
  const group = new THREE.Group();
  const baseHex = typeof baseColor === 'string' ? baseColor : '#4caf50';
  const altHex = lightenHex(baseHex, 0.18);
  const blobs: ReadonlyArray<readonly [number, number, number, number, boolean]> = [
    [ 0.00, 0.55,  0.00, 0.50, false],
    [-0.28, 0.45,  0.12, 0.36, true ],
    [ 0.25, 0.50, -0.14, 0.34, false],
    [ 0.05, 0.78, -0.05, 0.30, true ],
    [-0.05, 0.30,  0.20, 0.28, false],
  ];
  blobs.forEach(([x, y, z, r, light], i) => {
    const blob = buildOrganicBlob(
      THREE,
      item.width * r,
      light ? altHex : (baseColor as ThreeNS.ColorRepresentation),
      hasCollision,
      opacity,
      i * 13 + 7
    );
    blob.position.set(item.width * x, item.height * y, item.depth * z);
    group.add(blob);
  });
  return group;
}

export function buildHedge({ THREE, item, hasCollision, baseColor, opacity }: BuilderContext): ThreeNS.Group {
  const group = new THREE.Group();
  const leafMat = new THREE.MeshStandardMaterial({ color: baseColor, roughness: 0.9, transparent: hasCollision, opacity });
  const body = mesh(THREE, new THREE.BoxGeometry(item.width, item.height, item.depth), leafMat);
  body.position.y = item.height / 2;
  group.add(body);
  // Bumpy top to break the slab silhouette.
  const bumps = Math.max(3, Math.floor(item.width / 0.5));
  for (let i = 0; i < bumps; i += 1) {
    const t = (i + 0.5) / bumps;
    const blob = mesh(THREE, new THREE.SphereGeometry(item.depth * 0.55, 8, 8), leafMat);
    blob.position.set(item.width * (t - 0.5), item.height, 0);
    group.add(blob);
  }
  return group;
}

export function buildFlowerBed({ THREE, item, hasCollision, baseColor, opacity }: BuilderContext): ThreeNS.Group {
  const group = new THREE.Group();
  const soilMat = new THREE.MeshStandardMaterial({ color: 0x5d4037, roughness: 0.95, transparent: hasCollision, opacity });
  const rimMat = new THREE.MeshStandardMaterial({ color: 0x8d6e63, roughness: 0.7, transparent: hasCollision, opacity });
  const flowerColors = [baseColor, 0xffeb3b, 0xfff59d, 0xba68c8, 0xf06292];

  const rim = mesh(THREE, new THREE.BoxGeometry(item.width, item.height * 0.5, item.depth), rimMat);
  rim.position.y = item.height * 0.25;
  group.add(rim);
  const soil = mesh(
    THREE,
    new THREE.BoxGeometry(item.width * 0.92, item.height * 0.55, item.depth * 0.85),
    soilMat
  );
  soil.position.y = item.height * 0.45;
  group.add(soil);

  const cols = Math.max(3, Math.floor(item.width / 0.35));
  const rows = Math.max(1, Math.floor(item.depth / 0.35));
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      const px = ((c + 0.5) / cols - 0.5) * item.width * 0.85;
      const pz = ((r + 0.5) / rows - 0.5) * item.depth * 0.7;
      const color = flowerColors[(r * cols + c) % flowerColors.length]!;
      const headMat = new THREE.MeshStandardMaterial({ color, roughness: 0.7, transparent: hasCollision, opacity });
      const head = mesh(THREE, new THREE.SphereGeometry(0.07, 8, 8), headMat);
      head.position.set(px, item.height * 0.78, pz);
      group.add(head);
    }
  }
  return group;
}

export function buildSingleFlower({
  THREE,
  item,
  hasCollision,
  baseColor,
  opacity,
  headRadius,
  petals,
}: BuilderContext & { headRadius: number; petals: number }): ThreeNS.Group {
  const group = new THREE.Group();
  const stemMat = new THREE.MeshStandardMaterial({ color: 0x33691e, roughness: 0.9, transparent: hasCollision, opacity });
  const petalMat = new THREE.MeshStandardMaterial({ color: baseColor, roughness: 0.7, transparent: hasCollision, opacity });
  const centreMat = new THREE.MeshStandardMaterial({ color: 0x6d4c41, roughness: 0.9, transparent: hasCollision, opacity });

  const stem = mesh(THREE, new THREE.CylinderGeometry(0.015, 0.02, item.height * 0.85, 6), stemMat);
  stem.position.y = item.height * 0.425;
  group.add(stem);

  const centre = mesh(THREE, new THREE.SphereGeometry(headRadius * 0.45, 10, 10), centreMat);
  centre.position.y = item.height * 0.92;
  group.add(centre);

  for (let i = 0; i < petals; i += 1) {
    const angle = (i / petals) * Math.PI * 2;
    const petal = mesh(THREE, new THREE.SphereGeometry(headRadius * 0.45, 8, 8), petalMat);
    petal.position.set(
      Math.cos(angle) * headRadius * 0.55,
      item.height * 0.92,
      Math.sin(angle) * headRadius * 0.55
    );
    petal.scale.set(0.9, 0.6, 0.9);
    group.add(petal);
  }
  return group;
}

export function buildTulips(ctx: BuilderContext): ThreeNS.Group {
  const { THREE, item, hasCollision, opacity } = ctx;
  const group = new THREE.Group();
  const stemMat = new THREE.MeshStandardMaterial({ color: 0x33691e, roughness: 0.9, transparent: hasCollision, opacity });
  const petalMat = new THREE.MeshStandardMaterial({ color: ctx.baseColor, roughness: 0.7, transparent: hasCollision, opacity });

  const positions: ReadonlyArray<readonly [number, number]> = [
    [-0.15, -0.1],
    [0.15, -0.05],
    [0.0, 0.12],
    [-0.05, 0.08],
  ];
  for (const [px, pz] of positions) {
    const stem = mesh(THREE, new THREE.CylinderGeometry(0.012, 0.018, item.height * 0.85, 6), stemMat);
    stem.position.set(px, item.height * 0.425, pz);
    group.add(stem);
    const bulb = mesh(THREE, new THREE.SphereGeometry(0.05, 10, 8), petalMat);
    bulb.scale.set(1, 1.6, 1);
    bulb.position.set(px, item.height * 0.92, pz);
    group.add(bulb);
  }
  return group;
}

export function buildSunflower(ctx: BuilderContext): ThreeNS.Group {
  return buildSingleFlower({ ...ctx, headRadius: 0.18, petals: 12 });
}

export function buildRoseBush({ THREE, item, hasCollision, baseColor, opacity }: BuilderContext): ThreeNS.Group {
  const group = new THREE.Group();
  const leafMat = new THREE.MeshStandardMaterial({ color: 0x2e7d32, roughness: 0.9, transparent: hasCollision, opacity });
  const roseMat = new THREE.MeshStandardMaterial({ color: baseColor, roughness: 0.7, transparent: hasCollision, opacity });

  const body = mesh(THREE, new THREE.SphereGeometry(item.width * 0.45, 10, 10), leafMat);
  body.position.y = item.height * 0.55;
  group.add(body);

  const rosePositions: ReadonlyArray<readonly [number, number, number]> = [
    [0, 0.85, 0],
    [-0.18, 0.65, 0.10],
    [0.18, 0.70, -0.08],
    [0.05, 0.50, 0.18],
    [-0.10, 0.55, -0.15],
  ];
  for (const [x, y, z] of rosePositions) {
    const rose = mesh(THREE, new THREE.SphereGeometry(0.07, 8, 8), roseMat);
    rose.position.set(item.width * x, item.height * y, item.depth * z);
    group.add(rose);
  }
  return group;
}
