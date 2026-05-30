import type * as ThreeNS from 'three';
import { type BuilderContext, mesh } from '../builder-utils';

export function buildDoor({ THREE, item, hasCollision, baseColor, opacity }: BuilderContext): ThreeNS.Group {
  const group = new THREE.Group();
  const frameMat = new THREE.MeshStandardMaterial({
    color: baseColor,
    roughness: 0.7,
    transparent: hasCollision,
    opacity,
  });
  const handleMat = new THREE.MeshStandardMaterial({
    color: 0xd7c483,
    metalness: 0.8,
    roughness: 0.2,
    transparent: hasCollision,
    opacity,
  });

  // Door slab (almost as wide and tall as the wall opening).
  const slab = mesh(
    THREE,
    new THREE.BoxGeometry(item.width * 0.95, item.height * 0.97, item.depth * 0.5),
    frameMat
  );
  slab.position.set(0, item.height / 2, 0);
  group.add(slab);

  // Frame around the slab — three thin boxes (left, right, top).
  const frameThickness = 0.06;
  const sideGeo = new THREE.BoxGeometry(frameThickness, item.height, item.depth);
  for (const dx of [-1, 1]) {
    const side = mesh(THREE, sideGeo, frameMat);
    side.position.set(dx * (item.width / 2 - frameThickness / 2), item.height / 2, 0);
    group.add(side);
  }
  const lintel = mesh(
    THREE,
    new THREE.BoxGeometry(item.width, frameThickness, item.depth),
    frameMat
  );
  lintel.position.set(0, item.height - frameThickness / 2, 0);
  group.add(lintel);

  // Handle.
  const handle = mesh(THREE, new THREE.SphereGeometry(0.04, 12, 10), handleMat);
  handle.position.set(item.width * 0.35, item.height * 0.5, item.depth * 0.28);
  group.add(handle);

  return group;
}

export function buildWindow({ THREE, item, hasCollision, baseColor, opacity }: BuilderContext): ThreeNS.Group {
  const group = new THREE.Group();
  const frameMat = new THREE.MeshStandardMaterial({
    color: 0xf5f5f5,
    roughness: 0.5,
    transparent: hasCollision,
    opacity,
  });
  const sillMat = new THREE.MeshStandardMaterial({
    color: 0xe6e6e6,
    roughness: 0.6,
    transparent: hasCollision,
    opacity,
  });
  const glassMat = new THREE.MeshStandardMaterial({
    color: baseColor,
    roughness: 0.05,
    metalness: 0.25,
    transparent: true,
    opacity: hasCollision ? 0.5 : 0.4,
  });

  // Glass pane.
  const glass = mesh(
    THREE,
    new THREE.BoxGeometry(item.width * 0.95, item.height * 0.95, item.depth * 0.2),
    glassMat
  );
  glass.position.set(0, item.height / 2, 0);
  group.add(glass);

  // Outer frame (4 sides).
  const frameThickness = 0.06;
  const horizGeo = new THREE.BoxGeometry(item.width, frameThickness, item.depth);
  const top = mesh(THREE, horizGeo, frameMat);
  top.position.set(0, item.height - frameThickness / 2, 0);
  group.add(top);
  const bottom = mesh(THREE, horizGeo, frameMat);
  bottom.position.set(0, frameThickness / 2, 0);
  group.add(bottom);

  const vertGeo = new THREE.BoxGeometry(frameThickness, item.height, item.depth);
  for (const dx of [-1, 1]) {
    const side = mesh(THREE, vertGeo, frameMat);
    side.position.set(dx * (item.width / 2 - frameThickness / 2), item.height / 2, 0);
    group.add(side);
  }

  // Cross mullion — vertical + horizontal — for the classic 4-pane look.
  const mullionThickness = frameThickness * 0.5;
  const vMullion = mesh(
    THREE,
    new THREE.BoxGeometry(mullionThickness, item.height * 0.95, item.depth * 0.55),
    frameMat
  );
  vMullion.position.set(0, item.height / 2, 0);
  group.add(vMullion);
  const hMullion = mesh(
    THREE,
    new THREE.BoxGeometry(item.width * 0.95, mullionThickness, item.depth * 0.55),
    frameMat
  );
  hMullion.position.set(0, item.height / 2, 0);
  group.add(hMullion);

  // Outer sill projecting beyond the wall plane — the little ledge under
  // every window.
  const sill = mesh(
    THREE,
    new THREE.BoxGeometry(item.width + 0.08, frameThickness * 1.2, item.depth * 2.2),
    sillMat
  );
  sill.position.set(0, frameThickness * 0.6, 0);
  group.add(sill);

  return group;
}

export function buildStairs({ THREE, item, hasCollision, baseColor, opacity }: BuilderContext): ThreeNS.Group {
  const group = new THREE.Group();
  const stepMat = new THREE.MeshStandardMaterial({
    color: baseColor,
    roughness: 0.85,
    transparent: hasCollision,
    opacity,
  });
  const railMat = new THREE.MeshStandardMaterial({
    color: 0x424242,
    roughness: 0.5,
    metalness: 0.6,
    transparent: hasCollision,
    opacity,
  });

  // Item height is the rise to the next floor; build steps that span the depth.
  const stepCount = 14;
  const stepRise = item.height / stepCount;
  const stepRun = item.depth / stepCount;

  for (let i = 0; i < stepCount; i++) {
    const stepGeo = new THREE.BoxGeometry(item.width, stepRise, stepRun + 0.04);
    const step = mesh(THREE, stepGeo, stepMat);
    step.position.set(
      0,
      stepRise * (i + 0.5),
      -item.depth / 2 + stepRun * (i + 0.5)
    );
    group.add(step);
  }

  // Stringers along each side.
  const stringerGeo = new THREE.BoxGeometry(0.06, item.height * 0.18, item.depth + 0.1);
  for (const dx of [-1, 1]) {
    const stringer = mesh(THREE, stringerGeo, stepMat);
    // Run the stringer along the slope.
    const angle = Math.atan2(item.height, item.depth);
    stringer.rotation.x = -angle;
    stringer.position.set(dx * (item.width / 2 - 0.05), item.height / 2, 0);
    group.add(stringer);
  }

  // Handrails.
  const railLength = Math.hypot(item.depth, item.height);
  const railGeo = new THREE.CylinderGeometry(0.03, 0.03, railLength, 10);
  for (const dx of [-1, 1]) {
    const rail = mesh(THREE, railGeo, railMat);
    rail.rotation.x = Math.atan2(item.depth, item.height);
    rail.position.set(dx * (item.width / 2 + 0.04), item.height / 2 + 0.4, 0);
    group.add(rail);
  }

  return group;
}
