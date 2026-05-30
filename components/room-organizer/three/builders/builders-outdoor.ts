import type * as ThreeNS from 'three';
import { type BuilderContext, mesh } from '../builder-utils';

export function buildFence({ THREE, item, hasCollision, baseColor, opacity }: BuilderContext): ThreeNS.Group {
  const group = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: baseColor, roughness: 0.9, transparent: hasCollision, opacity });

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

export function buildPool({ THREE, item, hasCollision, baseColor, opacity }: BuilderContext): ThreeNS.Group {
  const group = new THREE.Group();
  const tileMat = new THREE.MeshStandardMaterial({ color: 0xeceff1, roughness: 0.7, transparent: hasCollision, opacity });
  const waterMat = new THREE.MeshStandardMaterial({
    color: baseColor,
    roughness: 0.15,
    metalness: 0.05,
    transparent: true,
    opacity: hasCollision ? 0.7 : 0.7,
  });

  const lip = mesh(THREE, new THREE.BoxGeometry(item.width, item.height, item.depth), tileMat);
  lip.position.y = item.height / 2;
  group.add(lip);

  const water = mesh(
    THREE,
    new THREE.BoxGeometry(item.width * 0.92, item.height * 0.6, item.depth * 0.92),
    waterMat
  );
  water.position.y = item.height * 0.55;
  group.add(water);
  return group;
}

export function buildBbq({ THREE, item, hasCollision, baseColor, opacity }: BuilderContext): ThreeNS.Group {
  const group = new THREE.Group();
  const bodyMat = new THREE.MeshStandardMaterial({ color: baseColor, roughness: 0.5, metalness: 0.5, transparent: hasCollision, opacity });
  const handleMat = new THREE.MeshStandardMaterial({ color: 0x212121, roughness: 0.6, transparent: hasCollision, opacity });

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
  const postMat = new THREE.MeshStandardMaterial({ color: 0x5d4037, roughness: 0.85, transparent: hasCollision, opacity });
  const boxMat = new THREE.MeshStandardMaterial({ color: baseColor, roughness: 0.5, metalness: 0.3, transparent: hasCollision, opacity });
  const flagMat = new THREE.MeshStandardMaterial({ color: 0xd32f2f, roughness: 0.6, transparent: hasCollision, opacity });

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
  const stoneMat = new THREE.MeshStandardMaterial({ color: baseColor, roughness: 0.85, transparent: hasCollision, opacity });
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
  const stoneMat = new THREE.MeshStandardMaterial({ color: baseColor, roughness: 0.95, transparent: hasCollision, opacity });
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
  const woodMat = new THREE.MeshStandardMaterial({ color: baseColor, roughness: 0.85, transparent: hasCollision, opacity });
  const metalMat = new THREE.MeshStandardMaterial({ color: 0x37474f, roughness: 0.5, metalness: 0.7, transparent: hasCollision, opacity });

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
  const woodMat = new THREE.MeshStandardMaterial({ color: baseColor, roughness: 0.9, transparent: hasCollision, opacity });

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
  const rockMat = new THREE.MeshStandardMaterial({ color: 0x6d4c41, roughness: 0.95, transparent: hasCollision, opacity });
  const waterMat = new THREE.MeshStandardMaterial({
    color: baseColor,
    roughness: 0.15,
    metalness: 0.1,
    transparent: true,
    opacity: 0.85,
  });

  const basin = mesh(
    THREE,
    new THREE.CylinderGeometry(item.width / 2, item.width / 2 - 0.1, item.height, 24),
    rockMat
  );
  basin.position.y = item.height / 2;
  basin.scale.z = item.depth / item.width;
  group.add(basin);
  const water = mesh(
    THREE,
    new THREE.CylinderGeometry(item.width / 2 - 0.12, item.width / 2 - 0.12, item.height * 0.6, 24),
    waterMat
  );
  water.position.y = item.height * 0.6;
  water.scale.z = item.depth / item.width;
  group.add(water);
  // A handful of cattails poking out
  const stemMat = new THREE.MeshStandardMaterial({ color: 0x33691e, roughness: 0.9, transparent: hasCollision, opacity });
  const bulbMat = new THREE.MeshStandardMaterial({ color: 0x4e342e, roughness: 0.9, transparent: hasCollision, opacity });
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
