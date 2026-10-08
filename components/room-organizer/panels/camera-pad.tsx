'use client';

import { useEffect, useState, type MutableRefObject } from 'react';
import { nextZoomStep, zoomSliderDistance, zoomSliderValue } from '../lib/camera-zoom';
import { Icon, type PlotcraftIconName } from '../plotcraft/icon';
import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

export interface CameraPadProps {
  onOrbit(direction: 'left' | 'right' | 'up' | 'down'): void;
  onZoom(direction: '+' | '-'): void;
  onFit(): void;
  /** Read-only: the slider shows the real orbit distance (#167). */
  controlsRef: MutableRefObject<OrbitControls | null>;
}

/** Max steps one slider move may take, so a jump end to end stays bounded. */
const MAX_SLIDER_STEPS = 40;

function orbitDistance(controls: OrbitControls | null): number | null {
  return controls ? controls.object.position.distanceTo(controls.target) : null;
}

/**
 * Compass dial: NSEW arrows ring a TILT centre, with a Fit-room
 * chip and a horizontal zoom slider below. The whole panel is a touch more
 * transparent than the main HUD glass — the camera pad is "part of the
 * world, not the HUD" per the design system.
 */
export function CameraPad(props: CameraPadProps): JSX.Element {
  const { controlsRef } = props;
  // Derived from the camera, not a local proxy: wheel/pinch zoom, the +/−
  // buttons, Fit and presets all move the thumb, and it can't saturate while
  // the camera keeps zooming (#167). OrbitControls fires 'change' for every
  // camera move, including the ones above.
  const [zoomPos, setZoomPos] = useState(() => zoomSliderValue(orbitDistance(controlsRef.current) ?? 0));
  useEffect(() => {
    const controls = controlsRef.current;
    if (!controls) return undefined;
    const sync = () => setZoomPos(zoomSliderValue(orbitDistance(controls) ?? 0));
    sync();
    controls.addEventListener('change', sync);
    return () => controls.removeEventListener('change', sync);
  }, [controlsRef]);

  const zoom = (direction: '+' | '-') => {
    props.onZoom(direction);
    const distance = orbitDistance(controlsRef.current);
    if (distance !== null) setZoomPos(zoomSliderValue(distance));
  };

  const zoomTo = (value: number) => {
    const target = zoomSliderDistance(value);
    for (let i = 0; i < MAX_SLIDER_STEPS; i += 1) {
      const distance = orbitDistance(controlsRef.current);
      const step = distance === null ? null : nextZoomStep(distance, target);
      if (!step) break;
      props.onZoom(step);
    }
    const distance = orbitDistance(controlsRef.current);
    setZoomPos(distance === null ? value : zoomSliderValue(distance));
  };

  return (
    <div
      className="pointer-events-auto pc-camera-pad"
      style={{
        background: 'rgba(60, 90, 105, 0.32)',
        backdropFilter: 'var(--pc-glass-blur)',
        WebkitBackdropFilter: 'var(--pc-glass-blur)',
        border: '1px solid rgba(255, 255, 255, 0.30)',
        borderRadius: 'var(--pc-r-lg)',
        boxShadow: 'var(--pc-shadow-glass)',
        padding: 10,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        width: 188,
      }}
    >
      <div
        className="pc-hud-header"
        style={{ fontSize: 9, opacity: 0.75, paddingLeft: 2 }}
      >
        Camera
      </div>

      {/* Compass dial */}
      <div
        style={{
          position: 'relative',
          width: 160,
          height: 160,
          alignSelf: 'center',
          // Outer ring with a subtle cyan rim.
          borderRadius: '50%',
          background:
            'radial-gradient(circle at 50% 45%, rgba(127,243,255,0.10) 0%, rgba(0,0,0,0.18) 65%, rgba(0,0,0,0.32) 100%)',
          border: '1px solid rgba(255,255,255,0.22)',
          boxShadow:
            'inset 0 2px 8px rgba(0,0,0,0.35), inset 0 -1px 0 rgba(255,255,255,0.08)',
        }}
      >
        {/* Inner ring (decorative) */}
        <div
          aria-hidden
          style={{
            position: 'absolute',
            inset: 14,
            borderRadius: '50%',
            border: '1px dashed rgba(255,255,255,0.15)',
          }}
        />

        {/* Cardinal arrows + labels */}
        <CompassButton
          dir="N"
          label="Tilt up"
          icon="arrowU"
          style={{ top: 4, left: '50%', transform: 'translateX(-50%)' }}
          onClick={() => props.onOrbit('up')}
        />
        <CompassButton
          dir="S"
          label="Tilt down"
          icon="arrowD"
          style={{ bottom: 4, left: '50%', transform: 'translateX(-50%)' }}
          onClick={() => props.onOrbit('down')}
        />
        <CompassButton
          dir="W"
          label="Orbit left"
          icon="arrowL"
          style={{ left: 4, top: '50%', transform: 'translateY(-50%)' }}
          onClick={() => props.onOrbit('left')}
        />
        <CompassButton
          dir="E"
          label="Orbit right"
          icon="arrowR"
          style={{ right: 4, top: '50%', transform: 'translateY(-50%)' }}
          onClick={() => props.onOrbit('right')}
        />

        {/* Centre — TILT label + Fit chip */}
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 4,
            pointerEvents: 'none',
          }}
        >
          <span
            className="pc-hud-header"
            style={{
              fontSize: 11,
              letterSpacing: '0.16em',
              color: 'var(--pc-paper-soft)',
              textShadow: '0 1px 0 rgba(0,0,0,0.25)',
            }}
          >
            TILT
          </span>
          <button
            type="button"
            onClick={props.onFit}
            title="Fit room"
            aria-label="Fit room"
            className="pc-tile"
            style={{
              pointerEvents: 'auto',
              width: 36,
              height: 36,
              borderRadius: '50%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'rgba(127, 243, 255, 0.14)',
              border: '1px solid var(--pc-cyan-glow)',
              color: 'var(--pc-cyan-glow)',
              boxShadow: 'var(--pc-halo-cyan-soft)',
            }}
          >
            <Icon name="target" size={16} />
          </button>
        </div>
      </div>

      {/* Zoom row */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          background: 'rgba(0, 0, 0, 0.20)',
          border: '1px solid rgba(255, 255, 255, 0.08)',
          borderRadius: 12,
          padding: '4px 6px',
          boxShadow: 'inset 0 2px 4px rgba(0, 0, 0, 0.30)',
        }}
      >
        <button
          type="button"
          onClick={() => zoom('-')}
          title="Zoom out"
          aria-label="Zoom out"
          className="pc-tile"
          style={{
            width: 24,
            height: 24,
            borderRadius: 6,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontFamily: 'var(--pc-font-display)',
            fontWeight: 800,
            fontSize: 14,
          }}
        >
          –
        </button>
        <input
          type="range"
          min={0}
          max={100}
          value={zoomPos}
          onChange={(event) => zoomTo(parseInt(event.target.value, 10))}
          aria-label="Zoom"
          style={{
            flex: 1,
            accentColor: 'var(--pc-cyan-glow)',
            height: 18,
          }}
        />
        <button
          type="button"
          onClick={() => zoom('+')}
          title="Zoom in"
          aria-label="Zoom in"
          className="pc-tile"
          style={{
            width: 24,
            height: 24,
            borderRadius: 6,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontFamily: 'var(--pc-font-display)',
            fontWeight: 800,
            fontSize: 14,
          }}
        >
          +
        </button>
      </div>
    </div>
  );
}

interface CompassButtonProps {
  dir: 'N' | 'S' | 'E' | 'W';
  icon: PlotcraftIconName;
  label: string;
  style: React.CSSProperties;
  onClick(): void;
}

function CompassButton({ dir, icon, label, style, onClick }: CompassButtonProps): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className="pc-tile"
      style={{
        position: 'absolute',
        width: 36,
        height: 36,
        borderRadius: '50%',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 0,
        padding: 0,
        ...style,
      }}
    >
      <Icon name={icon} size={14} />
      <span
        style={{
          fontFamily: 'var(--pc-font-display)',
          fontWeight: 800,
          fontSize: 8,
          letterSpacing: '0.12em',
          color: 'var(--pc-paper-soft)',
          lineHeight: 1,
          marginTop: 1,
        }}
      >
        {dir}
      </span>
    </button>
  );
}
