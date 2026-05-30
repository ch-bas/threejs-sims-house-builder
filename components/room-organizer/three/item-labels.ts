import type * as ThreeNS from 'three';
import type { FurnitureItem } from '../lib/types';

type ThreeModule = typeof import('three');

const LABEL_TAG = 'item-label';

export function clearItemLabels(scene: ThreeNS.Scene): void {
  for (const obj of scene.children.filter((child) => child.userData.type === LABEL_TAG)) {
    scene.remove(obj);
    disposeSprite(obj);
  }
}

export function renderItemLabels(
  THREE: ThreeModule,
  scene: ThreeNS.Scene,
  items: readonly FurnitureItem[],
  yOffset: number
): void {
  clearItemLabels(scene);
  for (const item of items) {
    if (!item.position) continue;
    const sprite = createLabelSprite(THREE, item.name);
    sprite.position.set(item.position.x, yOffset + item.height + 0.4, item.position.z);
    sprite.userData.type = LABEL_TAG;
    sprite.userData.itemId = item.id;
    scene.add(sprite);
  }
}

function createLabelSprite(THREE: ThreeModule, text: string): ThreeNS.Sprite {
  const canvas = document.createElement('canvas');
  const padding = 12;
  const fontSize = 28;
  canvas.width = 256;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');

  if (ctx) {
    ctx.fillStyle = 'rgba(15, 23, 42, 0.85)';
    ctx.roundRect(0, 0, canvas.width, canvas.height, 12);
    ctx.fill();

    ctx.fillStyle = '#ffffff';
    ctx.font = `600 ${fontSize}px -apple-system, BlinkMacSystemFont, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // Truncate over-long names with an ellipsis so the texture stays readable.
    const maxWidth = canvas.width - padding * 2;
    const display = fitText(ctx, text, maxWidth);
    ctx.fillText(display, canvas.width / 2, canvas.height / 2);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  // Crisper sampling at oblique angles.
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;

  const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(1.2, 0.3, 1);
  return sprite;
}

function fitText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let truncated = text;
  while (truncated.length > 1 && ctx.measureText(`${truncated}…`).width > maxWidth) {
    truncated = truncated.slice(0, -1);
  }
  return `${truncated}…`;
}

function disposeSprite(obj: ThreeNS.Object3D): void {
  const sprite = obj as ThreeNS.Sprite;
  if (sprite.material instanceof Array) {
    sprite.material.forEach((material) => disposeMaterial(material));
  } else if (sprite.material) {
    disposeMaterial(sprite.material);
  }
}

function disposeMaterial(material: ThreeNS.Material | ThreeNS.SpriteMaterial): void {
  const spriteMat = material as ThreeNS.SpriteMaterial;
  if (spriteMat.map) spriteMat.map.dispose();
  material.dispose();
}
