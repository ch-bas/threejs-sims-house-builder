import { type BuilderContext, cornerPositions, material, mesh } from '../builder-utils';
import { PEOPLE_CLIPS, clonePerson, findClip, getPeopleModel } from '../people-model';
import { FIGURE_HEIGHT, buildHumanFigure } from './human-figure';
import type * as ThreeNS from 'three';

export function buildPerson(ctx: BuilderContext): ThreeNS.Group {
  return buildRiggedPerson(ctx) ?? buildProceduralPerson(ctx);
}

/**
 * The rigged mannequin, held in a still idle pose. Null until people.glb has
 * loaded — the scene rebuilds furniture once it has (see usePeopleModel).
 */
function buildRiggedPerson({ THREE, item, hasCollision, baseColor, opacity }: BuilderContext): ThreeNS.Group | null {
  const people = getPeopleModel();
  const idle = people && findClip(people, PEOPLE_CLIPS.idle);
  if (!people || !idle) return null;
  const person = clonePerson(THREE, people, {
    body: baseColor,
    joints: hasCollision ? 0x7f1d1d : 0x3a3f47,
    opacity,
  });
  // Sample the idle clip once to leave the skeleton in a relaxed stance. The
  // mixer is dropped rather than stopped: stopping restores the T-pose.
  const mixer = new THREE.AnimationMixer(person);
  mixer.clipAction(idle).play();
  mixer.update(0.6);
  person.scale.setScalar(item.height / people.height);
  const group = new THREE.Group();
  group.add(person);
  return group;
}

function buildProceduralPerson({ THREE, item, hasCollision, baseColor, opacity }: BuilderContext): ThreeNS.Group {
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

/**
 * A dog laid out nose-to-tail along the item's depth (−z is the nose) and
 * kept inside its width × depth × height box (#167): collision and wall-snap
 * read that box, so a snout past it went through walls and neighbours.
 */
export function buildPet({ THREE, item, hasCollision, baseColor, opacity }: BuilderContext): ThreeNS.Group {
  const group = new THREE.Group();
  const furMat = material(THREE, baseColor, hasCollision, opacity, { roughness: 0.85 });
  const noseMat = material(THREE, 0x1b1b1b, hasCollision, opacity, { roughness: 0.6 });
  const { width: w, depth: d, height: h } = item;
  const front = -d / 2;

  // Body: an ellipsoid over the middle 60 % of the depth, a touch to the rear.
  const bodyRadius = w * 0.4;
  const body = mesh(THREE, new THREE.SphereGeometry(bodyRadius, 14, 12), furMat);
  body.scale.set(1, Math.min(0.7, (h * 0.42) / bodyRadius), (d * 0.3) / bodyRadius);
  body.position.set(0, h * 0.5, d * 0.05);
  group.add(body);

  // Head just behind the nose, which touches the front of the box.
  const headRadius = Math.min(w * 0.3, d * 0.14, h * 0.25);
  const headY = h * 0.72;
  const headZ = front + headRadius + 0.02;
  const head = mesh(THREE, new THREE.SphereGeometry(headRadius, 14, 12), furMat);
  head.position.set(0, headY, headZ);
  group.add(head);

  const noseRadius = Math.min(w * 0.06, headRadius * 0.35);
  const nose = mesh(THREE, new THREE.SphereGeometry(noseRadius, 8, 8), noseMat);
  nose.position.set(0, headY - headRadius * 0.2, front + noseRadius);
  group.add(nose);

  // Ears, their tips at the top of the box.
  const earHeight = h * 0.18;
  const earGeo = new THREE.ConeGeometry(Math.min(w * 0.1, headRadius * 0.5), earHeight, 10);
  for (const dx of [-1, 1]) {
    const ear = mesh(THREE, earGeo, furMat);
    ear.position.set(dx * headRadius * 0.55, h - earHeight / 2, headZ);
    ear.rotation.z = dx * 0.2;
    group.add(ear);
  }

  // Legs under the body.
  const legGeo = new THREE.CylinderGeometry(0.04, 0.05, h * 0.45, 8);
  for (const [x, y, z] of cornerPositions(w * 0.25, h * 0.225, d * 0.22)) {
    const leg = mesh(THREE, legGeo, furMat);
    leg.position.set(x, y, z + d * 0.05);
    group.add(leg);
  }

  // Tail raised up and back, its tip at the back of the box.
  const tailLength = d * 0.22;
  const tailAngle = Math.PI / 4;
  const tail = mesh(THREE, new THREE.CylinderGeometry(0.03, 0.05, tailLength, 8), furMat);
  tail.rotation.x = tailAngle;
  tail.position.set(0, h * 0.6, d / 2 - 0.05 - (Math.sin(tailAngle) * tailLength) / 2);
  group.add(tail);

  return group;
}
