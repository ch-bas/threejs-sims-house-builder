import { type BuilderContext, EDGE, material, mergeParts, mesh, softBox } from '../builder-utils';
import { surfaceMaterial } from '../furniture-materials';
import type * as ThreeNS from 'three';

/** A kitchen door: its thickness, the gap around it and the toe kick under it. */
const FRONT_THICKNESS = 0.018;
const FRONT_GAP = 0.004;
const TOE_KICK = 0.1;
/** How far the carcass sits back so a door and its handle stay in the item's box. */
const FRONT_SETBACK = 0.035;
const HANDLE_SIZE = 0.012;

/**
 * Door fronts on a kitchen unit (#755), as parts placed in the unit's frame:
 * one door per half metre, which share the carcass's material, and the dark
 * trim, a panel behind the doors that shows as the gaps and the toe kick plus
 * a bar handle at the top of each door. Merged by material, the fronts add
 * one draw call to a unit, not three per door. `top` is where they stop.
 */
function cabinetFronts(
  THREE: BuilderContext['THREE'],
  item: BuilderContext['item'],
  top: number
): { doors: ThreeNS.BufferGeometry[]; trim: ThreeNS.BufferGeometry[] } {
  const faceZ = item.depth / 2 - FRONT_SETBACK;
  const kick = Math.min(TOE_KICK, top * 0.15);
  const trim: ThreeNS.BufferGeometry[] = [new THREE.BoxGeometry(item.width - 0.002, top, 0.002).translate(0, top / 2, faceZ + 0.001)];
  const doors: ThreeNS.BufferGeometry[] = [];
  const count = Math.max(1, Math.round(item.width / 0.5));
  const pitch = item.width / count;
  const doorHeight = top - kick - FRONT_GAP;
  const doorZ = faceZ + 0.003 + FRONT_THICKNESS / 2;
  for (let i = 0; i < count; i += 1) {
    const x = (i + 0.5 - count / 2) * pitch;
    doors.push(softBox(THREE, pitch - FRONT_GAP, doorHeight, FRONT_THICKNESS, EDGE.wood).translate(x, kick + doorHeight / 2, doorZ));
    trim.push(
      softBox(THREE, Math.min(0.14, pitch * 0.5), HANDLE_SIZE, HANDLE_SIZE, 0.003).translate(
        x,
        top - 0.06,
        doorZ + FRONT_THICKNESS / 2 + 0.002 + HANDLE_SIZE / 2
      )
    );
  }
  return { doors, trim };
}

export function buildFridge(ctx: BuilderContext): ThreeNS.Group {
  const { THREE, item, baseColor } = ctx;
  const group = new THREE.Group();
  // Enamelled steel: a bare metal body only mirrors the dim room and turns black.
  const bodyMat = surfaceMaterial(ctx, baseColor, 'painted');
  const accentMat = surfaceMaterial(ctx, 0x424242, 'brushedMetal');

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

export function buildStove(ctx: BuilderContext): ThreeNS.Group {
  const { THREE, item, hasCollision, baseColor, opacity } = ctx;
  const group = new THREE.Group();
  const bodyMat = surfaceMaterial(ctx, baseColor, 'painted');
  const burnerMat = material(THREE, 0x212121, hasCollision, opacity, { roughness: 0.3, metalness: 1 });
  const doorMat = material(THREE, 0x616161, hasCollision, opacity, { roughness: 0.2, metalness: 1 });

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
  const { THREE, item, baseColor } = ctx;
  const group = new THREE.Group();
  const baseMat = surfaceMaterial(ctx, baseColor, 'painted');
  const metalMat = surfaceMaterial(ctx, 0xb0bec5, 'brushedMetal');
  const top = item.height * 0.95;
  const { doors, trim } = cabinetFronts(THREE, item, top);

  const carcass = softBox(THREE, item.width, top, item.depth - FRONT_SETBACK, EDGE.wood).translate(0, top / 2, -FRONT_SETBACK / 2);
  group.add(mesh(THREE, mergeParts(THREE, [carcass, ...doors]), baseMat));

  // The basin is as dark as the trim, so it draws with it.
  const basin = softBox(THREE, item.width * 0.7, item.height * 0.1, item.depth * 0.65, EDGE.wood).translate(0, item.height * 0.99, 0);
  group.add(mesh(THREE, mergeParts(THREE, [...trim, basin]), surfaceMaterial(ctx, 0x2b2b2b, 'painted')));

  // tap
  const tapBase = new THREE.CylinderGeometry(0.03, 0.04, 0.18, 12).translate(0, item.height * 1.05, -item.depth * 0.35);
  const spout = new THREE.CylinderGeometry(0.02, 0.02, item.depth * 0.4, 12)
    .rotateX(Math.PI / 2)
    .translate(0, item.height * 1.15, -item.depth * 0.15);
  group.add(mesh(THREE, mergeParts(THREE, [tapBase, spout]), metalMat));
  return group;
}

export function buildCounter(ctx: BuilderContext): ThreeNS.Group {
  const { THREE, item, baseColor } = ctx;
  const group = new THREE.Group();
  const baseMat = surfaceMaterial(ctx, 0xf5f5f5, 'painted');
  const topMat = surfaceMaterial(ctx, baseColor, 'plastic');
  const height = item.height * 0.92;
  const { doors, trim } = cabinetFronts(THREE, item, height);

  const carcass = softBox(THREE, item.width, height, item.depth - FRONT_SETBACK, EDGE.wood).translate(0, height / 2, -FRONT_SETBACK / 2);
  group.add(mesh(THREE, mergeParts(THREE, [carcass, ...doors]), baseMat));
  group.add(mesh(THREE, mergeParts(THREE, trim), surfaceMaterial(ctx, 0x2b2b2b, 'painted')));

  const top = mesh(THREE, softBox(THREE, item.width * 1.02, item.height * 0.05, item.depth * 1.02, EDGE.wood), topMat);
  top.position.y = item.height * 0.945;
  group.add(top);
  return group;
}
