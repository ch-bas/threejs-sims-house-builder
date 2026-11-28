import { useCallback, useEffect, useMemo, useRef, type MutableRefObject, type RefObject } from 'react';
import { onPlanZoom } from '../canvas-2d/plan-zoom';
import { confirmOpen } from '../lib/confirm-dialog';
import { formatMetres } from '../lib/format';
import { randomSuffix } from '../lib/ids';
import {
  cornerInset,
  isRunItem,
  layLotRun,
  layRun,
  RUN_DRAG_PX,
  runsRoundLot,
  snapRunPoint,
  type RunFit,
  type RunLot,
  type RunSnap,
} from '../lib/item-run';
import { GHOST_KEYS } from '../lib/keymap';
import {
  footprintCorners,
  GHOST_ROTATION_STEP,
  ghostItem,
  ghostOutlinePoints,
  groundUnderPointer,
  invertClientToWorld,
} from '../lib/placement-ghost';
import { isShortcutsOverlayOpen } from '../lib/shortcut-overlay';
import { isTypingTarget } from '../lib/walk-input';
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
  worldPositionFromClient(clientX: number, clientY: number, planeY?: number): Vec2 | null;
  clientToWorld2D(clientX: number, clientY: number): Vec2 | null;
  /** use-item-placement's catalogue snap: walls for openings, the toggles otherwise. */
  snapCatalogPlacement(catalogItem: CatalogItem, x: number, z: number, rotation: number): { position: Vec2; rotation: number };
  /** The active floor's items: the collision tint is re-checked when they change. */
  floorItems: readonly FurnitureItem[];
  /** Whether the item would collide on the active floor (`hasCollisions` with its context). */
  collides(item: FurnitureItem): boolean;
  /** Where the item's mesh stands in its group on the active floor (`revealSetbacks`, #758): 0 for most. */
  revealSetback(item: FurnitureItem): number;
  /** Place the entry for real; false when declined. `keep` = the ghost stays in hand. */
  place(catalogItem: CatalogItem, position: Vec2, rotation: number, keep: boolean): boolean;
  /** Runs of a fence, hedge or stepping stone in hand (#915). Without it a drag places one. */
  run?: GhostRunParams;
  threeModuleRef: MutableRefObject<ThreeModule | null>;
  sceneRef: MutableRefObject<ThreeNS.Scene | null>;
  invalidate(): void;
  /** World Y and height of the active storey. */
  floorY: number;
  storeyHeight: number;
  /** The ground under a garden item on a sloped site, where it will stand (#665); null for the floor. */
  groundY?(item: FurnitureItem): number | null;
}

export interface GhostRunParams {
  /** The garden a run stays in (`runLot`). */
  lot: RunLot;
  /** Where a run round the lot leaves a gate for the front path (`frontPathGate`), or null. */
  gate: number | null;
  /** What of a drawn run can be laid (`fitRun` against the ground floor). */
  fit(sections: readonly FurnitureItem[]): RunFit;
  /** Lay the sections, all in one step; false when refused or asked about. `keep` = the ghost stays in hand. */
  place(catalogItem: CatalogItem, items: FurnitureItem[], keep: boolean): boolean;
  /** Say why a run standing in `blocker` wasn't laid; `roundLot` for the run round the lot (#915), which nobody drew. */
  refuse(blocker: FurnitureItem, roundLot: boolean): void;
}

export interface UsePlacementGhostResult {
  /** Place the ghost where it is (Enter, a click or a tap). Shift keeps it in hand. */
  confirm(keep?: boolean): void;
  /** Put it down without placing (Escape, the hint's Cancel). */
  cancel(): void;
  /** Run the fence or hedge in hand round the whole lot in one step (#915), then put it down. */
  runRoundLot(): void;
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
  /** A run item pressed down (#915): where the run starts. */
  anchor: RunSnap | null;
  /** Where the run would end, under the pointer. */
  tip: RunSnap | null;
  /** What the run would lay: empty until the drag is long enough. */
  run: RunFit;
}

const NO_RUN: RunFit = { sections: [], dropped: 0, blocker: null };

const SVG_NS = 'http://www.w3.org/2000/svg';

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
 * and middle drags still orbit and pan. With a fence, hedge or stepping stone
 * in hand, a drag lays a run of them from the press to the release (#915).
 * A second finger cancels the press; so does a press whose release never
 * came (the window lost focus, or the mouse moves with no button down). The
 * 3D preview is moved directly and
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
    // Over the soft budget it asks first (#649): with Shift held the ghost
    // stays in hand for the next one, whatever the answer.
    if (!placed && keep && confirmOpen()) return;
    if (placed && keep) {
      // The copy just placed is now in the ghost's way: show it.
      renderRef.current();
      return;
    }
    p.endGhost();
  }, []);

  const cancel = useCallback(() => paramsRef.current.endGhost(), []);

  // "Fence the lot" (#915): the hint's button lays the run round the lot as
  // a drawn run is laid: fitted, refused whole on an item in the way, bought
  // or asked about once, one edit. Put down after, whatever the answer.
  const runRoundLot = useCallback(() => {
    const p = paramsRef.current;
    const ghost = p.ghost;
    if (!ghost || !p.run || !runsRoundLot(ghost.type)) return;
    const prefix = `${ghost.type}-${Date.now()}-${randomSuffix()}`;
    const { sections, blocker } = p.run.fit(layLotRun(p.run.lot, ghost, p.run.gate, (index) => `${prefix}-${index}`));
    if (blocker) p.run.refuse(blocker, true);
    else if (sections.length > 0) p.run.place(ghost, sections, false);
    p.endGhost();
  }, []);

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
    const toWorld = (clientX: number, clientY: number): Vec2 | null => {
      const current = paramsRef.current;
      if (view2D) return current.clientToWorld2D(clientX, clientY);
      // A garden item on a slope stands on the ground: find the point of it
      // under the pointer, not the floor's (#665).
      return groundUnderPointer(
        (planeY) => current.worldPositionFromClient(clientX, clientY, planeY),
        (position) => current.groundY?.(ghostItem(ghost, position, 0)) ?? null
      );
    };

    // A new pick starts at the middle of the view; a rebuild of the same
    // pick (view switch, floor change) keeps its spot and turn.
    let session = sessionRef.current;
    if (!session || session.ghost !== ghost) {
      const rect = canvas.getBoundingClientRect();
      const raw = toWorld(rect.left + rect.width / 2, rect.top + rect.height / 2) ?? { x: 0, z: 0 };
      session = { ghost, raw, turn: 0, position: raw, rotation: 0, anchor: null, tip: null, run: NO_RUN };
      sessionRef.current = session;
    }
    const live = session;

    live.anchor = null;
    live.tip = null;
    live.run = NO_RUN;
    const runs = isRunItem(ghost.type) && p.run !== undefined;

    // 3D: the item's own mesh, faded.
    let mesh: PlacementGhostMesh | null = null;
    const THREE = p.threeModuleRef.current;
    const scene = p.sceneRef.current;
    if (!view2D && sceneReady && THREE && scene) {
      mesh = buildPlacementGhost(THREE, ghostItem(ghost, live.position, 0), storeyHeight);
      scene.add(mesh.group);
    }
    // A run's other sections: built as the run first needs them, then kept
    // and moved, so a drag builds each mesh once (the drag fast-path rule).
    const runMeshes: PlacementGhostMesh[] = [];
    const sectionMesh = (index: number): PlacementGhostMesh | null => {
      if (index === 0) return mesh;
      if (!THREE || !scene || !mesh) return null;
      while (runMeshes.length < index) {
        const extra = buildPlacementGhost(THREE, ghostItem(ghost, live.position, 0), storeyHeight);
        scene.add(extra.group);
        runMeshes.push(extra);
      }
      return runMeshes[index - 1] ?? null;
    };

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
    // A run's other outlines, and its length at the tip.
    const runOutlines: SVGPolygonElement[] = [];
    let runLabel: SVGTextElement | null = null;
    const sectionOutline = (index: number): SVGPolygonElement | null => {
      if (index === 0) return outline;
      if (!svg) return null;
      while (runOutlines.length < index) {
        const extra = document.createElementNS(SVG_NS, 'polygon');
        extra.setAttribute('stroke-width', '2');
        extra.setAttribute('stroke-dasharray', '6 4');
        svg.appendChild(extra);
        runOutlines.push(extra);
      }
      return runOutlines[index - 1] ?? null;
    };

    const renderRun = (): void => {
      const current = paramsRef.current;
      // Sections in the house or on the porch are left out: the gaps show.
      const sections = live.run.sections;
      // The run is placed or refused as a whole: one tint for all of it.
      const colliding = live.run.blocker !== null || sections.some((section) => current.collides(section));
      sections.forEach((section, index) => {
        const sectionGhost = sectionMesh(index);
        if (!sectionGhost || !section.position) return;
        sectionGhost.group.position.set(section.position.x, current.groundY?.(section) ?? current.floorY, section.position.z);
        sectionGhost.group.rotation.y = section.rotation ?? 0;
        // The last section, cut to fit: the preview squeezes the whole one.
        sectionGhost.group.scale.x = section.width / ghost.width;
        sectionGhost.setColliding(colliding);
        sectionGhost.group.visible = true;
      });
      for (let index = Math.max(0, sections.length - 1); index < runMeshes.length; index += 1) runMeshes[index]!.group.visible = false;
      // Nothing left to lay (all of it in the house): no first section either.
      if (mesh && sections.length === 0) mesh.group.visible = false;
      if (outline) outline.style.display = sections.length === 0 ? 'none' : '';
      if (mesh) current.invalidate();
      if (svg && host) {
        const origin = host.getBoundingClientRect();
        const toClient = invertClientToWorld(current.clientToWorld2D, { x: origin.left, y: origin.top });
        if (!toClient) return;
        const local = (world: Vec2) => {
          const client = toClient(world);
          return { x: client.x - origin.left, y: client.y - origin.top };
        };
        sections.forEach((section, index) => {
          const shape = sectionOutline(index);
          if (!shape || !section.position) return;
          shape.setAttribute('points', ghostOutlinePoints(footprintCorners(section, section.position, section.rotation ?? 0), local));
          shape.setAttribute('fill', colliding ? 'rgba(228,82,72,0.30)' : 'rgba(127,243,255,0.28)');
          shape.setAttribute('stroke', colliding ? '#e45248' : '#0e7490');
          shape.style.display = '';
        });
        for (let index = Math.max(0, sections.length - 1); index < runOutlines.length; index += 1) runOutlines[index]!.style.display = 'none';
        const tip = live.tip;
        if (tip && live.anchor) {
          runLabel ??= svg.appendChild(document.createElementNS(SVG_NS, 'text'));
          const at = local(tip.point);
          runLabel.setAttribute('x', String(at.x + 10));
          runLabel.setAttribute('y', String(at.y - 10));
          runLabel.setAttribute('fill', colliding ? '#e45248' : '#0e7490');
          runLabel.setAttribute('font-size', '12');
          runLabel.setAttribute('font-weight', '700');
          runLabel.setAttribute('paint-order', 'stroke');
          runLabel.setAttribute('stroke', '#ffffff');
          runLabel.setAttribute('stroke-width', '3');
          const anchor = live.anchor.point;
          const blocker = live.run.blocker;
          runLabel.textContent =
            `${formatMetres(Math.hypot(tip.point.x - anchor.x, tip.point.z - anchor.z))} · ${sections.length} × ${ghost.name}` +
            (blocker ? ` · ${blocker.name} in the way` : '');
          runLabel.style.display = '';
        }
      }
    };

    const hideRun = (): void => {
      for (const extra of runMeshes) extra.group.visible = false;
      if (mesh) mesh.group.scale.x = 1;
      for (const extra of runOutlines) extra.style.display = 'none';
      if (runLabel) runLabel.style.display = 'none';
    };

    const render = (): void => {
      if (live.anchor && live.tip) {
        renderRun();
        return;
      }
      hideRun();
      if (outline) outline.style.display = '';
      const current = paramsRef.current;
      const item = ghostItem(ghost, live.position, live.rotation);
      const colliding = current.collides(item);
      if (mesh) {
        mesh.group.position.set(live.position.x, current.groundY?.(item) ?? current.floorY, live.position.z);
        mesh.group.rotation.y = live.rotation;
        mesh.setSetback(current.revealSetback(item));
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
    // The plan zoomed or panned under the outline (#678): redraw it.
    const stopZoom = view2D ? onPlanZoom(canvas, render) : null;

    let pressId: number | null = null;
    /** Where the press went down on screen: a run starts once the pointer is RUN_DRAG_PX from it. */
    let pressAt: { x: number; y: number } | null = null;
    const onCanvas = (event: PointerEvent): boolean => pointerOnCanvas(canvas, event.clientX, event.clientY);
    const follow = (event: PointerEvent): void => {
      const world = toWorld(event.clientX, event.clientY);
      if (!world) return;
      if (live.anchor && !live.tip && pressAt && Math.hypot(event.clientX - pressAt.x, event.clientY - pressAt.y) >= RUN_DRAG_PX) {
        // Far enough on screen, at any zoom: a run, not a jittery click.
        live.tip = live.anchor;
      }
      if (live.tip) aimRun(world);
      moveTo(world);
    };

    // A run (#915): its sections from the anchor to the snapped tip, clear of
    // a section it joins at either end.
    const aimRun = (world: Vec2): void => {
      const anchor = live.anchor;
      if (!anchor) return;
      const current = paramsRef.current;
      if (!current.run) return;
      const tip = snapRunPoint(world, anchor.point, ghost.type, current.floorItems, current.run.lot);
      live.tip = tip;
      const sections = layRun(anchor.point, tip.point, ghost, {
        insetStart: cornerInset(anchor.point, tip.point, anchor.joined),
        insetEnd: cornerInset(tip.point, anchor.point, tip.joined),
      });
      live.run = current.run.fit(sections);
    };
    const dropRun = (): void => {
      live.anchor = null;
      live.tip = null;
      live.run = NO_RUN;
    };
    /** A press whose release never came: put it down, placing nothing. */
    const losePress = (): void => {
      if (pressId === null) return;
      pressId = null;
      pressAt = null;
      dropRun();
      renderRef.current();
    };
    /**
     * Lays the run drawn so far, or refuses it as a whole when a section
     * stands in an item already there; false when the press drew no run.
     */
    const placeRun = (keep: boolean): boolean => {
      const drawn = live.tip !== null;
      const { sections, blocker } = live.run;
      dropRun();
      if (!drawn) return false;
      const current = paramsRef.current;
      if (blocker) {
        // Refused like an unaffordable run: put down, unless Shift keeps it in hand.
        current.run?.refuse(blocker, false);
        if (keep) renderRef.current();
        else current.endGhost();
        return true;
      }
      if (sections.length === 0) {
        renderRef.current();
        return true;
      }
      const prefix = `${ghost.type}-${Date.now()}-${randomSuffix()}`;
      const placed = current.run?.place(ghost, sections.map((section, index) => ({ ...section, id: `${prefix}-${index}` })), keep) ?? false;
      // As a single placement: over the soft budget it asks first (#649), and
      // only Shift keeps the ghost in hand meanwhile; a refusal puts it down.
      if (!placed && keep && confirmOpen()) return true;
      if (placed && keep) {
        renderRef.current();
        return true;
      }
      current.endGhost();
      return true;
    };

    const onPointerDown = (event: PointerEvent): void => {
      // Right and middle drags keep orbiting and panning the camera.
      if (event.target !== canvas || event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      // A second finger is a pinch, not a placement: drop the press so its
      // release places nothing. It is swallowed too, so the camera never
      // sees a lone finger and orbits under the ghost.
      // The same pointer pressing again lost its release: a fresh press.
      if (pressId !== null && event.pointerId === pressId) losePress();
      if (!event.isPrimary || pressId !== null) {
        losePress();
        return;
      }
      pressId = event.pointerId;
      pressAt = { x: event.clientX, y: event.clientY };
      if (runs) {
        const world = toWorld(event.clientX, event.clientY);
        const current = paramsRef.current;
        if (world) live.anchor = snapRunPoint(world, null, ghost.type, current.floorItems, current.run?.lot ?? null);
      }
      follow(event);
    };
    const onPointerMove = (event: PointerEvent): void => {
      // A mouse moving with no button down has released somewhere we never heard.
      if (event.pointerId === pressId && event.pointerType === 'mouse' && event.buttons === 0) losePress();
      if (event.pointerId === pressId) event.stopPropagation();
      // A finger aims only during its own press: a pinch leaves it put.
      else if (event.pointerType === 'touch') return;
      // Over the HUD the ghost holds its last spot, as a drag does (#511).
      if (onCanvas(event)) follow(event);
    };
    const onPointerUp = (event: PointerEvent): void => {
      if (event.pointerId !== pressId) return;
      pressId = null;
      pressAt = null;
      event.stopPropagation();
      // Released over the HUD: still in hand, and a run drawn so far is dropped.
      if (!onCanvas(event)) {
        dropRun();
        renderRef.current();
        return;
      }
      follow(event);
      if (placeRun(event.shiftKey)) return;
      confirm(event.shiftKey);
    };
    const onPointerCancel = (event: PointerEvent): void => {
      if (event.pointerId !== pressId) return;
      // Its press never reached the camera controls, nor may its cancel:
      // they would release a pointer capture they never set.
      event.stopPropagation();
      losePress();
    };
    // The ghost owns R, Enter, Space and Escape while it is held, ahead of
    // a focused catalog tile's roving keys and the window shortcuts.
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.ctrlKey || event.metaKey || event.altKey || isTypingTarget(event.target)) return;
      // An open question (#649), or the `?` overlay (#932), owns the keys
      // until it closes: nothing is placed or turned behind it.
      if (confirmOpen() || isShortcutsOverlayOpen()) return;
      const key = event.key.toLowerCase();
      if (key !== GHOST_KEYS.turn && key !== GHOST_KEYS.put && key !== GHOST_KEYS.putToo && key !== GHOST_KEYS.end) return;
      // Enter and Space on a focused button (the hint's Cancel, Undo, …) belong
      // to that button; the picked tile is blurred, so it never lands here.
      if ((key === GHOST_KEYS.put || key === GHOST_KEYS.putToo) && isFocusedControl(event.target)) return;
      event.preventDefault();
      event.stopPropagation();
      if (key === GHOST_KEYS.end) {
        paramsRef.current.endGhost();
      } else if (key === GHOST_KEYS.turn) {
        live.turn = (live.turn + (event.shiftKey ? -1 : 1) * GHOST_ROTATION_STEP) % (2 * Math.PI);
        moveTo(live.raw);
      } else if (!event.repeat && pressId === null) {
        // Mid-press, Enter and Space wait for the release: it places, or lays the run.
        confirm(event.shiftKey);
      }
    };

    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('pointermove', onPointerMove, true);
    document.addEventListener('pointerup', onPointerUp, true);
    document.addEventListener('pointercancel', onPointerCancel, true);
    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('blur', losePress);
    canvas.style.cursor = 'copy';

    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('pointermove', onPointerMove, true);
      document.removeEventListener('pointerup', onPointerUp, true);
      document.removeEventListener('pointercancel', onPointerCancel, true);
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('blur', losePress);
      stopZoom?.();
      canvas.style.cursor = '';
      renderRef.current = () => {};
      if (mesh) {
        // Detached even if the scene was rebuilt under it; always freed.
        mesh.dispose();
        paramsRef.current.invalidate();
      }
      for (const extra of runMeshes) extra.dispose();
      svg?.remove();
    };
    // floorY and storeyHeight rebuild the preview on a floor change.
  }, [ghost, enabled, sceneReady, view2D, floorY, storeyHeight, confirm]);

  return useMemo(() => ({ confirm, cancel, runRoundLot }), [confirm, cancel, runRoundLot]);
}
