'use client';

import { useState } from 'react';
import type { CatalogItem } from '../lib/types';
import { generateRoomShape } from '../lib/room-shapes';
import { surpriseLayout } from '../lib/surprise';
import { useRoomEditor } from '../contexts';
import { useSelection } from '../contexts';
import { BuildToolsPanel, type BuildToolCategory } from './build-tools-panel';
import { CameraPad } from './camera-pad';
import { CatalogStrip } from './catalog-strip';
import { ModePanel } from './mode-panel';
import { RoomShapesPanel } from './room-shapes-panel';
import { WallPaintPanel } from './wall-paint-panel';

export interface BottomHudProps {
  selectedWall: { id: string; kind: 'exterior' | 'interior' } | null;
  onSelectedWallChange(wall: { id: string; kind: 'exterior' | 'interior' } | null): void;
  onOrbit(direction: 'left' | 'right' | 'up' | 'down'): void;
  onZoom(direction: '+' | '-'): void;
  onFit(): void;
  placeCatalogItem(catalogItem: CatalogItem, position?: { x: number; z: number }): string;
}

export function BottomHud({ selectedWall, onSelectedWallChange, onOrbit, onZoom, onFit, placeCatalogItem }: BottomHudProps): JSX.Element {
  const { layout, actions, view, toggle, isReady, error, gameMode, setGameMode, playCue } = useRoomEditor();
  const { setSelectedItemId, setExtraSelectedIds } = useSelection();
  const [buildToolCategory, setBuildToolCategory] = useState<BuildToolCategory>('seating');

  if (!isReady || error) return <></>;

  return (
    <div
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
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 12,
            alignItems: 'flex-start',
            maxHeight: 'calc(100vh - 112px)',
            overflowY: 'auto',
            overflowX: 'visible',
            paddingRight: 4,
            scrollbarWidth: 'thin',
          }}
        >
          {view.drawWallMode && (
            <>
              <WallPaintPanel
                selectedWall={selectedWall}
                onSelectedWallChange={onSelectedWallChange}
              />
              <RoomShapesPanel
                maxWidth={layout.width}
                maxDepth={layout.height}
                onStamp={({ shape, width, depth, centerX, centerZ }) => {
                  const seed = `stamp-${shape}-${Date.now().toString(36)}`;
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
                  for (const wall of walls) actions.addInteriorWall(wall);
                  playCue('place');
                }}
              />
            </>
          )}
          <BuildToolsPanel
            active={buildToolCategory}
            drawWallMode={view.drawWallMode}
            onSelect={(tool) => {
              setBuildToolCategory(tool);
              if (tool === 'walls') {
                if (!view.drawWallMode) toggle('drawWallMode');
              } else if (view.drawWallMode) {
                toggle('drawWallMode');
              }
            }}
          />
          <CameraPad
            onOrbit={onOrbit}
            onZoom={onZoom}
            onFit={onFit}
          />
        </div>
      ) : (
        <div />
      )}

      {gameMode !== 'live' ? (
        <CatalogStrip
          category={buildToolCategory === 'walls' ? 'all' : buildToolCategory}
          onAdd={(catalogItem) => {
            const id = placeCatalogItem(catalogItem);
            setSelectedItemId(id);
            playCue('place');
          }}
        />
      ) : (
        <div />
      )}

      <ModePanel
        onSetMode={(mode) => {
          setGameMode(mode);
          if (mode === 'live') {
            if (!view.walkthroughMode) toggle('walkthroughMode');
          } else if (view.walkthroughMode) {
            toggle('walkthroughMode');
          }
        }}
        onSurprise={() => {
          const items = surpriseLayout({
            roomWidth: layout.width,
            roomDepth: layout.height,
          });
          actions.replaceItems(items);
          setSelectedItemId(null);
          setExtraSelectedIds(new Set());
        }}
      />
    </div>
  );
}
