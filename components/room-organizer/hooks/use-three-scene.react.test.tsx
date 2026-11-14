// @vitest-environment jsdom
import { cleanup, renderHook, waitFor } from '@testing-library/react';
import { Component, createRef, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { qualityProfile } from '../lib/render-quality';
import { currentQuality, useThreeScene, type UseThreeSceneOptions } from './use-three-scene';

// #608: the parts of the scene hook that run without a GPU: loading the
// engine chunks, the ready signal for the head watchdog, the one-reload
// recovery from a stale chunk and the error the editor shows otherwise.
// The scene itself (renderer, context loss, the frame loop) needs WebGL,
// which jsdom lacks; they need a real browser.

const engine = vi.hoisted(() => ({ failure: null as unknown, reloaded: [] as unknown[], reload: false }));

vi.mock('../three/three-runtime', () => ({}));
vi.mock('three/examples/jsm/controls/OrbitControls.js', () => ({ OrbitControls: class {} }));
vi.mock('three/examples/jsm/environments/RoomEnvironment.js', () => ({ RoomEnvironment: class {} }));
vi.mock('../lib/chunk-reload', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/chunk-reload')>();
  return {
    ...actual,
    // The engine load fails here: the hook's one `try` covers the chunk
    // imports and this call, so the error reaches the same handler as a
    // failed import, unwrapped (a throwing mock factory is wrapped, and its
    // result cached across tests).
    markAppReady: () => {
      if (engine.failure) throw engine.failure;
      actual.markAppReady();
    },
    // Records the reload instead of reloading jsdom's page.
    reloadOnceForChunkError: (err: unknown) => {
      if (!actual.isChunkLoadError(err) || !engine.reload) return false;
      engine.reloaded.push(err);
      return true;
    },
  };
});

class Catch extends Component<{ children: ReactNode; onError(error: Error): void }, { failed: boolean }> {
  override state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  override componentDidCatch(error: Error) {
    this.props.onError(error);
  }
  override render() {
    return this.state.failed ? null : this.props.children;
  }
}

function load(canvas: HTMLCanvasElement | null = null) {
  const canvasRef = createRef<HTMLCanvasElement>() as { current: HTMLCanvasElement | null };
  canvasRef.current = canvas;
  const options = { canvasRef, onItemSelect: () => undefined, onItemDrag: () => undefined } as unknown as UseThreeSceneOptions;
  const thrown: Error[] = [];
  const view = renderHook(() => useThreeScene(options), {
    wrapper: ({ children }) => <Catch onError={(error) => thrown.push(error)}>{children}</Catch>,
  });
  return { ...view, thrown };
}

const ready = () => (window as unknown as { __pcReady?: boolean }).__pcReady;

beforeEach(() => {
  engine.failure = null;
  engine.reloaded = [];
  engine.reload = false;
  delete (window as unknown as { __pcReady?: boolean }).__pcReady;
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('useThreeScene — loading the engine (#499, #608)', () => {
  it('tells the head watchdog the app is up once the engine chunks have loaded', async () => {
    const { result } = load();
    await waitFor(() => expect(ready()).toBe(true));
    expect(result.current.error).toBeNull();
    expect(result.current.isReady).toBe(false);
  });

  it('reloads once for a stale chunk, and shows no error meanwhile', async () => {
    engine.failure = Object.assign(new Error('Loading chunk 123 failed.'), { name: 'ChunkLoadError' });
    engine.reload = true;
    const { result, thrown } = load();
    await waitFor(() => expect(engine.reloaded).toHaveLength(1));
    expect(result.current.error).toBeNull();
    expect(thrown).toEqual([]);
    expect(ready()).toBeUndefined();
  });

  it('hands a chunk that still fails after the reload to the route error screen', async () => {
    engine.failure = Object.assign(new Error('Loading chunk 123 failed.'), { name: 'ChunkLoadError' });
    // React reports the render error to window as well; keep jsdom quiet.
    const quiet = (event: ErrorEvent) => event.preventDefault();
    window.addEventListener('error', quiet);
    const { thrown } = load();
    await waitFor(() => expect(thrown).toHaveLength(1));
    window.removeEventListener('error', quiet);
    expect(thrown[0]?.name).toBe('ChunkLoadError');
    expect(engine.reloaded).toEqual([]);
    expect(ready()).toBeUndefined();
  });

  it('shows any other failure in the editor instead', async () => {
    engine.failure = new Error('Out of memory');
    const { result, thrown } = load();
    await waitFor(() => expect(result.current.error).toBe('Out of memory'));
    expect(thrown).toEqual([]);
  });

  it('says so when the browser has no WebGL', async () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    const { result } = load(document.createElement('canvas'));
    await waitFor(() => expect(result.current.error).toMatch(/^WebGL is not supported/));
    expect(result.current.isReady).toBe(false);
  });
});

describe('currentQuality', () => {
  it("reads the device's pointer, screen and pixel ratio for the chosen tier", () => {
    // jsdom has no matchMedia.
    const coarse = vi.fn((query: string) => ({ matches: query === '(pointer: coarse)' }) as MediaQueryList);
    vi.stubGlobal('matchMedia', coarse);
    vi.spyOn(window, 'devicePixelRatio', 'get').mockReturnValue(3);
    vi.spyOn(window.screen, 'width', 'get').mockReturnValue(390);
    vi.spyOn(window.screen, 'height', 'get').mockReturnValue(844);
    for (const choice of [undefined, 'auto', 'low', 'high'] as const) {
      expect(currentQuality(choice)).toEqual(qualityProfile({ coarsePointer: true, screenShortSide: 390, devicePixelRatio: 3 }, choice));
    }
    expect(coarse).toHaveBeenCalledWith('(pointer: coarse)');
  });
});
