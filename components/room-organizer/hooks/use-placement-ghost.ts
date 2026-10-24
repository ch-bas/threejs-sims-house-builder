import { useCallback, useEffect, useMemo, useRef, type MutableRefObject, type RefObject } from 'react';
import {
  footprintCorners,
  GHOST_ROTATION_STEP,
  ghostItem,
  ghostOutlinePoints,
  invertClientToWorld,
} from '../lib/placement-ghost';
import { pointerOnCanvas } from '../three/drag-handlers';
import { buildPlacementGhost, type PlacementGhostMesh } from '../three/placement-ghost';
import type { CatalogItem, FurnitureItem, Vec2 } from '../lib/types';
import type * as ThreeNS from 'three';

type ThreeModule = typeof import('../three/three-runtime');

export interface UsePlacementGhostParams {
  /** The entry picked up from the catalogue (use-keyboard-placement), or null. */
  ghost: CatalogItem | null;
  endGhost(): void;
  /** False while the walkthrough owns the pointer: the ghost is put down. */
  enabled: boolean;
  /** The 3D scene is up (the ghost mesh needs it). */
  sceneReady: boolean;
  view2D: boolean;
  canvasRef: RefObject<HTMLCanvasElement | null>;
  canvas2DRef: RefObject<HTMLCanvasElement | null>;
  worldPositionFromClient(clientX: number, clientY: number): Vec2 | null;
  clientToWorld2D(clientX: number, clientY: number): Vec2 | null;
  /** use-item-placement's catalogue snap: walls for openings, the toggles otherwise. */
  snapCatalogPlacement(catalogItem: CatalogItem, x: number, z: number, rotation: number): { position: Vec2; rotation: number };
  /** The active floor's items: the collision tint is re-checked when they change. */
  floorItems: readonly FurnitureItem[];
  /** Whether the item would collide on the active floor (`hasCollisions` with its context). */
  collides(item: FurnitureItem): boolean;
  /** Place the entry for real; false when declined. `keep` = the ghost stays in hand. */
  place(catalogItem: CatalogItem, position: Vec2, rotation: number, keep: boolean): boolean;
  threeModuleRef: MutableRefObject<ThreeModule | null>;
  sceneRef: MutableRefObject<ThreeNS.Scene | null>;
  invalidate(): void;
  /** World Y and height of the active storey. */
  floorY: number;
  storeyHeight: number;
}

export interface UsePlacementGhostResult {
  /** Place the ghost where it is (Enter, a click or a tap). Shift keeps it in hand. */
  confirm(keep?: boolean): void;
  /** Put it down without placing (Escape, the hint's Cancel). */
  cancel(): void;
}

interface GhostSession {
  ghost: CatalogItem;
  /** The pointer's unsnapped floor point. */
  raw: Vec2;
  /** R's turn; openings and cameras take their wall's instead. */
  turn: number;
  /** Where it would land, after snapping. */
  position: Vec2;
  rotation: number;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

function isTextField(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null;
  if (!element?.tagName) return false;
  return element.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(element.tagName);
}

function isFocusedControl(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null;
  return typeof element?.closest === 'function' && element.closest('button, a[href], [role="button"]') !== null;
}

/**
 * The placement ghost (#463 d). A catalogue tile clicked or tapped hands its
 * entry here; a see-through copy then follows the pointer over the visible
 * view, the finger on touch, snapped like a drag and red where it would
 * collide. A click or tap on the view places it, Shift+click places it and
 * keeps another in hand, R turns it, Escape (or the hint's Cancel) puts it
 * down. Nothing enters the layout until it is placed, so the placement is one
 * ordinary undo entry and a cancel leaves no trace.
 *
 * Presses on the view are taken in the document's capture phase while the
 * ghost is up, so neither the camera controls nor selection see them, while
 * other document listeners (an open popover's outside click) still do; right
 * and middle drags still orbit and pan. A second finger cancels the press. The 3D preview is moved directly and
 * the plan's outline is an SVG over the plan canvas: no state dispatch per
 * move (the drag fast-path rule).
 */
export function usePlacementGhost(params: UsePlacementGhostParams): UsePlacementGhostResult {
  const paramsRef = useRef(params);
  paramsRef.current = params;
  const sessionRef = useRef<GhostSession | null>(null);
  /** Re-renders the preview at the session's spot; set while the effect runs. */
  const renderRef = useRef<() => void>(() => {});

  const { ghost, enabled, sceneReady, view2D, floorY, storeyHeight, floorItems } = params;

  // A placement, an undo or any other edit changes what the ghost collides
  // with: re-check it where it stands.
  useEffect(() => {
    renderRef.current();
  }, [floorItems]);

  const confirm = useCallback((keep = false) => {
    const p = paramsRef.current;
    const session = sessionRef.current;
    if (!p.ghost || !session || session.ghost !== p.ghost) return;
    const placed = p.place(p.ghost, session.position, session.rotation, keep);
    if (placed && keep) {
      // The copy just placed is now in the ghost's way: show it.
      renderRef.current();
      return;
    }
    p.endGhost();
  }, []);

  const cancel = useCallback(() => paramsRef.current.endGhost(), []);

  useEffect(() => {
    if (!ghost) {
      sessionRef.current = null;
      return undefined;
    }
    if (!enabled) {
      paramsRef.current.endGhost();
      return undefined;
    }
    const p = paramsRef.current;
    const canvas = (view2D ? p.canvas2DRef : p.canvasRef).current;
    if (!canvas) return undefined;
    const toWorld = (clientX: number, clientY: number): Vec2 | null =>
      view2D ? paramsRef.current.clientToWorld2D(clientX, clientY) : paramsRef.current.worldPositionFromClient(clientX, clientY);

    // A new pick starts at the middle of the view; a rebuild of the same
    // pick (view switch, floor change) keeps its spot and turn.
    let session = sessionRef.current;
    if (!session || session.ghost !== ghost) {
      const rect = canvas.getBoundingClientRect();
      const raw = toWorld(rect.left + rect.width / 2, rect.top + rect.height / 2) ?? { x: 0, z: 0 };
      session = { ghost, raw, turn: 0, position: raw, rotation: 0 };
      sessionRef.current = session;
    }
    const live = session;

    // 3D: the item's own mesh, faded.
    let mesh: PlacementGhostMesh | null = null;
    const THREE = p.threeModuleRef.current;
    const scene = p.sceneRef.current;
    if (!view2D && sceneReady && THREE && scene) {
      mesh = buildPlacementGhost(THREE, ghostItem(ghost, live.position, 0), storeyHeight);
      scene.add(mesh.group);
    }

    // 2D: the footprint outline over the plan.
    let svg: SVGSVGElement | null = null;
    let outline: SVGPolygonElement | null = null;
    const host = canvas.parentElement;
    if (view2D && host) {
      svg = document.createElementNS(SVG_NS, 'svg');
      svg.setAttribute('aria-hidden', 'true');
      svg.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;overflow:visible';
      outline = document.createElementNS(SVG_NS, 'polygon');
      outline.setAttribute('stroke-width', '2');
      outline.setAttribute('stroke-dasharray', '6 4');
      svg.appendChild(outline);
      host.appendChild(svg);
    }

    const render = (): void => {
      const current = paramsRef.current;
      const item = ghostItem(ghost, live.position, live.rotation);
      const colliding = current.collides(item);
      if (mesh) {
        mesh.group.position.set(live.position.x, current.floorY, live.position.z);
        mesh.group.rotation.y = live.rotation;
        mesh.setColliding(colliding);
        mesh.group.visible = true;
        current.invalidate();
      }
      if (svg && outline && host) {
        const origin = host.getBoundingClientRect();
        const toClient = invertClientToWorld(current.clientToWorld2D, { x: origin.left, y: origin.top });
        if (!toClient) return;
        const local = (world: Vec2) => {
          const client = toClient(world);
          return { x: client.x - origin.left, y: client.y - origin.top };
        };
        outline.setAttribute('points', ghostOutlinePoints(footprintCorners(item, live.position, live.rotation), local));
        outline.setAttribute('fill', colliding ? 'rgba(228,82,72,0.30)' : 'rgba(127,243,255,0.28)');
        outline.setAttribute('stroke', colliding ? '#e45248' : '#0e7490');
      }
    };
    const moveTo = (raw: Vec2): void => {
      live.raw = raw;
      const snapped = paramsRef.current.snapCatalogPlacement(ghost, raw.x, raw.z, live.turn);
      live.position = snapped.position;
      live.rotation = snapped.rotation;
      render();
    };
    renderRef.current = () => moveTo(live.raw);
    moveTo(live.raw);

    let pressId: number | null = null;
    const onCanvas = (event: PointerEvent): boolean => pointerOnCanvas(canvas, event.clientX, event.clientY);
    const follow = (event: PointerEvent): void => {
      const world = toWorld(event.clientX, event.clientY);
      if (world) moveTo(world);
    };

    const onPointerDown = (event: PointerEvent): void => {
      // Right and middle drags keep orbiting and panning the camera.
      if (event.target !== canvas || event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      // A second finger is a pinch, not a placement: drop the press so its
      // release places nothing. It is swallowed too, so the camera never
      // sees a lone finger and orbits under the ghost.
      if (!event.isPrimary || pressId !== null) {
        pressId = null;
        return;
      }
      pressId = event.pointerId;
      follow(event);
    };
    const onPointerMove = (event: PointerEvent): void => {
      if (event.pointerId === pressId) event.stopPropagation();
      // A finger aims only during its own press: a pinch leaves it put.
      else if (event.pointerType === 'touch') return;
      // Over the HUD the ghost holds its last spot, as a drag does (#511).
      if (onCanvas(event)) follow(event);
    };
    const onPointerUp = (event: PointerEvent): void => {
      if (event.pointerId !== pressId) return;
      pressId = null;
      event.stopPropagation();
      // Released over the HUD: still in hand.
      if (!onCanvas(event)) return;
      follow(event);
      confirm(event.shiftKey);
    };
    const onPointerCancel = (event: PointerEvent): void => {
      if (event.pointerId === pressId) pressId = null;
    };
    // The ghost owns R, Enter, Space and Escape while it is held, ahead of
    // a focused catalog tile's roving keys and the window shortcuts.
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.ctrlKey || event.metaKey || event.altKey || isTextField(event.target)) return;
      const key = event.key.toLowerCase();
      if (key !== 'r' && key !== 'enter' && key !== ' ' && key !== 'escape') return;
      // Enter and Space on a focused button (the hint's Cancel, Undo, …) belong
      // to that button; the picked tile is blurred, so it never lands here.
      if ((key === 'enter' || key === ' ') && isFocusedControl(event.target)) return;
      event.preventDefault();
      event.stopPropagation();
      if (key === 'escape') {
        paramsRef.current.endGhost();
      } else if (key === 'r') {
        live.turn = (live.turn + (event.shiftKey ? -1 : 1) * GHOST_ROTATION_STEP) % (2 * Math.PI);
        moveTo(live.raw);
      } else if (!event.repeat) {
        confirm(event.shiftKey);
      }
    };

    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('pointermove', onPointerMove, true);
    document.addEventListener('pointerup', onPointerUp, true);
    document.addEventListener('pointercancel', onPointerCancel, true);
    window.addEventListener('keydown', onKeyDown, true);
    canvas.style.cursor = 'copy';

    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('pointermove', onPointerMove, true);
      document.removeEventListener('pointerup', onPointerUp, true);
      document.removeEventListener('pointercancel', onPointerCancel, true);
      window.removeEventListener('keydown', onKeyDown, true);
      canvas.style.cursor = '';
      renderRef.current = () => {};
      if (mesh) {
        // Detached even if the scene was rebuilt under it; always freed.
        mesh.dispose();
        paramsRef.current.invalidate();
      }
      svg?.remove();
    };
    // floorY and storeyHeight rebuild the preview on a floor change.
  }, [ghost, enabled, sceneReady, view2D, floorY, storeyHeight, confirm]);

  return useMemo(() => ({ confirm, cancel }), [confirm, cancel]);
}
