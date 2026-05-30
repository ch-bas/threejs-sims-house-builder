import type * as ThreeNS from 'three';
import { type BuilderContext, mesh } from '../builder-utils';

export function buildBookshelf({ THREE, item, hasCollision, baseColor, opacity }: BuilderContext): ThreeNS.Group {
  const group = new THREE.Group();
  const shelfMat = new THREE.MeshStandardMaterial({ color: baseColor, roughness: 0.7, transparent: hasCollision, opacity });

  const back = mesh(THREE, new THREE.BoxGeometry(item.width, item.height, item.depth * 0.1), shelfMat);
  back.position.set(0, item.height / 2, -item.depth * 0.45);
  group.add(back);

  const sideGeo = new THREE.BoxGeometry(item.width * 0.05, item.height, item.depth);
  for (const dx of [-1, 1]) {
    const side = mesh(THREE, sideGeo, shelfMat);
    side.position.set(dx * item.width * 0.475, item.height / 2, 0);
    group.add(side);
  }

  const shelfGeo = new THREE.BoxGeometry(item.width * 0.9, item.height * 0.05, item.depth * 0.9);
  for (let i = 0; i < 4; i++) {
    const shelf = mesh(THREE, shelfGeo, shelfMat);
    shelf.position.set(0, (item.height / 4) * i + item.height * 0.025, 0);
    group.add(shelf);
  }

  const BOOK_COLORS = [0xff6b6b, 0x4ecdc4, 0x45b7d1, 0xffa07a, 0x98d8c8];
  for (let i = 1; i < 4; i++) {
    const color = BOOK_COLORS[i % BOOK_COLORS.length];
    if (color === undefined) continue;
    const book = mesh(
      THREE,
      new THREE.BoxGeometry(item.width * 0.1, item.height * 0.15, item.depth * 0.6),
      new THREE.MeshStandardMaterial({ color, roughness: 0.8, transparent: hasCollision, opacity })
    );
    book.position.set(-item.width * 0.3 + i * 0.15, (item.height / 4) * i + item.height * 0.12, 0);
    group.add(book);
  }

  return group;
}

export function buildCabinet({ THREE, item, hasCollision, baseColor, opacity }: BuilderContext): ThreeNS.Group {
  const group = new THREE.Group();
  const bodyMat = new THREE.MeshStandardMaterial({ color: baseColor, roughness: 0.7, transparent: hasCollision, opacity });
  const accentMat = new THREE.MeshStandardMaterial({ color: 0x424242, metalness: 0.6, roughness: 0.3, transparent: hasCollision, opacity });

  const body = mesh(THREE, new THREE.BoxGeometry(item.width, item.height, item.depth), bodyMat);
  body.position.y = item.height / 2;
  group.add(body);

  // door split down the middle
  const doorGeo = new THREE.BoxGeometry(item.width * 0.48, item.height * 0.92, item.depth * 0.04);
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
