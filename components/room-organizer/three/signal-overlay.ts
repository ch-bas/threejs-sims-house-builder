import type * as ThreeNS from 'three';
import type { FurnitureItem } from '../lib/types';
import { ROOM_OBJECT_TAGS } from './room-builder';

type ThreeModule = typeof import('three');

const WIFI_RING_COLORS = [0x00ff00, 0xffff00, 0xff6600] as const;
const CCTV_RING_COLORS = [0x0088ff, 0x00ddff, 0x8800ff] as const;

const RING_COUNT = 3;

export function addSignalOverlays(
  THREE: ThreeModule,
  scene: ThreeNS.Scene,
  items: readonly FurnitureItem[],
  yOffset = 0
): void {
  for (const item of items) {
    if (!item.position || !item.signalRange) continue;
    if (item.isWiFiAccessPoint) {
      addRings(THREE, scene, item.position, item.signalRange, WIFI_RING_COLORS, 0.3, 0.08, yOffset);
    } else if (item.isCCTV) {
      addRings(THREE, scene, item.position, item.signalRange, CCTV_RING_COLORS, 0.25, 0.06, yOffset);
    }
  }
}

function addRings(
  THREE: ThreeModule,
  scene: ThreeNS.Scene,
  position: { x: number; z: number },
  range: number,
  colors: readonly number[],
  startOpacity: number,
  opacityFalloff: number,
  yOffset: number
): void {
  for (let i = 1; i <= RING_COUNT; i++) {
    const radius = (range * i) / RING_COUNT;
    const geometry = new THREE.RingGeometry(radius - 0.05, radius + 0.05, 64);
    const material = new THREE.MeshBasicMaterial({
      color: colors[i - 1],
      transparent: true,
      opacity: startOpacity - (i - 1) * opacityFalloff,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(position.x, yOffset + 0.01, position.z);
    mesh.rotation.x = -Math.PI / 2;
    mesh.userData.type = ROOM_OBJECT_TAGS.Signal;
    scene.add(mesh);
  }
}
