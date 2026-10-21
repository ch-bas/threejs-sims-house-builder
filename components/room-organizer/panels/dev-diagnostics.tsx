'use client';

import { useEffect, useRef, useState } from 'react';
import {
  diagnosticsRequested,
  emptyRendererStats,
  formatRendererStats,
  readRendererStats,
} from '../lib/dev-diagnostics';
import type * as ThreeNS from 'three';

interface DevDiagnosticsProps {
  isReady: boolean;
  rendererRef: React.MutableRefObject<ThreeNS.WebGLRenderer | null>;
  sceneRef: React.MutableRefObject<ThreeNS.Scene | null>;
}

/**
 * `?debug` overlay with the renderer's counters (#192): draw calls and
 * triangles of the last frame, live geometries, textures and programs, and
 * the frame count, which stands still while the scene idles. It updates from
 * the scene's onAfterRender, so it has no loop of its own and costs nothing
 * between renders; without the flag nothing is installed at all. Draw calls
 * include the shadow pass on the frames that redraw shadows.
 */
export function DevDiagnostics({ isReady, rendererRef, sceneRef }: DevDiagnosticsProps): JSX.Element | null {
  const [enabled] = useState(() => typeof window !== 'undefined' && diagnosticsRequested(window.location.search));
  const textRef = useRef<HTMLPreElement>(null);

  useEffect(() => {
    if (!enabled || !isReady) return undefined;
    const scene = sceneRef.current;
    const renderer = rendererRef.current;
    if (!scene || !renderer) return undefined;
    const stats = emptyRendererStats();
    const previous = scene.onAfterRender;
    scene.onAfterRender = function onAfterRender(...args) {
      previous.apply(this, args);
      const node = textRef.current;
      if (node && readRendererStats(renderer.info, stats)) node.textContent = formatRendererStats(stats);
    };
    return () => {
      scene.onAfterRender = previous;
    };
  }, [enabled, isReady, rendererRef, sceneRef]);

  if (!enabled) return null;
  return (
    <pre
      ref={textRef}
      aria-hidden="true"
      data-testid="dev-diagnostics"
      style={{
        position: 'fixed',
        // Under the lot badge, clear of the header stats and the floor pill.
        top: 84,
        left: 16,
        zIndex: 60,
        margin: 0,
        padding: '6px 10px',
        borderRadius: 6,
        background: 'rgba(15, 23, 42, 0.82)',
        color: '#a7f3d0',
        font: '11px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace',
        whiteSpace: 'pre',
        pointerEvents: 'none',
      }}
    >
      waiting for a frame…
    </pre>
  );
}
