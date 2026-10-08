import { dormerFrame, dormerOpeningRects, julietRailSpan, type DormerFrame, type DormerOpeningRect } from '../lib/dormers';
import type { DormerSpec, RoofStyle } from '../lib/types';
import type * as ThreeNS from 'three';

type ThreeModule = typeof import('three');

/**
 * Dormer meshes (#203). Each dormer is one group, tagged like the roof so
 * the wall-display modes hide it with the roof and removeRoof disposes it
 * (removeAndDispose traverses the whole group — builder-utils).
 *
 * Built in the dormer's local frame (slope facing −z, x along the ridge; see
 * lib/dormers.ts) and rotated onto its side.
 */
const DEFAULT_FINISH = '#ece6da';
const FRAME_COLOR = 0xf4f1ea;
const GLASS_COLOR = 0x9fc3d9;
const RAIL_COLOR = 0x2b2b2b;
const FRAME = 0.05;
const FRAME_DEPTH = 0.07;
/** How far the glass sits out from the face, within the frame's depth. */
const GLASS_SETBACK = 0.01;
const TOP_THICKNESS = 0.08;
const TOP_OVERHANG = 0.1;

export interface BuildDormersOptions {
  style: RoofStyle;
  width: number;
  depth: number;
  baseY: number;
  roofColor: string;
  tag: string;
}

export function buildDormers(
  THREE: ThreeModule,
  dormers: readonly DormerSpec[],
  options: BuildDormersOptions
): ThreeNS.Group[] {
  const groups: ThreeNS.Group[] = [];
  for (const dormer of dormers) {
    const frame = dormerFrame(options.style, options.width, options.depth, options.baseY, dormer);
    if (!frame) continue;
    const group = buildDormer(THREE, dormer, frame, options.roofColor);
    group.userData.type = options.tag;
    group.userData.dormerId = dormer.id;
    groups.push(group);
  }
  return groups;
}

function buildDormer(THREE: ThreeModule, dormer: DormerSpec, frame: DormerFrame, roofColor: string): ThreeNS.Group {
  const group = new THREE.Group();
  const { width, faceZ, backZ, bottomY, topY } = frame;
  const height = topY - bottomY;
  const half = width / 2;
  const finish = new THREE.MeshStandardMaterial({
    color: dormer.color ?? DEFAULT_FINISH,
    roughness: 0.9,
    side: THREE.DoubleSide,
  });
  const rects = dormerOpeningRects(dormer, width, height);

  // Face: the vertical front, with a hole per opening.
  const outline = new THREE.Shape();
  outline.moveTo(-half, 0);
  outline.lineTo(half, 0);
  outline.lineTo(half, height);
  outline.lineTo(-half, height);
  outline.closePath();
  for (const rect of rects) {
    const hole = new THREE.Path();
    hole.moveTo(rect.x0, rect.y0);
    hole.lineTo(rect.x0, rect.y1);
    hole.lineTo(rect.x1, rect.y1);
    hole.lineTo(rect.x1, rect.y0);
    hole.closePath();
    outline.holes.push(hole);
  }
  const face = new THREE.Mesh(new THREE.ShapeGeometry(outline), finish);
  face.position.set(0, bottomY, faceZ);
  group.add(face);

  // Cheeks: the triangles between the face, the flat top and the slope.
  const cheek = new THREE.BufferGeometry();
  cheek.setAttribute(
    'position',
    new THREE.Float32BufferAttribute([0, bottomY, faceZ, 0, topY, faceZ, 0, topY, backZ], 3)
  );
  cheek.computeVertexNormals();
  for (const x of [-half, half]) {
    const side = new THREE.Mesh(cheek.clone(), finish);
    side.position.x = x;
    group.add(side);
  }
  cheek.dispose();

  // Flat top, overhanging the face and cheeks a little.
  const topMat = new THREE.MeshStandardMaterial({ color: roofColor, roughness: 0.85 });
  const topRun = backZ - faceZ + TOP_OVERHANG;
  const top = new THREE.Mesh(new THREE.BoxGeometry(width + TOP_OVERHANG * 2, TOP_THICKNESS, topRun), topMat);
  top.position.set(0, topY + TOP_THICKNESS / 2, faceZ - TOP_OVERHANG + topRun / 2);
  group.add(top);

  addOpenings(THREE, group, rects, frame);
  if (dormer.balcony) addJulietRail(THREE, group, rects, frame);

  for (const child of group.children) {
    // Glass lets the sun through rather than casting a solid shadow (#369).
    child.castShadow = child.userData.dormerGlass !== true;
    child.receiveShadow = true;
  }
  // Slide along the ridge in the local frame, then turn onto the real side.
  group.children.forEach((child) => (child.position.x += frame.centerX));
  group.rotation.y = frame.rotationY;
  return group;
}

/** Frames, mullions, transoms, glass and a head trim for each opening. */
function addOpenings(THREE: ThreeModule, group: ThreeNS.Group, rects: readonly DormerOpeningRect[], frame: DormerFrame): void {
  if (rects.length === 0) return;
  const frameMat = new THREE.MeshStandardMaterial({ color: FRAME_COLOR, roughness: 0.6 });
  const glassMat = new THREE.MeshStandardMaterial({
    color: GLASS_COLOR,
    roughness: 0.15,
    metalness: 0.1,
    transparent: true,
    opacity: 0.45,
    side: THREE.DoubleSide,
  });
  const z = frame.faceZ;
  const bar = (w: number, h: number, x: number, y: number, depth = FRAME_DEPTH, dz = 0) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, depth), frameMat);
    mesh.position.set(x, frame.bottomY + y, z + dz);
    group.add(mesh);
  };

  for (const rect of rects) {
    const w = rect.x1 - rect.x0;
    const h = rect.y1 - rect.y0;
    const cx = (rect.x0 + rect.x1) / 2;
    const cy = (rect.y0 + rect.y1) / 2;

    // The exterior is −z (lib/dormers.ts): glass a touch outside the face,
    // inside the frame's depth, and two-sided for the loft view (#369).
    const glass = new THREE.Mesh(new THREE.PlaneGeometry(w, h), glassMat);
    glass.position.set(cx, frame.bottomY + cy, z - GLASS_SETBACK);
    glass.userData.dormerGlass = true;
    group.add(glass);

    // Frame: head, sill and jambs.
    bar(w + FRAME * 2, FRAME, cx, rect.y1 + FRAME / 2);
    bar(w + FRAME * 2, FRAME, cx, rect.y0 - FRAME / 2);
    bar(FRAME, h, rect.x0 - FRAME / 2, cy);
    bar(FRAME, h, rect.x1 + FRAME / 2, cy);
    // Mullion: pairs of leaves on anything but a narrow light.
    if (rect.kind !== 'sidelight' && w > 0.7) bar(FRAME * 0.8, h, cx, cy);
    // Transom: a top light over doors and tall lights.
    if (rect.kind !== 'casement' && h > 1.4) bar(w, FRAME * 0.8, cx, rect.y1 - Math.min(0.4, h * 0.22));
    // Head trim, proud of the face.
    bar(w + FRAME * 2 + 0.08, 0.05, cx, rect.y1 + FRAME + 0.025, FRAME_DEPTH + 0.04, -0.03);
  }
}

/** A Juliet balcony: top and bottom rails with balusters, just proud of the face. */
function addJulietRail(THREE: ThreeModule, group: ThreeNS.Group, rects: readonly DormerOpeningRect[], frame: DormerFrame): void {
  const [x0, x1] = julietRailSpan(rects, frame.width);
  const height = frame.topY - frame.bottomY;
  const railTop = Math.min(1.0, height - 0.15);
  if (railTop < 0.3) return;
  const mat = new THREE.MeshStandardMaterial({ color: RAIL_COLOR, roughness: 0.4, metalness: 0.6 });
  const z = frame.faceZ - 0.12;
  const span = x1 - x0;
  const cx = (x0 + x1) / 2;
  for (const y of [0.12, railTop]) {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(span, 0.035, 0.035), mat);
    rail.position.set(cx, frame.bottomY + y, z);
    group.add(rail);
  }
  const count = Math.max(2, Math.round(span / 0.11) + 1);
  const balusterGeo = new THREE.CylinderGeometry(0.008, 0.008, railTop - 0.12, 6);
  for (let i = 0; i < count; i++) {
    const baluster = new THREE.Mesh(i === 0 ? balusterGeo : balusterGeo.clone(), mat);
    baluster.position.set(x0 + (span * i) / (count - 1), frame.bottomY + (0.12 + railTop) / 2, z);
    group.add(baluster);
  }
  // Brackets back to the face at each end.
  for (const x of [x0, x1]) {
    const bracket = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.03, 0.12), mat);
    bracket.position.set(x, frame.bottomY + railTop, z + 0.06);
    group.add(bracket);
  }
}
