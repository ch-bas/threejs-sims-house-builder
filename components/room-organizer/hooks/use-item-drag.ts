import { useCallback, useRef, type MutableRefObject } from 'react';
import { CAMERA_BRACKET_ARM } from '../lib/constants';
import { hasCollisions } from '../lib/geometry';
import { reseatWallMountedItem, snapWallMountedItem } from '../lib/opening-snap';
import type { LayoutActions } from './use-layout-state';
import type { FloorLayout } from '../lib/types';
import type * as ThreeNS from 'three';

export interface UseItemDragParams {
  activeFloor: FloorLayout;
  activeFloorIndex: number;
  roomWidth: number;
  roomDepth: number;
  actions: LayoutActions;
  allSelectedIds: ReadonlySet<string>;
}

export interface UseItemDragResult {
  /**
   * useThreeScene is called after this hook (its options include the drag
   * callbacks below), so its scene ref and invalidate fn are late-bound
   * through these boxes for use in the fast-path helpers.
   */
  sceneBoxRef: MutableRefObject<MutableRefObject<ThreeNS.Scene | null> | null>;
  invalidateBoxRef: MutableRefObject<() => void>;
  handleDragStart(primaryId: string): void;
  handleDrag(id: string, x: number, z: number): void;
  handleDragEnd(id: string): void;
}

/**
 * Drag fast-path. While a drag is in progress the Three.js groups are moved
 * directly and the single state dispatch is deferred to drag end —
 * dispatching per mousemove (the old behaviour) tore down and rebuilt every
 * furniture mesh on each pointer event. `origins` snapshots the selection's
 * starting positions for group drags; `latest` accumulates in-flight
 * positions and becomes one bulkSetPositions on release (which also gives
 * undo a single entry per gesture instead of one per mousemove).
 */
// True if any entry's latest position differs from its origin. A pure
// click-select (or any gesture with no net movement) leaves latest === origins,
// which must not commit state or lock the item.
function sessionMoved(
  origins: Map<string, { x: number; z: number }>,
  latest: Map<string, { x: number; z: number }>
): boolean {
  const EPS = 1e-4;
  for (const [id, origin] of origins) {
    const now = latest.get(id);
    if (!now) continue;
    if (Math.abs(now.x - origin.x) > EPS || Math.abs(now.z - origin.z) > EPS) {
      return true;
    }
  }
  return false;
}

export function useItemDrag({
  activeFloor,
  activeFloorIndex,
  roomWidth,
  roomDepth,
  actions,
  allSelectedIds,
}: UseItemDragParams): UseItemDragResult {
  const sceneBoxRef = useRef<MutableRefObject<ThreeNS.Scene | null> | null>(null);
  const invalidateBoxRef = useRef<() => void>(() => {});

  const dragSessionRef = useRef<{
    primaryId: string;
    origins: Map<string, { x: number; z: number }>;
    latest: Map<string, { x: number; z: number }>;
  } | null>(null);

  const findFurnitureGroup = useCallback(
    (itemId: string) =>
      sceneBoxRef.current?.current?.children.find(
        (obj) =>
          obj.userData.type === 'furniture' &&
          obj.userData.id === itemId &&
          obj.userData.floorIndex === activeFloorIndex
      ) ?? null,
    [activeFloorIndex]
  );

  // Live collision feedback during the fast-path: tint the dragged group's
  // emissive channel instead of rebuilding its meshes. Original emissive
  // values (lamp glow, TV screens) are stashed on material.userData and
  // restored on release.
  const setDragCollisionTint = useCallback((group: ThreeNS.Object3D, colliding: boolean) => {
    group.traverse((node) => {
      const material = (node as ThreeNS.Mesh).material;
      const materials = Array.isArray(material) ? material : material ? [material] : [];
      for (const mat of materials) {
        const std = mat as ThreeNS.MeshStandardMaterial;
        if (!std.emissive) continue;
        if (colliding) {
          if (std.userData.dragTint === undefined) std.userData.dragTint = std.emissive.getHex();
          std.emissive.setHex(0x7f1d1d);
        } else if (std.userData.dragTint !== undefined) {
          std.emissive.setHex(std.userData.dragTint as number);
          delete std.userData.dragTint;
        }
      }
    });
  }, []);

  const handleDragStart = useCallback(
    (primaryId: string) => {
      const ids = allSelectedIds.size > 1 ? allSelectedIds : new Set([primaryId]);
      const origins = new Map<string, { x: number; z: number }>();
      for (const id of ids) {
        const item = activeFloor.items.find((entry) => entry.id === id);
        if (item?.position) origins.set(id, { x: item.position.x, z: item.position.z });
      }
      dragSessionRef.current = { primaryId, origins, latest: new Map(origins) };
    },
    [allSelectedIds, activeFloor.items]
  );

  const handleDrag = useCallback(
    (id: string, x: number, z: number) => {
      const session = dragSessionRef.current;
      if (!session || session.primaryId !== id) {
        // No drag session (programmatic move) — dispatch directly.
        actions.moveItem(id, x, z);
        return;
      }
      session.latest.set(id, { x, z });

      // Group drag: translate every other selected group by the same delta.
      // The primary group was already moved by the canvas drag handler.
      const primaryOrigin = session.origins.get(id);
      if (primaryOrigin && session.origins.size > 1) {
        const dx = x - primaryOrigin.x;
        const dz = z - primaryOrigin.z;
        for (const [otherId, origin] of session.origins) {
          if (otherId === id) continue;
          const next = { x: origin.x + dx, z: origin.z + dz };
          session.latest.set(otherId, next);
          const group = findFurnitureGroup(otherId);
          if (group) {
            group.position.x = next.x;
            group.position.z = next.z;
          }
        }
      }

      const candidateItems = activeFloor.items.map((item) => {
        const moved = session.latest.get(item.id);
        return moved ? { ...item, position: moved } : item;
      });
      const dragged = candidateItems.find((item) => item.id === id);
      const primaryGroup = findFurnitureGroup(id);
      if (dragged && primaryGroup) {
        setDragCollisionTint(primaryGroup, hasCollisions(dragged, candidateItems, roomWidth, roomDepth));
      }
      invalidateBoxRef.current();
    },
    [actions, activeFloor.items, roomWidth, roomDepth, findFurnitureGroup, setDragCollisionTint]
  );

  const handleDragEnd = useCallback(
    (id: string) => {
      const session = dragSessionRef.current;
      dragSessionRef.current = null;
      const finalPos = session?.latest.get(id);
      // A gesture that never actually moved anything (a stray zero-distance
      // drag) must not write state or add an undo entry, and must not re-lock
      // the item — otherwise a click silently blocks the next nudge/delete
      // (see #65). A real drag always leaves at least one position changed.
      const moved = session ? sessionMoved(session.origins, session.latest) : false;
      if (session && finalPos && moved) {
        const primaryGroup = findFurnitureGroup(id);
        if (primaryGroup) setDragCollisionTint(primaryGroup, false);
        // Single dispatch for the whole gesture; the rebuild effect runs once.
        actions.bulkSetPositions(session.latest);
      }
      if (!moved) return;
      // Lock the item after a real drag so it can't be accidentally moved.
      actions.setLocked(id, true);
      // On release, click a security camera onto the nearest wall and turn it to
      // face into the room. Doing this on drop (not per drag frame) keeps the
      // drag itself smooth instead of flipping between walls. Note: read the
      // position from the drag session — state is one dispatch behind here.
      const item = activeFloor.items.find((entry) => entry.id === id);
      const releasePos = finalPos ?? item?.position;
      if (item?.type === 'security-camera' && releasePos) {
        const snapped = snapWallMountedItem({
          position: releasePos,
          itemWidth: item.width,
          itemDepth: item.depth,
          roomWidth,
          roomDepth,
          interiorWalls: activeFloor.interiorWalls ?? [],
        });
        // Record the wall's inward-normal yaw so rotation can be locked to the
        // in/out axis, then re-seat for the camera's current mount style.
        actions.updateItem(id, { wallRotation: snapped.rotation });
        if (item.cameraBracket) {
          const pos = reseatWallMountedItem({
            position: releasePos,
            itemWidth: item.width,
            itemDepth: item.depth,
            roomWidth,
            roomDepth,
            interiorWalls: activeFloor.interiorWalls ?? [],
            rotation: item.rotation ?? snapped.rotation,
            bracketArm: CAMERA_BRACKET_ARM,
          });
          actions.moveItem(id, pos.x, pos.z);
        } else {
          actions.moveItem(id, snapped.position.x, snapped.position.z);
          if (Math.abs((item.rotation ?? 0) - snapped.rotation) > 1e-3) {
            actions.setRotation(id, snapped.rotation);
          }
        }
      }
    },
    [activeFloor.items, activeFloor.interiorWalls, roomWidth, roomDepth, actions, findFurnitureGroup, setDragCollisionTint]
  );

  return { sceneBoxRef, invalidateBoxRef, handleDragStart, handleDrag, handleDragEnd };
}
