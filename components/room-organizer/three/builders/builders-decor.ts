import type * as ThreeNS from 'three';
import { type BuilderContext, mesh } from '../builder-utils';

export function buildRug({ THREE, item, hasCollision, baseColor, opacity }: BuilderContext): ThreeNS.Group {
  const group = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: baseColor, roughness: 1.0, transparent: hasCollision, opacity });
  const border = new THREE.MeshStandardMaterial({ color: 0x424242, roughness: 1.0, transparent: hasCollision, opacity });

  const rug = mesh(THREE, new THREE.BoxGeometry(item.width, 0.01, item.depth), mat);
  rug.position.y = 0.005;
  group.add(rug);

  const trim = mesh(THREE, new THREE.BoxGeometry(item.width * 0.92, 0.012, item.depth * 0.88), border);
  trim.position.y = 0.011;
  group.add(trim);
  return group;
}

export function buildPainting({ THREE, item, hasCollision, baseColor, opacity }: BuilderContext): ThreeNS.Group {
  const group = new THREE.Group();
  const frameMat = new THREE.MeshStandardMaterial({ color: baseColor, roughness: 0.6, transparent: hasCollision, opacity });
  const canvasMat = new THREE.MeshStandardMaterial({ color: 0xfff3e0, roughness: 0.8, transparent: hasCollision, opacity });

  const frame = mesh(THREE, new THREE.BoxGeometry(item.width, item.height, item.depth), frameMat);
  frame.position.y = item.height / 2 + 0.8;
  group.add(frame);

  const canvas = mesh(
    THREE,
    new THREE.BoxGeometry(item.width * 0.85, item.height * 0.85, item.depth * 0.5),
    canvasMat
  );
  canvas.position.set(0, item.height / 2 + 0.8, item.depth * 0.3);
  group.add(canvas);

  // a few abstract blobs of color
  const blobColors = [0xef5350, 0x42a5f5, 0xffca28];
  blobColors.forEach((color, i) => {
    const blob = mesh(
      THREE,
      new THREE.SphereGeometry(item.width * 0.12, 10, 10),
      new THREE.MeshStandardMaterial({ color, roughness: 0.7, transparent: hasCollision, opacity })
    );
    blob.position.set(item.width * (i - 1) * 0.25, item.height / 2 + 0.8 + Math.sin(i) * 0.1, item.depth * 0.32);
    group.add(blob);
  });
  return group;
}

export function buildVase({ THREE, item, hasCollision, baseColor, opacity }: BuilderContext): ThreeNS.Group {
  const group = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: baseColor, roughness: 0.4, transparent: hasCollision, opacity });

  const lower = mesh(THREE, new THREE.SphereGeometry(item.width * 0.45, 16, 16), mat);
  lower.position.y = item.height * 0.4;
  lower.scale.y = 1.2;
  group.add(lower);

  const neck = mesh(THREE, new THREE.CylinderGeometry(item.width * 0.15, item.width * 0.3, item.height * 0.3, 16), mat);
  neck.position.y = item.height * 0.85;
  group.add(neck);
  return group;
}

export function buildMirror({ THREE, item, hasCollision, baseColor, opacity }: BuilderContext): ThreeNS.Group {
  const group = new THREE.Group();
  const frameMat = new THREE.MeshStandardMaterial({ color: baseColor, roughness: 0.5, transparent: hasCollision, opacity });
  const reflectMat = new THREE.MeshStandardMaterial({ color: 0xb3e5fc, roughness: 0.05, metalness: 0.95, transparent: hasCollision, opacity });

  const frame = mesh(THREE, new THREE.BoxGeometry(item.width, item.height, item.depth), frameMat);
  frame.position.y = item.height / 2 + 0.4;
  group.add(frame);

  const surface = mesh(
    THREE,
    new THREE.BoxGeometry(item.width * 0.9, item.height * 0.9, item.depth * 0.4),
    reflectMat
  );
  surface.position.set(0, item.height / 2 + 0.4, item.depth * 0.31);
  group.add(surface);
  return group;
}

export function buildCurtains({ THREE, item, hasCollision, baseColor, opacity }: BuilderContext): ThreeNS.Group {
  const group = new THREE.Group();
  const rodMat = new THREE.MeshStandardMaterial({
    color: 0x37474f,
    roughness: 0.4,
    metalness: 0.7,
    transparent: hasCollision,
    opacity,
  });
  const fabricMat = new THREE.MeshStandardMaterial({
    color: baseColor,
    roughness: 0.95,
    transparent: hasCollision,
    opacity,
  });

  // Rod across the top.
  const rodLength = item.width;
  const rod = mesh(
    THREE,
    new THREE.CylinderGeometry(0.025, 0.025, rodLength + 0.18, 12),
    rodMat
  );
  rod.rotation.z = Math.PI / 2;
  rod.position.y = item.height - 0.03;
  group.add(rod);

  // Finials at each end.
  for (const sign of [-1, 1] as const) {
    const finial = mesh(THREE, new THREE.SphereGeometry(0.05, 10, 8), rodMat);
    finial.position.set(sign * (rodLength / 2 + 0.09), item.height - 0.03, 0);
    group.add(finial);
  }

  // Two fabric panels — left and right — pulled to the sides so the window
  // between them is still visible. Each panel uses a tall thin geometry
  // with a few gathers along the bottom.
  const panelWidth = item.width * 0.45;
  const panelHeight = item.height * 0.95;
  for (const sign of [-1, 1] as const) {
    const panel = new THREE.Group();
    const main = mesh(
      THREE,
      new THREE.BoxGeometry(panelWidth, panelHeight, item.depth * 0.4),
      fabricMat
    );
    main.position.y = -panelHeight / 2;
    panel.add(main);
    // A small valance hem along the bottom for that gathered-fabric look.
    const hem = mesh(
      THREE,
      new THREE.BoxGeometry(panelWidth * 1.05, panelHeight * 0.08, item.depth * 0.5),
      fabricMat
    );
    hem.position.y = -panelHeight * 0.96;
    panel.add(hem);
    panel.position.set(sign * (item.width / 2 - panelWidth / 2), item.height - 0.06, 0);
    group.add(panel);
  }

  return group;
}

export function buildWallShelf({ THREE, item, hasCollision, baseColor, opacity }: BuilderContext): ThreeNS.Group {
  const group = new THREE.Group();
  const woodMat = new THREE.MeshStandardMaterial({
    color: baseColor,
    roughness: 0.7,
    transparent: hasCollision,
    opacity,
  });
  const bracketMat = new THREE.MeshStandardMaterial({
    color: 0x424242,
    roughness: 0.4,
    metalness: 0.6,
    transparent: hasCollision,
    opacity,
  });

  // Shelf board itself.
  const shelf = mesh(
    THREE,
    new THREE.BoxGeometry(item.width, item.height, item.depth),
    woodMat
  );
  shelf.position.y = item.height / 2;
  group.add(shelf);

  // L-shaped brackets under the shelf, one near each end.
  const bracketGeo = new THREE.BoxGeometry(0.02, 0.12, item.depth * 0.85);
  for (const sign of [-1, 1] as const) {
    const bracket = mesh(THREE, bracketGeo, bracketMat);
    bracket.position.set(sign * (item.width / 2 - 0.08), -0.05, 0);
    group.add(bracket);
  }

  // A couple of small ornaments on top — a book and a tiny plant for variety.
  const bookMat = new THREE.MeshStandardMaterial({
    color: 0x8e1c1c,
    roughness: 0.85,
    transparent: hasCollision,
    opacity,
  });
  const book = mesh(THREE, new THREE.BoxGeometry(0.10, 0.14, 0.16), bookMat);
  book.position.set(-item.width * 0.30, item.height + 0.07, 0);
  group.add(book);
  const book2 = mesh(
    THREE,
    new THREE.BoxGeometry(0.08, 0.18, 0.14),
    new THREE.MeshStandardMaterial({
      color: 0x1b4f72,
      roughness: 0.85,
      transparent: hasCollision,
      opacity,
    })
  );
  book2.position.set(-item.width * 0.18, item.height + 0.09, 0);
  group.add(book2);

  const potMat = new THREE.MeshStandardMaterial({
    color: 0xa0522d,
    roughness: 0.85,
    transparent: hasCollision,
    opacity,
  });
  const pot = mesh(THREE, new THREE.CylinderGeometry(0.05, 0.06, 0.08, 10), potMat);
  pot.position.set(item.width * 0.30, item.height + 0.04, 0);
  group.add(pot);
  const leafMat = new THREE.MeshStandardMaterial({
    color: 0x4caf50,
    roughness: 0.9,
    transparent: hasCollision,
    opacity,
  });
  const leaf = mesh(THREE, new THREE.SphereGeometry(0.08, 10, 8), leafMat);
  leaf.position.set(item.width * 0.30, item.height + 0.14, 0);
  group.add(leaf);

  return group;
}

export function buildWallClock({ THREE, item, hasCollision, baseColor, opacity }: BuilderContext): ThreeNS.Group {
  const group = new THREE.Group();
  const frameMat = new THREE.MeshStandardMaterial({
    color: 0x37474f,
    roughness: 0.4,
    metalness: 0.5,
    transparent: hasCollision,
    opacity,
  });
  const faceMat = new THREE.MeshStandardMaterial({
    color: baseColor,
    roughness: 0.6,
    transparent: hasCollision,
    opacity,
  });
  const handMat = new THREE.MeshStandardMaterial({
    color: 0x111111,
    roughness: 0.5,
    transparent: hasCollision,
    opacity,
  });

  const radius = Math.min(item.width, item.height) / 2;
  const ring = mesh(
    THREE,
    new THREE.CylinderGeometry(radius, radius, item.depth, 32),
    frameMat
  );
  ring.rotation.x = Math.PI / 2;
  ring.position.y = item.height / 2;
  group.add(ring);

  const face = mesh(
    THREE,
    new THREE.CylinderGeometry(radius * 0.9, radius * 0.9, item.depth * 0.5, 32),
    faceMat
  );
  face.rotation.x = Math.PI / 2;
  face.position.y = item.height / 2;
  face.position.z = item.depth * 0.26;
  group.add(face);

  // Hour and minute hands pointing roughly to 10:10 — the universal
  // "happy clock" pose.
  const hour = mesh(
    THREE,
    new THREE.BoxGeometry(radius * 0.45, 0.012, 0.014),
    handMat
  );
  hour.position.set(-radius * 0.18, item.height / 2 + radius * 0.12, item.depth * 0.5);
  hour.rotation.z = Math.PI * 0.18;
  group.add(hour);
  const minute = mesh(
    THREE,
    new THREE.BoxGeometry(radius * 0.62, 0.010, 0.012),
    handMat
  );
  minute.position.set(radius * 0.20, item.height / 2 + radius * 0.20, item.depth * 0.5);
  minute.rotation.z = -Math.PI * 0.18;
  group.add(minute);

  // Tick marks at 12 / 3 / 6 / 9.
  const tickGeo = new THREE.BoxGeometry(0.03, 0.06, 0.01);
  const ticks: ReadonlyArray<readonly [number, number]> = [
    [0, radius * 0.78],
    [radius * 0.78, 0],
    [0, -radius * 0.78],
    [-radius * 0.78, 0],
  ];
  for (const [tx, ty] of ticks) {
    const tick = mesh(THREE, tickGeo, handMat);
    tick.position.set(tx, item.height / 2 + ty, item.depth * 0.5);
    group.add(tick);
  }

  return group;
}

export function buildCandles({ THREE, item, hasCollision, baseColor, opacity }: BuilderContext): ThreeNS.Group {
  const group = new THREE.Group();
  const waxMat = new THREE.MeshStandardMaterial({
    color: baseColor,
    roughness: 0.6,
    transparent: hasCollision,
    opacity,
  });
  const wickMat = new THREE.MeshStandardMaterial({
    color: 0x111111,
    roughness: 0.9,
    transparent: hasCollision,
    opacity,
  });
  const flameMat = new THREE.MeshStandardMaterial({
    color: 0xffa726,
    emissive: 0xffd54f,
    emissiveIntensity: 0.9,
    roughness: 0.2,
    transparent: hasCollision,
    opacity,
  });
  const trayMat = new THREE.MeshStandardMaterial({
    color: 0xb0a094,
    roughness: 0.7,
    transparent: hasCollision,
    opacity,
  });

  const tray = mesh(
    THREE,
    new THREE.BoxGeometry(item.width, item.height * 0.08, item.depth),
    trayMat
  );
  tray.position.y = item.height * 0.04;
  group.add(tray);

  const candleSpecs: ReadonlyArray<readonly [number, number]> = [
    [-item.width * 0.30, 1.0],
    [0, 1.2],
    [item.width * 0.30, 0.85],
  ];
  for (const [px, heightMult] of candleSpecs) {
    const hCandle = item.height * 0.75 * heightMult;
    const candle = mesh(
      THREE,
      new THREE.CylinderGeometry(0.035, 0.04, hCandle, 12),
      waxMat
    );
    candle.position.set(px, item.height * 0.08 + hCandle / 2, 0);
    group.add(candle);
    const wick = mesh(
      THREE,
      new THREE.CylinderGeometry(0.005, 0.005, 0.04, 6),
      wickMat
    );
    wick.position.set(px, item.height * 0.08 + hCandle + 0.02, 0);
    group.add(wick);
    const flame = mesh(THREE, new THREE.ConeGeometry(0.025, 0.08, 8), flameMat);
    flame.position.set(px, item.height * 0.08 + hCandle + 0.08, 0);
    group.add(flame);
  }

  return group;
}

export function buildBooksStack({ THREE, item, hasCollision, baseColor, opacity }: BuilderContext): ThreeNS.Group {
  const group = new THREE.Group();
  const covers = [baseColor, 0x2c6e49, 0xd4a373, 0x6f1d1b];
  const stackHeight = item.height * 0.9;
  const bookCount = 4;
  const slabHeight = stackHeight / bookCount;
  for (let i = 0; i < bookCount; i += 1) {
    const cover = covers[i % covers.length]!;
    const mat = new THREE.MeshStandardMaterial({
      color: cover,
      roughness: 0.85,
      transparent: hasCollision,
      opacity,
    });
    const wiggleX = Math.sin(i * 1.7) * item.width * 0.05;
    const wiggleZ = Math.cos(i * 1.3) * item.depth * 0.05;
    const book = mesh(
      THREE,
      new THREE.BoxGeometry(item.width * (0.85 + (i % 2) * 0.1), slabHeight * 0.95, item.depth * 0.92),
      mat
    );
    book.position.set(wiggleX, slabHeight / 2 + i * slabHeight, wiggleZ);
    book.rotation.y = (i % 2 === 0 ? 1 : -1) * 0.04;
    group.add(book);
  }
  return group;
}
