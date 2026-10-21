'use client';

import { useCallback, useEffect, useRef, useState, type MutableRefObject, type ReactNode } from 'react';
import { useViewSettings } from '../contexts';
import { useTopBarSlot } from '../hooks/use-edge-var';
import { Icon, type PlotcraftIconName } from '../plotcraft/icon';
import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

type TouchMode = 'orbit' | 'pan';

// THREE.TOUCH enum values, inlined to avoid importing the Three.js runtime into
// this presentational panel: ROTATE = 0, PAN = 1, DOLLY_PAN = 2.
const TOUCH_ROTATE = 0;
const TOUCH_PAN = 1;
const TOUCH_DOLLY_PAN = 2;

export interface TouchModeToggleProps {
  controlsRef: MutableRefObject<OrbitControls | null>;
  isReady: boolean;
  onFit(): void;
}

export function TouchModeToggle({ controlsRef, isReady, onFit }: TouchModeToggleProps): JSX.Element {
  const view = useViewSettings('showMinimap', 'view2D');
  const [mode, setMode] = useState<TouchMode>('orbit');
  const [isTouchDevice, setIsTouchDevice] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const shown = isTouchDevice && !view.view2D;
  // Short screens place the buttons in the top bar's free strip (globals.css).
  useTopBarSlot(rootRef, shown);

  useEffect(() => {
    const isTouch =
      'ontouchstart' in window ||
      navigator.maxTouchPoints > 0 ||
      window.matchMedia('(pointer: coarse)').matches;
    setIsTouchDevice(isTouch);
  }, []);

  const applyMode = useCallback((m: TouchMode) => {
    const controls = controlsRef.current;
    if (!controls) return;
    // Touch gestures read controls.touches (not mouseButtons). A one-finger
    // drag either rotates the camera (orbit) or pans it (center); two fingers
    // always pinch-dolly + pan. mouseButtons is left at its OrbitControls
    // defaults so the desktop pointer-drag interaction is unaffected.
    controls.touches = {
      ONE: (m === 'pan' ? TOUCH_PAN : TOUCH_ROTATE) as never,
      TWO: TOUCH_DOLLY_PAN as never,
    };
  }, [controlsRef]);

  useEffect(() => {
    // Apply once the scene (and therefore controlsRef) is live, rather than
    // racing the renderer with a fixed setTimeout.
    if (!isReady) return;
    applyMode(mode);
  }, [mode, isReady, applyMode]);

  const handleZoom = (direction: '+' | '-') => {
    const controls = controlsRef.current;
    if (!controls) return;
    const camera = controls.object;
    const offset = camera.position.clone().sub(controls.target);
    offset.multiplyScalar(direction === '+' ? 0.75 : 1.3);
    camera.position.copy(controls.target).add(offset);
    controls.update();
  };

  // The buttons drive the 3D camera, which is hidden in the 2D top-down view —
  // same reasoning as the camera pad (#220).
  if (!shown) return <></>;

  return (
    // Anchored under the top-right pills instead of at 50%, where it landed on
    // the stacked mobile HUD (#300). Placement and column/row direction are
    // per-breakpoint in globals.css, which also steps it clear of the minimap.
    // zIndex stays below the HUD (25) and the item bottom sheet (36): wherever
    // the viewport is too small to keep them apart, the panels win the tap.
    <div
      ref={rootRef}
      // Taps between the buttons reach the scene; the buttons take their own.
      className="pointer-events-none pc-touch-controls"
      data-scene-occluder=""
      data-minimap={view.showMinimap ? '' : undefined}
      style={{
        position: 'absolute',
        zIndex: 24,
        display: 'flex',
      }}
    >
      <TouchButton
        icon="rotate"
        label="Orbit Rotation"
        caption="Orbit"
        active={mode === 'orbit'}
        onClick={() => setMode('orbit')}
      />
      <TouchButton
        icon="target"
        label="Pan mode"
        caption="Pan"
        active={mode === 'pan'}
        onClick={() => setMode('pan')}
      />
      {/* Distinct captions and glyphs: both used to read ZOOM (#423). */}
      <TouchButton
        icon="magnify"
        label="Zoom In"
        caption="In"
        onClick={() => handleZoom('+')}
      />
      <TouchButton
        glyph={ZOOM_OUT_GLYPH}
        label="Zoom Out"
        caption="Out"
        onClick={() => handleZoom('-')}
      />
      <TouchButton
        icon="home"
        label="Fit"
        caption="Fit"
        onClick={onFit}
      />
    </div>
  );
}

// The kit's magnifier carries a plus; zoom out is the same lens with a minus.
const ZOOM_OUT_GLYPH = (
  <>
    <circle cx="11" cy="11" r="6" />
    <path d="M20 20l-4.3 -4.3" />
    <path d="M9 11h4" />
  </>
);

function TouchButton({ icon, glyph, label, caption, active, onClick }: {
  /** A kit icon, or `glyph` for paths the kit lacks. */
  icon?: PlotcraftIconName;
  glyph?: ReactNode;
  label: string;
  caption: string;
  active?: boolean;
  onClick(): void;
}): JSX.Element {
  const color = active ? 'var(--pc-cyan-glow)' : 'var(--pc-paper-soft)';
  return (
    <button
      type="button"
      onClick={onClick}
      className={`pointer-events-auto pc-tile${active ? ' pc-tile--active' : ''}`}
      style={{
        width: 44,
        height: 44,
        borderRadius: 22,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 2,
        background: active ? 'rgba(127,243,255,0.15)' : 'rgba(30, 45, 55, 0.6)',
        backdropFilter: 'blur(8px)',
        border: active ? '1.5px solid var(--pc-cyan-glow)' : '1px solid rgba(255,255,255,0.12)',
        boxShadow: active ? 'var(--pc-halo-cyan-soft)' : '0 2px 8px rgba(0,0,0,0.3)',
      }}
      title={label}
      aria-label={label}
    >
      {icon ? (
        <Icon name={icon} size={16} style={{ color }} />
      ) : (
        <svg
          viewBox="0 0 24 24"
          width={16}
          height={16}
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5}
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          style={{ color }}
        >
          {glyph}
        </svg>
      )}
      <span
        style={{
          fontFamily: 'var(--pc-font-display)',
          fontWeight: 600,
          fontSize: 10,
          letterSpacing: '0.02em',
          textTransform: 'uppercase',
          color,
          lineHeight: 1,
        }}
      >
        {caption}
      </span>
    </button>
  );
}
