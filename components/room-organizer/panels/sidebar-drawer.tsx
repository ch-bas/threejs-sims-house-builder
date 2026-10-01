'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useRoomEditor } from '../contexts';
import { useSelection } from '../contexts';
import { useDialogFocus } from '../hooks/use-dialog-focus';
import { useEntranceKeepOut } from '../hooks/use-entrance-keep-out';
import { alignSelection, distributeSelection } from '../lib/alignment';
import { readImageAsDataUrl } from '../lib/file-io';
import { buildFurnitureSet } from '../lib/furniture-sets';
import { hasCollisions } from '../lib/geometry';
import { confirmReplace, snapshotBeforeReplace } from '../lib/restore-point';
import { safeGetItem, safeSetItem } from '../lib/safe-storage';
import { applyTheme } from '../lib/themes';
import { Icon } from '../plotcraft/icon';
import { AchievementsPanel } from './achievements-panel';
import { ActionsPanel } from './actions-panel';
import { AlignPanel } from './align-panel';
import { CameraPresetsPanel } from './camera-presets-panel';
import { FloorSwitcher } from './floor-switcher';
import { FurnitureCatalogPanel } from './furniture-catalog-panel';
import { ItemResizePanel } from './item-resize-panel';
import { LibraryPanel } from './library-panel';
import { PlacedItemsPanel } from './placed-items-panel';
import { RoofPanel } from './roof-panel';
import { RoomSettingsPanel } from './room-settings-panel';
import { SetsPanel } from './sets-panel';
import { ShortcutsPanel } from './shortcuts-panel';
import { SidebarTabs, type SidebarTab } from './sidebar-tabs';
import { SitePanel } from './site-panel';
import { StatisticsPanel } from './statistics-panel';
import { TemplatesPanel } from './templates-panel';
import { ThemesPanel } from './themes-panel';
import { TimeOfDayPanel } from './time-of-day-panel';
import { WallsPanel } from './walls-panel';
import { ZonesPanel } from './zones-panel';
import type { AlignEdge, DistributeAxis } from '../lib/alignment';
import type { CameraPreset, CatalogItem } from '../lib/types';

const SIDEBAR_TAB_KEY = 'standalone-room-organizer-sidebar-tab';

export interface SidebarDrawerProps {
  collapsed: boolean;
  onCollapse(): void;
  unlockedAchievements: ReadonlySet<string>;
  // Scene-ref callbacks that can't move into context
  onApplyPreset(preset: CameraPreset): void;
  onFitToRoom(): void;
  onScreenshot(): void;
  onImport(file: File): void;
  onExportGlb(): void;
  onShareLink(): void;
  /** Wall-aware placement (snaps doors/windows/cameras to walls) shared with the bottom catalog. */
  placeCatalogItem(catalogItem: CatalogItem, position?: { x: number; z: number }): string;
  /**
   * The orchestrator's removeItem — it also clears the id from the
   * multi-select set, which a local reimplementation here used to miss.
   */
  removeItem(id: string): void;
}

export function SidebarDrawer({
  collapsed,
  onCollapse,
  unlockedAchievements,
  onApplyPreset,
  onFitToRoom,
  onScreenshot,
  onImport,
  onExportGlb,
  onShareLink,
  placeCatalogItem,
  removeItem,
}: SidebarDrawerProps): JSX.Element {
  const { layout, activeFloor, activeFloorIndex, actions, view, isReady, playCue, catalogQuery, setCatalogQuery, gameMode } =
    useRoomEditor();
  const keepOut = useEntranceKeepOut(layout, activeFloorIndex);
  const { selectedItem, selectOnly, allSelectedIds } = useSelection();
  const drawerRef = useRef<HTMLElement>(null);
  // While a draw mode is on the canvas is the workbench, so the drawer stops
  // being modal: no backdrop — the backdrop button sat over the plan and
  // swallowed the first pointerdown of a zone / wall gesture, closing the
  // drawer instead of drawing (#323) — and no focus trap, so Escape and the
  // shortcuts stay with the plan once it has focus. The close tile, `p` and
  // Escape from inside still dismiss it.
  const drawing = view.drawWallMode || view.drawZoneMode || view.measurementMode;
  // Otherwise the drawer is a modal overlay (a backdrop covers the canvas),
  // so it behaves like one for keyboard users: focus moves in, Tab stays
  // inside, Escape closes it, and focus returns to the opener (#152).
  useDialogFocus(!collapsed, drawerRef, { trap: !drawing, onEscape: onCollapse });
  // Storage access can throw where it is blocked; this drawer is always
  // mounted, so an unguarded read took the whole editor down (#396).
  const [sidebarTab, setSidebarTabRaw] = useState<SidebarTab>(() => {
    const saved = safeGetItem(SIDEBAR_TAB_KEY);
    return (saved === 'build' || saved === 'buy' || saved === 'style' || saved === 'manage') ? saved : 'build';
  });
  const setSidebarTab = (tab: SidebarTab) => {
    setSidebarTabRaw(tab);
    safeSetItem(SIDEBAR_TAB_KEY, tab);
  };
  // All tabs share one scroll container: open each at the top instead of at
  // the previous tab's offset (#378). Layout effect, so it never paints scrolled.
  const scrollRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 });
  }, [sidebarTab]);
  // The tab follows a mode *change* — DESIGN opens Build, FURNISH opens Buy
  // (#151) — but not the mount, so the saved tab still wins on reload, and a
  // tab picked afterwards stays put until the mode changes again.
  const lastModeRef = useRef(gameMode);
  useEffect(() => {
    if (lastModeRef.current === gameMode) return;
    lastModeRef.current = gameMode;
    if (gameMode === 'live') return;
    setSidebarTabRaw(gameMode);
    safeSetItem(SIDEBAR_TAB_KEY, gameMode);
  }, [gameMode]);

  const handleFloorPlanUpload = async (file: File) => {
    try {
      const dataUrl = await readImageAsDataUrl(file);
      actions.setFloorPlan(dataUrl);
    } catch (uploadError) {
      window.alert(uploadError instanceof Error ? uploadError.message : 'Failed to upload image.');
    }
  };

  return (
    <div style={{ display: collapsed ? 'none' : 'block' }}>
      {!drawing && (
        <button
          type="button"
          aria-label="Close panels"
          onClick={onCollapse}
          style={{
            position: 'absolute',
            inset: 0,
            background: 'rgba(20, 30, 40, 0.35)',
            border: 'none',
            zIndex: 35,
            cursor: 'pointer',
          }}
        />
      )}
      <aside
        ref={drawerRef}
        role="dialog"
        aria-modal={drawing ? undefined : 'true'}
        tabIndex={-1}
        aria-label="Side panels"
        className="pc-glass pc-glass--dark pc-sidebar"
        style={{
          position: 'absolute',
          top: 72,
          left: 16,
          bottom: 16,
          width: 320,
          zIndex: 40,
          display: 'flex',
          flexDirection: 'column',
          padding: 12,
          overflow: 'hidden',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <SidebarTabs active={sidebarTab} onChange={setSidebarTab} />
          <button
            type="button"
            onClick={onCollapse}
            aria-label="Close panels"
            className="pc-tile pc-sidebar-close"
            style={{
              width: 36,
              height: 36,
              borderRadius: 10,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            <Icon name="close" size={18} />
          </button>
        </div>

        <div
          ref={scrollRef}
          style={{
            flex: 1,
            overflowY: 'auto',
            marginTop: 10,
            paddingRight: 4,
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
          }}
        >
          {allSelectedIds.size >= 2 && (
            <AlignPanel
              selectionCount={allSelectedIds.size}
              onAlign={(edge: AlignEdge) => {
                const updates = alignSelection(activeFloor.items, allSelectedIds, edge);
                if (updates.size > 0) actions.bulkSetPositions(updates);
              }}
              onDistribute={(axis: DistributeAxis) => {
                const updates = distributeSelection(activeFloor.items, allSelectedIds, axis);
                if (updates.size > 0) actions.bulkSetPositions(updates);
              }}
            />
          )}

          {sidebarTab === 'build' && (
            <>
              <FloorSwitcher />

              <RoomSettingsPanel
                onFloorPlanUpload={handleFloorPlanUpload}
              />

              <WallsPanel />

              {/* Drawing happens on the plan the drawer covers, so switching
                  the mode on folds the drawer away (#323). */}
              <ZonesPanel onDrawStart={onCollapse} />

              <RoofPanel />

              <SitePanel />
            </>
          )}

          {sidebarTab === 'buy' && (
            <>
              <FurnitureCatalogPanel
                query={catalogQuery}
                onQueryChange={setCatalogQuery}
                onAdd={(catalogItem) => {
                  const id = placeCatalogItem(catalogItem);
                  if (!id) return;
                  selectOnly(id);
                  playCue('place');
                }}
              />

              <SetsPanel
                onAddSet={(set) => {
                  // Scale/refuse the set to the current room so pieces don't
                  // land through the walls in small rooms (#73). An empty
                  // result means the set can't fit here.
                  const items = buildFurnitureSet(set, {
                    roomWidth: layout.width,
                    roomDepth: layout.height,
                  });
                  if (items.length === 0) return;
                  actions.addItems(items);
                  const last = items[items.length - 1];
                  if (last) selectOnly(last.id);
                }}
              />

              <PlacedItemsPanel
                onRotate={(id) => {
                  actions.rotateItem(id);
                  playCue('rotate');
                }}
                onRemove={removeItem}
              />
            </>
          )}

          {sidebarTab === 'style' && (
            <>
              <ThemesPanel onApply={(themeKey) => actions.applyLayout(applyTheme(layout, themeKey))} />

              <TimeOfDayPanel />

              {selectedItem && (
                <ItemResizePanel
                  hasCollision={hasCollisions(selectedItem, activeFloor.items, layout.width, layout.height, keepOut)}
                  onDuplicate={(id) => {
                    const newId = actions.duplicateItem(id);
                    selectOnly(newId);
                  }}
                />
              )}
            </>
          )}

          {sidebarTab === 'manage' && (
            <>
              <CameraPresetsPanel
                disabled={!isReady || view.view2D || view.walkthroughMode}
                onApply={onApplyPreset}
                onFit={onFitToRoom}
                onScreenshot={onScreenshot}
              />

              <ActionsPanel
                onImport={onImport}
                onExportGlb={onExportGlb}
                onShareLink={onShareLink}
              />

              <TemplatesPanel
                onLoadTemplate={(template) => {
                  if (!confirmReplace(layout, `the ${template.name} template`)) return;
                  snapshotBeforeReplace(layout);
                  actions.applyLayout({
                    ...template,
                    floors: template.floors.map((floor) => ({ ...floor, items: [...floor.items] })),
                  });
                  selectOnly(null);
                }}
              />

              <LibraryPanel
                currentLayout={layout}
                onLoad={(loaded) => {
                  // No history.clear(): like a template load, this must stay
                  // one Ctrl+Z away from the design it replaced (#222).
                  snapshotBeforeReplace(layout);
                  actions.applyLayout(loaded);
                  selectOnly(null);
                }}
              />

              <StatisticsPanel />
              <AchievementsPanel unlocked={unlockedAchievements} />
              <ShortcutsPanel />
            </>
          )}
        </div>
      </aside>
    </div>
  );
}
