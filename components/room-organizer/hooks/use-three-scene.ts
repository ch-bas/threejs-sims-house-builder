import { useEffect, useRef, useState } from 'react';
import type * as ThreeNS from 'three';
import type { OrbitControls as OrbitControlsType } from 'three/examples/jsm/controls/OrbitControls.js';

type ThreeModule = typeof import('three');

export interface HoverInfo {
  id: string;
  clientX: number;
  clientY: number;
}

export type SelectionMode = 'replace' | 'toggle';

export interface UseThreeSceneOptions {
  canvasRef: React.RefObject<HTMLCanvasElement>;
  onItemSelect: (id: string, mode: SelectionMode) => void;
  onItemDragStart?: (id: string) => void;
  onItemDrag: (id: string, x: number, z: number) => void;
  onItemDragEnd?: (id: string) => void;
  onItemHover?: (info: HoverInfo | null) => void;
  /** Fired when the user clicks an empty area (no furniture hit). */
  onEmptyClick?: (x: number, z: number) => void;
  /** Fired when the user clicks a wall (exterior or interior). */
  onWallSelect?: (info: { wallId: string; kind: 'exterior' | 'interior' }) => void;
  /** Fired on every mousemove that lands on the floor (no drag in progress). */
  onFloorPointerMove?: (x: number, z: number) => void;
  /** Fired when the pointer leaves the canvas, so floor-tracking UI can clean up. */
  onFloorPointerLeave?: () => void;
  /** Adjust a candidate drop position before it's applied (snap-to-grid, snap-to-wall, etc.). */
  snapPosition: (itemId: string, x: number, z: number) => { x: number; z: number };
  /** World-space Y for the drag plane (the floor the user is editing). */
  getDragPlaneY?: () => number;
}

export interface UseThreeSceneResult {
  isReady: boolean;
  error: string | null;
  threeModuleRef: React.MutableRefObject<ThreeModule | null>;
  sceneRef: React.MutableRefObject<ThreeNS.Scene | null>;
  cameraRef: React.MutableRefObject<ThreeNS.PerspectiveCamera | null>;
  rendererRef: React.MutableRefObject<ThreeNS.WebGLRenderer | null>;
  controlsRef: React.MutableRefObject<OrbitControlsType | null>;
  /** Convert a client-space pointer position to a world-space floor coordinate. */
  worldPositionFromClient(clientX: number, clientY: number): { x: number; z: number } | null;
}

export function useThreeScene(options: UseThreeSceneOptions): UseThreeSceneResult {
  const {
    canvasRef,
    onItemSelect,
    onItemDragStart,
    onItemDrag,
    onItemDragEnd,
    onItemHover,
    onEmptyClick,
    onWallSelect,
    onFloorPointerMove,
    onFloorPointerLeave,
    snapPosition,
    getDragPlaneY,
  } = options;

  const [isReady, setIsReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const threeModuleRef = useRef<ThreeModule | null>(null);
  const orbitCtorRef = useRef<typeof OrbitControlsType | null>(null);
  const sceneRef = useRef<ThreeNS.Scene | null>(null);
  const cameraRef = useRef<ThreeNS.PerspectiveCamera | null>(null);
  const rendererRef = useRef<ThreeNS.WebGLRenderer | null>(null);
  const controlsRef = useRef<OrbitControlsType | null>(null);

  // Latest-callback refs: capture handlers without making them part of the
  // init-effect dependency list (which would tear down the scene unnecessarily).
  const handlersRef = useRef({
    onItemSelect,
    onItemDragStart,
    onItemDrag,
    onItemDragEnd,
    onItemHover,
    onEmptyClick,
    onWallSelect,
    onFloorPointerMove,
    onFloorPointerLeave,
    snapPosition,
    getDragPlaneY,
  });
  handlersRef.current = {
    onItemSelect,
    onItemDragStart,
    onItemDrag,
    onItemDragEnd,
    onItemHover,
    onEmptyClick,
    onWallSelect,
    onFloorPointerMove,
    onFloorPointerLeave,
    snapPosition,
    getDragPlaneY,
  };

  // Load Three.js + OrbitControls once.
  const [isModuleLoaded, setModuleLoaded] = useState(false);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [three, controls] = await Promise.all([
          import('three'),
          import('three/examples/jsm/controls/OrbitControls.js'),
        ]);
        if (cancelled) return;
        threeModuleRef.current = three;
        orbitCtorRef.current = controls.OrbitControls;
        setModuleLoaded(true);
      } catch (err) {
        if (cancelled) return;
        setError(messageOf(err, 'Failed to load 3D engine.'));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Initialize scene once the module + canvas are ready.
  useEffect(() => {
    if (!isModuleLoaded) return undefined;
    const canvas = canvasRef.current;
    const THREE = threeModuleRef.current;
    const OrbitControls = orbitCtorRef.current;
    if (!canvas || !THREE || !OrbitControls) return undefined;

    const cleanup: Array<() => void> = [];

    try {
      if (!supportsWebGL()) {
        setError(
          'WebGL is not supported in your environment. Please enable hardware acceleration or use a different browser.'
        );
        return undefined;
      }

      const scene = new THREE.Scene();
      scene.background = new THREE.Color(0xf5f5f5);
      sceneRef.current = scene;

      const camera = new THREE.PerspectiveCamera(75, canvas.clientWidth / canvas.clientHeight, 0.1, 1000);
      camera.position.set(0, 8, 8);
      camera.lookAt(0, 0, 0);
      cameraRef.current = camera;

      const renderer = new THREE.WebGLRenderer({
        canvas,
        antialias: true,
        failIfMajorPerformanceCaveat: false,
        // Keep the frame buffer so toBlob/toDataURL can capture the canvas.
        preserveDrawingBuffer: true,
      });
      renderer.setSize(canvas.clientWidth, canvas.clientHeight);
      renderer.shadowMap.enabled = true;
      rendererRef.current = renderer;
      cleanup.push(() => renderer.dispose());

      const controls = new OrbitControls(camera, renderer.domElement);
      controls.enableDamping = true;
      controls.dampingFactor = 0.05;
      controls.maxPolarAngle = Math.PI / 2.5;
      controls.screenSpacePanning = true;
      controlsRef.current = controls;
      cleanup.push(() => {
        controls.dispose();
        controlsRef.current = null;
      });

      addLights(THREE, scene);

      let rafId = 0;
      const tick = () => {
        rafId = requestAnimationFrame(tick);
        controls.update();
        renderer.render(scene, camera);
      };
      rafId = requestAnimationFrame(tick);
      cleanup.push(() => cancelAnimationFrame(rafId));

      const onResize = () => {
        camera.aspect = canvas.clientWidth / canvas.clientHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(canvas.clientWidth, canvas.clientHeight);
      };
      window.addEventListener('resize', onResize);
      cleanup.push(() => window.removeEventListener('resize', onResize));

      const removeDragHandlers = attachDragHandlers({
        THREE,
        canvas,
        camera,
        scene,
        controls,
        handlersRef,
      });
      cleanup.push(removeDragHandlers);

      setIsReady(true);
    } catch (err) {
      setError(messageOf(err, 'Failed to initialize WebGL renderer.'));
    }

    return () => {
      setIsReady(false);
      for (const fn of cleanup) {
        try {
          fn();
        } catch {
          /* swallow */
        }
      }
      sceneRef.current = null;
      cameraRef.current = null;
      rendererRef.current = null;
    };
  }, [isModuleLoaded, canvasRef]);

  const worldPositionFromClient = (clientX: number, clientY: number): { x: number; z: number } | null => {
    const canvas = canvasRef.current;
    const camera = cameraRef.current;
    const THREE = threeModuleRef.current;
    if (!canvas || !camera || !THREE) return null;

    const rect = canvas.getBoundingClientRect();
    const pointer = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1
    );
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(pointer, camera);
    const planeY = handlersRef.current.getDragPlaneY?.() ?? 0;
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -planeY);
    const target = new THREE.Vector3();
    if (!raycaster.ray.intersectPlane(plane, target)) return null;
    return { x: target.x, z: target.z };
  };

  return {
    isReady,
    error,
    threeModuleRef,
    sceneRef,
    cameraRef,
    rendererRef,
    controlsRef,
    worldPositionFromClient,
  };
}

function supportsWebGL(): boolean {
  try {
    const probe = document.createElement('canvas');
    return Boolean(probe.getContext('webgl') ?? probe.getContext('experimental-webgl'));
  } catch {
    return false;
  }
}

function addLights(THREE: ThreeModule, scene: ThreeNS.Scene): void {
  // Hemisphere fill gives the bright sky / warm ground bounce a suburban lot
  // reads with — without it everything in shadow goes flat-grey.
  const hemi = new THREE.HemisphereLight(0xbfe5ff, 0xa07a48, 0.55);
  hemi.userData.type = 'light:hemi';
  scene.add(hemi);

  const ambient = new THREE.AmbientLight(0xffffff, 0.45);
  ambient.userData.type = 'light:ambient';
  scene.add(ambient);

  const directional = new THREE.DirectionalLight(0xfff4d1, 1.05);
  directional.position.set(7, 14, 6);
  directional.castShadow = true;
  // Frustum large enough to cover the lot + the outdoor perimeter so trees
  // and the room walls all cast contact shadows on the grass.
  const shadowExtent = 24;
  directional.shadow.camera.left = -shadowExtent;
  directional.shadow.camera.right = shadowExtent;
  directional.shadow.camera.top = shadowExtent;
  directional.shadow.camera.bottom = -shadowExtent;
  directional.shadow.camera.near = 1;
  directional.shadow.camera.far = 60;
  directional.shadow.mapSize.set(2048, 2048);
  directional.shadow.bias = -0.0005;
  directional.userData.type = 'light:directional';
  scene.add(directional);
}

interface DragHandlersOptions {
  THREE: ThreeModule;
  canvas: HTMLCanvasElement;
  camera: ThreeNS.PerspectiveCamera;
  scene: ThreeNS.Scene;
  controls: OrbitControlsType;
  handlersRef: React.MutableRefObject<{
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
  }>;
}

function attachDragHandlers({
  THREE,
  canvas,
  camera,
  scene,
  controls,
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

    if (id !== lastHoverId) {
      lastHoverId = id;
      canvas.style.cursor = id ? 'pointer' : '';
    }
    if (id) {
      hoverCallback({ id, clientX: event.clientX, clientY: event.clientY });
    } else {
      hoverCallback(null);
    }
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

function messageOf(error: unknown, fallback: string): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return fallback;
}
