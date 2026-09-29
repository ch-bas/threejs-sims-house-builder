import type * as ThreeNS from 'three';

type ThreeModule = typeof import('three');

/** Reference height the figure is modelled at; callers scale the group. */
export const FIGURE_HEIGHT = 1.75;

export interface HumanFigureMaterials {
  skin: ThreeNS.Material;
  top: ThreeNS.Material;
  bottom: ThreeNS.Material;
  shoes: ThreeNS.Material;
  hair: ThreeNS.Material;
}

/** Pivots an animator can rotate: hips and shoulders swing about local X. */
export interface HumanFigureRig {
  leftHip: ThreeNS.Object3D;
  rightHip: ThreeNS.Object3D;
  leftShoulder: ThreeNS.Object3D;
  rightShoulder: ThreeNS.Object3D;
  leftKnee: ThreeNS.Object3D;
  rightKnee: ThreeNS.Object3D;
}

/**
 * A stylised, faceless scale figure (architectural-mannequin style), modelled
 * at 1.75 m, feet on y = 0, facing +Z. Limbs hang from hip/shoulder/knee pivots
 * so a walk cycle is a rotation, not a vertical bob.
 */
export function buildHumanFigure(
  THREE: ThreeModule,
  mats: HumanFigureMaterials
): { group: ThreeNS.Group; rig: HumanFigureRig } {
  const group = new THREE.Group();

  const add = (parent: ThreeNS.Object3D, geo: ThreeNS.BufferGeometry, mat: ThreeNS.Material) => {
    const m = new THREE.Mesh(geo, mat);
    m.castShadow = true;
    m.receiveShadow = true;
    parent.add(m);
    return m;
  };

  // --- Torso: a lathe profile (waist → chest → shoulders → neck base),
  // flattened front-to-back so it reads as a chest rather than a tube.
  const torsoProfile = [
    [0.0, 0.9],
    [0.135, 0.9],
    [0.14, 0.98],
    [0.13, 1.06],
    [0.155, 1.2],
    [0.17, 1.3],
    [0.165, 1.37],
    [0.13, 1.43],
    [0.06, 1.47],
    [0.0, 1.475],
  ].map(([r, y]) => new THREE.Vector2(r, y));
  const torso = add(group, new THREE.LatheGeometry(torsoProfile, 20), mats.top);
  torso.scale.z = 0.62;

  // Pelvis, in trouser colour, bridging torso and legs.
  const pelvis = add(group, new THREE.SphereGeometry(0.15, 18, 12), mats.bottom);
  pelvis.scale.set(1, 0.55, 0.66);
  pelvis.position.y = 0.9;

  // Neck + head (slightly egg-shaped) + hair cap for a readable facing.
  const neck = add(group, new THREE.CylinderGeometry(0.045, 0.052, 0.1, 12), mats.skin);
  neck.position.y = 1.5;
  const head = add(group, new THREE.SphereGeometry(0.1, 20, 16), mats.skin);
  head.scale.set(0.9, 1.12, 1);
  head.position.y = 1.635;
  const hair = add(
    group,
    new THREE.SphereGeometry(0.104, 20, 12, 0, Math.PI * 2, 0, Math.PI * 0.55),
    mats.hair
  );
  hair.scale.set(0.92, 1.12, 1.02);
  hair.position.set(0, 1.645, -0.008);
  hair.rotation.x = -0.35; // sweep back so the face side stays bare

  // --- Legs: hip pivot → thigh → knee pivot → shin → foot.
  const makeLeg = (side: 1 | -1) => {
    const hip = new THREE.Object3D();
    hip.position.set(side * 0.085, 0.9, 0);
    group.add(hip);
    const thigh = add(hip, new THREE.CapsuleGeometry(0.07, 0.34, 6, 12), mats.bottom);
    thigh.position.y = -0.215; // overlaps the knee so no seam opens mid-stride
    const knee = new THREE.Object3D();
    knee.position.y = -0.43;
    hip.add(knee);
    const shin = add(knee, new THREE.CapsuleGeometry(0.058, 0.33, 6, 12), mats.bottom);
    shin.position.y = -0.2;
    const foot = add(knee, new THREE.CapsuleGeometry(0.045, 0.14, 4, 10), mats.shoes);
    foot.rotation.x = Math.PI / 2;
    foot.scale.set(1.1, 1, 0.75);
    foot.position.set(0, -0.435, 0.045);
    return { hip, knee };
  };
  const left = makeLeg(-1);
  const right = makeLeg(1);

  // --- Arms: shoulder pivot → upper arm → elbow → forearm → hand.
  const makeArm = (side: 1 | -1) => {
    const shoulder = new THREE.Object3D();
    shoulder.position.set(side * 0.205, 1.39, 0);
    shoulder.rotation.z = side * 0.09; // hang clear of the chest
    group.add(shoulder);
    const upper = add(shoulder, new THREE.CapsuleGeometry(0.048, 0.22, 6, 10), mats.top);
    upper.position.y = -0.15;
    const elbow = new THREE.Object3D();
    elbow.position.y = -0.29;
    elbow.rotation.x = 0.12; // relaxed bend
    shoulder.add(elbow);
    const fore = add(elbow, new THREE.CapsuleGeometry(0.038, 0.19, 6, 10), mats.skin);
    fore.position.y = -0.13;
    const hand = add(elbow, new THREE.SphereGeometry(0.045, 12, 10), mats.skin);
    hand.scale.set(0.7, 1.25, 0.95);
    hand.position.y = -0.3;
    return shoulder;
  };

  return {
    group,
    rig: {
      leftHip: left.hip,
      rightHip: right.hip,
      leftKnee: left.knee,
      rightKnee: right.knee,
      leftShoulder: makeArm(-1),
      rightShoulder: makeArm(1),
    },
  };
}

/** Pose the rig at a point in the walk cycle; `amount` 0 = standing still. */
export function poseWalk(rig: HumanFigureRig, phase: number, amount = 1): void {
  const s = Math.sin(phase) * amount;
  rig.leftHip.rotation.x = s * 0.45;
  rig.rightHip.rotation.x = -s * 0.45;
  // Knees only bend backwards, and mostly on the trailing leg.
  rig.leftKnee.rotation.x = Math.max(0, -Math.sin(phase + 0.6)) * 0.6 * amount;
  rig.rightKnee.rotation.x = Math.max(0, Math.sin(phase + 0.6)) * 0.6 * amount;
  rig.leftShoulder.rotation.x = -s * 0.35;
  rig.rightShoulder.rotation.x = s * 0.35;
}
