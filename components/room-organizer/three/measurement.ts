import type * as ThreeNS from 'three';
import type { Vec2 } from '../lib/types';

type ThreeModule = typeof import('three');

const MEASUREMENT_TAG = 'measurement';

export function clearMeasurement(scene: ThreeNS.Scene): void {
  scene.children
    .filter((obj) => obj.userData.type === MEASUREMENT_TAG)
    .forEach((obj) => scene.remove(obj));
}

/**
 * Render measurement markers — small green spheres at each point and, when
 * two points exist, a line connecting them. The numeric label is rendered
 * in HTML by the orchestrator; keeping it out of the scene avoids having
 * to load a font + Text geometry.
 */
export function renderMeasurement(
  THREE: ThreeModule,
  scene: ThreeNS.Scene,
  points: readonly Vec2[],
  yOffset = 0
): void {
  clearMeasurement(scene);
  if (points.length === 0) return;

  const sphereGeo = new THREE.SphereGeometry(0.08, 16, 12);
  const sphereMat = new THREE.MeshStandardMaterial({
    color: 0x10b981,
    emissive: 0x10b981,
    emissiveIntensity: 0.4,
  });
  for (const point of points) {
    const sphere = new THREE.Mesh(sphereGeo, sphereMat);
    sphere.position.set(point.x, yOffset + 0.05, point.z);
    sphere.userData.type = MEASUREMENT_TAG;
    scene.add(sphere);
  }

  if (points.length >= 2) {
    const lineMat = new THREE.LineBasicMaterial({ color: 0x10b981, linewidth: 2 });
    const lineGeo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(points[0]!.x, yOffset + 0.05, points[0]!.z),
      new THREE.Vector3(points[1]!.x, yOffset + 0.05, points[1]!.z),
    ]);
    const line = new THREE.Line(lineGeo, lineMat);
    line.userData.type = MEASUREMENT_TAG;
    scene.add(line);
  }
}

export function measurementDistance(points: readonly Vec2[]): number | null {
  if (points.length < 2) return null;
  const [a, b] = points;
  if (!a || !b) return null;
  return Math.hypot(a.x - b.x, a.z - b.z);
}
