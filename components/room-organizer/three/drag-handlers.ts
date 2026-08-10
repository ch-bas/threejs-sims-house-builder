import type * as ThreeNS from 'three';
import type { OrbitControls as OrbitControlsType } from 'three/examples/jsm/controls/OrbitControls.js';

type ThreeModule = typeof import('three');

export interface HoverInfo {
  id: string;
  clientX: number;
  clientY: number;
}

export type SelectionMode = 'replace' | 'toggle';

/**
 * The React-side callbacks the canvas event handlers feed into. Read through a
 * `{ current }` box so the latest render's closures are always used without
 * re-attaching DOM listeners.
 */
export interface SceneEventHandlers {
  onItemSelect: (id: string, mode: SelectionMode) => void;
  onItemDragStart?: (id: string) => void;
  onItemDrag: (id: string, x: number, z: number) => void;
  onItemDragEnd?: (id: string) => void;
  onItemHover?: (info: HoverInfo | null) => void;
  onEmptyClick?: (x: number, z: number) => void;
  onWallSelect?: (info: { wallId: string; kind: 'exterior' | 'interior' }) => void;
  onFloorPointerMove?: (x: number, z: number) => void;
  onFloorPointerLeave?: () => void;
  snapPosition: (id: string, x: number, z: number) => { x: number; z: number };
  getDragPlaneY?: () => number;
}

export interface DragHandlersOptions {
  THREE: ThreeModule;
  canvas: HTMLCanvasElement;
  camera: ThreeNS.PerspectiveCamera;
  scene: ThreeNS.Scene;
  controls: OrbitControlsType;
  markDirty: () => void;
  handlersRef: { readonly current: SceneEventHandlers };
}

/**
 * Wires the canvas mouse events for select / drag / hover / wall-pick /
 * empty-click. Pure Three.js + DOM — no React. Returns a cleanup that removes
 * every listener.
 */
export function attachDragHandlers({
  THREE,
  canvas,
  camera,
  scene,
  controls,
  markDirty,
  handlersRef,
}: DragHandlersOptions): () => void {
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const dragPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const intersection = new THREE.Vector3();

  let dragTarget: ThreeNS.Object3D | null = null;

  const setPointerFromEvent = (event: MouseEvent): void => {
    const rect = canvas.getBoundingClientRect();
    pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  };

  const onMouseDown = (event: MouseEvent): void => {
    setPointerFromEvent(event);
    raycaster.setFromCamera(pointer, camera);
    const furniture = scene.children.filter((obj) => obj.userData.type === 'furniture');
    const hits = raycaster.intersectObjects(furniture, true);
    if (hits.length === 0) {
      // Walls get a chance to claim the click before we fall through to the
      // floor's onEmptyClick handler. Required for "pick a wall to
      // paint it" interaction.
      if (handlersRef.current.onWallSelect) {
        const wallObjects = scene.children.filter(
          (obj) =>
            obj.userData.type === 'wall' || obj.userData.type === 'interior-wall'
        );
        const wallHits = raycaster.intersectObjects(wallObjects, false);
        const wallHit = wallHits.find((h) => h.object.visible);
        if (wallHit) {
          const id = wallHit.object.userData.wallId as string | undefined;
          if (id) {
            handlersRef.current.onWallSelect({
              wallId: id,
              kind: wallHit.object.userData.type === 'interior-wall'
                ? 'interior'
                : 'exterior',
            });
            return;
          }
        }
      }
      if (handlersRef.current.onEmptyClick) {
        dragPlane.constant = -(handlersRef.current.getDragPlaneY?.() ?? 0);
        if (raycaster.ray.intersectPlane(dragPlane, intersection)) {
          handlersRef.current.onEmptyClick(intersection.x, intersection.z);
        }
      }
      return;
    }

    const target = ascendToFurniture(hits[0]?.object);
    if (!target) return;

    const mode: SelectionMode = event.ctrlKey || event.metaKey ? 'toggle' : 'replace';
    const itemId = target.userData.id as string;
    handlersRef.current.onItemSelect(itemId, mode);

    if (target.userData.locked === true || mode === 'toggle') return;

    dragTarget = target;
    controls.enabled = false;
    handlersRef.current.onItemDragStart?.(itemId);
  };

  let lastHoverId: string | null = null;
  const updateHover = (event: MouseEvent): void => {
    const hoverCallback = handlersRef.current.onItemHover;
    if (!hoverCallback) return;
    setPointerFromEvent(event);
    raycaster.setFromCamera(pointer, camera);
    const furniture = scene.children.filter((obj) => obj.userData.type === 'furniture');
    const hits = raycaster.intersectObjects(furniture, true);
    const target = ascendToFurniture(hits[0]?.object);
    const id = target ? (target.userData.id as string) : null;

    // Only notify on hover changes — a fresh payload per mousemove would
    // re-render React for every pixel of travel. The tooltip anchors at the
    // point where the hover began.
    if (id === lastHoverId) return;
    lastHoverId = id;
    canvas.style.cursor = id ? 'pointer' : '';
    hoverCallback(id ? { id, clientX: event.clientX, clientY: event.clientY } : null);
  };

  const onMouseMove = (event: MouseEvent): void => {
    if (!dragTarget) {
      updateHover(event);
      if (handlersRef.current.onFloorPointerMove) {
        setPointerFromEvent(event);
        raycaster.setFromCamera(pointer, camera);
        dragPlane.constant = -(handlersRef.current.getDragPlaneY?.() ?? 0);
        if (raycaster.ray.intersectPlane(dragPlane, intersection)) {
          handlersRef.current.onFloorPointerMove(intersection.x, intersection.z);
        }
      }
      return;
    }
    setPointerFromEvent(event);
    raycaster.setFromCamera(pointer, camera);
    dragPlane.constant = -(handlersRef.current.getDragPlaneY?.() ?? 0);
    raycaster.ray.intersectPlane(dragPlane, intersection);

    const itemId = dragTarget.userData.id as string;
    const snapped = handlersRef.current.snapPosition(itemId, intersection.x, intersection.z);

    dragTarget.position.x = snapped.x;
    dragTarget.position.z = snapped.z;
    markDirty();
    handlersRef.current.onItemDrag(itemId, snapped.x, snapped.z);
  };

  const onMouseUp = (): void => {
    if (!dragTarget) return;
    const id = dragTarget.userData.id as string;
    dragTarget = null;
    controls.enabled = true;
    handlersRef.current.onItemDragEnd?.(id);
  };

  const onMouseLeave = (): void => {
    handlersRef.current.onItemHover?.(null);
    handlersRef.current.onFloorPointerLeave?.();
    canvas.style.cursor = '';
    if (dragTarget) {
      const id = dragTarget.userData.id as string;
      dragTarget = null;
      controls.enabled = true;
      handlersRef.current.onItemDragEnd?.(id);
    }
  };

  canvas.addEventListener('mousedown', onMouseDown);
  canvas.addEventListener('mousemove', onMouseMove);
  canvas.addEventListener('mouseup', onMouseUp);
  canvas.addEventListener('mouseleave', onMouseLeave);

  return () => {
    canvas.removeEventListener('mousedown', onMouseDown);
    canvas.removeEventListener('mousemove', onMouseMove);
    canvas.removeEventListener('mouseup', onMouseUp);
    canvas.removeEventListener('mouseleave', onMouseLeave);
  };
}

function ascendToFurniture(node: ThreeNS.Object3D | undefined): ThreeNS.Object3D | null {
  let current: ThreeNS.Object3D | null = node ?? null;
  while (current && current.userData?.type !== 'furniture') {
    current = current.parent;
  }
  return current && current.userData?.type === 'furniture' ? current : null;
}
