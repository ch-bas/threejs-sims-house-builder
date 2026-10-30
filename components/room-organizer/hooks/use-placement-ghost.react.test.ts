// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { makeCatalogItem } from '../lib/__testfixtures__/fixtures';
import { askConfirm, cancelPendingConfirms } from '../lib/confirm-dialog';
import { usePlacementGhost, type UsePlacementGhostParams } from './use-placement-ghost';
import type { CatalogItem } from '../lib/types';

const W = 800;
const H = 600;
/** The plan at 50 px/m, room centre in the middle of the canvas. */
const toWorld = (x: number, y: number) => ({ x: (x - W / 2) / 50, z: (y - H / 2) / 50 });

function rect(left: number, top: number, width: number, height: number) {
  return { left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}) };
}

function setup(overrides: Partial<UsePlacementGhostParams> = {}) {
  const host = document.createElement('div');
  const plan = document.createElement('canvas');
  const scene3d = document.createElement('canvas');
  host.append(plan, scene3d);
  document.body.append(host);
  host.getBoundingClientRect = () => rect(0, 0, W, H);
  plan.getBoundingClientRect = () => rect(0, 0, W, H);
  scene3d.getBoundingClientRect = () => rect(0, 0, W, H);
  (document as { elementFromPoint?: unknown }).elementFromPoint = () => plan;
  const place = vi.fn(() => true);
  const endGhost = vi.fn();
  const params: UsePlacementGhostParams = {
    ghost: makeCatalogItem({ width: 1, depth: 0.5 }),
    endGhost,
    enabled: true,
    sceneReady: false,
    view2D: true,
    canvasRef: { current: scene3d },
    canvas2DRef: { current: plan },
    worldPositionFromClient: () => null,
    clientToWorld2D: toWorld,
    // Snap to whole metres, so the test sees the snap applied.
    floorItems: [],
    snapCatalogPlacement: (_item, x, z, rotation) => ({ position: { x: Math.round(x), z: Math.round(z) }, rotation }),
    collides: (item) => (item.position?.x ?? 0) > 2,
    place,
    threeModuleRef: { current: null },
    sceneRef: { current: null },
    invalidate: () => {},
    floorY: 0,
    storeyHeight: 3,
    ...overrides,
  };
  const hook = renderHook((props: UsePlacementGhostParams) => usePlacementGhost(props), { initialProps: params });
  return { ...hook, params, plan, host, place, endGhost };
}

const pointer = (type: string, x: number, y: number, extra: PointerEventInit = {}) =>
  new PointerEvent(type, { clientX: x, clientY: y, pointerId: 1, button: 0, isPrimary: true, bubbles: true, ...extra });

describe('usePlacementGhost (#463 d)', () => {
  afterEach(() => {
    cleanup();
    document.body.innerHTML = '';
    delete (document as { elementFromPoint?: unknown }).elementFromPoint;
  });

  it('follows the pointer over the plan with a snapped outline, red where it collides', () => {
    const { host } = setup();
    const outline = host.querySelector('polygon')!;
    expect(outline).not.toBeNull();
    act(() => {
      document.dispatchEvent(pointer('pointermove', W / 2 + 60, H / 2 + 10));
    });
    // (1.2, 0.2) snaps to (1, 0): the outline is centred there, 50 px/m.
    const xs = outline.getAttribute('points')!.split(' ').map((p) => Number(p.split(',')[0]));
    expect((Math.max(...xs) + Math.min(...xs)) / 2).toBeCloseTo(W / 2 + 50, 5);
    expect(outline.getAttribute('fill')).toContain('127,243,255');
    act(() => {
      document.dispatchEvent(pointer('pointermove', W / 2 + 160, H / 2));
    });
    expect(outline.getAttribute('fill')).toContain('228,82,72');
  });

  it('places where a press is released, swallowing it so the plan never selects', () => {
    const { plan, place, endGhost } = setup();
    const planDown = vi.fn();
    plan.addEventListener('pointerdown', planDown);
    act(() => {
      plan.dispatchEvent(pointer('pointerdown', W / 2 - 100, H / 2 + 50));
      plan.dispatchEvent(pointer('pointerup', W / 2 - 100, H / 2 + 50));
    });
    expect(planDown).not.toHaveBeenCalled();
    expect(place).toHaveBeenCalledWith(expect.objectContaining({ name: 'Chair' }), { x: -2, z: 1 }, 0, false);
    expect(endGhost).toHaveBeenCalled();
  });

  it('keeps the ghost in hand after a Shift+click, and turns it with R', () => {
    const { plan, place, endGhost } = setup();
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'r', bubbles: true }));
      plan.dispatchEvent(pointer('pointerdown', W / 2, H / 2));
      plan.dispatchEvent(pointer('pointerup', W / 2, H / 2, { shiftKey: true }));
    });
    expect(place).toHaveBeenCalledWith(expect.anything(), { x: 0, z: 0 }, Math.PI / 2, true);
    expect(endGhost).not.toHaveBeenCalled();
  });

  it('lets right-button drags through to the camera', () => {
    const { plan, place } = setup();
    const planDown = vi.fn();
    plan.addEventListener('pointerdown', planDown);
    act(() => {
      plan.dispatchEvent(pointer('pointerdown', W / 2, H / 2, { button: 2 }));
    });
    expect(planDown).toHaveBeenCalled();
    expect(place).not.toHaveBeenCalled();
  });

  it('holds its spot when released over the HUD', () => {
    const { plan, place } = setup();
    const hud = document.createElement('div');
    act(() => {
      plan.dispatchEvent(pointer('pointerdown', W / 2, H / 2));
    });
    (document as { elementFromPoint?: unknown }).elementFromPoint = () => hud;
    act(() => {
      document.dispatchEvent(pointer('pointerup', W / 2, H - 10));
    });
    expect(place).not.toHaveBeenCalled();
  });

  it('confirms at its spot from Enter, and is put down by the walkthrough', () => {
    const { result, rerender, params, place, endGhost } = setup();
    act(() => {
      result.current.confirm();
    });
    expect(place).toHaveBeenCalledWith(expect.anything(), { x: 0, z: 0 }, 0, false);
    endGhost.mockClear();
    rerender({ ...params, ghost: { ...params.ghost } as CatalogItem, enabled: false });
    expect(endGhost).toHaveBeenCalled();
  });

  it('owns Enter, Space and Escape while held, ahead of the page', () => {
    const { place, endGhost } = setup();
    const page = vi.fn();
    window.addEventListener('keydown', page);
    act(() => {
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });
    expect(place).toHaveBeenCalledTimes(1);
    act(() => {
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', shiftKey: true, bubbles: true }));
    });
    expect(place).toHaveBeenLastCalledWith(expect.anything(), { x: 0, z: 0 }, 0, true);
    endGhost.mockClear();
    act(() => {
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(endGhost).toHaveBeenCalled();
    expect(page).not.toHaveBeenCalled();
    window.removeEventListener('keydown', page);
  });

  it('leaves Escape, Enter and R to an open in-app question (#649)', () => {
    const { place, endGhost } = setup();
    let answer: boolean | null = null;
    void askConfirm({ title: 'Place it anyway?' }).then((ok) => {
      answer = ok;
    });
    act(() => {
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'r', bubbles: true }));
    });
    expect(endGhost).not.toHaveBeenCalled();
    expect(place).not.toHaveBeenCalled();
    cancelPendingConfirms();
    expect(answer).toBeNull();
    act(() => {
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(endGhost).toHaveBeenCalled();
  });

  it('leaves Enter and Space on a focused button to that button', () => {
    const { place, endGhost } = setup();
    const cancel = document.createElement('button');
    document.body.appendChild(cancel);
    act(() => {
      cancel.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      cancel.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
    });
    expect(place).not.toHaveBeenCalled();
    act(() => {
      cancel.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(endGhost).toHaveBeenCalled();
    cancel.remove();
  });

  it('places nothing when a second finger turns the press into a pinch', () => {
    const { plan, place } = setup();
    act(() => {
      plan.dispatchEvent(pointer('pointerdown', W / 2, H / 2, { pointerType: 'touch' }));
      plan.dispatchEvent(pointer('pointerdown', W / 2 + 40, H / 2, { pointerId: 2, isPrimary: false, pointerType: 'touch' }));
      plan.dispatchEvent(pointer('pointerup', W / 2 + 80, H / 2, { pointerId: 2, isPrimary: false, pointerType: 'touch' }));
      plan.dispatchEvent(pointer('pointerup', W / 2 - 80, H / 2, { pointerType: 'touch' }));
    });
    expect(place).not.toHaveBeenCalled();
  });

  it('lets an outside-click listener on the document still see a press on the view', () => {
    const { plan } = setup();
    const outside = vi.fn();
    document.addEventListener('pointerdown', outside, true);
    act(() => {
      plan.dispatchEvent(pointer('pointerdown', W / 2, H / 2));
    });
    expect(outside).toHaveBeenCalled();
    document.removeEventListener('pointerdown', outside, true);
  });

  it('re-checks the collision tint when the floor changes under it', () => {
    let blocked = false;
    const { rerender, params, host } = setup({ collides: () => blocked });
    const outline = host.querySelector('polygon')!;
    expect(outline.getAttribute('fill')).toContain('127,243,255');
    blocked = true;
    rerender({ ...params, floorItems: [] });
    expect(outline.getAttribute('fill')).toContain('228,82,72');
  });

  it('removes its outline and listeners when put down', () => {
    const { rerender, params, host, plan, place } = setup();
    rerender({ ...params, ghost: null });
    expect(host.querySelector('svg')).toBeNull();
    act(() => {
      plan.dispatchEvent(pointer('pointerdown', W / 2, H / 2));
      plan.dispatchEvent(pointer('pointerup', W / 2, H / 2));
    });
    expect(place).not.toHaveBeenCalled();
  });
});
