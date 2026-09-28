import { type BuilderContext, cornerPositions, material, mesh } from '../builder-utils';
import { FIGURE_HEIGHT, buildHumanFigure } from './human-figure';
import type * as ThreeNS from 'three';

export function buildPerson({ THREE, item, hasCollision, baseColor, opacity }: BuilderContext): ThreeNS.Group {
  // The item colour dresses the figure; skin, trousers, shoes and hair are fixed.
  const { group: figure } = buildHumanFigure(THREE, {
    top: material(THREE, baseColor, hasCollision, opacity, { roughness: 0.8 }),
    skin: material(THREE, 0xd9a787, hasCollision, opacity, { roughness: 0.65 }),
    bottom: material(THREE, 0x2f3542, hasCollision, opacity, { roughness: 0.85 }),
    shoes: material(THREE, 0x1c1c1c, hasCollision, opacity, { roughness: 0.6 }),
    hair: material(THREE, 0x3b2a20, hasCollision, opacity, { roughness: 0.9 }),
  });
  // Scale uniformly from height so a resized person stays in proportion.
  figure.scale.setScalar(item.height / FIGURE_HEIGHT);
  const group = new THREE.Group();
  group.add(figure);
  return group;
}

export function buildPet({ THREE, item, hasCollision, baseColor, opacity }: BuilderContext): ThreeNS.Group {
  const group = new THREE.Group();
  const furMat = material(THREE, baseColor, hasCollision, opacity, { roughness: 0.85 });
  const noseMat = material(THREE, 0x1b1b1b, hasCollision, opacity, { roughness: 0.6 });

  // Body
  const body = mesh(
    THREE,
    new THREE.SphereGeometry(item.width * 0.45, 14, 12),
    furMat
  );
  body.scale.set(1, 0.7, 1.6);
  body.position.y = item.height * 0.55;
  group.add(body);

  // Head
  const head = mesh(THREE, new THREE.SphereGeometry(item.width * 0.32, 14, 12), furMat);
  head.position.set(0, item.height * 0.8, -item.depth * 0.9);
  group.add(head);

  // Nose
  const nose = mesh(THREE, new THREE.SphereGeometry(item.width * 0.06, 8, 8), noseMat);
  nose.position.set(0, item.height * 0.75, -item.depth * 1.25);
  group.add(nose);

  // Ears
  const earGeo = new THREE.ConeGeometry(item.width * 0.1, item.height * 0.25, 10);
  for (const dx of [-1, 1]) {
    const ear = mesh(THREE, earGeo, furMat);
    ear.position.set(dx * item.width * 0.18, item.height * 1.05, -item.depth * 0.9);
    ear.rotation.z = dx * 0.2;
    group.add(ear);
  }

  // Legs
  const legGeo = new THREE.CylinderGeometry(0.04, 0.05, item.height * 0.45, 8);
  for (const [x, y, z] of cornerPositions(item.width * 0.25, item.height * 0.225, item.depth * 0.55)) {
    const leg = mesh(THREE, legGeo, furMat);
    leg.position.set(x, y, z);
    group.add(leg);
  }

  // Tail
  const tail = mesh(THREE, new THREE.CylinderGeometry(0.03, 0.05, item.depth * 0.7, 8), furMat);
  tail.position.set(0, item.height * 0.7, item.depth * 0.95);
  tail.rotation.x = -Math.PI / 3;
  group.add(tail);

  return group;
}
