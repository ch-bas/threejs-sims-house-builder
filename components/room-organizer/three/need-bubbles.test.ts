// @vitest-environment jsdom
import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { disposeObject } from './builder-utils';
import { buildNeedBubble, createNeedBubbleAtlas, showNeedBubble } from './need-bubbles';

describe('need bubbles (#906)', () => {
  it('one atlas image, a view per need on its own cell', () => {
    const atlas = createNeedBubbleAtlas(THREE);
    const views = Object.values(atlas.textures);
    expect(views).toHaveLength(4);
    expect(new Set(views.map((view) => view.source)).size).toBe(1);
    expect(views.map((view) => view.offset.x)).toEqual([0, 0.25, 0.5, 0.75]);
    expect(views.every((view) => view.repeat.x === 0.25 && view.repeat.y === 1)).toBe(true);
    atlas.dispose();
  });

  it('starts hidden, shows a need, swaps the map in place, and hides; reports only real changes', () => {
    const atlas = createNeedBubbleAtlas(THREE);
    const bubble = buildNeedBubble(THREE, atlas);
    const material = bubble.sprite.material;
    expect(bubble.sprite.visible).toBe(false);
    expect(showNeedBubble(bubble, null)).toBe(false);
    expect(showNeedBubble(bubble, 'hunger')).toBe(true);
    expect(bubble.sprite.visible).toBe(true);
    expect(material.map).toBe(atlas.textures.hunger);
    expect(showNeedBubble(bubble, 'hunger')).toBe(false);
    const version = material.version;
    expect(showNeedBubble(bubble, 'hygiene')).toBe(true);
    expect(bubble.sprite.material).toBe(material);
    expect(material.map).toBe(atlas.textures.hygiene);
    // Same shape of map: no recompile asked for.
    expect(material.version).toBe(version);
    expect(showNeedBubble(bubble, null)).toBe(true);
    expect(bubble.sprite.visible).toBe(false);
    atlas.dispose();
  });

  it('sits lower over a sitter, and stays hidden while the atlas is (photo mode)', () => {
    const atlas = createNeedBubbleAtlas(THREE);
    const bubble = buildNeedBubble(THREE, atlas);
    showNeedBubble(bubble, 'fun');
    const standing = bubble.sprite.position.y;
    expect(showNeedBubble(bubble, 'fun', true)).toBe(true);
    expect(bubble.sprite.position.y).toBeLessThan(standing - 0.3);
    atlas.hidden = true;
    expect(showNeedBubble(bubble, 'fun', true)).toBe(true);
    expect(bubble.sprite.visible).toBe(false);
    expect(showNeedBubble(bubble, 'hunger')).toBe(false);
    atlas.hidden = false;
    expect(showNeedBubble(bubble, 'hunger')).toBe(true);
    expect(bubble.sprite.position.y).toBe(standing);
    atlas.dispose();
  });

  it('a walker removed frees its own material, never the shared atlas', () => {
    const atlas = createNeedBubbleAtlas(THREE);
    const views = Object.values(atlas.textures).map((view) => vi.spyOn(view, 'dispose'));
    const group = new THREE.Group();
    const bubble = buildNeedBubble(THREE, atlas);
    showNeedBubble(bubble, 'fun');
    group.add(bubble.sprite);
    const material = vi.spyOn(bubble.sprite.material, 'dispose');
    disposeObject(group);
    expect(material).toHaveBeenCalled();
    for (const spy of views) expect(spy).not.toHaveBeenCalled();
    atlas.dispose();
    for (const spy of views) expect(spy).toHaveBeenCalled();
  });
});
