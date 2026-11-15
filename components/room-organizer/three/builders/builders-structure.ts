import { DOOR_LEAF_NAME, DOOR_LEAF_PARTS } from '../../lib/door-swing';
import { INTERIOR_WALL_THICKNESS } from '../../lib/opening-snap';
import { DOOR_FRAME, SLIDING_PANE_SHARE, archHead, doorStyle, windowStyle } from '../../lib/opening-style';
import { STAIR_STEP_COUNT, stairSteps, winderLayout } from '../../lib/stairs';
import { windowSillHeight } from '../../lib/street';
import { type BuilderContext, material, mesh } from '../builder-utils';
import { EXTERIOR_SILL_KEY, REVEAL_FILL_KEY } from '../reveals';
import type * as ThreeNS from 'three';

/**
 * Door and window meshes are built to the item's `height` (and a window's
 * `sillHeight`) exactly as the wall holes are cut, so frame and hole stay
 * flush (#212). The furniture effect hands them values already fitted to
 * the storey (`fitOpeningToStorey`, #277), so on a 2 m storey the door is
 * the 1.95 m of its hole rather than 2.05 m through the ceiling.
 */
/** Between a door's open leaf and its jamb: no shared face to z-fight. */
const DOOR_LEAF_JAMB_GAP = 0.004;
/** How far an archway's casings stand proud of a partition's faces, and its reveal fill's soffit over the head's. */
const ARCH_PROUD = 0.002;
/** A tall window's transom, as a share of its height from the sill. */
const TALL_WINDOW_TRANSOM = 0.78;
/** Between a double door's two leaves where they meet. */
const DOOR_LEAF_MEETING_GAP = 0.004;

/** A door, by its type (#922): one leaf, two, a sliding pane or an open archway. */
export function buildDoor(ctx: BuilderContext): ThreeNS.Group {
  switch (doorStyle(ctx.item)) {
    case 'double':
      return buildDoubleDoor(ctx);
    case 'sliding':
      return buildSlidingDoor(ctx);
    case 'arch':
      return buildArchway(ctx);
    case 'single':
      return buildSingleDoor(ctx);
  }
}

/** The jambs either side and the lintel over the top, flush with the wall hole. */
function addDoorFrame(THREE: BuilderContext['THREE'], group: ThreeNS.Group, item: BuilderContext['item'], frameMat: ThreeNS.Material, lintel = true): void {
  const sideGeo = new THREE.BoxGeometry(DOOR_FRAME, item.height, item.depth);
  for (const dx of [-1, 1]) {
    const side = mesh(THREE, sideGeo, frameMat);
    side.position.set(dx * (item.width / 2 - DOOR_FRAME / 2), item.height / 2, 0);
    group.add(side);
  }
  if (!lintel) return;
  const head = mesh(THREE, new THREE.BoxGeometry(item.width, DOOR_FRAME, item.depth), frameMat);
  head.position.set(0, item.height - DOOR_FRAME / 2, 0);
  group.add(head);
}

/**
 * Two leaves meeting in the middle (#922), each on a pivot of its own named
 * `DOOR_LEAF_NAME`, so EXPLORE swings both. The +X leaf runs back towards
 * −X from its hinge, so it turns the other way (`DOOR_LEAF_PARTS` sign −1).
 * Each leaf reaches back past its pivot to just short of the casing, so no
 * slit of light shows down the jamb while it is shut.
 */
function buildDoubleDoor({ THREE, item, hasCollision, baseColor, opacity }: BuilderContext): ThreeNS.Group {
  const group = new THREE.Group();
  const frameMat = material(THREE, baseColor, hasCollision, opacity, { roughness: 0.7 });
  const handleMat = material(THREE, 0xd7c483, hasCollision, opacity, { metalness: 1, roughness: 0.2 });
  const leafThickness = item.depth * 0.5;
  const hingeX = -item.width / 2 + DOOR_FRAME + leafThickness / 2 + DOOR_LEAF_JAMB_GAP;
  // Each leaf from just inside its casing to just short of the middle.
  const leafWidth = -hingeX - DOOR_LEAF_MEETING_GAP;
  const back = hingeX - (-item.width / 2 + DOOR_FRAME + DOOR_LEAF_MEETING_GAP);
  const leafGeo = new THREE.BoxGeometry(leafWidth + back, item.height * 0.97, leafThickness);
  const side = item.swingOut ? -1 : undefined;
  const handleGeo = new THREE.SphereGeometry(0.04, 12, 10);
  for (const sign of [1, -1] as const) {
    const pivot = new THREE.Group();
    pivot.name = DOOR_LEAF_NAME;
    DOOR_LEAF_PARTS.set(pivot, { ...(sign === -1 ? { sign } : {}), ...(side ? { side } : {}) });
    pivot.position.set(sign * hingeX, 0, 0);
    group.add(pivot);
    const slab = mesh(THREE, leafGeo, frameMat);
    slab.position.set((sign * (leafWidth - back)) / 2, item.height / 2, 0);
    pivot.add(slab);
    const handle = mesh(THREE, handleGeo, handleMat);
    handle.position.set(sign * (leafWidth - 0.08), item.height * 0.5, item.depth * 0.28);
    pivot.add(handle);
  }
  addDoorFrame(THREE, group, item, frameMat);
  return group;
}

/**
 * Two glazed panes in the frame (#922), one either side of the wall's
 * centre line as the plan draws them: −X fixed, +X sliding behind it. The
 * sliding pane is the door's `DOOR_LEAF_NAME` part with a slide (`DOOR_LEAF_PARTS`),
 * so EXPLORE slides it open instead of turning it.
 */
function buildSlidingDoor({ THREE, item, hasCollision, baseColor, opacity }: BuilderContext): ThreeNS.Group {
  const group = new THREE.Group();
  const frameMat = material(THREE, baseColor, hasCollision, opacity, { roughness: 0.5 });
  const glassMat = new THREE.MeshStandardMaterial({
    color: 0x90caf9,
    roughness: 0.05,
    metalness: 0,
    transparent: true,
    opacity: hasCollision ? 0.5 : 0.35,
  });
  const inner = item.width - 2 * DOOR_FRAME;
  const paneWidth = inner * SLIDING_PANE_SHARE;
  const paneHeight = item.height - DOOR_FRAME;
  const paneDepth = item.depth * 0.18;
  const rail = 0.05;
  const offset = item.depth / 6;
  const paneGeo = {
    glass: new THREE.BoxGeometry(paneWidth - 2 * rail, paneHeight - 2 * rail, paneDepth * 0.4),
    stile: new THREE.BoxGeometry(rail, paneHeight, paneDepth),
    bar: new THREE.BoxGeometry(paneWidth - 2 * rail, rail, paneDepth),
  };
  for (const side of [-1, 1] as const) {
    const pane = new THREE.Group();
    // −X pane on the −Z side, +X pane on the +Z side: the plan's offsets.
    pane.position.set(side * (inner - paneWidth) / 2, 0, side * offset);
    const glass = mesh(THREE, paneGeo.glass, glassMat);
    glass.position.set(0, paneHeight / 2, 0);
    // Like window glass: the shadow pass would plug the opening (#551).
    glass.castShadow = false;
    pane.add(glass);
    for (const dx of [-1, 1]) {
      const stile = mesh(THREE, paneGeo.stile, frameMat);
      stile.position.set(dx * (paneWidth / 2 - rail / 2), paneHeight / 2, 0);
      pane.add(stile);
    }
    for (const y of [rail / 2, paneHeight - rail / 2]) {
      const bar = mesh(THREE, paneGeo.bar, frameMat);
      bar.position.set(0, y, 0);
      pane.add(bar);
    }
    if (side === 1) {
      pane.name = DOOR_LEAF_NAME;
      DOOR_LEAF_PARTS.set(pane, { slide: -(inner - paneWidth) });
    }
    group.add(pane);
  }
  addDoorFrame(THREE, group, item, frameMat);
  return group;
}

/**
 * An open archway (#922): no leaf, casings up both jambs, and the head filled
 * in down to the arch's curve (`archHead`), which springs from the casings'
 * inner faces so the two meet without a step. The wall's hole stays the
 * rectangle every opening cuts; the head covers its top corners. Casings
 * and head run a hair deeper than a partition is thick, so the hole's square
 * corners show on neither face of one. In an outer wall the frame is set
 * back into its reveal: a second head (`REVEAL_FILL_KEY`) fills the reveal
 * between the facade and the frame, so the facade's hole reads as an arch
 * too (three/reveals.ts `setBackOpening`).
 */
function buildArchway({ THREE, item, hasCollision, baseColor, opacity }: BuilderContext): ThreeNS.Group {
  const group = new THREE.Group();
  const frameMat = material(THREE, baseColor, hasCollision, opacity, { roughness: 0.85 });
  const half = item.width / 2;
  const inner = Math.max(0, half - DOOR_FRAME);
  const depth = Math.max(item.depth, INTERIOR_WALL_THICKNESS + 2 * ARCH_PROUD);
  const { spring, crown, rise } = archHead(inner * 2, item.height);
  if (rise > 0) {
    // The circle through both springing points and the crown.
    const radius = (rise * rise + inner * inner) / (2 * rise);
    const centreY = crown - radius;
    const headShape = (lift: number) => {
      const r = radius + lift;
      const startAngle = Math.asin(Math.max(-1, Math.min(1, inner / r)));
      const shape = new THREE.Shape();
      shape.moveTo(half, spring);
      shape.lineTo(half, item.height);
      shape.lineTo(-half, item.height);
      shape.lineTo(-half, spring);
      // Back along the arch, from the −X springing over the crown: clockwise.
      shape.absarc(0, centreY, r, Math.PI / 2 + startAngle, Math.PI / 2 - startAngle, true);
      shape.lineTo(half, spring);
      return shape;
    };
    const head = mesh(THREE, new THREE.ExtrudeGeometry(headShape(0), { depth, bevelEnabled: false, curveSegments: 24 }), frameMat);
    head.position.set(0, 0, -depth / 2);
    group.add(head);
    // Its soffit a couple of millimetres above the head's, where the two overlap.
    const fill = mesh(THREE, new THREE.ExtrudeGeometry(headShape(ARCH_PROUD), { depth: 1, bevelEnabled: false, curveSegments: 24 }), frameMat);
    fill.userData[REVEAL_FILL_KEY] = depth / 2;
    fill.visible = false;
    group.add(fill);
  }
  // Casings up to the springing, where the head takes over.
  const jambHeight = rise > 0 ? spring : item.height;
  const jambGeo = new THREE.BoxGeometry(DOOR_FRAME, jambHeight, depth);
  for (const dx of [-1, 1]) {
    const side = mesh(THREE, jambGeo, frameMat);
    side.position.set(dx * (half - DOOR_FRAME / 2), jambHeight / 2, 0);
    group.add(side);
  }
  return group;
}

function buildSingleDoor({ THREE, item, hasCollision, baseColor, opacity }: BuilderContext): ThreeNS.Group {
  const group = new THREE.Group();
  const frameMat = material(THREE, baseColor, hasCollision, opacity, { roughness: 0.7 });
  const handleMat = material(THREE, 0xd7c483, hasCollision, opacity, { metalness: 1, roughness: 0.2 });

  const frameThickness = 0.06;
  // The leaf turns on its hinge jamb (local −X; a mirrored door's group is
  // flipped, so +X) in a pivot of its own, which EXPLORE swings open (#605,
  // three/door-leaves.ts). At rest it is shut, as the plan, the exports and
  // DESIGN show it. The pivot stands half a leaf's thickness inside the
  // jamb's face, plus a gap, so the leaf swung square clears the frame and
  // never shares its face (#276).
  const leafWidth = item.width * 0.95;
  const leafThickness = item.depth * 0.5;
  const hingeX = -item.width / 2 + frameThickness + leafThickness / 2 + DOOR_LEAF_JAMB_GAP;
  const pivot = new THREE.Group();
  pivot.name = DOOR_LEAF_NAME;
  // A door set to open out always opens that way in EXPLORE (#917).
  if (item.swingOut) DOOR_LEAF_PARTS.set(pivot, { side: -1 });
  pivot.position.set(hingeX, 0, 0);
  group.add(pivot);

  // Door slab (almost as wide and tall as the wall opening), where it always stood.
  const slab = mesh(
    THREE,
    new THREE.BoxGeometry(leafWidth, item.height * 0.97, leafThickness),
    frameMat
  );
  slab.position.set(-hingeX, item.height / 2, 0);
  pivot.add(slab);

  // Frame around the slab — three thin boxes (left, right, top).
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

  // Handle, on the leaf.
  const handle = mesh(THREE, new THREE.SphereGeometry(0.04, 12, 10), handleMat);
  handle.position.set(item.width * 0.35 - hingeX, item.height * 0.5, item.depth * 0.28);
  pivot.add(handle);

  return group;
}

export function buildWindow({ THREE, item, hasCollision, baseColor, opacity }: BuilderContext): ThreeNS.Group {
  const group = new THREE.Group();
  const frameMat = material(THREE, 0xf5f5f5, hasCollision, opacity, { roughness: 0.5 });
  const sillMat = material(THREE, 0xe6e6e6, hasCollision, opacity, { roughness: 0.6 });
  const glassMat = new THREE.MeshStandardMaterial({
    color: baseColor,
    roughness: 0.05,
    metalness: 0,
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
  // The wall is cut around the window so the sun comes in (#132); the shadow
  // pass ignores opacity, so a casting pane would plug 93 % of that hole
  // again (#551). The frame and mullions still cast, like dormer glass (#369).
  glass.castShadow = false;
  glass.userData.litGlass = true;
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

  // Cross mullion — vertical + horizontal — for the classic 4-pane look;
  // a tall window has a transom high up instead, a fixed one no bars (#922).
  const style = windowStyle(item);
  const mullionThickness = frameThickness * 0.5;
  if (style === 'standard') {
    const vMullion = mesh(
      THREE,
      new THREE.BoxGeometry(mullionThickness, item.height * 0.93, item.depth * 0.55),
      frameMat
    );
    vMullion.position.set(0, sillHeight + item.height / 2, 0);
    group.add(vMullion);
  }
  if (style !== 'fixed') {
    const hMullion = mesh(
      THREE,
      new THREE.BoxGeometry(item.width * 0.93, mullionThickness, item.depth * 0.55),
      frameMat
    );
    hMullion.position.set(0, sillHeight + item.height * (style === 'tall' ? TALL_WINDOW_TRANSOM : 0.5), 0);
    group.add(hMullion);
  }

  // Outer sill — the ledge under the window. The wall below it is the
  // wall itself: the hole starts at the sill (#212), so no filler (#362).
  const sill = mesh(
    THREE,
    new THREE.BoxGeometry(item.width + 0.08, frameThickness * 1.2, item.depth * 2.2),
    sillMat
  );
  sill.position.set(0, sillHeight, 0);
  // It stays on the wall plane when the window is set into a reveal (#758).
  sill.userData[EXTERIOR_SILL_KEY] = true;
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
/** A closed string: this thick across the pitch, this far above the nosings, this wide. */
const STRINGER_DEPTH = 0.25;
const STRINGER_LIP = 0.03;
const STRINGER_WIDTH = 0.06;

/**
 * The outline of a closed string in the stair's (z, y) plane (#658): its
 * top edge runs along the nosings, a lip above them, from the first nosing
 * to the last; it is `STRINGER_DEPTH` thick across the pitch, cut level
 * at the floor, and ends square under the top nosing against the floor
 * above. A tilted box used to hang 0.36 m over the floor at the foot, stop
 * short of the landing and stand 0.22 m proud of the treads.
 */
export function stringerOutline(depth: number, height: number, stepCount: number): Array<[number, number]> {
  const hd = depth / 2;
  const going = depth / stepCount;
  const rise = height / stepCount;
  const slope = height / depth;
  const top = (z: number) => rise + STRINGER_LIP + (z + hd) * slope;
  // Vertical thickness of a band `STRINGER_DEPTH` thick across the pitch.
  const drop = STRINGER_DEPTH * Math.hypot(depth, height) / depth;
  const zEnd = hd - going;
  // Where the bottom edge meets the floor: the foot is cut level there.
  const zFoot = Math.min(zEnd, -hd + Math.max(0, drop - rise - STRINGER_LIP) / slope);
  return [
    [-hd, 0],
    [-hd, top(-hd)],
    [zEnd, top(zEnd)],
    [zEnd, Math.max(0, top(zEnd) - drop)],
    [zFoot, 0],
  ];
}

function buildStraightStairs({ THREE, item, hasCollision, baseColor, opacity }: BuilderContext): ThreeNS.Group {
  const group = new THREE.Group();
  const stepMat = material(THREE, baseColor, hasCollision, opacity, { roughness: 0.85 });
  const railMat = material(THREE, 0x424242, hasCollision, opacity, { roughness: 0.5, metalness: 1 });

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

  // A closed string along each side, following the nosings (#658).
  const outline = stringerOutline(item.depth, item.height, stepCount);
  const shape = new THREE.Shape();
  outline.forEach(([z, y], i) => (i === 0 ? shape.moveTo(z, y) : shape.lineTo(z, y)));
  shape.closePath();
  // Drawn in the (z, y) plane and extruded across x; the extrusion runs
  // from x = 0 to −width, so it is centred on its side afterwards.
  const stringerGeo = new THREE.ExtrudeGeometry(shape, { depth: STRINGER_WIDTH, bevelEnabled: false });
  stringerGeo.rotateY(-Math.PI / 2);
  stringerGeo.translate(STRINGER_WIDTH / 2, 0, 0);
  for (const dx of [-1, 1]) {
    const stringer = mesh(THREE, stringerGeo, stepMat);
    stringer.position.set(dx * (item.width / 2 - STRINGER_WIDTH / 2), 0, 0);
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
