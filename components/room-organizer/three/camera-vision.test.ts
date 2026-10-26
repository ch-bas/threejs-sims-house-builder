import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { buildSightWalls } from '../lib/walk-collision';
import { addVisionCones, stepVisionCones } from './camera-vision';
import { ROOM_OBJECT_TAGS } from './room-builder';
import type { FurnitureItem, InteriorWall } from '../lib/types';

type ThreeModule = typeof import('./three-runtime');
const T = THREE as unknown as ThreeModule;

function item(overrides: Partial<FurnitureItem> & { type: string; position: { x: number; z: number } }): FurnitureItem {
  return { id: overrides.type, name: overrides.type, width: 0.5, depth: 0.5, height: 1, color: '#000', icon: '', rotation: 0, ...overrides };
}

// A camera in the middle of a 10 × 10 m storey, looking along +z with a 5 m reach.
const CAMERA = item({ id: 'cam', type: 'security-camera', height: 2.4, position: { x: 0, z: -2 }, hasVisionCone: true, visionRange: 5, visionFov: 90 });
const CHAIR = item({ id: 'chair', type: 'chair', position: { x: 0, z: 1.5 } });
const PARTITION: InteriorWall = { id: 'p', x1: -5, z1: 0, x2: 5, z2: 0 };

function cone(scene: THREE.Scene): THREE.Object3D {
  return scene.children.find((child) => child.userData.type === ROOM_OBJECT_TAGS.CameraVision)!;
}

/** A scene with the cone and a furniture group for the chair, as the effects build them. */
function sceneWith(items: FurnitureItem[], options?: Parameters<typeof addVisionCones>[6]): THREE.Scene {
  const scene = new THREE.Scene();
  addVisionCones(T, scene, items, 0, 0, 3, options);
  for (const target of items) {
    if (target.hasVisionCone || !target.position) continue;
    const group = new THREE.Group();
    group.position.set(target.position.x, 0, target.position.z);
    group.userData = { type: 'furniture', id: target.id, floorIndex: 0 };
    scene.add(group);
  }
  return scene;
}

/** Whether the cone is in its alert state after a step (the wedge's opacity at t = 0). */
function alerted(scene: THREE.Scene, walls?: Parameters<typeof stepVisionCones>[2]): boolean {
  stepVisionCones(scene, 0, walls);
  const wedge = (cone(scene).userData.vision as { wedge: THREE.Mesh }).wedge;
  return (wedge.material as THREE.MeshBasicMaterial).opacity > 0.2;
}

describe('camera vision cones and walls (#590)', () => {
  const building = (interiorWalls: InteriorWall[], items: FurnitureItem[]) => ({
    width: 10,
    depth: 10,
    floors: [{ items, interiorWalls }],
  });

  it('alerts on a chair in view', () => {
    const items = [CAMERA, CHAIR];
    expect(alerted(sceneWith(items))).toBe(true);
    expect(alerted(sceneWith(items), buildSightWalls(building([], items)))).toBe(true);
  });

  it('does not alert on a chair behind a partition', () => {
    const items = [CAMERA, CHAIR];
    expect(alerted(sceneWith(items), buildSightWalls(building([PARTITION], items)))).toBe(false);
  });

  it('sees through a door in the partition', () => {
    const door = item({ id: 'door', type: 'door', width: 0.9, depth: 0.1, height: 2.1, position: { x: 0, z: 0 } });
    const items = [CAMERA, CHAIR, door];
    expect(alerted(sceneWith(items), buildSightWalls(building([PARTITION], items)))).toBe(true);
  });

  it('does not alert on a walker behind a partition', () => {
    const scene = sceneWith([CAMERA]);
    const walker = new THREE.Group();
    walker.userData.type = 'npc';
    walker.position.set(0.5, 0, 1.5);
    scene.add(walker);
    expect(alerted(scene)).toBe(true);
    expect(alerted(scene, buildSightWalls(building([PARTITION], [CAMERA])))).toBe(false);
  });

  it('a camera on a wall still sees the room it faces', () => {
    // Hung on the partition itself, facing away from it.
    const onWall = { ...CAMERA, position: { x: 0, z: 0.02 } };
    const items = [onWall, CHAIR];
    expect(alerted(sceneWith(items), buildSightWalls(building([PARTITION], items)))).toBe(true);
  });
});

describe('camera vision cones on other storeys (#552)', () => {
  const materials = (scene: THREE.Scene) =>
    (cone(scene).userData.vision as { materials: THREE.Material[] }).materials;

  it('draw over the world by default, as on the active storey', () => {
    expect(materials(sceneWith([CAMERA])).every((material) => !material.depthTest)).toBe(true);
  });

  it('are hidden behind floor plates and walls when occludable', () => {
    expect(materials(sceneWith([CAMERA], { occludable: true })).every((material) => material.depthTest)).toBe(true);
  });
});
