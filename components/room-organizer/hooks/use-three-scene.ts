import { useEffect, useRef, useState } from 'react';
import { reloadOnceForChunkError } from '../lib/chunk-reload';
import { attachDragHandlers } from '../three/drag-handlers';
import { addLights } from '../three/lighting';
import { setMaxAnisotropy } from '../three/texture-settings';
import type { SceneEventHandlers } from '../three/drag-handlers';
import type * as ThreeNS from 'three';
import type { OrbitControls as OrbitControlsType } from 'three/examples/jsm/controls/OrbitControls.js';

type ThreeModule = typeof import('three');

export type { HoverInfo, SelectionMode } from '../three/drag-handlers';

export interface UseThreeSceneOptions extends SceneEventHandlers {
  canvasRef: React.RefObject<HTMLCanvasElement>;
}

export interface UseThreeSceneResult {
  isReady: boolean;
  error: string | null;
  /** Mark the scene dirty so the next animation frame renders. */
  invalidate: () => void;
  /**
   * Request a one-off recompute of the (otherwise static) shadow map on the
   * next render. Call this whenever a shadow caster or the sun actually moves
   * — NOT for pure camera orbit, which never changes cast shadows.
   */
  requestShadowUpdate: () => void;
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
    walkthroughActive,
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

  // Render-on-demand: the RAF loop only renders when OrbitControls report
  // movement or something marked the scene dirty. Starts dirty for frame 1.
  const dirtyRef = useRef(true);
  const invalidateRef = useRef(() => {
    dirtyRef.current = true;
  });

  // Shadow map is static by default (autoUpdate = false); we recompute it only
  // when a shadow caster or the sun actually moves. `requestShadowUpdate` marks
  // both the shadow map and the frame dirty so the fresh shadows get painted.
  const rendererRef = useRef<ThreeNS.WebGLRenderer | null>(null);
  const requestShadowUpdateRef = useRef(() => {
    const renderer = rendererRef.current;
    if (renderer) renderer.shadowMap.needsUpdate = true;
    dirtyRef.current = true;
  });

  const threeModuleRef = useRef<ThreeModule | null>(null);
  const orbitCtorRef = useRef<typeof OrbitControlsType | null>(null);
  const roomEnvCtorRef = useRef<(new () => ThreeNS.Scene) | null>(null);
  const sceneRef = useRef<ThreeNS.Scene | null>(null);
  const cameraRef = useRef<ThreeNS.PerspectiveCamera | null>(null);
  const controlsRef = useRef<OrbitControlsType | null>(null);

  // Latest-callback refs: capture handlers without making them part of the
  // init-effect dependency list (which would tear down the scene unnecessarily).
  const handlersRef = useRef<SceneEventHandlers>({
    walkthroughActive,
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
    walkthroughActive,
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
        const [three, controls, environments] = await Promise.all([
          import('three'),
          import('three/examples/jsm/controls/OrbitControls.js'),
          import('three/examples/jsm/environments/RoomEnvironment.js'),
        ]);
        if (cancelled) return;
        threeModuleRef.current = three;
        orbitCtorRef.current = controls.OrbitControls;
        roomEnvCtorRef.current = environments.RoomEnvironment;
        setModuleLoaded(true);
      } catch (err) {
        if (cancelled) return;
        // A stale Three.js chunk after a redeploy is a transient 404 — reload
        // once to fetch fresh assets instead of stranding the user on the
        // "Failed to load 3D engine" message.
        if (reloadOnceForChunkError(err)) return;
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
      // Day-sky horizon tone; replaced by the gradient texture as soon as
      // applyTimeOfDay runs (avoids a white flash on first paint).
      scene.background = new THREE.Color(0xdceefb);
      sceneRef.current = scene;

      // Near plane pulled from 0.1 to 0.3 for better depth precision. The
      // walkthrough eye height is ~1.6m so 0.3 never clips near geometry.
      const camera = new THREE.PerspectiveCamera(75, canvas.clientWidth / canvas.clientHeight, 0.3, 1000);
      camera.position.set(0, 8, 8);
      camera.lookAt(0, 0, 0);
      cameraRef.current = camera;

      // No `preserveDrawingBuffer` — it disables buffer optimisations on
      // every frame for a once-per-session feature. PNG capture instead
      // renders a fresh frame synchronously right before reading the canvas.
      const renderer = new THREE.WebGLRenderer({
        canvas,
        antialias: true,
        failIfMajorPerformanceCaveat: false,
        powerPreference: 'high-performance',
      });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      renderer.setSize(canvas.clientWidth, canvas.clientHeight);
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      // The 2048² directional shadow is expensive; keep it static and only
      // recompute it when a caster or the sun actually moves (via
      // requestShadowUpdate). Frame 1 needs the initial pass, so start dirty.
      renderer.shadowMap.autoUpdate = false;
      renderer.shadowMap.needsUpdate = true;
      // Filmic colour pipeline: ACES tone mapping + explicit sRGB output.
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.15;
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      setMaxAnisotropy(renderer.capabilities.getMaxAnisotropy());
      rendererRef.current = renderer;
      cleanup.push(() => renderer.dispose());

      // Image-based lighting from a neutral studio environment. This is what
      // makes MeshStandardMaterial respond with believable specular/diffuse
      // bounce instead of the flat sun+ambient-only look. Intensity is
      // re-scaled by applyTimeOfDay so nights stay dark.
      const RoomEnvironment = roomEnvCtorRef.current;
      if (RoomEnvironment) {
        const pmrem = new THREE.PMREMGenerator(renderer);
        const envTexture = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
        pmrem.dispose();
        scene.environment = envTexture;
        scene.environmentIntensity = 0.5;
        cleanup.push(() => {
          scene.environment = null;
          envTexture.dispose();
        });
      }

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

      // While the GPU context is lost the drawing buffer is gone; rendering
      // into it throws and/or wastes work. Pause the render half of the loop
      // until `webglcontextrestored` fires.
      let contextLost = false;

      let rafId = 0;
      const tick = () => {
        rafId = requestAnimationFrame(tick);
        // OrbitControls.update() returns true while the camera is moving
        // (including damping glide). Skip rendering entirely when nothing
        // changed — an editor sits idle most of the time.
        // During walkthrough the camera belongs to PointerLockControls;
        // OrbitControls.update() has no `enabled` guard (three r0.169) and
        // would re-aim the camera at the stale orbit target and clamp it back
        // into the polar cone before every render (#114). Walkthrough marks
        // frames dirty itself, so skipping update() here loses nothing.
        const controlsMoved = handlersRef.current.walkthroughActive ? false : controls.update();
        if (contextLost) return;
        if (!controlsMoved && !dirtyRef.current) return;
        dirtyRef.current = false;
        renderer.render(scene, camera);
      };
      rafId = requestAnimationFrame(tick);
      cleanup.push(() => cancelAnimationFrame(rafId));

      // WebGL context loss (GPU reset, driver hiccup, tab backgrounding) would
      // otherwise blank the canvas forever. preventDefault() lets the browser
      // restore the context; we pause rendering until it does, then rebuild the
      // shadow map and repaint from the (still-intact) scene graph.
      const onContextLost = (event: Event) => {
        event.preventDefault();
        contextLost = true;
      };
      const onContextRestored = () => {
        contextLost = false;
        // GPU resources were dropped — force a fresh shadow pass and a repaint.
        renderer.shadowMap.needsUpdate = true;
        invalidateRef.current();
      };
      canvas.addEventListener('webglcontextlost', onContextLost as EventListener, false);
      canvas.addEventListener('webglcontextrestored', onContextRestored as EventListener, false);
      cleanup.push(() => {
        canvas.removeEventListener('webglcontextlost', onContextLost as EventListener);
        canvas.removeEventListener('webglcontextrestored', onContextRestored as EventListener);
      });

      const onResize = () => {
        camera.aspect = canvas.clientWidth / canvas.clientHeight;
        camera.updateProjectionMatrix();
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        renderer.setSize(canvas.clientWidth, canvas.clientHeight);
        dirtyRef.current = true;
      };
      window.addEventListener('resize', onResize);
      cleanup.push(() => window.removeEventListener('resize', onResize));

      const removeDragHandlers = attachDragHandlers({
        THREE,
        canvas,
        camera,
        scene,
        markDirty: () => {
          dirtyRef.current = true;
        },
        requestShadowUpdate: requestShadowUpdateRef.current,
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
    invalidate: invalidateRef.current,
    requestShadowUpdate: requestShadowUpdateRef.current,
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



function messageOf(error: unknown, fallback: string): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return fallback;
}
