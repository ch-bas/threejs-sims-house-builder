import { type BuilderContext, EDGE, material, mesh, softBox } from '../builder-utils';
import { surfaceMaterial } from '../furniture-materials';
import type * as ThreeNS from 'three';

export function buildBookshelf(ctx: BuilderContext): ThreeNS.Group {
  const { THREE, item, hasCollision, baseColor, opacity } = ctx;
  const group = new THREE.Group();
  const shelfMat = surfaceMaterial(ctx, baseColor, 'woodOiled', { detailed: true });

  const back = mesh(THREE, softBox(THREE, item.width, item.height, item.depth * 0.1, EDGE.wood), shelfMat);
  back.position.set(0, item.height / 2, -item.depth * 0.45);
  group.add(back);

  const sideGeo = softBox(THREE, item.width * 0.05, item.height, item.depth, EDGE.wood);
  for (const dx of [-1, 1]) {
    const side = mesh(THREE, sideGeo, shelfMat);
    side.position.set(dx * item.width * 0.475, item.height / 2, 0);
    group.add(side);
  }

  const shelfGeo = softBox(THREE, item.width * 0.9, item.height * 0.05, item.depth * 0.9, EDGE.wood);
  for (let i = 0; i < 4; i++) {
    const shelf = mesh(THREE, shelfGeo, shelfMat);
    shelf.position.set(0, (item.height / 4) * i + item.height * 0.025, 0);
    group.add(shelf);
  }

  const BOOK_COLORS = [0xff6b6b, 0x4ecdc4, 0x45b7d1, 0xffa07a, 0x98d8c8];
  // Every book is the same size — share one geometry; only the material
  // (per-book colour) differs.
  const bookGeo = softBox(THREE, item.width * 0.1, item.height * 0.15, item.depth * 0.6, EDGE.wood);
  for (let i = 1; i < 4; i++) {
    const color = BOOK_COLORS[i % BOOK_COLORS.length];
    if (color === undefined) continue;
    const book = mesh(
      THREE,
      bookGeo,
      material(THREE, color, hasCollision, opacity, { roughness: 0.8 })
    );
    book.position.set(-item.width * 0.3 + i * 0.15, (item.height / 4) * i + item.height * 0.12, 0);
    group.add(book);
  }

  return group;
}

export function buildCabinet(ctx: BuilderContext): ThreeNS.Group {
  const { THREE, item, baseColor } = ctx;
  const group = new THREE.Group();
  // The dishwasher shares this builder, and it isn't timber.
  const bodyMat = item.type === 'dishwasher'
    ? surfaceMaterial(ctx, baseColor, 'painted')
    : surfaceMaterial(ctx, baseColor, 'woodLacquered', { detailed: true });
  const accentMat = surfaceMaterial(ctx, 0x424242, 'brushedMetal');

  const body = mesh(THREE, softBox(THREE, item.width, item.height, item.depth, EDGE.wood), bodyMat);
  body.position.y = item.height / 2;
  group.add(body);

  // door split down the middle
  const doorGeo = softBox(THREE, item.width * 0.48, item.height * 0.92, item.depth * 0.04, EDGE.wood);
  for (const dx of [-1, 1]) {
    const door = mesh(THREE, doorGeo, bodyMat);
    door.position.set(dx * item.width * 0.245, item.height * 0.5, item.depth * 0.52);
    group.add(door);

    const handle = mesh(THREE, new THREE.CylinderGeometry(0.015, 0.015, 0.18, 8), accentMat);
    handle.position.set(dx * item.width * 0.04, item.height * 0.55, item.depth * 0.55);
    group.add(handle);
  }
  return group;
}
