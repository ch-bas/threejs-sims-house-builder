import { NEED_KINDS, type NeedKind } from '../lib/npc-needs';
import { markSharedTexture } from './builder-utils';
import type * as ThreeNS from 'three';

type ThreeModule = typeof import('./three-runtime');

/**
 * Thought bubbles over the walkers (#906): one canvas atlas with a cell per
 * need, drawn once per walker set, and one sprite per walker that shows the
 * cell of its most pressing unmet need (lib/walker-card `bubbleNeed`) or
 * hides. Toggling swaps the sprite's map between the atlas's views and
 * flips `visible`: no rebuild, no new program. The views share one image,
 * uploaded once; they are marked shared, so `disposeObject` on a walker
 * leaves them, and the walk frees them when the walkers go.
 */
export interface NeedBubbleAtlas {
  textures: Readonly<Record<NeedKind, ThreeNS.Texture>>;
  /** Photo mode: every bubble stays hidden, so a photo shows the house, not the game. */
  hidden: boolean;
  dispose(): void;
}

export interface NeedBubble {
  sprite: ThreeNS.Sprite;
  atlas: NeedBubbleAtlas;
}

const CELL = 128;
/** The bubble's size (m), and the height of its bottom above the walker's feet. */
const BUBBLE_SIZE = 0.55;
const BUBBLE_HEIGHT = 1.88;
/** Over a sitter, whose head is lower. */
const SEATED_BUBBLE_HEIGHT = 1.45;

/** Each need's mark: ink on white, a colour per need. */
const NEED_COLOURS: Readonly<Record<NeedKind, string>> = {
  hunger: '#E65100',
  energy: '#3949AB',
  fun: '#F9A825',
  hygiene: '#0288D1',
};
const INK = '#263238';

export function createNeedBubbleAtlas(THREE: ThreeModule): NeedBubbleAtlas {
  const canvas = document.createElement('canvas');
  canvas.width = CELL * NEED_KINDS.length;
  canvas.height = CELL;
  const ctx = canvas.getContext('2d');
  if (ctx) NEED_KINDS.forEach((need, index) => drawBubble(ctx, index * CELL, need));
  const source = new THREE.CanvasTexture(canvas);
  source.colorSpace = THREE.SRGBColorSpace;
  const views = {} as Record<NeedKind, ThreeNS.Texture>;
  NEED_KINDS.forEach((need, index) => {
    // A view of one cell: clones share the canvas and its one upload.
    const view = source.clone();
    view.repeat.set(1 / NEED_KINDS.length, 1);
    view.offset.set(index / NEED_KINDS.length, 0);
    view.needsUpdate = true;
    views[need] = markSharedTexture(view);
  });
  return {
    textures: views,
    hidden: false,
    dispose() {
      for (const need of NEED_KINDS) views[need].dispose();
      source.dispose();
    },
  };
}

/** A hidden bubble for one walker, to add to its group; its material is its own, the maps are the atlas's. */
export function buildNeedBubble(THREE: ThreeModule, atlas: NeedBubbleAtlas): NeedBubble {
  const material = new THREE.SpriteMaterial({ map: atlas.textures.hunger, transparent: true, depthWrite: false });
  const sprite = new THREE.Sprite(material);
  sprite.center.set(0.5, 0);
  sprite.scale.set(BUBBLE_SIZE, BUBBLE_SIZE, 1);
  sprite.position.y = BUBBLE_HEIGHT;
  sprite.visible = false;
  sprite.name = 'need-bubble';
  return { sprite, atlas };
}

/**
 * Show `need`'s bubble, lower over a `seated` walker, or hide it for null
 * (or while the atlas is hidden); true when that changed what is drawn.
 */
export function showNeedBubble(bubble: NeedBubble, need: NeedKind | null, seated = false): boolean {
  const { sprite } = bubble;
  if (need === null || bubble.atlas.hidden) {
    if (!sprite.visible) return false;
    sprite.visible = false;
    return true;
  }
  const map = bubble.atlas.textures[need];
  const material = sprite.material;
  const height = seated ? SEATED_BUBBLE_HEIGHT : BUBBLE_HEIGHT;
  if (sprite.visible && material.map === map && sprite.position.y === height) return false;
  sprite.position.y = height;
  // Every view has the same shape of map: swapping one needs no recompile.
  material.map = map;
  sprite.visible = true;
  return true;
}

/** The bubble with its tail, and the need's mark inside, in the cell at `left`. */
function drawBubble(ctx: CanvasRenderingContext2D, left: number, need: NeedKind): void {
  const cx = left + 66;
  const cy = 52;
  ctx.save();
  ctx.lineWidth = 4;
  ctx.strokeStyle = INK;
  ctx.fillStyle = '#ffffff';
  for (const [x, y, r] of [[left + 34, 106, 9], [left + 20, 120, 5]] as const) {
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.arc(cx, cy, 46, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = NEED_COLOURS[need];
  ctx.strokeStyle = NEED_COLOURS[need];
  switch (need) {
    case 'hunger': {
      // A plate between a fork and a knife.
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.arc(cx, cy, 18, 0, Math.PI * 2);
      ctx.stroke();
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(cx - 32, cy - 20);
      ctx.lineTo(cx - 32, cy + 24);
      ctx.moveTo(cx - 38, cy - 20);
      ctx.lineTo(cx - 38, cy - 6);
      ctx.moveTo(cx - 26, cy - 20);
      ctx.lineTo(cx - 26, cy - 6);
      ctx.moveTo(cx - 38, cy - 6);
      ctx.lineTo(cx - 26, cy - 6);
      ctx.moveTo(cx + 32, cy - 20);
      ctx.lineTo(cx + 32, cy + 24);
      ctx.stroke();
      break;
    }
    case 'energy': {
      ctx.font = '700 40px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('Z', cx - 8, cy + 6);
      ctx.font = '700 26px sans-serif';
      ctx.fillText('z', cx + 18, cy - 14);
      break;
    }
    case 'fun': {
      // A five-pointed star.
      ctx.beginPath();
      for (let i = 0; i < 10; i++) {
        const angle = -Math.PI / 2 + (i * Math.PI) / 5;
        const r = i % 2 === 0 ? 30 : 13;
        ctx.lineTo(cx + Math.cos(angle) * r, cy + 2 + Math.sin(angle) * r);
      }
      ctx.closePath();
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = INK;
      ctx.stroke();
      break;
    }
    case 'hygiene': {
      // A drop of water.
      ctx.beginPath();
      ctx.moveTo(cx, cy - 30);
      ctx.bezierCurveTo(cx + 8, cy - 14, cx + 22, cy, cx + 22, cy + 12);
      ctx.arc(cx, cy + 12, 22, 0, Math.PI);
      ctx.bezierCurveTo(cx - 22, cy, cx - 8, cy - 14, cx, cy - 30);
      ctx.fill();
      break;
    }
    default: {
      const unreachable: never = need;
      throw new Error(`Unknown need ${String(unreachable)}`);
    }
  }
  ctx.restore();
}
