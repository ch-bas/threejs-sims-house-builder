import { useEffect, useRef, useState } from 'react';
import { isChunkLoadError, markAppReady, reloadOnceForChunkError } from '../lib/chunk-reload';
import { REDUCED_MOTION_QUERY } from '../lib/reduced-motion';
import { qualityProfile, type QualityChoice, type QualityProfile } from '../lib/render-quality';
import { ORBIT_FOV_DEG, ORBIT_MAX_POLAR, ORBIT_START, clearOfGround, orbitNear } from '../lib/scene-insets';
import { holdForShaderWarmup } from '../lib/shader-warmup';
import { disposeScene } from '../three/builder-utils';
import { attachDragHandlers } from '../three/drag-handlers';
import { createFrameBudget, type DecorativeStep, type FrameBudget } from '../three/frame-budget';
import { releaseGroundTextures } from '../three/ground-surfaces';
import { addLights, applyShadowQuality, bakeStudioEnvironment, installEnvironment, type SceneEnvironment } from '../three/lighting';
import { releaseRoomLightTexture } from '../three/night-glow';
import { releasePeopleGeometry } from '../three/people-model';
import { clearFloorPlanImageCache } from '../three/room-builder';
import { setSkyDetail } from '../three/sky';
import { clearTextureCaches } from '../three/texture-lru';
import { setMaxAnisotropy } from '../three/texture-settings';
import type { SceneEventHandlers } from '../three/drag-handlers';
import type * as ThreeNS from 'three';
import type { OrbitControls as OrbitControlsType } from 'three/examples/jsm/controls/OrbitControls.js';

type ThreeModule = typeof import('../three/three-runtime');

/** #730: the longest the first frame waits for shaders compiling in parallel. */
const SHADER_WARMUP_LIMIT_MS = 4000;

export type { HoverInfo, SelectionMode } from '../three/drag-handlers';

export interface UseThreeSceneOptions extends SceneEventHandlers {
  /** Ground height at world z, which the orbit camera stays above. */
  groundAt?: (z: number) => number;
  /** The View menu's render quality (#760). */
  renderQuality?: QualityChoice | undefined;
  canvasRef: React.RefObject<HTMLCanvasElement>;
}

export interface UseThreeSceneResult {
  isReady: boolean;
  /** #730: the first frame waits for the first scene's shaders; keep the loading state up. */
  shadersWarming: boolean;
  error: string | null;
  /** Mark the scene dirty so the next animation frame renders. */
  invalidate: () => void;
  /**
   * Request a one-off recompute of the (otherwise static) shadow map on the
   * next render. Call this whenever a shadow caster or the sun actually moves
   * — NOT for pure camera orbit, which never changes cast shadows.
   */
  requestShadowUpdate: () => void;
  /**
   * Run a decorative animation step on the render loop's frame budget
   * (#671): at most 30 times a second while nothing else draws, paused while
   * the page is hidden. Returns its removal.
   */
  addDecorativeStep: (step: DecorativeStep) => () => void;
  threeModuleRef: React.MutableRefObject<ThreeModule | null>;
  sceneRef: React.MutableRefObject<ThreeNS.Scene | null>;
  cameraRef: React.MutableRefObject<ThreeNS.PerspectiveCamera | null>;
  rendererRef: React.MutableRefObject<ThreeNS.WebGLRenderer | null>;
  controlsRef: React.MutableRefObject<OrbitControlsType | null>;
  /**
   * Convert a client-space pointer position to a world-space floor coordinate,
   * on the active floor or at `planeY` (a garden item's ground, #665).
   */
  worldPositionFromClient(clientX: number, clientY: number, planeY?: number): { x: number; z: number } | null;
}

export function useThreeScene(options: UseThreeSceneOptions): UseThreeSceneResult {
  const { canvasRef } = options;

  const [isReady, setIsReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Render-on-demand: the RAF loop only renders when OrbitControls report
  // movement or something marked the scene dirty. Starts dirty for frame 1.
  const dirtyRef = useRef(true);
  // #730: true until the first scene's shaders have compiled; the loop holds
  // frames meanwhile, so none renders a half-built scene ahead of the compile.
  const warmingShadersRef = useRef(true);
  const [shadersWarming, setShadersWarming] = useState(true);
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

  // Decorative loops (#671): one budget per editor, made on first use so the
  // prerender never touches window; the render loop below ticks it.
  const frameBudgetRef = useRef<FrameBudget | null>(null);
  const frameBudget = (): FrameBudget =>
    (frameBudgetRef.current ??= createFrameBudget({ document }));
  const addDecorativeStepRef = useRef((step: DecorativeStep) => frameBudget().add(step));
  useEffect(
    () => () => {
      frameBudgetRef.current?.dispose();
      frameBudgetRef.current = null;
    },
    []
  );

  const threeModuleRef = useRef<ThreeModule | null>(null);
  const orbitCtorRef = useRef<typeof OrbitControlsType | null>(null);
  const roomEnvCtorRef = useRef<(new () => ThreeNS.Scene) | null>(null);
  const sceneRef = useRef<ThreeNS.Scene | null>(null);
  const cameraRef = useRef<ThreeNS.PerspectiveCamera | null>(null);
  const controlsRef = useRef<OrbitControlsType | null>(null);

  // Latest-callback refs: capture handlers without making them part of the
  // init-effect dependency list (which would tear down the scene unnecessarily).
  const handlersRef = useRef<UseThreeSceneOptions>(options);
  const refitOrbitRef = useRef<(() => void) | null>(null);
  handlersRef.current = options;

  // Load Three.js + OrbitControls once.
  const [isModuleLoaded, setModuleLoaded] = useState(false);
  // A chunk that still fails after the one automatic reload is a broken
  // deploy: rethrown from render so the route error screen ("Couldn't load
  // the app", with Retry) replaces the editor (#499).
  const [engineChunkError, setEngineChunkError] = useState<Error | null>(null);
  if (engineChunkError) throw engineChunkError;
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [three, controls, environments] = await Promise.all([
          import('../three/three-runtime'),
          import('three/examples/jsm/controls/OrbitControls.js'),
          import('three/examples/jsm/environments/RoomEnvironment.js'),
        ]);
        if (cancelled) return;
        threeModuleRef.current = three;
        orbitCtorRef.current = controls.OrbitControls;
        roomEnvCtorRef.current = environments.RoomEnvironment;
        markAppReady();
        setModuleLoaded(true);
      } catch (err) {
        if (cancelled) return;
        // A stale Three.js chunk after a redeploy is a transient 404 — reload
        // once to fetch fresh assets instead of stranding the user on the
        // "Failed to load 3D engine" message.
        if (reloadOnceForChunkError(err)) return;
        if (isChunkLoadError(err) && err instanceof Error) {
          setEngineChunkError(err);
          return;
        }
        setError(messageOf(err, 'Failed to load 3D engine.'));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // A changed render quality, without tearing the scene down: the textures
  // already built, cached ones included, take the new anisotropy cap at once.
  const { renderQuality } = options;
  useEffect(() => {
    const THREE = threeModuleRef.current;
    const scene = sceneRef.current;
    const renderer = rendererRef.current;
    const canvas = canvasRef.current;
    if (!isReady || !THREE || !scene || !renderer || !canvas) return;
    const quality = currentQuality(renderQuality);
    if (applySceneQuality(THREE, scene, renderer, quality)) renderer.shadowMap.needsUpdate = true;
    renderer.setPixelRatio(quality.pixelRatio);
    if (canvas.clientWidth > 0 && canvas.clientHeight > 0) renderer.setSize(canvas.clientWidth, canvas.clientHeight, false);
    dirtyRef.current = true;
  }, [isReady, renderQuality, canvasRef]);

  // Initialize scene once the module + canvas are ready.
  // The ground moved under a camera nothing else is moving: a new slope.
  const { groundAt } = options;
  useEffect(() => {
    refitOrbitRef.current?.();
    dirtyRef.current = true;
  }, [groundAt]);

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

      // Near plane pulled from 0.1 to 0.3 for better depth precision, and
      // further still for a far orbit (`orbitNear`).
      // The canvas is display:none when the editor opens in 2D; keep a finite
      // aspect until the first non-zero resize (#363).
      const camera = new THREE.PerspectiveCamera(ORBIT_FOV_DEG, aspectOf(canvas), 0.3, 1000);
      camera.position.set(...ORBIT_START);
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
        // No `reversedDepthBuffer`: r186's PCF lookup keeps the normal-depth
        // bias sign and far-plane test, so with it on the sun-facing walls
        // speckle with acne and the ground past the shadow camera's far plane
        // reads as shadowed (#187). Coplanar meshes keep their gaps instead.
      });
      renderer.setPixelRatio(currentQuality(handlersRef.current.renderQuality).pixelRatio);
      // updateStyle = false everywhere: three would otherwise pin the canvas's
      // inline width/height to pixels, and a 0×0 write while hidden in 2D
      // kept it collapsed for the rest of the session (#363).
      if (canvas.clientWidth > 0 && canvas.clientHeight > 0) {
        renderer.setSize(canvas.clientWidth, canvas.clientHeight, false);
      }
      renderer.shadowMap.enabled = true;
      // Per-material clipping planes: the party-wall neighbours' roofs stop
      // at their own wall on our side (#655).
      renderer.localClippingEnabled = true;
      // r186 removed PCFSoftShadowMap (it fell back to PCF with a warning);
      // PCF softens by the light's `shadow.radius` instead (#379).
      renderer.shadowMap.type = THREE.PCFShadowMap;
      // The 2048² directional shadow is expensive; keep it static and only
      // recompute it when a caster or the sun actually moves (via
      // requestShadowUpdate). Frame 1 needs the initial pass, so start dirty.
      renderer.shadowMap.autoUpdate = false;
      renderer.shadowMap.needsUpdate = true;
      // Khronos Neutral keeps a paint's hue and depth closest to its swatch in
      // the colour picker (#752), with an explicit sRGB output.
      renderer.toneMapping = THREE.NeutralToneMapping;
      renderer.toneMappingExposure = 0.9;
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      rendererRef.current = renderer;
      cleanup.push(() => renderer.dispose());
      // Runs after the scene is freed: placed people and walkers share the
      // cached people.glb geometry, which no disposeObject call frees (#284).
      cleanup.push(() => releasePeopleGeometry());
      // Likewise the ground maps and the lit-window texture, shared by every
      // material that uses them and skipped by disposeObject.
      cleanup.push(() => releaseGroundTextures());
      cleanup.push(() => releaseRoomLightTexture());
      // Cleanups run last-in-first-out, so this frees the whole graph (stars,
      // moon, furniture, shell, instanced outdoor meshes, sky background)
      // while the renderer still tracks their GL handles (#213).
      cleanup.push(() => disposeScene(scene));
      // The fitted floor-plan composites are module-level and can be 64 MB
      // apiece; nothing else drops them once the editor is gone.
      cleanup.push(() => clearFloorPlanImageCache());
      // W3 (#559): so are the pattern, shingle, label and bark masters' canvases.
      cleanup.push(() => clearTextureCaches());

      // Image-based lighting from a neutral studio environment. This is what
      // makes MeshStandardMaterial respond with believable specular/diffuse
      // bounce instead of the flat sun+ambient-only look. Intensity is
      // re-scaled by applyTimeOfDay so nights stay dark.
      // Kept so a context restore can bake it again (#663).
      const RoomEnvironment = roomEnvCtorRef.current;
      let environment: SceneEnvironment | null = null;
      if (RoomEnvironment) {
        environment = installEnvironment(scene, () => bakeStudioEnvironment(THREE, renderer, RoomEnvironment));
        scene.environmentIntensity = 0.5;
        cleanup.push(() => environment?.dispose());
      }

      const controls = new OrbitControls(camera, renderer.domElement);
      controls.dampingFactor = 0.05;
      // The orbit glides to a stop after the pointer lets go, unless the user
      // asked the OS to reduce motion (#436); followed live.
      const motionQuery = typeof window.matchMedia === 'function' ? window.matchMedia(REDUCED_MOTION_QUERY) : null;
      const applyMotionPreference = () => {
        controls.enableDamping = !motionQuery?.matches;
      };
      applyMotionPreference();
      motionQuery?.addEventListener('change', applyMotionPreference);
      cleanup.push(() => motionQuery?.removeEventListener('change', applyMotionPreference));
      controls.maxPolarAngle = ORBIT_MAX_POLAR;
      controls.screenSpacePanning = true;
      controlsRef.current = controls;
      // Fired inside controls.update(), ahead of the frame it moves. The
      // walkthrough owns the camera while it runs.
      const fitOrbit = () => {
        if (handlersRef.current.walkthroughActive) return;
        const y = clearOfGround(camera.position.y, handlersRef.current.groundAt?.(camera.position.z) ?? 0);
        // Lift the target with the camera: moving the camera alone would change
        // the orbit's tilt for good, because OrbitControls reads it back.
        if (y !== camera.position.y) {
          controls.target.y += y - camera.position.y;
          camera.position.y = y;
        }
        const near = orbitNear(camera.position.distanceTo(controls.target));
        if (Math.abs(near - camera.near) < near * 0.01) return;
        camera.near = near;
        camera.updateProjectionMatrix();
      };
      controls.addEventListener('change', fitOrbit);
      refitOrbitRef.current = fitOrbit;
      cleanup.push(() => {
        controls.dispose();
        controlsRef.current = null;
      });

      addLights(THREE, scene);
      // The tier's anisotropy cap, shadow map and sky: before any scene effect
      // builds a texture (they read the cap as they go) or a frame draws.
      applySceneQuality(THREE, scene, renderer, currentQuality(handlersRef.current.renderQuality));

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
        // #730: no frame until the first scene's shaders are compiled (below).
        if (contextLost || warmingShadersRef.current) return;
        // Decorative loops (#671): every frame while this one draws anyway,
        // otherwise at their own capped rate.
        if (frameBudgetRef.current?.tick(performance.now(), controlsMoved || dirtyRef.current)) dirtyRef.current = true;
        if (!controlsMoved && !dirtyRef.current) return;
        // The 2D plan hides the canvas (0×0): nobody sees the frame, so keep
        // it owed, shadow pass included, and draw it when the canvas shows
        // again, which the resize observer also marks dirty (#667).
        if (canvas.clientWidth === 0 || canvas.clientHeight === 0) return;
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
        // W3 (#663): the image-based light is a render target, which three
        // can't restore; bake it again or the whole scene renders dark.
        environment?.rebake();
        invalidateRef.current();
      };
      canvas.addEventListener('webglcontextlost', onContextLost as EventListener, false);
      canvas.addEventListener('webglcontextrestored', onContextRestored as EventListener, false);
      cleanup.push(() => {
        canvas.removeEventListener('webglcontextlost', onContextLost as EventListener);
        canvas.removeEventListener('webglcontextrestored', onContextRestored as EventListener);
      });

      // Observing the canvas itself (not the window) also fires when it turns
      // visible again after the 2D view, which fixes a resize that happened
      // while it was hidden. A hidden canvas reports 0×0: skip it (#363). The
      // window listener stays for devicePixelRatio changes (zoom, monitor).
      const onResize = () => {
        const width = canvas.clientWidth;
        const height = canvas.clientHeight;
        if (width === 0 || height === 0) return;
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
        renderer.setPixelRatio(currentQuality(handlersRef.current.renderQuality).pixelRatio);
        renderer.setSize(width, height, false);
        dirtyRef.current = true;
      };
      const resizeObserver = new ResizeObserver(onResize);
      resizeObserver.observe(canvas);
      window.addEventListener('resize', onResize);
      cleanup.push(() => {
        resizeObserver.disconnect();
        window.removeEventListener('resize', onResize);
      });

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
      setError(messageOf(err, 'Failed to initialise WebGL renderer.'));
    }

    return () => {
      setIsReady(false);
      // Reverse order of setup: listeners and the RAF loop stop first, the
      // scene graph (incl. the #122 sky-gradient background) is freed next,
      // and renderer.dispose() runs last (#213).
      for (const fn of cleanup.reverse()) {
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

  // ── #730: compile the first scene's shaders off the main thread ──────────
  // Cold, the first render linked every program on the main thread: a 1.9 s
  // freeze with the HUD already up. Once the scene effects (a child
  // component, so their effects ran first) have built the scene, compileAsync
  // starts the programs and waits on KHR_parallel_shader_compile; the first
  // frame is held, under the loading overlay (`shadersWarming`), until it
  // settles, fails or SHADER_WARMUP_LIMIT_MS pass (lib/shader-warmup.ts),
  // and then renders as before. Without the extension it settles at once and
  // the first render compiles, as it always did.
  useEffect(() => {
    const renderer = rendererRef.current;
    const scene = sceneRef.current;
    const camera = cameraRef.current;
    if (!isReady || !renderer || !scene || !camera) return undefined;
    warmingShadersRef.current = true;
    setShadersWarming(true);
    return holdForShaderWarmup(
      () => renderer.compileAsync(scene, camera),
      () => {
        warmingShadersRef.current = false;
        dirtyRef.current = true;
        // The loop draws the first frame on the next animation frame, which
        // can still block on the shadow programs compileAsync doesn't cover:
        // lift the overlay a frame after that, never over a bare canvas.
        requestAnimationFrame(() => requestAnimationFrame(() => setShadersWarming(false)));
      },
      SHADER_WARMUP_LIMIT_MS
    );
  }, [isReady]);
  // ── end #730 ──────────────────────────────────────────────────────────────

  const worldPositionFromClient = (clientX: number, clientY: number, planeY?: number): { x: number; z: number } | null => {
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
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -(planeY ?? handlersRef.current.getDragPlaneY?.() ?? 0));
    const target = new THREE.Vector3();
    if (!raycaster.ray.intersectPlane(plane, target)) return null;
    return { x: target.x, z: target.z };
  };

  return {
    isReady,
    shadersWarming,
    error,
    invalidate: invalidateRef.current,
    requestShadowUpdate: requestShadowUpdateRef.current,
    addDecorativeStep: addDecorativeStepRef.current,
    threeModuleRef,
    sceneRef,
    cameraRef,
    rendererRef,
    controlsRef,
    worldPositionFromClient,
  };
}

function aspectOf(canvas: HTMLCanvasElement): number {
  const { clientWidth, clientHeight } = canvas;
  return clientWidth > 0 && clientHeight > 0 ? clientWidth / clientHeight : 1;
}

/**
 * Put a quality profile on the scene (#760): the anisotropy cap, the sun's
 * shadow map and the sky's detail. True when the shadow map was resized and
 * needs a pass. The pixel ratio is the caller's, with the canvas size.
 */
function applySceneQuality(
  THREE: ThreeModule,
  scene: ThreeNS.Scene,
  renderer: ThreeNS.WebGLRenderer,
  quality: QualityProfile
): boolean {
  setMaxAnisotropy(Math.min(quality.maxAnisotropy, renderer.capabilities.getMaxAnisotropy()));
  setSkyDetail(THREE, scene, quality.richScenery);
  return applyShadowQuality(scene, quality.shadowMapSize, quality.shadowRadius);
}

/**
 * The quality profile for this device and `choice` (lib/render-quality.ts).
 * Read on every resize, since zoom and monitor moves change the pixel ratio.
 */
export function currentQuality(choice: QualityChoice | undefined): QualityProfile {
  // The prerender has no device: it reads as a desktop, nothing draws there.
  if (typeof window === 'undefined') return qualityProfile({ coarsePointer: false, screenShortSide: 0, devicePixelRatio: 1 }, choice);
  return qualityProfile(
    {
      coarsePointer: window.matchMedia('(pointer: coarse)').matches,
      screenShortSide: Math.min(window.screen.width, window.screen.height),
      devicePixelRatio: window.devicePixelRatio,
    },
    choice
  );
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
