// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { makeCatalogItem, makeItem } from '../lib/__testfixtures__/fixtures';
import { askConfirm, cancelPendingConfirms } from '../lib/confirm-dialog';
import { closeShortcutsOverlay, openShortcutsOverlay } from '../lib/shortcut-overlay';
import { usePlacementGhost, type GhostRunParams, type UsePlacementGhostParams } from './use-placement-ghost';
import type { CatalogItem, FurnitureItem } from '../lib/types';

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
    revealSetback: () => 0,
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

  describe('runs (#915)', () => {
    const fence = () => makeCatalogItem({ type: 'fence', name: 'Fence Section', category: 'outdoor', width: 2, depth: 0.15, price: 120 });
    type Sections = Array<{ id: string; width: number; position: { x: number; z: number }; rotation: number }>;
    const runParams = (overrides: Partial<GhostRunParams> = {}) => {
      const place = vi.fn((_item: CatalogItem, _items: FurnitureItem[], _keep: boolean) => true);
      const refuse = vi.fn();
      const run: GhostRunParams = {
        lot: { x0: -100, x1: 100, z0: -100, z1: 100 },
        gate: null,
        fit: (sections) => ({ sections: [...sections], dropped: 0, blocker: null }),
        place,
        refuse,
        ...overrides,
      };
      return { run, place: overrides.place ?? place, refuse };
    };
    const drawRun = (plan: HTMLCanvasElement, extra: PointerEventInit = {}) => {
      act(() => {
        plan.dispatchEvent(pointer('pointerdown', W / 2 - 200, H / 2 + 250));
        document.dispatchEvent(pointer('pointermove', W / 2 + 150, H / 2 + 260));
        plan.dispatchEvent(pointer('pointerup', W / 2 + 150, H / 2 + 260, extra));
      });
    };

    it('lays a run from the press to the release, in one call, sections end to end', () => {
      const { run, place: placeRun } = runParams();
      const { plan, host, place, endGhost } = setup({ ghost: fence(), run, collides: () => false });
      act(() => {
        plan.dispatchEvent(pointer('pointerdown', W / 2 - 200, H / 2 + 250));
        document.dispatchEvent(pointer('pointermove', W / 2, H / 2 + 255));
      });
      // The preview: one outline per section and the length at the tip.
      expect(host.querySelectorAll('polygon').length).toBeGreaterThanOrEqual(2);
      expect(host.querySelector('text')?.textContent).toContain('2 × Fence Section');
      act(() => {
        document.dispatchEvent(pointer('pointermove', W / 2 + 150, H / 2 + 260));
        plan.dispatchEvent(pointer('pointerup', W / 2 + 150, H / 2 + 260));
      });
      expect(place).not.toHaveBeenCalled();
      expect(placeRun).toHaveBeenCalledTimes(1);
      const [, items, keep] = vi.mocked(placeRun).mock.calls[0] as unknown as [CatalogItem, Sections, boolean];
      expect(keep).toBe(false);
      // (-4, 5) to (3, 5): straight along x, on the 15° step.
      expect(items.map((item) => item.width)).toEqual([2, 2, 2, 1]);
      expect(items.every((item) => item.rotation === 0 && item.position.z === 5)).toBe(true);
      expect(new Set(items.map((item) => item.id)).size).toBe(4);
      expect(endGhost).toHaveBeenCalled();
    });

    it('places one section for a click or a jitter under 12 px, and drops a run when a second finger lands', () => {
      const { run, place: placeRun } = runParams();
      const { plan, place } = setup({ ghost: fence(), run });
      act(() => {
        plan.dispatchEvent(pointer('pointerdown', W / 2, H / 2 + 250));
        document.dispatchEvent(pointer('pointermove', W / 2 + 8, H / 2 + 254));
        plan.dispatchEvent(pointer('pointerup', W / 2 + 8, H / 2 + 254));
      });
      expect(place).toHaveBeenCalledTimes(1);
      expect(placeRun).not.toHaveBeenCalled();
      act(() => {
        plan.dispatchEvent(pointer('pointerdown', W / 2, H / 2 + 250));
        document.dispatchEvent(pointer('pointermove', W / 2 + 200, H / 2 + 250));
        plan.dispatchEvent(pointer('pointerdown', W / 2 + 200, H / 2, { pointerId: 2, isPrimary: false }));
        plan.dispatchEvent(pointer('pointerup', W / 2 + 200, H / 2 + 250));
      });
      expect(placeRun).not.toHaveBeenCalled();
    });

    it('keeps the ghost in hand after a Shift run, and lays a chair without runs', () => {
      const { run, place: placeRun } = runParams();
      const { plan, endGhost } = setup({ ghost: fence(), run });
      drawRun(plan, { shiftKey: true });
      expect(placeRun).toHaveBeenCalledWith(expect.anything(), expect.any(Array), true);
      expect(endGhost).not.toHaveBeenCalled();
      cleanup();
      const chair = setup({ run });
      act(() => {
        chair.plan.dispatchEvent(pointer('pointerdown', W / 2, H / 2));
        chair.plan.dispatchEvent(pointer('pointerup', W / 2 + 200, H / 2));
      });
      expect(placeRun).toHaveBeenCalledTimes(1);
      expect(chair.place).toHaveBeenCalledTimes(1);
    });

    it('lays only what fits, the gaps left out of the preview too', () => {
      const { run, place: placeRun } = runParams({
        fit: (sections) => ({ sections: sections.filter((_, index) => index !== 1), dropped: 1, blocker: null }),
      });
      const { plan, host } = setup({ ghost: fence(), run, collides: () => false });
      act(() => {
        plan.dispatchEvent(pointer('pointerdown', W / 2 - 200, H / 2 + 250));
        document.dispatchEvent(pointer('pointermove', W / 2 + 150, H / 2 + 260));
      });
      const shown = [...host.querySelectorAll('polygon')].filter((shape) => (shape as SVGElement).style.display !== 'none');
      expect(shown).toHaveLength(3);
      act(() => {
        plan.dispatchEvent(pointer('pointerup', W / 2 + 150, H / 2 + 260));
      });
      const [, items] = vi.mocked(placeRun).mock.calls[0] as unknown as [CatalogItem, Sections];
      expect(items.map((item) => item.position.x)).toEqual([-3, 1, 2.5]);
    });

    it('refuses a run standing in an item as a whole, naming it, and puts the ghost down unless Shift', () => {
      const blocker = makeItem({ id: 'tree', name: 'Oak Tree' });
      const { run, place: placeRun, refuse } = runParams({
        fit: (sections) => ({ sections: [...sections], dropped: 0, blocker }),
      });
      const { plan, host, endGhost } = setup({ ghost: fence(), run, collides: () => false });
      act(() => {
        plan.dispatchEvent(pointer('pointerdown', W / 2 - 200, H / 2 + 250));
        document.dispatchEvent(pointer('pointermove', W / 2 + 150, H / 2 + 260));
      });
      expect(host.querySelector('text')?.textContent).toContain('Oak Tree in the way');
      expect(host.querySelector('polygon')?.getAttribute('fill')).toContain('228,82,72');
      act(() => {
        plan.dispatchEvent(pointer('pointerup', W / 2 + 150, H / 2 + 260));
      });
      expect(placeRun).not.toHaveBeenCalled();
      expect(refuse).toHaveBeenCalledWith(blocker, false);
      expect(endGhost).toHaveBeenCalledTimes(1);
      drawRun(plan, { shiftKey: true });
      expect(refuse).toHaveBeenCalledTimes(2);
      expect(endGhost).toHaveBeenCalledTimes(1);
    });

    it('runs a fence round the lot in one call, gated, and puts it down; refuses whole on an item; never for a chair', () => {
      const { run, place: placeRun, refuse } = runParams({ lot: { x0: -11, x1: 11, z0: -10, z1: 10 }, gate: 0 });
      const { result, endGhost } = setup({ ghost: fence(), run });
      act(() => result.current.runRoundLot());
      expect(placeRun).toHaveBeenCalledTimes(1);
      const [, items, keep] = vi.mocked(placeRun).mock.calls[0] as unknown as [CatalogItem, Sections, boolean];
      expect(keep).toBe(false);
      expect(new Set(items.map((item) => item.id)).size).toBe(items.length);
      // Round all four sides, the street side in two parts round the gate.
      expect(items.some((item) => item.position.z < -9.9)).toBe(true);
      expect(items.some((item) => item.position.z > 9.9)).toBe(true);
      expect(items.some((item) => Math.abs(item.position.z + 9.925) < 1e-6 && Math.abs(item.position.x) < 0.6 + item.width / 2)).toBe(false);
      expect(endGhost).toHaveBeenCalledTimes(1);

      const blocker = makeItem({ id: 'tree', name: 'Oak Tree' });
      const blocked = runParams({ fit: (sections) => ({ sections: [...sections], dropped: 0, blocker }) });
      const second = setup({ ghost: fence(), run: blocked.run });
      act(() => second.result.current.runRoundLot());
      expect(blocked.place).not.toHaveBeenCalled();
      expect(blocked.refuse).toHaveBeenCalledWith(blocker, true);
      expect(second.endGhost).toHaveBeenCalledTimes(1);

      const chair = setup({ run });
      act(() => chair.result.current.runRoundLot());
      expect(placeRun).toHaveBeenCalledTimes(1);
      expect(refuse).not.toHaveBeenCalled();
    });

    it('keeps the cancel of its own press from the camera controls', () => {
      const { plan } = setup({ ghost: fence(), run: runParams().run });
      const controls = vi.fn();
      plan.addEventListener('pointercancel', controls);
      act(() => {
        plan.dispatchEvent(pointer('pointerdown', W / 2, H / 2));
        plan.dispatchEvent(new PointerEvent('pointercancel', { pointerId: 1, bubbles: true }));
        // Another pointer's cancel is not the ghost's.
        plan.dispatchEvent(new PointerEvent('pointercancel', { pointerId: 7, bubbles: true }));
      });
      expect(controls).toHaveBeenCalledTimes(1);
    });

    it('is put down by a refusal or the soft question, as one item is; Shift keeps it while asked', () => {
      const refused = runParams({ place: vi.fn(() => false) });
      const first = setup({ ghost: fence(), run: refused.run });
      drawRun(first.plan);
      expect(first.endGhost).toHaveBeenCalled();
      cleanup();
      const asking = runParams({
        place: vi.fn(() => {
          void askConfirm({ title: 'Lay them anyway?' });
          return false;
        }),
      });
      const second = setup({ ghost: fence(), run: asking.run });
      drawRun(second.plan, { shiftKey: true });
      expect(second.endGhost).not.toHaveBeenCalled();
      cancelPendingConfirms();
      drawRun(second.plan);
      expect(second.endGhost).toHaveBeenCalled();
      cancelPendingConfirms();
    });

    it('drops a press whose release was lost, so the next click places (blur, or a mouse move with no button)', () => {
      const { run, place: placeRun } = runParams();
      const { plan, place } = setup({ ghost: fence(), run });
      act(() => {
        plan.dispatchEvent(pointer('pointerdown', W / 2 - 200, H / 2 + 250));
        document.dispatchEvent(pointer('pointermove', W / 2 + 150, H / 2 + 260, { pointerType: 'mouse', buttons: 1 }));
        // The release happened outside the window: the next move has no button down.
        document.dispatchEvent(pointer('pointermove', W / 2 + 160, H / 2 + 260, { pointerType: 'mouse', buttons: 0 }));
      });
      expect(placeRun).not.toHaveBeenCalled();
      act(() => {
        plan.dispatchEvent(pointer('pointerdown', W / 2, H / 2));
        plan.dispatchEvent(pointer('pointerup', W / 2, H / 2));
      });
      expect(place).toHaveBeenCalledTimes(1);
      act(() => {
        plan.dispatchEvent(pointer('pointerdown', W / 2 - 200, H / 2 + 250));
        document.dispatchEvent(pointer('pointermove', W / 2 + 150, H / 2 + 260));
        window.dispatchEvent(new Event('blur'));
        plan.dispatchEvent(pointer('pointerdown', W / 2, H / 2));
        plan.dispatchEvent(pointer('pointerup', W / 2, H / 2));
      });
      expect(placeRun).not.toHaveBeenCalled();
      expect(place).toHaveBeenCalledTimes(2);
    });

    it('a single item loses its press the same way', () => {
      const { plan, place } = setup();
      act(() => {
        plan.dispatchEvent(pointer('pointerdown', W / 2, H / 2));
        window.dispatchEvent(new Event('blur'));
        plan.dispatchEvent(pointer('pointerup', W / 2, H / 2));
      });
      expect(place).not.toHaveBeenCalled();
      act(() => {
        plan.dispatchEvent(pointer('pointerdown', W / 2, H / 2));
        plan.dispatchEvent(pointer('pointerup', W / 2, H / 2));
      });
      expect(place).toHaveBeenCalledTimes(1);
    });

    it('waits for the release on Enter or Space mid-press, which then lays the run', () => {
      const { run, place: placeRun } = runParams();
      const { plan, place } = setup({ ghost: fence(), run });
      act(() => {
        plan.dispatchEvent(pointer('pointerdown', W / 2 - 200, H / 2 + 250));
        document.dispatchEvent(pointer('pointermove', W / 2 + 150, H / 2 + 260));
        document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        document.body.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
      });
      expect(place).not.toHaveBeenCalled();
      act(() => {
        plan.dispatchEvent(pointer('pointerup', W / 2 + 150, H / 2 + 260));
      });
      expect(placeRun).toHaveBeenCalledTimes(1);
    });
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

  it('leaves Enter, Space, R and Escape to the open shortcut overlay (#932): nothing placed or bought behind it', () => {
    const { place, endGhost } = setup();
    openShortcutsOverlay();
    try {
      const keys = ['Enter', ' ', 'r', 'Escape'].map((key) => new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
      act(() => {
        for (const event of keys) document.body.dispatchEvent(event);
      });
      expect(place).not.toHaveBeenCalled();
      expect(endGhost).not.toHaveBeenCalled();
      // Escape went on to the dialog, untouched.
      expect(keys.every((event) => !event.defaultPrevented)).toBe(true);
    } finally {
      closeShortcutsOverlay();
    }
    act(() => {
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });
    expect(place).toHaveBeenCalledTimes(1);
  });

  it('stays in hand when a Shift placement asks first (the soft budget), and is put down without Shift (F4)', () => {
    const asking = () => {
      void askConfirm({ title: 'Place it anyway?' });
      return false;
    };
    const { result, endGhost } = setup({ place: vi.fn(asking) });
    act(() => {
      result.current.confirm(true);
    });
    expect(endGhost).not.toHaveBeenCalled();
    cancelPendingConfirms();
    act(() => {
      result.current.confirm(false);
    });
    expect(endGhost).toHaveBeenCalled();
    cancelPendingConfirms();
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
