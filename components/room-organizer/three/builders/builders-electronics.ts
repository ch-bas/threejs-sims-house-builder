import type * as ThreeNS from 'three';
import { type BuilderContext, mesh } from '../builder-utils';
import { CAMERA_MOUNT_HEIGHT } from '../camera-vision';
import { CAMERA_BRACKET_ARM } from '../../lib/constants';
import { type CctvModel, getCctvModel } from '../../lib/cctv-models';

export function buildTV({ THREE, item, hasCollision, baseColor, opacity }: BuilderContext): ThreeNS.Group {
  const group = new THREE.Group();

  const base = mesh(
    THREE,
    new THREE.BoxGeometry(item.width, item.height * 0.6, item.depth),
    new THREE.MeshStandardMaterial({ color: baseColor, roughness: 0.6, metalness: 0.2, transparent: hasCollision, opacity })
  );
  base.position.y = item.height * 0.3;
  group.add(base);

  const screen = mesh(
    THREE,
    new THREE.BoxGeometry(item.width * 0.7, item.height * 0.8, item.depth * 0.1),
    new THREE.MeshStandardMaterial({
      color: hasCollision ? 0xff0000 : 0x1a1a1a,
      roughness: 0.1,
      metalness: 0.8,
      transparent: hasCollision,
      opacity,
    })
  );
  screen.position.set(0, item.height * 0.9, -item.depth * 0.35);
  group.add(screen);

  const bezel = mesh(
    THREE,
    new THREE.BoxGeometry(item.width * 0.75, item.height * 0.85, item.depth * 0.08),
    new THREE.MeshStandardMaterial({ color: 0x333333, roughness: 0.5, metalness: 0.6, transparent: hasCollision, opacity })
  );
  bezel.position.set(0, item.height * 0.9, -item.depth * 0.36);
  group.add(bezel);

  return group;
}

export function buildComputer({ THREE, item, hasCollision, baseColor, opacity }: BuilderContext): ThreeNS.Group {
  const group = new THREE.Group();
  const bodyMat = new THREE.MeshStandardMaterial({ color: baseColor, roughness: 0.5, metalness: 0.4, transparent: hasCollision, opacity });
  const screenMat = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.1, metalness: 0.9, emissive: 0x0d47a1, emissiveIntensity: 0.4, transparent: hasCollision, opacity });

  const tower = mesh(THREE, new THREE.BoxGeometry(item.width * 0.4, item.height * 0.8, item.depth * 0.7), bodyMat);
  tower.position.set(-item.width * 0.25, item.height * 0.4, 0);
  group.add(tower);

  const monitor = mesh(THREE, new THREE.BoxGeometry(item.width * 0.85, item.height * 0.6, item.depth * 0.1), screenMat);
  monitor.position.set(item.width * 0.1, item.height * 0.85, item.depth * 0.1);
  group.add(monitor);

  const stand = mesh(THREE, new THREE.BoxGeometry(item.width * 0.15, item.height * 0.25, item.depth * 0.3), bodyMat);
  stand.position.set(item.width * 0.1, item.height * 0.45, item.depth * 0.1);
  group.add(stand);
  return group;
}

export function buildWiFi({ THREE, item, hasCollision, baseColor, opacity }: BuilderContext): ThreeNS.Group {
  const group = new THREE.Group();

  const body = mesh(
    THREE,
    new THREE.BoxGeometry(item.width, item.height, item.depth),
    new THREE.MeshStandardMaterial({ color: baseColor, roughness: 0.4, metalness: 0.3, transparent: hasCollision, opacity })
  );
  body.position.y = item.height / 2;
  group.add(body);

  const antennaMat = new THREE.MeshStandardMaterial({
    color: 0x333333,
    roughness: 0.5,
    metalness: 0.6,
    transparent: hasCollision,
    opacity,
  });
  const antennaGeo = new THREE.CylinderGeometry(0.01, 0.01, item.height * 3, 8);
  for (const dx of [-item.width * 0.3, item.width * 0.3]) {
    const antenna = mesh(THREE, antennaGeo, antennaMat);
    antenna.position.set(dx, item.height * 1.7, 0);
    antenna.rotation.z = dx < 0 ? -0.3 : 0.3;
    group.add(antenna);
  }

  const ledGeo = new THREE.SphereGeometry(0.015, 8, 8);
  const ledMat = new THREE.MeshStandardMaterial({
    color: 0x00ff00,
    emissive: 0x00ff00,
    emissiveIntensity: 0.8,
    transparent: hasCollision,
    opacity,
  });
  for (let i = 0; i < 3; i++) {
    const led = mesh(THREE, ledGeo, ledMat);
    led.position.set(-item.width * 0.2 + i * item.width * 0.2, item.height * 0.6, item.depth * 0.51);
    group.add(led);
  }

  return group;
}

export function buildRouter({ THREE, item, hasCollision, baseColor, opacity }: BuilderContext): ThreeNS.Group {
  const group = new THREE.Group();

  const body = mesh(
    THREE,
    new THREE.BoxGeometry(item.width, item.height, item.depth),
    new THREE.MeshStandardMaterial({ color: baseColor, roughness: 0.4, metalness: 0.2, transparent: hasCollision, opacity })
  );
  body.position.y = item.height / 2;
  group.add(body);

  const antennaMat = new THREE.MeshStandardMaterial({
    color: 0x1a1a1a,
    roughness: 0.6,
    metalness: 0.5,
    transparent: hasCollision,
    opacity,
  });
  const antennaGeo = new THREE.CylinderGeometry(0.008, 0.008, item.height * 4, 8);
  const antennaXs = [-item.width * 0.35, -item.width * 0.15, item.width * 0.15, item.width * 0.35];
  antennaXs.forEach((x, index) => {
    const antenna = mesh(THREE, antennaGeo, antennaMat);
    antenna.position.set(x, item.height * 2.2, 0);
    antenna.rotation.z = index % 2 === 0 ? -0.2 : 0.2;
    group.add(antenna);
  });

  const ledMat = new THREE.MeshStandardMaterial({
    color: 0x00ff00,
    emissive: 0x00ff00,
    emissiveIntensity: 0.6,
    transparent: hasCollision,
    opacity,
  });
  const ledGeo = new THREE.SphereGeometry(0.012, 8, 8);
  for (let i = 0; i < 5; i++) {
    const led = mesh(THREE, ledGeo, ledMat);
    led.position.set(-item.width * 0.3 + i * item.width * 0.15, item.height * 0.6, item.depth * 0.51);
    group.add(led);
  }

  const portMat = new THREE.MeshStandardMaterial({
    color: 0xffd700,
    roughness: 0.3,
    metalness: 0.7,
    transparent: hasCollision,
    opacity,
  });
  const portGeo = new THREE.BoxGeometry(0.02, 0.015, 0.01);
  for (let i = 0; i < 4; i++) {
    const port = mesh(THREE, portGeo, portMat);
    port.position.set(-item.width * 0.25 + i * item.width * 0.17, item.height * 0.5, -item.depth * 0.51);
    group.add(port);
  }

  return group;
}

export function buildCCTV({ THREE, item, hasCollision, baseColor, opacity }: BuilderContext): ThreeNS.Group {
  const group = new THREE.Group();

  const base = mesh(
    THREE,
    new THREE.CylinderGeometry(item.width * 0.3, item.width * 0.4, item.height * 0.2, 16),
    new THREE.MeshStandardMaterial({ color: baseColor, roughness: 0.5, metalness: 0.4, transparent: hasCollision, opacity })
  );
  base.position.y = item.height * 0.1;
  group.add(base);

  const body = mesh(
    THREE,
    new THREE.CylinderGeometry(item.width * 0.5, item.width * 0.5, item.height * 0.6, 16),
    new THREE.MeshStandardMaterial({ color: baseColor, roughness: 0.4, metalness: 0.5, transparent: hasCollision, opacity })
  );
  body.position.y = item.height * 0.55;
  body.rotation.z = Math.PI / 2;
  group.add(body);

  const lens = mesh(
    THREE,
    new THREE.CylinderGeometry(item.width * 0.3, item.width * 0.35, item.height * 0.15, 16),
    new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.1, metalness: 0.9, transparent: hasCollision, opacity })
  );
  lens.position.set(item.width * 0.3, item.height * 0.55, 0);
  lens.rotation.z = Math.PI / 2;
  group.add(lens);

  const led = mesh(
    THREE,
    new THREE.SphereGeometry(0.01, 8, 8),
    new THREE.MeshStandardMaterial({
      color: 0xff0000,
      emissive: 0xff0000,
      emissiveIntensity: 0.8,
      transparent: hasCollision,
      opacity,
    })
  );
  led.position.set(-item.width * 0.3, item.height * 0.65, 0);
  group.add(led);

  const irMat = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.8, transparent: hasCollision, opacity });
  const irGeo = new THREE.SphereGeometry(0.008, 8, 8);
  for (const offset of [-0.015, 0, 0.015]) {
    const ir = mesh(THREE, irGeo, irMat);
    ir.position.set(item.width * 0.35, item.height * 0.55, offset);
    group.add(ir);
  }

  return group;
}

/**
 * Wall-mounted security camera. Modelled in a local frame where the wall sits
 * at the back (−Z) and the lens faces into the room (+Z), so the matching
 * vision cone (which also fans toward +Z) aligns once the group is rotated.
 *
 * The silhouette follows the selected real model (lib/cctv-models): Dome / PTZ
 * models get a flat base ring + dark half-sphere glass dome; bullet, indoor and
 * battery models (Reolink, Nest, Ring, Arlo…) get a mount arm + ball joint and
 * a rounded cylindrical pod. A thin cable runs up the wall so the selection box
 * (which spans the full mount height) reads as a wall run rather than empty.
 */
export function buildSecurityCamera({ THREE, item, hasCollision, baseColor, opacity }: BuilderContext): ThreeNS.Group {
  const group = new THREE.Group();
  const bodyMat = new THREE.MeshStandardMaterial({ color: baseColor, roughness: 0.35, metalness: 0.5, transparent: hasCollision, opacity });
  const trimMat = new THREE.MeshStandardMaterial({ color: 0x0e1116, roughness: 0.3, metalness: 0.65, transparent: hasCollision, opacity });
  const glassMat = new THREE.MeshStandardMaterial({
    color: 0x05080d,
    roughness: 0.05,
    metalness: 0.2,
    transparent: true,
    opacity: hasCollision ? 0.5 : 0.45,
  });
  const ledMat = new THREE.MeshStandardMaterial({ color: 0xff3b30, emissive: 0xff3b30, emissiveIntensity: 0.9, transparent: hasCollision, opacity });

  const mountY = CAMERA_MOUNT_HEIGHT;
  const model = getCctvModel(item.cctvModelId);

  if (item.cameraBracket) {
    // Stand-off bracket. The group is yawed by item.rotation (the facing); an
    // anchor counter-rotates so the base plate, conduit and arm stay fixed to
    // the wall, and a pan pivot at the arm's end re-applies the facing so the
    // head points where the user aimed — like a real arm-mounted camera that
    // pans on its joint while the bracket stays bolted to the wall.
    const facing = item.rotation ?? 0;
    const wallRot = item.wallRotation ?? facing;
    const arm = CAMERA_BRACKET_ARM;

    const anchor = new THREE.Group();
    anchor.rotation.y = wallRot - facing; // anchor's local +Z → world inward normal
    group.add(anchor);

    // Conduit + base plate flush on the wall, an arm length behind the camera.
    const conduit = mesh(THREE, new THREE.BoxGeometry(0.03, mountY - 0.1, 0.03), trimMat);
    conduit.position.set(0, (mountY - 0.1) / 2, -arm);
    anchor.add(conduit);

    const plate = mesh(THREE, new THREE.BoxGeometry(0.12, 0.12, 0.025), trimMat);
    plate.position.set(0, mountY, -arm + 0.012);
    anchor.add(plate);

    const armMesh = mesh(THREE, new THREE.CylinderGeometry(0.022, 0.022, arm, 16), bodyMat);
    armMesh.rotation.x = Math.PI / 2;
    armMesh.position.set(0, mountY, -arm / 2);
    anchor.add(armMesh);

    const knuckle = mesh(THREE, new THREE.SphereGeometry(0.045, 16, 16), trimMat);
    knuckle.position.set(0, mountY, 0);
    anchor.add(knuckle);

    const pivot = new THREE.Group();
    pivot.rotation.y = facing - wallRot; // undo the anchor so the head faces `facing`
    anchor.add(pivot);
    pivot.add(selectCameraHead(model, { THREE, mountY, wallZ: -0.045, bodyMat, trimMat, glassMat, ledMat }));

    return group;
  }

  // Flush mount: the head sits directly against the wall at the group's back.
  const wallZ = -item.depth / 2;
  const cable = mesh(THREE, new THREE.BoxGeometry(0.03, mountY - 0.1, 0.03), trimMat);
  cable.position.set(0, (mountY - 0.1) / 2, wallZ);
  group.add(cable);

  group.add(selectCameraHead(model, { THREE, mountY, wallZ, bodyMat, trimMat, glassMat, ledMat }));

  return group;
}

/** Pick the head silhouette matching the camera's real-world model type. */
function selectCameraHead(model: CctvModel | undefined, params: HeadParams): ThreeNS.Group {
  switch (model?.type) {
    case 'PTZ':
      return buildPtzHead(params);
    case 'Bullet':
      return buildBulletHead(params);
    case 'Indoor':
      return buildPodHead(params);
    case 'Battery':
      return buildSpotlightHead(params);
    case 'Dome':
    default:
      return buildDomeHead(params);
  }
}

interface HeadParams {
  THREE: typeof import('three');
  mountY: number;
  wallZ: number;
  bodyMat: ThreeNS.Material;
  trimMat: ThreeNS.Material;
  glassMat: ThreeNS.Material;
  ledMat: ThreeNS.Material;
}

/** Hikvision-style dome: flat base ring + dark half-sphere glass dome facing +Z. */
function buildDomeHead({ THREE, mountY, wallZ, bodyMat, trimMat, glassMat, ledMat }: HeadParams): ThreeNS.Group {
  const head = new THREE.Group();

  // Flat base ring flush to the wall (cylinder axis rotated onto Z).
  const base = mesh(THREE, new THREE.CylinderGeometry(0.14, 0.15, 0.04, 36), bodyMat);
  base.rotation.x = Math.PI / 2;
  base.position.set(0, mountY, wallZ + 0.02);
  head.add(base);

  // Dark semi-transparent glass dome — a sphere cut in half, curve facing +Z.
  const dome = mesh(THREE, new THREE.SphereGeometry(0.13, 36, 18, 0, Math.PI * 2, 0, Math.PI / 2), glassMat);
  dome.rotation.x = Math.PI / 2;
  dome.position.set(0, mountY, wallZ + 0.04);
  head.add(dome);

  // Lens barrel + glossy element visible through the glass.
  const barrel = mesh(THREE, new THREE.CylinderGeometry(0.05, 0.055, 0.05, 24), trimMat);
  barrel.rotation.x = Math.PI / 2;
  barrel.position.set(0, mountY, wallZ + 0.07);
  head.add(barrel);

  const element = mesh(
    THREE,
    new THREE.SphereGeometry(0.035, 18, 14),
    new THREE.MeshStandardMaterial({ color: 0x16242e, roughness: 0.05, metalness: 0.9 })
  );
  element.position.set(0, mountY, wallZ + 0.1);
  head.add(element);

  // Status LED on the base rim.
  const led = mesh(THREE, new THREE.SphereGeometry(0.01, 10, 10), ledMat);
  led.position.set(0.1, mountY - 0.1, wallZ + 0.04);
  head.add(led);

  return head;
}

/** Nest-style indoor pod: short mount arm + ball joint + rounded cylindrical body. */
function buildPodHead({ THREE, mountY, wallZ, bodyMat, trimMat, glassMat, ledMat }: HeadParams): ThreeNS.Group {
  const head = new THREE.Group();

  // Wall foot.
  const foot = mesh(THREE, new THREE.CylinderGeometry(0.05, 0.06, 0.03, 24), bodyMat);
  foot.rotation.x = Math.PI / 2;
  foot.position.set(0, mountY, wallZ + 0.015);
  head.add(foot);

  // Mount arm reaching into the room + ball joint.
  const arm = mesh(THREE, new THREE.CylinderGeometry(0.02, 0.02, 0.14, 16), trimMat);
  arm.rotation.x = Math.PI / 2;
  arm.position.set(0, mountY, wallZ + 0.09);
  head.add(arm);

  const ball = mesh(THREE, new THREE.SphereGeometry(0.034, 18, 16), trimMat);
  ball.position.set(0, mountY, wallZ + 0.16);
  head.add(ball);

  // Rounded cylindrical pod, tilted slightly downward, lens on the +Z face.
  const pod = new THREE.Group();
  pod.position.set(0, mountY, wallZ + 0.16);
  pod.rotation.x = 0.22;

  const body = mesh(THREE, new THREE.CylinderGeometry(0.06, 0.06, 0.17, 28), bodyMat);
  body.rotation.x = Math.PI / 2;
  body.position.set(0, 0, 0.11);
  pod.add(body);

  // Rounded back cap (half sphere) so the cylinder reads as a pod, not a tube.
  const backCap = mesh(THREE, new THREE.SphereGeometry(0.06, 24, 16, 0, Math.PI * 2, 0, Math.PI / 2), bodyMat);
  backCap.rotation.x = -Math.PI / 2;
  backCap.position.set(0, 0, 0.025);
  pod.add(backCap);

  // Front bezel + glass lens.
  const bezel = mesh(THREE, new THREE.CylinderGeometry(0.058, 0.055, 0.012, 28), trimMat);
  bezel.rotation.x = Math.PI / 2;
  bezel.position.set(0, 0, 0.2);
  pod.add(bezel);

  const lens = mesh(THREE, new THREE.SphereGeometry(0.04, 20, 16, 0, Math.PI * 2, 0, Math.PI / 2), glassMat);
  lens.rotation.x = Math.PI / 2;
  lens.position.set(0, 0, 0.2);
  pod.add(lens);

  // Recording LED beside the lens.
  const led = mesh(THREE, new THREE.SphereGeometry(0.008, 10, 10), ledMat);
  led.position.set(0.035, 0.035, 0.19);
  pod.add(led);

  head.add(pod);
  return head;
}

/** Classic bullet: long horizontal barrel with a sun-shroud visor and a mount knuckle. */
function buildBulletHead({ THREE, mountY, wallZ, bodyMat, trimMat, glassMat, ledMat }: HeadParams): ThreeNS.Group {
  const head = new THREE.Group();
  const barrelLen = 0.34;
  const barrelZ = wallZ + 0.06 + barrelLen / 2;
  const frontZ = wallZ + 0.06 + barrelLen;

  // Wall plate + knuckle dropping to the barrel.
  const plate = mesh(THREE, new THREE.BoxGeometry(0.1, 0.13, 0.03), bodyMat);
  plate.position.set(0, mountY, wallZ + 0.015);
  head.add(plate);

  const knuckle = mesh(THREE, new THREE.BoxGeometry(0.04, 0.11, 0.04), trimMat);
  knuckle.position.set(0, mountY - 0.06, wallZ + 0.12);
  head.add(knuckle);

  // Long barrel pointing into the room.
  const barrel = mesh(THREE, new THREE.CylinderGeometry(0.06, 0.06, barrelLen, 28), bodyMat);
  barrel.rotation.x = Math.PI / 2;
  barrel.position.set(0, mountY, barrelZ);
  head.add(barrel);

  // Sun-shroud — an open half-cylinder hood over the top, overhanging the lens.
  const shroud = mesh(
    THREE,
    new THREE.CylinderGeometry(0.075, 0.075, barrelLen * 0.92, 28, 1, true, Math.PI / 2, Math.PI),
    bodyMat
  );
  shroud.rotation.x = Math.PI / 2;
  shroud.position.set(0, mountY, barrelZ + 0.05);
  head.add(shroud);

  // Front bezel + dark glass lens.
  const bezel = mesh(THREE, new THREE.CylinderGeometry(0.063, 0.058, 0.02, 28), trimMat);
  bezel.rotation.x = Math.PI / 2;
  bezel.position.set(0, mountY, frontZ);
  head.add(bezel);

  const lens = mesh(THREE, new THREE.CylinderGeometry(0.05, 0.05, 0.012, 24), glassMat);
  lens.rotation.x = Math.PI / 2;
  lens.position.set(0, mountY, frontZ + 0.006);
  head.add(lens);

  const led = mesh(THREE, new THREE.SphereGeometry(0.008, 10, 10), ledMat);
  led.position.set(0.045, mountY - 0.045, frontZ - 0.02);
  head.add(led);

  return head;
}

/** PTZ speed-dome: bracket arm carrying a chunky pendant housing + tinted glass bubble. */
function buildPtzHead({ THREE, mountY, wallZ, bodyMat, trimMat, glassMat, ledMat }: HeadParams): ThreeNS.Group {
  const head = new THREE.Group();
  const domeZ = wallZ + 0.26;

  // Bracket reaching out from the wall.
  const bracket = mesh(THREE, new THREE.BoxGeometry(0.07, 0.07, 0.22), bodyMat);
  bracket.position.set(0, mountY, wallZ + 0.11);
  head.add(bracket);

  // Top housing collar.
  const collar = mesh(THREE, new THREE.CylinderGeometry(0.17, 0.17, 0.09, 32), bodyMat);
  collar.position.set(0, mountY - 0.045, domeZ);
  head.add(collar);

  // Chunky tinted glass bubble (lower half-sphere) — the speed-dome.
  const bubble = mesh(THREE, new THREE.SphereGeometry(0.17, 32, 18, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), glassMat);
  bubble.position.set(0, mountY - 0.09, domeZ);
  head.add(bubble);

  // Inner lens module aimed forward-down inside the bubble.
  const module = mesh(THREE, new THREE.CylinderGeometry(0.05, 0.065, 0.11, 20), trimMat);
  module.rotation.x = Math.PI / 2 - 0.55;
  module.position.set(0, mountY - 0.13, domeZ + 0.06);
  head.add(module);

  const led = mesh(THREE, new THREE.SphereGeometry(0.012, 10, 10), ledMat);
  led.position.set(0.12, mountY - 0.05, domeZ);
  head.add(led);

  return head;
}

/** Battery spotlight cam (Ring/Arlo): wall-flush rounded body flanked by two spotlight lamps. */
function buildSpotlightHead({ THREE, mountY, wallZ, bodyMat, trimMat, glassMat, ledMat }: HeadParams): ThreeNS.Group {
  const head = new THREE.Group();
  const frontZ = wallZ + 0.02 + 0.13;
  const spotMat = new THREE.MeshStandardMaterial({ color: 0xfff6e0, emissive: 0xfff2cc, emissiveIntensity: 0.85 });

  // Wall plate.
  const plate = mesh(THREE, new THREE.BoxGeometry(0.16, 0.13, 0.03), bodyMat);
  plate.position.set(0, mountY, wallZ + 0.015);
  head.add(plate);

  // Rounded body protruding from the wall (capsule: cylinder + front dome).
  const body = mesh(THREE, new THREE.CylinderGeometry(0.07, 0.07, 0.13, 28), bodyMat);
  body.rotation.x = Math.PI / 2;
  body.position.set(0, mountY, wallZ + 0.02 + 0.065);
  head.add(body);

  const dome = mesh(THREE, new THREE.SphereGeometry(0.07, 24, 16, 0, Math.PI * 2, 0, Math.PI / 2), bodyMat);
  dome.rotation.x = Math.PI / 2;
  dome.position.set(0, mountY, frontZ);
  head.add(dome);

  // Lens on the front face.
  const lens = mesh(THREE, new THREE.SphereGeometry(0.035, 18, 14, 0, Math.PI * 2, 0, Math.PI / 2), glassMat);
  lens.rotation.x = Math.PI / 2;
  lens.position.set(0, mountY, frontZ + 0.02);
  head.add(lens);

  // Two spotlight lamps flanking the body, angled into the room.
  for (const dx of [-0.11, 0.11]) {
    const lamp = mesh(THREE, new THREE.CylinderGeometry(0.025, 0.03, 0.04, 20), trimMat);
    lamp.rotation.x = Math.PI / 2;
    lamp.position.set(dx, mountY - 0.04, wallZ + 0.05);
    head.add(lamp);

    const glow = mesh(THREE, new THREE.CylinderGeometry(0.022, 0.022, 0.008, 20), spotMat);
    glow.rotation.x = Math.PI / 2;
    glow.position.set(dx, mountY - 0.04, wallZ + 0.072);
    head.add(glow);
  }

  const led = mesh(THREE, new THREE.SphereGeometry(0.008, 10, 10), ledMat);
  led.position.set(0, mountY + 0.05, frontZ - 0.02);
  head.add(led);

  return head;
}
