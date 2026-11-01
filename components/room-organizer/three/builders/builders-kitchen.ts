import { type BuilderContext, EDGE, material, mesh, softBox } from '../builder-utils';
import type * as ThreeNS from 'three';

/** A kitchen door: its thickness, the gap around it and the toe kick under it. */
const FRONT_THICKNESS = 0.018;
const FRONT_GAP = 0.004;
const TOE_KICK = 0.1;
/** How far the carcass sits back so a door and its handle stay in the item's box. */
const FRONT_SETBACK = 0.032;

/**
 * Door fronts on a kitchen unit (#755): a dark panel behind them shows as the
 * gaps and the toe kick, one door per half metre, a bar handle at the top of
 * each. `top` is where the fronts stop.
 */
function addCabinetFronts(
  { THREE, item, hasCollision, opacity }: BuilderContext,
  group: ThreeNS.Group,
  top: number,
  doorMat: ThreeNS.Material
): void {
  const faceZ = item.depth / 2 - FRONT_SETBACK;
  const kick = Math.min(TOE_KICK, top * 0.15);

  const reveal = mesh(
    THREE,
    new THREE.BoxGeometry(item.width - 0.002, top, 0.002),
    material(THREE, 0x2b2b2b, hasCollision, opacity, { roughness: 0.8 })
  );
  reveal.position.set(0, top / 2, faceZ + 0.001);
  group.add(reveal);

  const doors = Math.max(1, Math.round(item.width / 0.5));
  const pitch = item.width / doors;
  const doorHeight = top - kick - FRONT_GAP;
  const doorGeo = softBox(THREE, pitch - FRONT_GAP, doorHeight, FRONT_THICKNESS, EDGE.wood);
  const handleMat = material(THREE, 0xb0bec5, hasCollision, opacity, { metalness: 0.9, roughness: 0.3 });
  const handleGeo = softBox(THREE, Math.min(0.14, pitch * 0.5), 0.012, 0.012, 0.003);
  for (let i = 0; i < doors; i += 1) {
    const x = (i + 0.5 - doors / 2) * pitch;
    const door = mesh(THREE, doorGeo, doorMat);
    door.position.set(x, kick + doorHeight / 2, faceZ + 0.003 + FRONT_THICKNESS / 2);
    group.add(door);

    const handle = mesh(THREE, handleGeo, handleMat);
    handle.position.set(x, top - 0.06, faceZ + 0.003 + FRONT_THICKNESS + 0.006);
    group.add(handle);
  }
}

export function buildFridge({ THREE, item, hasCollision, baseColor, opacity }: BuilderContext): ThreeNS.Group {
  const group = new THREE.Group();
  const bodyMat = material(THREE, baseColor, hasCollision, opacity, { roughness: 0.35, metalness: 0.6 });
  const accentMat = material(THREE, 0x424242, hasCollision, opacity, { metalness: 0.8, roughness: 0.3 });

  const body = mesh(THREE, softBox(THREE, item.width, item.height, item.depth, EDGE.wood), bodyMat);
  body.position.y = item.height / 2;
  group.add(body);

  // Freezer/fridge split
  const splitGap = mesh(THREE, softBox(THREE, item.width * 0.95, 0.03, item.depth * 0.05, EDGE.wood), accentMat);
  splitGap.position.set(0, item.height * 0.55, item.depth * 0.51);
  group.add(splitGap);

  const handleGeo = new THREE.CylinderGeometry(0.015, 0.015, item.height * 0.35, 8);
  for (const y of [item.height * 0.78, item.height * 0.28]) {
    const handle = mesh(THREE, handleGeo, accentMat);
    handle.position.set(item.width * 0.42, y, item.depth * 0.55);
    group.add(handle);
  }
  return group;
}

export function buildStove({ THREE, item, hasCollision, baseColor, opacity }: BuilderContext): ThreeNS.Group {
  const group = new THREE.Group();
  const bodyMat = material(THREE, baseColor, hasCollision, opacity, { roughness: 0.5, metalness: 0.5 });
  const burnerMat = material(THREE, 0x212121, hasCollision, opacity, { roughness: 0.3, metalness: 0.7 });
  const doorMat = material(THREE, 0x616161, hasCollision, opacity, { roughness: 0.2, metalness: 0.8 });

  const body = mesh(THREE, softBox(THREE, item.width, item.height, item.depth, EDGE.wood), bodyMat);
  body.position.y = item.height / 2;
  group.add(body);

  // burner tops
  const burnerGeo = new THREE.CylinderGeometry(item.width * 0.18, item.width * 0.18, 0.02, 16);
  for (const [dx, dz] of [[-0.25, -0.25], [0.25, -0.25], [-0.25, 0.25], [0.25, 0.25]] as const) {
    const burner = mesh(THREE, burnerGeo, burnerMat);
    burner.position.set(dx * item.width, item.height * 1.005, dz * item.depth);
    group.add(burner);
  }

  // oven door window
  const window = mesh(
    THREE,
    softBox(THREE, item.width * 0.75, item.height * 0.45, item.depth * 0.04, EDGE.wood),
    doorMat
  );
  window.position.set(0, item.height * 0.3, item.depth * 0.52);
  group.add(window);
  return group;
}

export function buildSink(ctx: BuilderContext): ThreeNS.Group {
  const { THREE, item, hasCollision, baseColor, opacity } = ctx;
  const group = new THREE.Group();
  const baseMat = material(THREE, baseColor, hasCollision, opacity, { roughness: 0.5 });
  const metalMat = material(THREE, 0xb0bec5, hasCollision, opacity, { metalness: 0.9, roughness: 0.15 });

  const counter = mesh(THREE, softBox(THREE, item.width, item.height * 0.95, item.depth - FRONT_SETBACK, EDGE.wood), baseMat);
  counter.position.set(0, item.height * 0.475, -FRONT_SETBACK / 2);
  group.add(counter);
  addCabinetFronts(ctx, group, item.height * 0.95, baseMat);

  // basin
  const basin = mesh(
    THREE,
    softBox(THREE, item.width * 0.7, item.height * 0.1, item.depth * 0.65, EDGE.wood),
    material(THREE, 0x212121, hasCollision, opacity, { roughness: 0.4 })
  );
  basin.position.set(0, item.height * 0.99, 0);
  group.add(basin);

  // tap
  const tapBase = mesh(THREE, new THREE.CylinderGeometry(0.03, 0.04, 0.18, 12), metalMat);
  tapBase.position.set(0, item.height * 1.05, -item.depth * 0.35);
  group.add(tapBase);

  const spout = mesh(THREE, new THREE.CylinderGeometry(0.02, 0.02, item.depth * 0.4, 12), metalMat);
  spout.rotation.x = Math.PI / 2;
  spout.position.set(0, item.height * 1.15, -item.depth * 0.15);
  group.add(spout);
  return group;
}

export function buildCounter(ctx: BuilderContext): ThreeNS.Group {
  const { THREE, item, hasCollision, baseColor, opacity } = ctx;
  const group = new THREE.Group();
  const baseMat = material(THREE, 0xf5f5f5, hasCollision, opacity, { roughness: 0.7 });
  const topMat = material(THREE, baseColor, hasCollision, opacity, { roughness: 0.4, metalness: 0.1 });

  const base = mesh(THREE, softBox(THREE, item.width, item.height * 0.92, item.depth - FRONT_SETBACK, EDGE.wood), baseMat);
  base.position.set(0, item.height * 0.46, -FRONT_SETBACK / 2);
  group.add(base);
  addCabinetFronts(ctx, group, item.height * 0.92, baseMat);

  const top = mesh(THREE, softBox(THREE, item.width * 1.02, item.height * 0.05, item.depth * 1.02, EDGE.wood), topMat);
  top.position.y = item.height * 0.945;
  group.add(top);
  return group;
}
