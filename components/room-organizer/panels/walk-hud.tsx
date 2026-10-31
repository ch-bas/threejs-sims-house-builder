'use client';

import { useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { useViewSettings } from '../contexts';
import { useMediaQuery } from '../hooks/use-media-query';
import { COARSE_POINTER_QUERY } from '../lib/hud-layout';
import { Icon } from '../plotcraft/icon';

export interface WalkHudProps {
  /** Pointer lock is engaged: the keys walk and the mouse looks. */
  locked: boolean;
  /** The browser refused pointer lock; the next click asks again (#351). */
  lockRefused: boolean;
  /** The seat in reach, while standing (#463b). */
  seatName: string | null;
  seated: boolean;
  floorName: string;
  /** PgUp / PgDn have somewhere to go (#446). */
  multiFloor: boolean;
  /** The touch stick: x right, y forward, each in [−1, 1]. */
  onStick(x: number, y: number): void;
  onToggleSit(): void;
  onExit(): void;
}

/**
 * The walkthrough HUD (#454, #446, #463): what to do right now, in the
 * walker's own words. Before the pointer is locked it says how to start
 * and that a second Esc leaves; once locked, the walking keys; a seat in
 * reach gets an `E` prompt under the reticle; the floor and the clock sit
 * at the top. On a touch screen there is no lock: a drag looks around, a
 * stick walks, and buttons sit, stand and leave.
 */
export function WalkHud(props: WalkHudProps): JSX.Element {
  const touch = useMediaQuery(COARSE_POINTER_QUERY);
  return touch ? <TouchWalkHud {...props} /> : <DesktopWalkHud {...props} />;
}

function DesktopWalkHud({ locked, lockRefused, seatName, seated, floorName, multiFloor }: WalkHudProps): JSX.Element {
  const prompt = seated ? 'Stand up' : seatName ? `Sit on ${seatName}` : null;
  return (
    <>
      <StatusBar floorName={floorName} />
      {locked && <Reticle prompt={prompt} promptKey="E" />}
      <div
        className="pointer-events-none absolute bottom-4 left-1/2"
        style={{ transform: 'translateX(-50%)' }}
        role="status"
      >
        <HintChip>
          <Icon name="live" size={14} />
          {lockRefused ? (
            <span>Click again to look around</span>
          ) : !locked ? (
            <>
              <Hint label="to look around">Click</Hint>
              <Dot />
              <Hint label="again to exit">Esc</Hint>
            </>
          ) : (
            <>
              <Hint label="walk">WASD</Hint>
              <Dot />
              <Hint label="sprint">Shift</Hint>
              {multiFloor && (
                <>
                  <Dot />
                  <Hint label="floor">PgUp/PgDn</Hint>
                </>
              )}
              <Dot />
              <Hint label="time">[ ]</Hint>
              <Dot />
              <Hint label="release">Esc</Hint>
            </>
          )}
        </HintChip>
      </div>
    </>
  );
}

function TouchWalkHud({ seatName, seated, floorName, onStick, onToggleSit, onExit }: WalkHudProps): JSX.Element {
  const canSit = seated || seatName !== null;
  return (
    <>
      <StatusBar floorName={floorName} hint="Drag to look" onExit={onExit} />
      <Reticle prompt={null} promptKey="" />
      <Stick onStick={onStick} />
      {canSit && (
        <button
          type="button"
          onClick={onToggleSit}
          className="pc-glass pc-glass--dark absolute"
          aria-label={seated ? 'Stand up' : `Sit on ${seatName ?? ''}`}
          style={{
            ...ACTION_POSITION,
            right: 'calc(16px + env(safe-area-inset-right, 0px))',
            zIndex: 26,
            minWidth: 88,
            height: 48,
            padding: '0 16px',
            borderRadius: 24,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
            fontFamily: 'var(--pc-font-display)',
            fontWeight: 700,
            fontSize: 12,
            letterSpacing: '0.04em',
            textTransform: 'uppercase',
            color: 'var(--pc-cyan-glow)',
            border: '1.5px solid var(--pc-cyan-glow)',
          }}
        >
          <Icon name={seated ? 'arrowU' : 'sofa'} size={16} />
          {seated ? 'Stand' : 'Sit'}
        </button>
      )}
    </>
  );
}

/**
 * Just above the mode panel, wherever it ends (`--pc-mode-top`, measured on
 * the painted panel: the HUD box reaches near the top of a tablet, #672). The
 * stick has no such anchor: it takes the free bottom-left corner, or rides
 * above a phone's full-width mode bar (`.pc-walk-stick`, globals.css).
 */
const ACTION_POSITION: CSSProperties = {
  bottom: 'calc(100% - var(--pc-mode-top, 100%) + 16px)',
};

const STICK_SIZE = 116;
const KNOB_SIZE = 48;
/** A push under this fraction of the throw is a resting thumb, not a step. */
const STICK_DEAD_ZONE = 0.12;

/** A thumb stick: drag the knob, the walker walks that way, harder for a fuller throw. */
function Stick({ onStick }: { onStick(x: number, y: number): void }): JSX.Element {
  const [knob, setKnob] = useState({ x: 0, y: 0 });
  const pointerRef = useRef<number | null>(null);
  const reach = (STICK_SIZE - KNOB_SIZE) / 2;

  const move = (event: React.PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    let dx = event.clientX - (rect.left + rect.width / 2);
    let dy = event.clientY - (rect.top + rect.height / 2);
    const length = Math.hypot(dx, dy);
    if (length > reach) {
      dx = (dx / length) * reach;
      dy = (dy / length) * reach;
    }
    setKnob({ x: dx, y: dy });
    const push = Math.min(1, length / reach);
    if (push < STICK_DEAD_ZONE) onStick(0, 0);
    else onStick(dx / reach, -dy / reach);
  };
  const release = () => {
    pointerRef.current = null;
    setKnob({ x: 0, y: 0 });
    onStick(0, 0);
  };

  return (
    <div
      data-walk-stick=""
      role="group"
      aria-label="Walk: drag to move"
      className="pc-glass pc-glass--dark pc-walk-stick absolute"
      onPointerDown={(event) => {
        if (pointerRef.current !== null) return;
        pointerRef.current = event.pointerId;
        event.currentTarget.setPointerCapture?.(event.pointerId);
        move(event);
      }}
      onPointerMove={(event) => {
        if (event.pointerId === pointerRef.current) move(event);
      }}
      onPointerUp={(event) => {
        if (event.pointerId === pointerRef.current) release();
      }}
      onPointerCancel={(event) => {
        if (event.pointerId === pointerRef.current) release();
      }}
      style={{
        left: 'calc(16px + env(safe-area-inset-left, 0px))',
        zIndex: 26,
        width: STICK_SIZE,
        height: STICK_SIZE,
        borderRadius: '50%',
        touchAction: 'none',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <div
        aria-hidden
        style={{
          width: KNOB_SIZE,
          height: KNOB_SIZE,
          borderRadius: '50%',
          background: 'rgba(127, 243, 255, 0.22)',
          border: '1.5px solid var(--pc-cyan-glow)',
          boxShadow: 'var(--pc-halo-cyan-soft)',
          transform: `translate(${knob.x}px, ${knob.y}px)`,
          pointerEvents: 'none',
        }}
      />
    </div>
  );
}

/** Floor and clock, top centre; on touch also the look hint and a way out. */
function StatusBar({ floorName, hint, onExit }: { floorName: string; hint?: string; onExit?(): void }): JSX.Element {
  const { timeOfDay } = useViewSettings('timeOfDay');
  const hours = Math.floor(timeOfDay);
  const minutes = Math.floor((timeOfDay - hours) * 60);
  const clock = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
  const night = timeOfDay < 6 || timeOfDay >= 19;
  return (
    <div
      className="pc-top-chip absolute left-1/2"
      style={{ top: 104, transform: 'translateX(-50%)', zIndex: 31, pointerEvents: 'none' }}
    >
      <HintChip>
        <Icon name="stairs" size={14} />
        <span style={{ color: 'var(--pc-paper)' }}>{floorName}</span>
        <Dot />
        <SunMoon night={night} />
        <span style={{ color: 'var(--pc-paper)', fontVariantNumeric: 'tabular-nums' }} aria-label={`Time ${clock}`}>
          {clock}
        </span>
        {hint && (
          <>
            <Dot />
            <span>{hint}</span>
          </>
        )}
        {onExit && (
          <button
            type="button"
            onClick={onExit}
            aria-label="Leave the walkthrough"
            className="pc-walk-exit"
            style={{
              pointerEvents: 'auto',
              marginLeft: 2,
              marginRight: -6,
              width: 32,
              height: 32,
              borderRadius: 16,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'rgba(255,255,255,0.08)',
              border: '1px solid rgba(255,255,255,0.18)',
              color: 'var(--pc-paper)',
            }}
          >
            <Icon name="close" size={14} />
          </button>
        )}
      </HintChip>
    </div>
  );
}

function Reticle({ prompt, promptKey }: { prompt: string | null; promptKey: string }): JSX.Element {
  const active = prompt !== null;
  return (
    <div
      className="pointer-events-none absolute left-1/2 top-1/2"
      style={{ transform: 'translate(-50%, -50%)', display: 'flex', flexDirection: 'column', alignItems: 'center' }}
    >
      <div
        aria-hidden
        style={{
          height: active ? 18 : 10,
          width: active ? 18 : 10,
          borderRadius: 999,
          background: active ? 'transparent' : 'var(--pc-cyan-glow)',
          border: active ? '2px solid var(--pc-cyan-glow)' : 'none',
          boxShadow: 'var(--pc-halo-cyan)',
          transition: 'width 120ms ease, height 120ms ease',
        }}
      />
      {active && (
        <div style={{ position: 'absolute', top: 30, whiteSpace: 'nowrap' }} role="status">
          <HintChip>
            <Hint label={prompt}>{promptKey}</Hint>
          </HintChip>
        </div>
      )}
    </div>
  );
}

function HintChip({ children }: { children: ReactNode }): JSX.Element {
  return (
    <div
      className="pc-glass pc-glass--dark"
      style={{
        padding: '6px 12px',
        display: 'inline-flex',
        alignItems: 'center',
        gap: 8,
        borderRadius: 999,
        fontFamily: 'var(--pc-font-display)',
        fontWeight: 600,
        fontSize: 11,
        letterSpacing: '0.02em',
        whiteSpace: 'nowrap',
        color: 'var(--pc-cyan-glow)',
      }}
    >
      {children}
    </div>
  );
}

/** A key cap and what it does. */
function Hint({ children, label }: { children: ReactNode; label: string }): JSX.Element {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
      <kbd
        style={{
          minWidth: 18,
          height: 18,
          padding: '0 5px',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: 5,
          border: '1px solid rgba(127, 243, 255, 0.45)',
          background: 'rgba(127, 243, 255, 0.08)',
          color: 'var(--pc-paper)',
          fontFamily: 'inherit',
          fontSize: 10,
          fontWeight: 700,
        }}
      >
        {children}
      </kbd>
      <span>{label}</span>
    </span>
  );
}

function Dot(): JSX.Element {
  return (
    <span aria-hidden style={{ opacity: 0.5 }}>
      ·
    </span>
  );
}

function SunMoon({ night }: { night: boolean }): JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      width={14}
      height={14}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {night ? (
        <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" />
      ) : (
        <>
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
        </>
      )}
    </svg>
  );
}
