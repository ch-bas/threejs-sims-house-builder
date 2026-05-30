import type * as ThreeNS from 'three';

type ThreeModule = typeof import('three');

const OUTDOOR_TAG = 'outdoor';

/**
 * Build a suburban-style suburban lot around the room:
 *
 *  - a generous grass plane with darker tufts for variation
 *  - a wood-decking style patio strip along the front (north) edge
 *  - a grey sidewalk + asphalt road further out on the same side
 *  - a perimeter of trees (mixed birch + leafy) framing the lot
 *  - clusters of bushes and flower spots scattered around the grass
 *
 * Deterministic random so the layout doesn't shuffle every render.
 */
export function setOutdoorVisible(
  THREE: ThreeModule,
  scene: ThreeNS.Scene,
  visible: boolean,
  roomWidth: number,
  roomDepth: number
): void {
  scene.children
    .filter((obj) => obj.userData.type === OUTDOOR_TAG)
    .forEach((obj) => scene.remove(obj));

  if (!visible) return;

  const rng = makeRng(roomWidth * 1000 + roomDepth);
  const halfW = roomWidth / 2;
  const halfD = roomDepth / 2;
  const lotMargin = 6;
  const lotHalfW = halfW + lotMargin;
  const lotHalfD = halfD + lotMargin;
  const groundSize = Math.max(roomWidth, roomDepth) * 6 + lotMargin * 2;

  // ---- 1. Grass plane (warm suburban green) ----
  const grass = new THREE.Mesh(
    new THREE.PlaneGeometry(groundSize, groundSize, 1, 1),
    new THREE.MeshStandardMaterial({ color: 0x7cb04a, roughness: 1 })
  );
  grass.rotation.x = -Math.PI / 2;
  grass.position.y = -0.04;
  grass.receiveShadow = true;
  grass.userData.type = OUTDOOR_TAG;
  scene.add(grass);

  // Tuft pass: a few hundred low patches of darker / lighter grass to break
  // the flat plane up the way suburban terrain reads.
  scatterGrassTufts(THREE, scene, rng, groundSize, lotHalfW, lotHalfD);

  // ---- 2. Sidewalk + road on the north edge ----
  const roadOffset = lotHalfD + 1.6; // sidewalk starts past the lot
  const sidewalkDepth = 1.6;
  const roadDepth = 4.5;

  const sidewalkMat = new THREE.MeshStandardMaterial({ color: 0xcfd1cf, roughness: 0.85 });
  const sidewalk = new THREE.Mesh(
    new THREE.PlaneGeometry(groundSize, sidewalkDepth),
    sidewalkMat
  );
  sidewalk.rotation.x = -Math.PI / 2;
  sidewalk.position.set(0, -0.03, -(roadOffset + sidewalkDepth / 2));
  sidewalk.receiveShadow = true;
  sidewalk.userData.type = OUTDOOR_TAG;
  scene.add(sidewalk);

  const asphaltMat = new THREE.MeshStandardMaterial({ color: 0x3a3d40, roughness: 0.95 });
  const road = new THREE.Mesh(
    new THREE.PlaneGeometry(groundSize, roadDepth),
    asphaltMat
  );
  road.rotation.x = -Math.PI / 2;
  road.position.set(0, -0.029, -(roadOffset + sidewalkDepth + roadDepth / 2));
  road.receiveShadow = true;
  road.userData.type = OUTDOOR_TAG;
  scene.add(road);

  // Yellow centre dashes on the road.
  const dashMat = new THREE.MeshStandardMaterial({ color: 0xf4c026, roughness: 0.7 });
  const dashGeom = new THREE.PlaneGeometry(1.2, 0.18);
  for (let x = -groundSize / 2 + 2; x < groundSize / 2 - 2; x += 2.4) {
    const dash = new THREE.Mesh(dashGeom, dashMat);
    dash.rotation.x = -Math.PI / 2;
    dash.position.set(x, -0.028, -(roadOffset + sidewalkDepth + roadDepth / 2));
    dash.userData.type = OUTDOOR_TAG;
    scene.add(dash);
  }

  // Path of stepping stones from the front-of-lot edge to the room's "door"
  // wall (north). Just a few hint stones — looks like suburban walkways.
  const stoneMat = new THREE.MeshStandardMaterial({ color: 0xb0b3b0, roughness: 0.9 });
  for (let z = -halfD - 0.5; z >= -roadOffset; z -= 0.7) {
    const stone = new THREE.Mesh(
      new THREE.CylinderGeometry(0.32, 0.30, 0.06, 12),
      stoneMat
    );
    stone.position.set(0, -0.005, z);
    stone.receiveShadow = true;
    stone.userData.type = OUTDOOR_TAG;
    scene.add(stone);
  }

  // ---- 3. Perimeter trees + bushes ----
  scatterPerimeter(THREE, scene, rng, lotHalfW, lotHalfD);
}

function scatterGrassTufts(
  THREE: ThreeModule,
  scene: ThreeNS.Scene,
  rng: () => number,
  groundSize: number,
  lotHalfW: number,
  lotHalfD: number
): void {
  const tuftMat = new THREE.MeshStandardMaterial({ color: 0x5e9b2e, roughness: 1 });
  const tuftBrightMat = new THREE.MeshStandardMaterial({ color: 0x9bc55a, roughness: 1 });
  const tuftGeom = new THREE.SphereGeometry(0.18, 6, 5);
  const half = groundSize / 2;
  const count = 220;
  for (let i = 0; i < count; i += 1) {
    const x = (rng() - 0.5) * groundSize;
    const z = (rng() - 0.5) * groundSize;
    // Don't put tufts inside the lot footprint or directly on the road.
    if (Math.abs(x) < lotHalfW + 0.5 && Math.abs(z) < lotHalfD + 0.5) continue;
    if (z < -lotHalfD - 1.5 && z > -lotHalfD - 7) continue;
    const tuft = new THREE.Mesh(tuftGeom, rng() > 0.5 ? tuftMat : tuftBrightMat);
    tuft.position.set(x, -0.02, z);
    tuft.scale.setScalar(0.7 + rng() * 0.6);
    tuft.scale.y *= 0.45;
    tuft.userData.type = OUTDOOR_TAG;
    scene.add(tuft);
    // Hide ones way off-camera in fog to keep draw cost down. (Three picks
    // these up at render time — we just leave them as plain meshes.)
    if (Math.hypot(x, z) > half * 0.8) tuft.visible = false;
  }
}

interface TreeKind {
  id: 'birch' | 'oak' | 'pine';
  trunkColor: number;
  leafColor: number;
  leafColorAlt: number;
  trunkRadius: number;
  trunkHeight: number;
  crownRadius: number;
  crownShape: 'leafy' | 'pine';
}

const TREE_KINDS: readonly TreeKind[] = [
  // Birch — pale bark with dark horizontal stripes, bright leafy crown.
  { id: 'birch', trunkColor: 0xe8e3da, leafColor: 0x82b54a, leafColorAlt: 0x9fcf5b, trunkRadius: 0.10, trunkHeight: 2.6, crownRadius: 0.95, crownShape: 'leafy' },
  // Oak — warm brown trunk, deep two-tone green crown.
  { id: 'oak',   trunkColor: 0x6b4a2b, leafColor: 0x3e7a2e, leafColorAlt: 0x5a9b3d, trunkRadius: 0.15, trunkHeight: 2.0, crownRadius: 1.20, crownShape: 'leafy' },
  // Pine — dark trunk, conical evergreen with two-tone needles.
  { id: 'pine',  trunkColor: 0x3e2e1d, leafColor: 0x2b5a2a, leafColorAlt: 0x3d7838, trunkRadius: 0.13, trunkHeight: 1.2, crownRadius: 0.90, crownShape: 'pine' },
];

// Cache the birch-bark texture so we generate the canvas only once per session.
let birchBarkTextureCache: ThreeNS.CanvasTexture | null = null;

function getBirchBarkTexture(THREE: ThreeModule): ThreeNS.CanvasTexture | null {
  if (birchBarkTextureCache) return birchBarkTextureCache;
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  // Pale base with a soft vertical gradient (birch trunks are a touch
  // darker near the ground).
  const grad = ctx.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, '#f4eee5');
  grad.addColorStop(1, '#d2cbbe');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 64, 256);
  // Characteristic dark horizontal slashes.
  for (let i = 0; i < 28; i += 1) {
    const y = (i * 9.1 + Math.sin(i * 1.7) * 4) % 256;
    const startX = (Math.sin(i * 2.3) * 32 + 32) % 64;
    const length = 8 + Math.abs(Math.cos(i * 1.1) * 30);
    const alpha = 0.30 + (i % 5) * 0.08;
    ctx.fillStyle = `rgba(40, 25, 18, ${alpha.toFixed(2)})`;
    ctx.fillRect(startX, y, length, 1.6);
  }
  // A few smaller eye-knot dots.
  for (let i = 0; i < 14; i += 1) {
    const x = (i * 11) % 64;
    const y = (i * 23) % 256;
    ctx.fillStyle = 'rgba(40, 25, 18, 0.45)';
    ctx.beginPath();
    ctx.ellipse(x, y, 1.4, 0.8, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  birchBarkTextureCache = texture;
  return texture;
}

/** Displace each icosahedron vertex slightly so the surface reads as a
 * lumpy leaf cluster rather than a smooth sphere. Flat-shaded so the
 * faceted look says "many leaves" at orbit distance. */
function buildLeafBlob(
  THREE: ThreeModule,
  radius: number,
  color: number,
  seed: number
): ThreeNS.Mesh {
  const geom = new THREE.IcosahedronGeometry(radius, 1);
  const positions = geom.attributes.position;
  if (positions) {
    for (let i = 0; i < positions.count; i += 1) {
      const phase = seed + i * 1.7;
      const jitter = (Math.sin(phase) * 0.5 + Math.cos(phase * 1.3) * 0.5) * radius * 0.18;
      const x = positions.getX(i);
      const y = positions.getY(i);
      const z = positions.getZ(i);
      const len = Math.sqrt(x * x + y * y + z * z) || 1;
      positions.setXYZ(
        i,
        x + (x / len) * jitter,
        y + (y / len) * jitter,
        z + (z / len) * jitter
      );
    }
    positions.needsUpdate = true;
  }
  geom.computeVertexNormals();
  const mat = new THREE.MeshStandardMaterial({
    color,
    roughness: 0.95,
    flatShading: true,
  });
  return new THREE.Mesh(geom, mat);
}

function scatterPerimeter(
  THREE: ThreeModule,
  scene: ThreeNS.Scene,
  rng: () => number,
  lotHalfW: number,
  lotHalfD: number
): void {
  const bushMat = new THREE.MeshStandardMaterial({ color: 0x3e7a35, roughness: 0.9 });
  const bushGeom = new THREE.SphereGeometry(0.45, 10, 10);

  // Trees: ring around three sides of the lot (skip the road side).
  const treePositions: Array<readonly [number, number]> = [];
  const treeCount = 14;
  for (let i = 0; i < treeCount; i += 1) {
    const t = i / treeCount;
    let x: number, z: number;
    // Distribute across south edge (back of lot), east, and west — leave the
    // north open for the sidewalk/road frontage we just drew.
    const side = i % 3;
    if (side === 0) {
      x = (rng() - 0.5) * (lotHalfW * 2 + 4);
      z = lotHalfD + 1.5 + rng() * 4; // south
    } else if (side === 1) {
      x = lotHalfW + 1.5 + rng() * 3.5; // east
      z = (rng() - 0.5) * (lotHalfD * 2);
    } else {
      x = -(lotHalfW + 1.5 + rng() * 3.5); // west
      z = (rng() - 0.5) * (lotHalfD * 2);
    }
    treePositions.push([x, z]);
    addTree(THREE, scene, x, z, TREE_KINDS[i % TREE_KINDS.length]!, rng);
    void t;
  }

  // Small ornamental shrubs hugging the lot edges.
  const shrubCount = 18;
  for (let i = 0; i < shrubCount; i += 1) {
    const angle = (i / shrubCount) * Math.PI * 2;
    const radius = Math.max(lotHalfW, lotHalfD) + 0.8 + rng() * 0.6;
    let x = Math.cos(angle) * radius;
    let z = Math.sin(angle) * radius;
    // Keep the road frontage clean.
    if (z < -lotHalfD) continue;
    const bush = new THREE.Mesh(bushGeom, bushMat);
    bush.position.set(x, 0.32, z);
    bush.scale.setScalar(0.7 + rng() * 0.4);
    bush.castShadow = true;
    bush.userData.type = OUTDOOR_TAG;
    scene.add(bush);
  }

  // A few cheerful flower patches around the lot's front.
  const flowerColors = [0xff5b6a, 0xffd24a, 0xffffff, 0xc77bff];
  for (let i = 0; i < 6; i += 1) {
    const x = ((rng() - 0.5) * lotHalfW) * 2;
    const z = -lotHalfD - 0.4 - rng() * 0.6;
    addFlowerPatch(THREE, scene, x, z, flowerColors, rng);
  }
}

function addTree(
  THREE: ThreeModule,
  scene: ThreeNS.Scene,
  x: number,
  z: number,
  kind: TreeKind,
  rng: () => number
): void {
  const scale = 0.85 + rng() * 0.5;
  const group = new THREE.Group();
  const seed = rng() * 1000;

  // ----- Trunk -----
  let trunkMat: ThreeNS.MeshStandardMaterial;
  if (kind.id === 'birch') {
    const bark = getBirchBarkTexture(THREE);
    if (bark) {
      const trunkBark = bark.clone();
      trunkBark.needsUpdate = true;
      trunkBark.repeat.set(1, Math.max(1, kind.trunkHeight / 2));
      trunkMat = new THREE.MeshStandardMaterial({
        map: trunkBark,
        roughness: 0.85,
      });
    } else {
      trunkMat = new THREE.MeshStandardMaterial({
        color: kind.trunkColor,
        roughness: 0.95,
      });
    }
  } else {
    trunkMat = new THREE.MeshStandardMaterial({
      color: kind.trunkColor,
      roughness: 0.95,
    });
  }
  const trunk = new THREE.Mesh(
    new THREE.CylinderGeometry(
      kind.trunkRadius * 0.75, // narrower at top
      kind.trunkRadius * 1.2,  // flare at the base
      kind.trunkHeight,
      12
    ),
    trunkMat
  );
  trunk.position.y = kind.trunkHeight / 2;
  trunk.castShadow = true;
  trunk.receiveShadow = true;
  group.add(trunk);

  // A subtle root flare ring at the very bottom for the leafy species.
  if (kind.id !== 'pine') {
    const flareMat = new THREE.MeshStandardMaterial({
      color: kind.id === 'birch' ? 0xc8c2b6 : 0x4d3520,
      roughness: 1,
    });
    const flare = new THREE.Mesh(
      new THREE.CylinderGeometry(kind.trunkRadius * 1.4, kind.trunkRadius * 1.7, 0.12, 10),
      flareMat
    );
    flare.position.y = 0.05;
    flare.receiveShadow = true;
    group.add(flare);
  }

  // ----- Crown -----
  if (kind.crownShape === 'pine') {
    // 5 stacked irregular-bottom-edge cones for a thick pine — each cone
    // uses 14 segments so the silhouette is rounder, and the foliage is
    // flat-shaded for that crinkled-needle look.
    const tiers = [
      { y: 0.0, r: kind.crownRadius * 1.05, h: 1.4, dark: true  },
      { y: 0.9, r: kind.crownRadius * 0.92, h: 1.3, dark: false },
      { y: 1.7, r: kind.crownRadius * 0.78, h: 1.2, dark: true  },
      { y: 2.4, r: kind.crownRadius * 0.58, h: 1.0, dark: false },
      { y: 3.0, r: kind.crownRadius * 0.35, h: 0.8, dark: true  },
    ];
    for (const t of tiers) {
      const mat = new THREE.MeshStandardMaterial({
        color: t.dark ? kind.leafColor : kind.leafColorAlt,
        roughness: 0.95,
        flatShading: true,
      });
      const cone = new THREE.Mesh(new THREE.ConeGeometry(t.r, t.h, 14), mat);
      cone.position.y = kind.trunkHeight + t.y + t.h / 2;
      cone.rotation.y = rng() * Math.PI * 2;
      cone.castShadow = true;
      group.add(cone);
    }
  } else {
    // Visible branches poking out from the top of the trunk before the
    // foliage takes over.
    const branchMat = new THREE.MeshStandardMaterial({
      color: kind.trunkColor,
      roughness: 0.9,
    });
    for (let b = 0; b < 3; b += 1) {
      const angle = (b / 3) * Math.PI * 2 + rng() * 0.5;
      const branchLen = kind.crownRadius * (0.5 + rng() * 0.3);
      const branch = new THREE.Mesh(
        new THREE.CylinderGeometry(
          kind.trunkRadius * 0.35,
          kind.trunkRadius * 0.5,
          branchLen,
          6
        ),
        branchMat
      );
      branch.rotation.z = Math.PI / 2 - 0.6;
      branch.rotation.y = angle;
      branch.position.set(
        Math.cos(angle) * branchLen * 0.45,
        kind.trunkHeight - 0.1,
        Math.sin(angle) * branchLen * 0.45
      );
      branch.castShadow = true;
      group.add(branch);
    }

    // Cluster of 6 lumpy leaf blobs in alternating shades. Each blob is an
    // icosahedron with displaced vertices + flat shading, so the canopy
    // reads as clumped foliage rather than a smooth ball.
    const blobs: ReadonlyArray<readonly [number, number, number, number, number]> = [
      // x, y, z, radius-multiplier, color-index (0 = main, 1 = light)
      [ 0.00, 0.30,  0.00, 1.00, 1],
      [-0.55, 0.05,  0.15, 0.70, 0],
      [ 0.45, 0.18, -0.20, 0.78, 0],
      [-0.20, 0.65,  0.10, 0.66, 1],
      [ 0.15, 0.55, -0.40, 0.62, 0],
      [-0.05, 0.40,  0.50, 0.70, 1],
    ];
    blobs.forEach(([bx, by, bz, br, ci], i) => {
      const color = ci === 1 ? kind.leafColorAlt : kind.leafColor;
      const blob = buildLeafBlob(THREE, kind.crownRadius * br, color, seed + i);
      blob.position.set(
        bx * kind.crownRadius,
        kind.trunkHeight + kind.crownRadius * (0.5 + by),
        bz * kind.crownRadius
      );
      blob.castShadow = true;
      blob.receiveShadow = true;
      group.add(blob);
    });
  }

  group.position.set(x, 0, z);
  group.rotation.y = rng() * Math.PI * 2;
  group.scale.setScalar(scale);
  group.userData.type = OUTDOOR_TAG;
  scene.add(group);
}

function addFlowerPatch(
  THREE: ThreeModule,
  scene: ThreeNS.Scene,
  x: number,
  z: number,
  colors: readonly number[],
  rng: () => number
): void {
  const group = new THREE.Group();
  const count = 6 + Math.floor(rng() * 4);
  for (let i = 0; i < count; i += 1) {
    const angle = rng() * Math.PI * 2;
    const r = rng() * 0.35;
    const px = Math.cos(angle) * r;
    const pz = Math.sin(angle) * r;
    const color = colors[Math.floor(rng() * colors.length)]!;
    const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.8 });
    const flower = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 8), mat);
    flower.position.set(px, 0.12, pz);
    group.add(flower);
    const stem = new THREE.Mesh(
      new THREE.CylinderGeometry(0.012, 0.015, 0.18, 5),
      new THREE.MeshStandardMaterial({ color: 0x336e1f, roughness: 0.9 })
    );
    stem.position.set(px, 0.05, pz);
    group.add(stem);
  }
  group.position.set(x, 0, z);
  group.userData.type = OUTDOOR_TAG;
  scene.add(group);
}

/** Mulberry32 — small, deterministic PRNG so the lot doesn't reshuffle. */
function makeRng(seed: number): () => number {
  let state = (seed | 0) || 1;
  return function next(): number {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
