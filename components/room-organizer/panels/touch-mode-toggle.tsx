'use client';

import { useCallback, useEffect, useState, type MutableRefObject } from 'react';
import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { Icon, type PlotcraftIconName } from '../plotcraft/icon';

type TouchMode = 'orbit' | 'pan';

export interface TouchModeToggleProps {
  controlsRef: MutableRefObject<OrbitControls | null>;
  onFit(): void;
}

export function TouchModeToggle({ controlsRef, onFit }: TouchModeToggleProps): JSX.Element {
  const [mode, setMode] = useState<TouchMode>('orbit');
  const [isTouchDevice, setIsTouchDevice] = useState(false);

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
    if (m === 'pan') {
      controls.mouseButtons = {
        LEFT: 2 as never,
        MIDDLE: 1 as never,
        RIGHT: 0 as never,
      };
    } else {
      controls.mouseButtons = {
        LEFT: 0 as never,
        MIDDLE: 1 as never,
        RIGHT: 2 as never,
      };
    }
  }, [controlsRef]);

  useEffect(() => {
    applyMode(mode);
    const timer = window.setTimeout(() => applyMode(mode), 1000);
    return () => window.clearTimeout(timer);
  }, [mode, applyMode]);

  const handleZoom = (direction: '+' | '-') => {
    const controls = controlsRef.current;
    if (!controls) return;
    const camera = controls.object;
    const offset = camera.position.clone().sub(controls.target);
    offset.multiplyScalar(direction === '+' ? 0.75 : 1.3);
    camera.position.copy(controls.target).add(offset);
    controls.update();
  };

  if (!isTouchDevice) return <></>;

  return (
    <div
      className="pointer-events-auto pc-touch-controls"
      style={{
        position: 'absolute',
        right: 10,
        top: '50%',
        transform: 'translateY(-50%)',
        zIndex: 35,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
      }}
    >
      <TouchButton
        icon="rotate"
        label="Orbit Rotation"
        active={mode === 'orbit'}
        onClick={() => setMode('orbit')}
      />
      <TouchButton
        icon="target"
        label="Center"
        active={mode === 'pan'}
        onClick={() => setMode('pan')}
      />
      <TouchButton
        icon="magnify"
        label="Zoom In"
        onClick={() => handleZoom('+')}
      />
      <TouchButton
        icon="magnify"
        label="Zoom Out"
        onClick={() => handleZoom('-')}
        flipIcon
      />
      <TouchButton
        icon="home"
        label="Fit"
        onClick={onFit}
      />
    </div>
  );
}

function TouchButton({ icon, label, active, onClick, flipIcon }: {
  icon: PlotcraftIconName;
  label: string;
  active?: boolean;
  onClick(): void;
  flipIcon?: boolean;
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`pc-tile${active ? ' pc-tile--active' : ''}`}
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
    >
      <Icon
        name={icon}
        size={18}
        style={{
          transform: flipIcon ? 'rotate(180deg)' : undefined,
          color: active ? 'var(--pc-cyan-glow)' : 'var(--pc-paper-soft)',
        }}
      />
      <span
        style={{
          fontFamily: 'var(--pc-font-display)',
          fontWeight: 600,
          fontSize: 6,
          letterSpacing: '0.04em',
          textTransform: 'uppercase',
          color: active ? 'var(--pc-cyan-glow)' : 'var(--pc-paper-soft)',
          lineHeight: 1,
        }}
      >
        {label.split(' ')[0]}
      </span>
    </button>
  );
}
