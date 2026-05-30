import type * as ThreeNS from 'three';
import { type BuilderContext, mesh } from '../builder-utils';

export function buildPerson({ THREE, item, hasCollision, baseColor, opacity }: BuilderContext): ThreeNS.Group {
  const group = new THREE.Group();
  const skinMat = new THREE.MeshStandardMaterial({ color: baseColor, roughness: 0.7, transparent: hasCollision, opacity });
  const clothesMat = new THREE.MeshStandardMaterial({ color: 0x3949ab, roughness: 0.8, transparent: hasCollision, opacity });
  const trouserMat = new THREE.MeshStandardMaterial({ color: 0x1f2937, roughness: 0.8, transparent: hasCollision, opacity });

  // Legs (cylinders)
  const legGeo = new THREE.CylinderGeometry(0.08, 0.08, item.height * 0.45, 10);
  for (const dx of [-0.1, 0.1]) {
    const leg = mesh(THREE, legGeo, trouserMat);
    leg.position.set(dx, item.height * 0.225, 0);
    group.add(leg);
  }

  // Torso
  const torso = mesh(
    THREE,
    new THREE.CylinderGeometry(0.18, 0.22, item.height * 0.35, 14),
    clothesMat
  );
  torso.position.y = item.height * 0.6;
  group.add(torso);

  // Arms
  const armGeo = new THREE.CylinderGeometry(0.06, 0.06, item.height * 0.42, 10);
  for (const dx of [-0.25, 0.25]) {
    const arm = mesh(THREE, armGeo, clothesMat);
    arm.position.set(dx, item.height * 0.6, 0);
    group.add(arm);
  }

  // Head
  const head = mesh(THREE, new THREE.SphereGeometry(0.13, 16, 14), skinMat);
  head.position.y = item.height * 0.92;
  group.add(head);

  return group;
}

export function buildPet({ THREE, item, hasCollision, baseColor, opacity }: BuilderContext): ThreeNS.Group {
  const group = new THREE.Group();
  const furMat = new THREE.MeshStandardMaterial({ color: baseColor, roughness: 0.85, transparent: hasCollision, opacity });
  const noseMat = new THREE.MeshStandardMaterial({ color: 0x1b1b1b, roughness: 0.6, transparent: hasCollision, opacity });

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
  for (const dx of [-1, 1]) {
    for (const dz of [-1, 1]) {
      const leg = mesh(THREE, legGeo, furMat);
      leg.position.set(dx * item.width * 0.25, item.height * 0.225, dz * item.depth * 0.55);
      group.add(leg);
    }
  }

  // Tail
  const tail = mesh(THREE, new THREE.CylinderGeometry(0.03, 0.05, item.depth * 0.7, 8), furMat);
  tail.position.set(0, item.height * 0.7, item.depth * 0.95);
  tail.rotation.x = -Math.PI / 3;
  group.add(tail);

  return group;
}
