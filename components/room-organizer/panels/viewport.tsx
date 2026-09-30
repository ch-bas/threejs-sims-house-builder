'use client';

import { CATALOG_DRAG_MIME } from '../lib/catalog-drag';
import { CURRENCY_SYMBOL } from '../lib/constants';
import { Icon, iconForItem } from '../plotcraft/icon';
import { Minimap } from './minimap';
import type { FurnitureItem, RoomLayout } from '../lib/types';
import type { FloorLayout } from '../lib/types';

export interface HoverState {
  item: FurnitureItem;
  clientX: number;
  clientY: number;
}

export interface ViewportProps {
  isReady: boolean;
  error: string | null;
  view2D: boolean;
  layout: RoomLayout;
  activeFloor: FloorLayout;
  selectedItem: FurnitureItem | null;
  selectionCount?: number;
  /** Copy the current multi-selection to the furniture clipboard (#153). */
  onCopySelection?(): void;
  /** The selection is exactly one persistent group (#154) — the chip says so. */
  selectionGrouped?: boolean;
  /** Group the selection; absent when it is already one whole group (#154). */
  onGroupSelection?(): void;
  /** Ungroup the selection; absent when nothing in it is grouped (#154). */
  onUngroupSelection?(): void;
  /** Save the selection as a reusable custom set (#302). */
  onSaveSelectionAsSet?(): void;
  showMeasurements: boolean;
  showMinimap: boolean;
  walkthroughActive?: boolean;
  hover?: HoverState | null;
  measurementDistance?: number | null;
  measurementPointsPlaced?: number;
  /** When set, a HUD chip shows the current wall-drawing status. */
  wallDrawStatus?: {
    hasAnchor: boolean;
    snapKind?: 'vertex' | 'right-angle' | 'none';
    currentLength?: number | null;
  } | null;
  canvasRef: React.RefObject<HTMLCanvasElement>;
  canvas2DRef: React.RefObject<HTMLCanvasElement>;
  onCatalogDrop?(clientX: number, clientY: number, type: string): void;
}

export function Viewport(props: ViewportProps): JSX.Element {
  const showLoading = !props.isReady && !props.error;
  const showError = Boolean(props.error);

  // Foreign-drag guard (#166): only the app's own catalog payload is accepted.
  // Without the types check, dragover preventDefault advertised a drop target
  // to ANY drag (files, text, images), showing a fake copy affordance.
  const handleDragOver = (event: React.DragEvent<HTMLCanvasElement>) => {
    if (!props.onCatalogDrop) return;
    if (!event.dataTransfer.types.includes(CATALOG_DRAG_MIME)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
  };
  const handleDrop = (event: React.DragEvent<HTMLCanvasElement>) => {
    if (!props.onCatalogDrop) return;
    const type = event.dataTransfer.getData(CATALOG_DRAG_MIME);
    if (!type) return;
    event.preventDefault();
    props.onCatalogDrop(event.clientX, event.clientY, type);
  };

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        overflow: 'hidden',
      }}
    >
      <div style={{ position: 'relative', width: '100%', height: '100%' }}>
        {/*
         * Both canvases are mounted at all times so that useThreeScene
         * can attach its renderer before isReady becomes true. The
         * inactive canvas is hidden, not unmounted.
         */}
        {/*
         * No fixed width/height attributes: the 2D backing store is sized to
         * clientWidth/clientHeight × devicePixelRatio by a ResizeObserver in
         * use-scene-effects, so the canvas stays crisp on retina and its aspect
         * ratio matches the container (circles stay circular). CSS stretches the
         * element to fill the viewport.
         */}
        {/*
         * The 2D plan takes the same catalog drops as the 3D canvas (#166) and
         * pointer select/drag via use-canvas-2d-interaction (#219); touchAction
         * none, as on the 3D canvas, so touch drags aren't eaten by scrolling.
         */}
        <canvas
          ref={props.canvas2DRef}
          className={props.view2D ? '' : 'hidden'}
          style={{
            width: '100%',
            height: '100%',
            display: props.view2D ? 'block' : 'none',
            background: 'var(--pc-grass)',
            touchAction: 'none',
          }}
          onDragOver={handleDragOver}
          onDrop={handleDrop}
        />
        <canvas
          ref={props.canvasRef}
          className={props.view2D ? 'hidden' : ''}
          style={{
            width: '100%',
            height: '100%',
            display: props.view2D ? 'none' : 'block',
            touchAction: 'none',
          }}
          onDragOver={handleDragOver}
          onDrop={handleDrop}
        />

        {showLoading && <LoadingOverlay />}
        {showError && <ErrorOverlay message={props.error ?? ''} />}

        {props.isReady && !showError && <ViewportOverlays {...props} />}
      </div>
    </div>
  );
}

function LoadingOverlay(): JSX.Element {
  return (
    <div
      className="absolute inset-0 flex items-center justify-center pc-world"
      style={{ background: 'var(--pc-grass)' }}
    >
      <div
        className="pc-glass pc-glass--dark"
        style={{ padding: '18px 24px', textAlign: 'center' }}
      >
        <p
          className="pc-hud-header"
          style={{ fontSize: 13, marginBottom: 4 }}
        >
          Loading the lot…
        </p>
        <p className="pc-blurb" style={{ fontSize: 11, margin: 0 }}>
          Fetching Three.js and waking up WebGL.
        </p>
      </div>
    </div>
  );
}

function ErrorOverlay({ message }: { message: string }): JSX.Element {
  return (
    <div
      className="absolute inset-0 flex items-center justify-center"
      style={{ background: 'rgba(20, 30, 40, 0.6)' }}
    >
      <div
        className="pc-glass pc-glass--dark"
        style={{
          maxWidth: 480,
          padding: 24,
          textAlign: 'center',
        }}
      >
        <div
          aria-hidden
          style={{
            margin: '0 auto 12px',
            height: 48,
            width: 48,
            borderRadius: 14,
            background: 'rgba(228,82,72,0.18)',
            border: '1px solid var(--pc-demolish)',
            color: 'var(--pc-demolish)',
            display: 'grid',
            placeItems: 'center',
          }}
        >
          <Icon name="demolish" size={24} />
        </div>
        <p
          className="pc-hud-header"
          style={{ fontSize: 16, marginBottom: 8 }}
        >
          WebGL Not Available
        </p>
        <p
          className="pc-blurb"
          style={{ fontSize: 12, marginBottom: 16 }}
        >
          {message}
        </p>
        <ul
          style={{
            textAlign: 'left',
            padding: 12,
            margin: 0,
            listStyle: 'none',
            background: 'rgba(0,0,0,0.18)',
            borderRadius: 10,
            border: '1px solid var(--pc-glass-inner)',
          }}
        >
          {[
            'Enable hardware acceleration in your browser settings.',
            'Update your graphics drivers.',
            'Try Chrome, Firefox, or Edge.',
          ].map((tip) => (
            <li
              key={tip}
              style={{
                display: 'flex',
                gap: 8,
                alignItems: 'flex-start',
                fontFamily: 'var(--pc-font-body)',
                fontSize: 12,
                color: 'var(--pc-paper-soft)',
                padding: '4px 0',
              }}
            >
              <span
                aria-hidden
                style={{
                  marginTop: 6,
                  height: 6,
                  width: 6,
                  borderRadius: 999,
                  background: 'var(--pc-cyan-glow)',
                  flexShrink: 0,
                }}
              />
              {tip}
            </li>
          ))}
        </ul>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="pc-tile"
          style={{
            marginTop: 16,
            padding: '8px 16px',
            borderRadius: 10,
            fontFamily: 'var(--pc-font-display)',
            fontWeight: 700,
            fontSize: 12,
            letterSpacing: 'var(--pc-tr-caps)',
            textTransform: 'uppercase',
          }}
        >
          Reload Page
        </button>
      </div>
    </div>
  );
}

interface HoverTooltipProps {
  hover: HoverState;
  containerRef: React.RefObject<HTMLCanvasElement>;
}

function HoverTooltip({ hover, containerRef }: HoverTooltipProps): JSX.Element | null {
  const canvas = containerRef.current;
  if (!canvas) return null;
  const rect = canvas.getBoundingClientRect();
  const x = Math.max(8, Math.min(rect.width - 220, hover.clientX - rect.left + 14));
  const y = Math.max(8, Math.min(rect.height - 70, hover.clientY - rect.top + 14));

  return (
    <div
      className="pointer-events-none pc-glass pc-glass--dark"
      style={{
        position: 'absolute',
        left: x,
        top: y,
        padding: '8px 12px',
        borderRadius: 12,
        minWidth: 140,
      }}
    >
      <p
        style={{
          margin: 0,
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          fontFamily: 'var(--pc-font-display)',
          fontWeight: 700,
          fontSize: 12,
          color: 'var(--pc-paper)',
        }}
      >
        <Icon name={iconForItem(hover.item.type, hover.item.category)} size={14} />
        {hover.item.name}
      </p>
      {hover.item.price !== undefined && (
        <p
          style={{
            margin: '2px 0 0',
            fontFamily: 'var(--pc-font-display)',
            fontWeight: 700,
            fontSize: 12,
            color: 'var(--pc-money)',
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {CURRENCY_SYMBOL}
          {hover.item.price.toLocaleString()}
        </p>
      )}
      <p
        className="pc-blurb"
        style={{
          margin: '2px 0 0',
          fontSize: 11,
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {hover.item.width.toFixed(2)}m × {hover.item.depth.toFixed(2)}m
      </p>
    </div>
  );
}

function StatusChip({
  children,
  intent = 'normal',
}: {
  children: React.ReactNode;
  intent?: 'normal' | 'accent' | 'success' | 'info';
}): JSX.Element {
  const tones: Record<string, React.CSSProperties> = {
    normal:  { color: 'var(--pc-paper)' },
    accent:  { color: 'var(--pc-cyan-glow)' },
    success: { color: 'var(--pc-confirm-green)' },
    info:    { color: 'var(--pc-sky)' },
  };
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
        ...tones[intent],
      }}
    >
      {children}
    </div>
  );
}

/** Pill action inside a StatusChip — the multi-select chip's Copy / Group / Save row. */
function ChipButton({
  children,
  onClick,
  title,
}: {
  children: React.ReactNode;
  onClick(): void;
  title: string;
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      style={{
        border: '1px solid currentColor',
        borderRadius: 999,
        background: 'transparent',
        color: 'inherit',
        fontFamily: 'var(--pc-font-display)',
        fontWeight: 700,
        fontSize: 10,
        padding: '1px 8px',
        cursor: 'pointer',
        whiteSpace: 'nowrap',
      }}
    >
      {children}
    </button>
  );
}

function ViewportOverlays(props: ViewportProps): JSX.Element {
  return (
    <>
      {!props.view2D && props.showMinimap && (
        <Minimap
          layout={props.layout}
          floor={props.activeFloor}
          selectedItemId={props.selectedItem?.id ?? null}
        />
      )}

      {props.selectionCount !== undefined && props.selectionCount > 1 && (
        <div
          className="absolute left-1/2"
          // Below the header stats box, which can wrap to two lines at
          // narrow desktop widths and covered a top-16 chip (#299, #154).
          style={{ top: 104, transform: 'translateX(-50%)', zIndex: 31 }}
        >
          <StatusChip intent="accent">
            <Icon name="copy" size={14} />
            {props.selectionCount} items
            {props.selectionGrouped ? ' · grouped · click any to select all' : ' selected · drag to move together'}
            {props.onCopySelection && (
              <ChipButton
                onClick={props.onCopySelection}
                title="Copy the selection (Ctrl+C) — Ctrl+V pastes, here or on another floor"
              >
                Copy
              </ChipButton>
            )}
            {props.onGroupSelection && (
              <ChipButton
                onClick={props.onGroupSelection}
                title="Group these items — clicking any one selects them all; Alt+click picks a single member"
              >
                Group
              </ChipButton>
            )}
            {props.onUngroupSelection && (
              <ChipButton onClick={props.onUngroupSelection} title="Ungroup the selected items">
                Ungroup
              </ChipButton>
            )}
            {props.onSaveSelectionAsSet && (
              <ChipButton
                onClick={props.onSaveSelectionAsSet}
                title="Save this arrangement as a reusable set in the Furniture Sets panel"
              >
                Save as set
              </ChipButton>
            )}
          </StatusChip>
        </div>
      )}

      {props.walkthroughActive && (
        <>
          <div
            aria-hidden
            className="pointer-events-none absolute left-1/2 top-1/2"
            style={{
              transform: 'translate(-50%, -50%)',
              height: 10,
              width: 10,
              borderRadius: 999,
              background: 'var(--pc-cyan-glow)',
              boxShadow: 'var(--pc-halo-cyan)',
            }}
          />
          <div
            className="pointer-events-none absolute bottom-4 left-1/2"
            style={{ transform: 'translateX(-50%)' }}
          >
            <StatusChip intent="accent">
              <Icon name="live" size={14} />
              WASD to walk · Shift to sprint · Esc to release
            </StatusChip>
          </div>
        </>
      )}

      {props.measurementPointsPlaced !== undefined &&
        props.measurementPointsPlaced > 0 && (
          <div className="absolute top-4 right-4">
            <StatusChip intent="info">
              <Icon name="ruler" size={14} />
              {props.measurementPointsPlaced === 1
                ? 'Click a second point…'
                : `Distance: ${(props.measurementDistance ?? 0).toFixed(2)} m`}
            </StatusChip>
          </div>
        )}

      {props.wallDrawStatus && (
        <div
          className="absolute top-4 right-4 pc-glass pc-glass--dark"
          style={{
            padding: '8px 12px',
            display: 'flex',
            flexDirection: 'column',
            gap: 2,
            minWidth: 200,
          }}
        >
          {props.wallDrawStatus.hasAnchor ? (
            <>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  fontFamily: 'var(--pc-font-display)',
                  fontWeight: 700,
                  fontSize: 11,
                  color: 'var(--pc-paper)',
                }}
              >
                <Icon name="brick" size={14} />
                Click to extend · Esc to stop
              </div>
              {props.wallDrawStatus.currentLength !== undefined &&
                props.wallDrawStatus.currentLength !== null && (
                  <div
                    className="pc-blurb"
                    style={{
                      fontSize: 11,
                      fontVariantNumeric: 'tabular-nums',
                      paddingLeft: 20,
                    }}
                  >
                    {props.wallDrawStatus.currentLength.toFixed(2)} m
                  </div>
                )}
              {props.wallDrawStatus.snapKind === 'vertex' && (
                <div
                  style={{
                    fontFamily: 'var(--pc-font-display)',
                    fontWeight: 600,
                    fontSize: 11,
                    color: 'var(--pc-confirm-green)',
                    paddingLeft: 20,
                  }}
                >
                  ⊙ Snapping to vertex
                </div>
              )}
              {props.wallDrawStatus.snapKind === 'right-angle' && (
                <div
                  style={{
                    fontFamily: 'var(--pc-font-display)',
                    fontWeight: 600,
                    fontSize: 11,
                    color: 'var(--pc-cyan-glow)',
                    paddingLeft: 20,
                  }}
                >
                  ⟂ Right-angle snap
                </div>
              )}
            </>
          ) : (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                fontFamily: 'var(--pc-font-display)',
                fontWeight: 700,
                fontSize: 11,
                color: 'var(--pc-paper)',
              }}
            >
              <Icon name="brick" size={14} />
              Click to place the first wall point
            </div>
          )}
        </div>
      )}

      {props.hover && props.hover.item.id !== props.selectedItem?.id && (
        <HoverTooltip hover={props.hover} containerRef={props.canvasRef} />
      )}
    </>
  );
}
