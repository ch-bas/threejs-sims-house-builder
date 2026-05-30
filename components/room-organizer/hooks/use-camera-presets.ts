import { useCallback } from 'react';
import type * as ThreeNS from 'three';
import type { OrbitControls as OrbitControlsType } from 'three/examples/jsm/controls/OrbitControls.js';
import type { CameraPreset } from '../lib/types';

interface PresetView {
  position: readonly [number, number, number];
  target: readonly [number, number, number];
}

const PRESETS: Record<CameraPreset, (size: number) => PresetView> = {
  iso: (size) => ({ position: [size * 0.8, size * 0.9, size * 0.8], target: [0, 0, 0] }),
  top: (size) => ({ position: [0, size * 1.6, 0.001], target: [0, 0, 0] }),
  front: (size) => ({ position: [0, size * 0.4, size * 1.4], target: [0, size * 0.3, 0] }),
  corner: (size) => ({ position: [size * 1.1, size * 0.6, -size * 0.6], target: [0, 0, 0] }),
};

export interface UseCameraPresetsOptions {
  cameraRef: React.MutableRefObject<ThreeNS.PerspectiveCamera | null>;
  controlsRef: React.MutableRefObject<OrbitControlsType | null>;
  roomSize: number;
  /** Total stacked building height in metres (floors × 3). */
  buildingHeight?: number;
}

export function useCameraPresets({ cameraRef, controlsRef, roomSize, buildingHeight = 3 }: UseCameraPresetsOptions): {
  applyPreset(preset: CameraPreset): void;
  focusOn(target: { x: number; z: number }, distance?: number): void;
  fitToRoom(): void;
} {
  const applyPreset = useCallback(
    (preset: CameraPreset) => {
      const camera = cameraRef.current;
      const controls = controlsRef.current;
      if (!camera) return;

      const view = PRESETS[preset](Math.max(2, roomSize));
      camera.position.set(view.position[0], view.position[1], view.position[2]);
      camera.lookAt(view.target[0], view.target[1], view.target[2]);

      if (controls) {
        controls.target.set(view.target[0], view.target[1], view.target[2]);
        controls.update();
      }
    },
    [cameraRef, controlsRef, roomSize]
  );

  const focusOn = useCallback(
    (target: { x: number; z: number }, distance = 3) => {
      const camera = cameraRef.current;
      const controls = controlsRef.current;
      if (!camera) return;

      camera.position.set(target.x + distance * 0.6, distance * 0.8, target.z + distance * 0.6);
      camera.lookAt(target.x, 0, target.z);

      if (controls) {
        controls.target.set(target.x, 0, target.z);
        controls.update();
      }
    },
    [cameraRef, controlsRef]
  );

  const fitToRoom = useCallback(() => {
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    if (!camera) return;

    // Frame the building diagonal plus roof headroom.
    const safeSize = Math.max(2, roomSize);
    const distance = Math.max(safeSize * 1.4, buildingHeight * 2.2);
    const targetY = buildingHeight / 2;

    camera.position.set(distance * 0.6, distance * 0.7 + targetY, distance * 0.6);
    camera.lookAt(0, targetY, 0);

    if (controls) {
      controls.target.set(0, targetY, 0);
      controls.update();
    }
  }, [cameraRef, controlsRef, roomSize, buildingHeight]);

  return { applyPreset, focusOn, fitToRoom };
}
