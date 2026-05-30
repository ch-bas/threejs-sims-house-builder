import { useEffect, useRef } from 'react';
import type * as ThreeNS from 'three';

type ThreeModule = typeof import('three');

const NPC_TAG = 'npc';

interface NpcState {
  group: ThreeNS.Group;
  position: { x: number; z: number };
  target: { x: number; z: number };
  speed: number;
  /** Used to drive the leg-bob animation. */
  phase: number;
  legs: ThreeNS.Object3D[];
}

export interface UseNpcsOptions {
  enabled: boolean;
  count?: number;
  threeModuleRef: React.MutableRefObject<ThreeModule | null>;
  sceneRef: React.MutableRefObject<ThreeNS.Scene | null>;
  roomWidth: number;
  roomDepth: number;
  /** Y-offset to plant the NPCs on the active floor. */
  floorY: number;
}

/**
 * Sprinkles a few procedurally-built human figures into the scene and
 * walks them between random waypoints inside the room. Cleanup tears
 * down all NPC meshes and the RAF loop on every dependency change.
 */
export function useNpcs(options: UseNpcsOptions): void {
  const { enabled, count = 3, threeModuleRef, sceneRef, roomWidth, roomDepth, floorY } = options;
  const stateRef = useRef<NpcState[]>([]);

  useEffect(() => {
    if (!enabled) return undefined;
    const THREE = threeModuleRef.current;
    const scene = sceneRef.current;
    if (!THREE || !scene) return undefined;

    const halfW = roomWidth / 2 - 0.4;
    const halfD = roomDepth / 2 - 0.4;
    if (halfW <= 0.2 || halfD <= 0.2) return undefined;

    const npcs: NpcState[] = [];
    for (let i = 0; i < count; i++) {
      const npc = createNpc(THREE, scene, halfW, halfD, floorY, i);
      npcs.push(npc);
    }
    stateRef.current = npcs;

    let rafId = 0;
    let lastTime = performance.now();
    const tick = () => {
      rafId = requestAnimationFrame(tick);
      const now = performance.now();
      const delta = Math.min(0.1, (now - lastTime) / 1000);
      lastTime = now;
      stepNpcs(stateRef.current, delta, halfW, halfD, floorY);
    };
    rafId = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(rafId);
      for (const npc of stateRef.current) {
        scene.remove(npc.group);
        disposeGroup(npc.group);
      }
      stateRef.current = [];
    };
  }, [enabled, count, threeModuleRef, sceneRef, roomWidth, roomDepth, floorY]);
}

function createNpc(
  THREE: ThreeModule,
  scene: ThreeNS.Scene,
  halfW: number,
  halfD: number,
  floorY: number,
  index: number
): NpcState {
  const group = new THREE.Group();
  group.userData.type = NPC_TAG;

  const palette = [0xef9a9a, 0xa5d6a7, 0x90caf9, 0xffe082, 0xb39ddb];
  const shirtColor = palette[index % palette.length] ?? 0xef9a9a;
  const skinColor = 0xffccbc;
  const trouserColor = 0x37474f;

  const shirtMat = new THREE.MeshStandardMaterial({ color: shirtColor, roughness: 0.8 });
  const skinMat = new THREE.MeshStandardMaterial({ color: skinColor, roughness: 0.7 });
  const trouserMat = new THREE.MeshStandardMaterial({ color: trouserColor, roughness: 0.85 });

  // Legs — animated by bobbing in Y.
  const legGeo = new THREE.CylinderGeometry(0.08, 0.08, 0.8, 10);
  const legs: ThreeNS.Object3D[] = [];
  for (const dx of [-0.1, 0.1]) {
    const leg = new THREE.Mesh(legGeo, trouserMat);
    leg.position.set(dx, 0.4, 0);
    leg.castShadow = true;
    group.add(leg);
    legs.push(leg);
  }

  const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.22, 0.6, 14), shirtMat);
  torso.position.y = 1.1;
  torso.castShadow = true;
  group.add(torso);

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.13, 16, 14), skinMat);
  head.position.y = 1.55;
  head.castShadow = true;
  group.add(head);

  const armGeo = new THREE.CylinderGeometry(0.06, 0.06, 0.7, 10);
  for (const dx of [-0.25, 0.25]) {
    const arm = new THREE.Mesh(armGeo, shirtMat);
    arm.position.set(dx, 1.1, 0);
    arm.castShadow = true;
    group.add(arm);
  }

  const position = { x: rand(-halfW, halfW), z: rand(-halfD, halfD) };
  group.position.set(position.x, floorY, position.z);
  scene.add(group);

  return {
    group,
    position,
    target: { x: rand(-halfW, halfW), z: rand(-halfD, halfD) },
    speed: 0.6 + Math.random() * 0.5,
    phase: Math.random() * Math.PI * 2,
    legs,
  };
}

function stepNpcs(
  npcs: NpcState[],
  delta: number,
  halfW: number,
  halfD: number,
  floorY: number
): void {
  for (const npc of npcs) {
    const dx = npc.target.x - npc.position.x;
    const dz = npc.target.z - npc.position.z;
    const distance = Math.hypot(dx, dz);

    if (distance < 0.15) {
      npc.target = { x: rand(-halfW, halfW), z: rand(-halfD, halfD) };
      continue;
    }

    const step = npc.speed * delta;
    const nx = npc.position.x + (dx / distance) * step;
    const nz = npc.position.z + (dz / distance) * step;
    npc.position.x = clamp(nx, -halfW, halfW);
    npc.position.z = clamp(nz, -halfD, halfD);

    // Face the direction of travel.
    npc.group.rotation.y = Math.atan2(dx, dz);
    npc.group.position.x = npc.position.x;
    npc.group.position.z = npc.position.z;

    // Bob legs to mimic walking. Phase advances proportionally to speed.
    npc.phase += delta * 6;
    const swing = Math.sin(npc.phase) * 0.06;
    if (npc.legs[0]) npc.legs[0].position.y = 0.4 + swing;
    if (npc.legs[1]) npc.legs[1].position.y = 0.4 - swing;
    npc.group.position.y = floorY + Math.abs(swing) * 0.5;
  }
}

function disposeGroup(group: ThreeNS.Object3D): void {
  group.traverse((node) => {
    const mesh = node as ThreeNS.Mesh;
    if (mesh.geometry) mesh.geometry.dispose();
    const material = mesh.material;
    if (!material) return;
    if (Array.isArray(material)) material.forEach((m) => m.dispose());
    else material.dispose();
  });
}

function rand(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
