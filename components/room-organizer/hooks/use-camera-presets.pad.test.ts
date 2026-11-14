import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { ZOOM_IN_FACTOR, ZOOM_OUT_FACTOR } from '../lib/camera-zoom';
import { ORBIT_MAX_POLAR } from '../lib/scene-insets';
import { orbitCamera, zoomCamera } from './use-camera-presets';
import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

const runtime = THREE as unknown as typeof import('../three/three-runtime');

function rig(position: [number, number, number]) {
  const camera = new THREE.PerspectiveCamera();
  camera.position.set(...position);
  const controls = { target: new THREE.Vector3(0, 0, 0), update: vi.fn() } as unknown as OrbitControls;
  return { camera, controls };
}

describe('the camera pad (orbitCamera, zoomCamera)', () => {
  it('zooms by the shared factors about the target', () => {
    const { camera, controls } = rig([0, 0, 10]);
    zoomCamera(camera, controls, '+');
    expect(camera.position.z).toBeCloseTo(10 * ZOOM_IN_FACTOR);
    zoomCamera(camera, controls, '-');
    expect(camera.position.z).toBeCloseTo(10 * ZOOM_IN_FACTOR * ZOOM_OUT_FACTOR);
    expect(controls.update).toHaveBeenCalledTimes(2);
  });

  it('orbits at a constant distance and never tilts past the polar limit', () => {
    const { camera, controls } = rig([0, 5, 5]);
    const distance = camera.position.length();
    orbitCamera(runtime, camera, controls, 'left');
    expect(camera.position.length()).toBeCloseTo(distance);
    for (let i = 0; i < 40; i++) orbitCamera(runtime, camera, controls, 'down');
    const phi = new THREE.Spherical().setFromVector3(camera.position).phi;
    expect(phi).toBeLessThanOrEqual(ORBIT_MAX_POLAR + 1e-9);
    for (let i = 0; i < 40; i++) orbitCamera(runtime, camera, controls, 'up');
    expect(new THREE.Spherical().setFromVector3(camera.position).phi).toBeCloseTo(0.15);
  });
});
