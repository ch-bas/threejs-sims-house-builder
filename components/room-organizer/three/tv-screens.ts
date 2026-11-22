import { ROOM_OBJECT_TAGS } from './room-builder';
import type * as ThreeNS from 'three';

/**
 * TV screens switched on in EXPLORE (#910). The screen glows through its
 * material's emissive colour only: no light is added (the lamp pool's size is
 * fixed, and a light count change recompiles every shader), no texture, so
 * nothing recompiles either. The screens are known by their material, in a
 * WeakSet rather than `userData`, which the GLB export would carry.
 */
const screens = new WeakSet<ThreeNS.Material>();
/** Scenes with a screen lit now: with none lit and none wanted, nothing is walked. */
const scenesLit = new WeakSet<ThreeNS.Object3D>();

/** A cool, bright picture: what a lit screen looks like across a dim room. */
export const TV_GLOW_COLOR = 0x9cc6ff;
export const TV_GLOW_INTENSITY = 0.95;

/** Marks `material` as a TV's screen (`buildTV`); it starts dark, as built. */
export function markTvScreen<T extends ThreeNS.Material>(material: T): T {
  screens.add(material);
  return material;
}

/**
 * Lights the screens of the TVs in `on` and darkens every other one. Each
 * value is written absolutely, so a furniture group kept across edits (#404)
 * or newly built lands on the same picture, and an empty set puts every
 * screen back as the builder made it. True when a screen changed. With no TV
 * on and none lit, it returns at once: an edit in a house nobody switched a
 * TV in walks nothing. (A rebuilt screen starts dark, so none can be lit
 * unseen.)
 */
export function applyTvScreens(scene: ThreeNS.Object3D, on: ReadonlySet<string>): boolean {
  if (on.size === 0 && !scenesLit.has(scene)) return false;
  let changed = false;
  let anyLit = false;
  for (const group of scene.children) {
    if (group.userData.type !== ROOM_OBJECT_TAGS.Furniture) continue;
    const lit = on.has(group.userData.id as string);
    if (lit) anyLit = true;
    group.traverse((node) => {
      const material = (node as ThreeNS.Mesh).material as ThreeNS.Material | ThreeNS.Material[] | undefined;
      if (!material || Array.isArray(material) || !screens.has(material)) return;
      const screen = material as ThreeNS.MeshStandardMaterial;
      const color = lit ? TV_GLOW_COLOR : 0x000000;
      const intensity = lit ? TV_GLOW_INTENSITY : 1;
      if (screen.emissive.getHex() === color && screen.emissiveIntensity === intensity) return;
      screen.emissive.setHex(color);
      screen.emissiveIntensity = intensity;
      changed = true;
    });
  }
  if (anyLit) scenesLit.add(scene);
  else scenesLit.delete(scene);
  return changed;
}
