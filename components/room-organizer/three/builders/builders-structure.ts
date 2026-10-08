import { STAIR_STEP_COUNT, stairSteps, winderLayout } from '../../lib/stairs';
import { windowSillHeight } from '../../lib/street';
import { type BuilderContext, material, mesh } from '../builder-utils';
import type * as ThreeNS from 'three';

/**
 * Door and window meshes are built to the item's `height` (and a window's
 * `sillHeight`) exactly as the wall holes are cut, so frame and hole stay
 * flush (#212). The furniture effect hands them values already fitted to
 * the storey (`fitOpeningToStorey`, #277), so on a 2 m storey the door is
 * the 1.95 m of its hole rather than 2.05 m through the ceiling.
 */
export function buildDoor({ THREE, item, hasCollision, baseColor, opacity }: BuilderContext): ThreeNS.Group {
  const group = new THREE.Group();
  const frameMat = material(THREE, baseColor, hasCollision, opacity, { roughness: 0.7 });
  const handleMat = material(THREE, 0xd7c483, hasCollision, opacity, { metalness: 0.8, roughness: 0.2 });

  // Door slab (almost as wide and tall as the wall opening).
  const slab = mesh(
    THREE,
    new THREE.BoxGeometry(item.width * 0.95, item.height * 0.97, item.depth * 0.5),
    frameMat
  );
  slab.position.set(0, item.height / 2, 0);
  group.add(slab);

  // Frame around the slab — three thin boxes (left, right, top).
  const frameThickness = 0.06;
  const sideGeo = new THREE.BoxGeometry(frameThickness, item.height, item.depth);
  for (const dx of [-1, 1]) {
    const side = mesh(THREE, sideGeo, frameMat);
    side.position.set(dx * (item.width / 2 - frameThickness / 2), item.height / 2, 0);
    group.add(side);
  }
  const lintel = mesh(
    THREE,
    new THREE.BoxGeometry(item.width, frameThickness, item.depth),
    frameMat
  );
  lintel.position.set(0, item.height - frameThickness / 2, 0);
  group.add(lintel);

  // Handle.
  const handle = mesh(THREE, new THREE.SphereGeometry(0.04, 12, 10), handleMat);
  handle.position.set(item.width * 0.35, item.height * 0.5, item.depth * 0.28);
  group.add(handle);

  return group;
}

export function buildWindow({ THREE, item, hasCollision, baseColor, opacity }: BuilderContext): ThreeNS.Group {
  const group = new THREE.Group();
  const frameMat = material(THREE, 0xf5f5f5, hasCollision, opacity, { roughness: 0.5 });
  const sillMat = material(THREE, 0xe6e6e6, hasCollision, opacity, { roughness: 0.6 });
  const glassMat = new THREE.MeshStandardMaterial({
    color: baseColor,
    roughness: 0.05,
    metalness: 0.25,
    transparent: true,
    opacity: hasCollision ? 0.5 : 0.4,
  });
  // Windows sit at their sill (own `sillHeight` or the shared datum), not on
  // the floor — the wall cuts read the same helper so the frame fills the
  // hole exactly (#212, #204); a sill dropped to fit a low storey arrives
  // here as the item's `sillHeight` (#277).
  const sillHeight = windowSillHeight(item);
  const frameThickness = 0.06;
  // Glass pane.
  const glass = mesh(
    THREE,
    new THREE.BoxGeometry(item.width * 0.93, item.height * 0.93, item.depth * 0.2),
    glassMat
  );
  glass.position.set(0, sillHeight + item.height / 2, 0); 
  group.add(glass);

  // Outer frame (4 sides).
  const horizGeo = new THREE.BoxGeometry(item.width, frameThickness, item.depth);
  const top = mesh(THREE, horizGeo, frameMat);
  top.position.set(0, sillHeight + item.height - frameThickness / 2, 0);
  group.add(top);
  const bottom = mesh(THREE, horizGeo, frameMat);
  bottom.position.set(0, sillHeight + frameThickness / 2, 0);
  group.add(bottom);

  const vertGeo = new THREE.BoxGeometry(frameThickness, item.height, item.depth);
  for (const dx of [-1, 1]) {
    const side = mesh(THREE, vertGeo, frameMat);
    side.position.set(dx * (item.width / 2 - frameThickness / 2), sillHeight + item.height / 2, 0);
    group.add(side);
  }

  // Cross mullion — vertical + horizontal — for the classic 4-pane look.
  const mullionThickness = frameThickness * 0.5;
  const vMullion = mesh(
    THREE,
    new THREE.BoxGeometry(mullionThickness, item.height * 0.93, item.depth * 0.55),
    frameMat
  );
  vMullion.position.set(0, sillHeight + item.height / 2, 0);
  group.add(vMullion);
  const hMullion = mesh(
    THREE,
    new THREE.BoxGeometry(item.width * 0.93, mullionThickness, item.depth * 0.55),
    frameMat
  );
  hMullion.position.set(0, sillHeight + item.height / 2, 0);
  group.add(hMullion);

  // Outer sill — the ledge under the window. The wall below it is the
  // wall itself: the hole starts at the sill (#212), so no filler (#362).
  const sill = mesh(
    THREE,
    new THREE.BoxGeometry(item.width + 0.08, frameThickness * 1.2, item.depth * 2.2),
    sillMat
  );
  sill.position.set(0, sillHeight, 0);
  group.add(sill);

  return group;
}

export function buildStairs(ctx: BuilderContext): ThreeNS.Group {
  if (ctx.item.stairsShape === 'winder') return buildWinderStairs(ctx);
  return buildStraightStairs(ctx);
}

/** Handrail height above the stairs' pitch line, and the rail's radius. */
const RAIL_HEIGHT = 0.9;
const RAIL_RADIUS = 0.03;

function buildStraightStairs({ THREE, item, hasCollision, baseColor, opacity }: BuilderContext): ThreeNS.Group {
  const group = new THREE.Group();
  const stepMat = material(THREE, baseColor, hasCollision, opacity, { roughness: 0.85 });
  const railMat = material(THREE, 0x424242, hasCollision, opacity, { roughness: 0.5, metalness: 0.6 });

  // Item height is the rise to the next floor; build steps that span the depth.
  const stepCount = 14;
  const stepRise = item.height / stepCount;
  const stepRun = item.depth / stepCount;

  // Every step is the same size — allocate one geometry and share it across
  // all steps (matches the hoisted stringer/rail geometry below).
  const stepGeo = new THREE.BoxGeometry(item.width, stepRise, stepRun + 0.04);
  for (let i = 0; i < stepCount; i++) {
    const step = mesh(THREE, stepGeo, stepMat);
    step.position.set(
      0,
      stepRise * (i + 0.5),
      -item.depth / 2 + stepRun * (i + 0.5)
    );
    group.add(step);
  }

  // Stringers along each side.
  const stringerGeo = new THREE.BoxGeometry(0.06, item.height * 0.18, item.depth + 0.1);
  for (const dx of [-1, 1]) {
    const stringer = mesh(THREE, stringerGeo, stepMat);
    // Run the stringer along the slope.
    const angle = Math.atan2(item.height, item.depth);
    stringer.rotation.x = -angle;
    stringer.position.set(dx * (item.width / 2 - 0.05), item.height / 2, 0);
    group.add(stringer);
  }

  // Handrails at RAIL_HEIGHT above the pitch line, inside the stair's
  // width, stopping where they reach the floor above so they never pierce
  // it beside the stairwell (#388). A post carries each rail's foot.
  const climb = item.height - RAIL_HEIGHT;
  if (climb > 0) {
    const fraction = climb / item.height;
    const railLength = Math.hypot(item.depth, item.height) * fraction;
    const railGeo = new THREE.CylinderGeometry(RAIL_RADIUS, RAIL_RADIUS, railLength, 10);
    const postGeo = new THREE.CylinderGeometry(RAIL_RADIUS, RAIL_RADIUS, RAIL_HEIGHT, 8);
    const railX = item.width / 2 - RAIL_RADIUS;
    const runEnd = -item.depth / 2 + item.depth * fraction;
    for (const dx of [-1, 1]) {
      const rail = mesh(THREE, railGeo, railMat);
      rail.rotation.x = Math.atan2(item.depth, item.height);
      rail.position.set(dx * railX, RAIL_HEIGHT + climb / 2, (-item.depth / 2 + runEnd) / 2);
      group.add(rail);
      const post = mesh(THREE, postGeo, railMat);
      post.position.set(dx * railX, RAIL_HEIGHT / 2, -item.depth / 2 + RAIL_RADIUS);
      group.add(post);
    }
  }

  return group;
}

/**
 * Half-turn winder stair (#205): up flight, a fan of winders turning 180°,
 * return flight — laid out by lib/stairs.ts, the same layout the stairwell
 * cut above uses. Each tread is a slab of one rise; a newel post stands at
 * the turn and a spine wall divides the flights.
 */
function buildWinderStairs({ THREE, item, hasCollision, baseColor, opacity }: BuilderContext): ThreeNS.Group {
  const group = new THREE.Group();
  const treadMat = material(THREE, baseColor, hasCollision, opacity, { roughness: 0.85 });
  const spineMat = material(THREE, 0xefe9df, hasCollision, opacity, { roughness: 0.9 });
  const newelMat = material(THREE, 0x5d4037, hasCollision, opacity, { roughness: 0.6 });
  const steps = stairSteps(item, item.height);
  const rise = item.height / STAIR_STEP_COUNT;

  for (const step of steps) {
    // Outline is [x, z]; the shape lives in XY with y = −z so that rotating
    // −90° about X lays it flat with extrusion pointing up.
    const shape = new THREE.Shape(step.outline.map(([x, z]) => new THREE.Vector2(x, -z)));
    const geometry = new THREE.ExtrudeGeometry(shape, { depth: rise, bevelEnabled: false });
    geometry.rotateX(-Math.PI / 2);
    const tread = mesh(THREE, geometry, treadMat);
    tread.position.y = step.top - rise;
    group.add(tread);
  }

  // Spine wall between the flights, up to the turn, and the newel at the turn.
  // The turn comes from the same layout the treads and the stairwell hole use
  // — a winder too shallow for its fan lays out straight and gets neither (#278).
  const layout = winderLayout(item);
  if (!layout) return group;
  const { fanZ } = layout;
  const spineLength = fanZ + item.depth / 2;
  const spineHeight = Math.max(0.9, steps[steps.length - 1]!.top * 0.5);
  if (spineLength > 0.05) {
    const spine = mesh(THREE, new THREE.BoxGeometry(0.08, spineHeight, spineLength), spineMat);
    spine.position.set(0, spineHeight / 2, -item.depth / 2 + spineLength / 2);
    group.add(spine);
  }
  const newelHeight = item.height * 0.55 + 0.9;
  const newel = mesh(THREE, new THREE.BoxGeometry(0.1, newelHeight, 0.1), newelMat);
  newel.position.set(0, newelHeight / 2, fanZ);
  group.add(newel);

  return group;
}
