'use client';

import { memo, useRef, useState, type MutableRefObject } from 'react';
import { useEditorView, useEditorViewActions, useRoomEditor, useViewSettings } from '../contexts';
import { useSelection } from '../contexts';
import { useEdgeVar } from '../hooks/use-edge-var';
import { useEvent } from '../hooks/use-event';
import { layoutStore } from '../hooks/use-layout-store';
import { useScrollCue } from '../hooks/use-scroll-cue';
import { useSheetInset } from '../hooks/use-sheet-inset';
import { askConfirm } from '../lib/confirm-dialog';
import { DEFAULT_BUDGET } from '../lib/constants';
import { catalogCategoryForTool, resolveToolForMode } from '../lib/modes';
import { generateRoomShape } from '../lib/room-shapes';
import { runSurprise } from '../lib/surprise';
import { BuildToolsPanel, type BuildToolCategory } from './build-tools-panel';
import { CameraPad } from './camera-pad';
import { CatalogStrip } from './catalog-strip';
import { ModePanel } from './mode-panel';
import { RoomShapesPanel } from './room-shapes-panel';
import { WallPaintPanel } from './wall-paint-panel';
import type { CatalogItem } from '../lib/types';
import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

export interface BottomHudProps {
  selectedWall: { id: string; kind: 'exterior' | 'interior' } | null;
  onSelectedWallChange(wall: { id: string; kind: 'exterior' | 'interior' } | null): void;
  onOrbit(direction: 'left' | 'right' | 'up' | 'down'): void;
  onZoom(direction: '+' | '-'): void;
  onFit(): void;
  /** Read by the camera pad's zoom slider (#167). */
  controlsRef: MutableRefObject<OrbitControls | null>;
  placeCatalogItem(catalogItem: CatalogItem, position?: { x: number; z: number }): string;
}

// Memoised with stable props from the orchestrator (#3); it still follows the
// layout through its context, so the children that only take callbacks are
// memoised too.
export const BottomHud = memo(function BottomHud({ selectedWall, onSelectedWallChange, onOrbit, onZoom, onFit, controlsRef, placeCatalogItem }: BottomHudProps): JSX.Element {
  const { layout, activeFloorIndex, actions, isReady, error, playCue } = useRoomEditor();
  const view = useViewSettings('drawWallMode', 'view2D', 'walkthroughMode');
  const { toggle, setView, setGameMode } = useEditorViewActions();
  const gameMode = useEditorView((state) => state.gameMode);
  const { selectOnly, setSelectedItemId, setExtraSelectedIds } = useSelection();
  const [buildToolCategory, setBuildToolCategory] = useState<BuildToolCategory>('seating');
  const hudRef = useRef<HTMLDivElement>(null);
  const leftColumnRef = useRef<HTMLDivElement>(null);
  // Held: Apply To moved to All from the keyboard, focus still in the panel.
  const [paintHeld, setPaintHeld] = useState(false);
  const showPaint = view.drawWallMode || selectedWall !== null || paintHeld;
  // On a phone the wall panels open folded, one at a time (#395); a tapped
  // wall opens Paint, since that is what the tap asks for. Off the dock
  // both always show in full.
  const [unfolded, setUnfolded] = useState<'paint' | 'stamp' | 'none' | null>(null);
  // Every wall tap opens Paint, even after a manual fold; closing the
  // panels forgets the fold, so they open folded again next time. Adjusted
  // while rendering rather than in an effect, so Paint never flashes folded.
  const [foldedFor, setFoldedFor] = useState({ selectedWall, showPaint });
  if (foldedFor.selectedWall !== selectedWall || foldedFor.showPaint !== showPaint) {
    setFoldedFor({ selectedWall, showPaint });
    if (!showPaint) setUnfolded(null);
    else if (selectedWall !== null && selectedWall !== foldedFor.selectedWall) setUnfolded('paint');
  }
  const paintUnfolded = unfolded === 'paint' || (unfolded === null && !view.drawWallMode);
  const stampUnfolded = unfolded === 'stamp';
  const toggleFold = useEvent((panel: 'paint' | 'stamp') => {
    const open = panel === 'paint' ? paintUnfolded : stampUnfolded;
    setUnfolded(open ? 'none' : panel);
  });
  const layoutKey = `${isReady}:${gameMode}:${showPaint}:${view.drawWallMode}:${view.view2D}`;
  // An overflowing column says so (#426).
  useScrollCue(leftColumnRef, layoutKey);
  // The dock's top edge, for the touch buttons that must stay above it. The
  // phone item sheet lifts the dock without resizing it: `data-sheet-open`
  // and the `--pc-sheet-height` it rides on (a style change on <html>).
  useEdgeVar(hudRef, '--pc-dock-top', 'top', { layoutKey, rootAttributes: SHEET_ATTRIBUTES });
  // The mode bar rides above the phone item sheet.
  useSheetInset();
  // Each mode shows its own half of the tools (#151): a pick from the other
  // half falls back to this mode's first tool. Derived, not synced, so the
  // pick survives a round trip through the other mode.
  const buildTool = resolveToolForMode(gameMode, buildToolCategory);
  const selectBuildTool = useEvent((tool: BuildToolCategory) => {
    setBuildToolCategory(tool);
    // Walls again ends the tool: a phone has no Esc, and the hint says to tap it.
    if (tool === 'walls' || view.drawWallMode) {
      toggle('drawWallMode');
    }
  });
  const addFromStrip = useEvent((catalogItem: CatalogItem) => {
    const id = placeCatalogItem(catalogItem);
    // '' = placement declined (budget confirm) or refused — nothing
    // was added, so no selection wipe (#146). The add chimed (#460).
    if (!id) return;
    selectOnly(id);
  });

  if (!isReady || error) return <></>;

  return (
    <div
      ref={hudRef}
      className="pointer-events-none pc-bottom-hud"
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: 0,
        padding: 16,
        display: 'flex',
        alignItems: 'flex-end',
        justifyContent: 'space-between',
        gap: 12,
        zIndex: 25,
      }}
    >
      {gameMode !== 'live' ? (
        <div
          ref={leftColumnRef}
          // max-height lives in globals.css: the room above this column
          // differs per breakpoint (#299). Not an occluder itself: it is
          // wider than its panels, which are tagged one by one.
          className="pc-hud-left"
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 12,
            alignItems: 'flex-start',
            overflowY: 'auto',
            overflowX: 'visible',
            paddingRight: 4,
            scrollbarWidth: 'thin',
          }}
        >
          {/* Paint panel opens with the wall tool OR when any wall is clicked in 3D. */}
          {showPaint && (
            <WallPaintPanel
              selectedWall={selectedWall}
              onSelectedWallChange={onSelectedWallChange}
              onHoldOpen={setPaintHeld}
              fold={{ open: paintUnfolded, onToggle: () => toggleFold('paint') }}
            />
          )}
          {view.drawWallMode && (
            <>
              <RoomShapesPanel
                maxWidth={layout.width}
                maxDepth={layout.height}
                fold={{ open: stampUnfolded, onToggle: () => toggleFold('stamp') }}
                onStamp={({ shape, width, depth, centerX, centerZ }) => {
                  // Random suffix so two stamps in the same millisecond can't
                  // produce colliding wall ids.
                  const seed = `stamp-${shape}-${Date.now().toString(36)}-${Math.random()
                    .toString(36)
                    .slice(2, 6)}`;
                  const walls = generateRoomShape(
                    shape,
                    centerX,
                    centerZ,
                    width,
                    depth,
                    seed,
                    undefined,
                    { width: layout.width, depth: layout.height }
                  );
                  // Batch all segments into one dispatch so the whole stamp is a
                  // single undo entry rather than N steps.
                  actions.addInteriorWalls(walls);
                  playCue('place');
                }}
              />
            </>
          )}
          <MemoBuildToolsPanel
            active={buildTool}
            drawWallMode={view.drawWallMode}
            onSelect={selectBuildTool}
          />
          {/* The pad drives the (hidden) 3D camera, so it's inert in the 2D
              top-down view — hide it there, like CameraPresetsPanel disables
              on view2D (#220). */}
          {!view.view2D && (
            <MemoCameraPad
              onOrbit={onOrbit}
              onZoom={onZoom}
              onFit={onFit}
              controlsRef={controlsRef}
            />
          )}
        </div>
      ) : (
        <div />
      )}

      {gameMode !== 'live' ? (
        <MemoCatalogStrip
          // The strip follows the mode's tool, so DESIGN browses structure
          // and FURNISH furniture; the wall tool browses the openings that
          // go on walls rather than the whole catalog (#151).
          category={catalogCategoryForTool(buildTool)}
          onAdd={addFromStrip}
        />
      ) : (
        <div />
      )}

      <ModePanel
        onSetMode={(mode) => {
          setGameMode(mode);
          // The wall tool lives in DESIGN only; don't leave the draw mode
          // (and its paint/stamp panels) armed with no tile to disarm it (#151).
          if (mode !== 'build' && view.drawWallMode) toggle('drawWallMode');
          if (mode === 'live') {
            // EXPLORE is for looking around: drop the selection so its
            // popover doesn't float over the walkthrough (#339).
            selectOnly(null);
            onSelectedWallChange(null);
            // Walkthrough needs the 3D view — the hook requires `!view2D`, so
            // entering Live from the 2D top-down view is otherwise a silent
            // no-op (see #67). Drop view2D as we switch walkthrough on.
            setView((v) => ({ ...v, view2D: false, walkthroughMode: true }));
          } else if (view.walkthroughMode) {
            toggle('walkthroughMode');
          }
        }}
        onSurprise={() => {
          // Not while exploring: EXPLORE never edits the house (#643).
          if (gameMode === 'live') return;
          // Surprise replaces the furniture on the floor — never wipe it
          // without asking (#105). Structure and garden stay (#448). It
          // spends what the rest of the building leaves of the budget: the
          // hard budget refuses before asking, the soft one asks before
          // going over (#136, #581).
          void runSurprise(layoutStore.getState().layout, activeFloorIndex, DEFAULT_BUDGET, {
            confirm: askConfirm,
            playCue,
            replaceItems: (items) => actions.replaceItems(items),
            // Read again after the question (another tab's version may have landed).
            current: () => layoutStore.getState().layout,
          }).then((replaced) => {
            if (!replaced) return;
            setSelectedItemId(null);
            setExtraSelectedIds(new Set());
          });
        }}
      />
    </div>
  );
});

const SHEET_ATTRIBUTES = ['data-sheet-open', 'style'] as const;

const MemoBuildToolsPanel = memo(BuildToolsPanel);
const MemoCameraPad = memo(CameraPad);
const MemoCatalogStrip = memo(CatalogStrip);
