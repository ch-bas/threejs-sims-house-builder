'use client';

import { useEffect, useState } from 'react';
import type { CameraPreset, RoomLayout } from '../lib/types';
import type { AlignEdge, DistributeAxis } from '../lib/alignment';
import { alignSelection, distributeSelection } from '../lib/alignment';
import { hasCollisions } from '../lib/geometry';
import { applyTheme } from '../lib/themes';
import { buildFurnitureSet } from '../lib/furniture-sets';
import { readImageAsDataUrl } from '../lib/file-io';
import { Icon } from '../plotcraft/icon';
import { useRoomEditor } from '../contexts';
import { useSelection } from '../contexts';
import { SidebarTabs, type SidebarTab } from './sidebar-tabs';
import { AlignPanel } from './align-panel';
import { FloorSwitcher } from './floor-switcher';
import { RoomSettingsPanel } from './room-settings-panel';
import { WallsPanel } from './walls-panel';
import { RoofPanel } from './roof-panel';
import { FurnitureCatalogPanel } from './furniture-catalog-panel';
import { SetsPanel } from './sets-panel';
import { PlacedItemsPanel } from './placed-items-panel';
import { ThemesPanel } from './themes-panel';
import { TimeOfDayPanel } from './time-of-day-panel';
import { ItemResizePanel } from './item-resize-panel';
import { CameraPresetsPanel } from './camera-presets-panel';
import { ActionsPanel } from './actions-panel';
import { TemplatesPanel } from './templates-panel';
import { LibraryPanel } from './library-panel';
import { StatisticsPanel } from './statistics-panel';
import { AchievementsPanel } from './achievements-panel';
import { ShortcutsPanel } from './shortcuts-panel';

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
}: SidebarDrawerProps): JSX.Element {
  const { layout, activeFloor, actions, view, isReady, playCue, history, catalogQuery, setCatalogQuery } = useRoomEditor();
  const { selectedItem, setSelectedItemId, allSelectedIds } = useSelection();
  const [sidebarTab, setSidebarTabRaw] = useState<SidebarTab>(() => {
    if (typeof window === 'undefined') return 'build';
    const saved = localStorage.getItem('room-organizer-sidebar-tab');
    return (saved === 'build' || saved === 'buy' || saved === 'style' || saved === 'manage') ? saved : 'build';
  });
  const setSidebarTab = (tab: SidebarTab) => {
    setSidebarTabRaw(tab);
    localStorage.setItem('room-organizer-sidebar-tab', tab);
  };

  const removeItem = (id: string) => {
    actions.removeItem(id);
    playCue('remove');
    setSelectedItemId((current) => (current === id ? null : current));
  };

  const placeCatalogItem = (catalogItem: Parameters<typeof actions.addCatalogItem>[0]) => {
    const id = actions.addCatalogItem(catalogItem);
    return id;
  };

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
      <aside
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

              <RoofPanel />
            </>
          )}

          {sidebarTab === 'buy' && (
            <>
              <FurnitureCatalogPanel
                query={catalogQuery}
                onQueryChange={setCatalogQuery}
                onAdd={(catalogItem) => {
                  const id = placeCatalogItem(catalogItem);
                  setSelectedItemId(id);
                  playCue('place');
                }}
              />

              <SetsPanel
                onAddSet={(set) => {
                  const items = buildFurnitureSet(set);
                  actions.addItems(items);
                  const last = items[items.length - 1];
                  if (last) setSelectedItemId(last.id);
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
                  hasCollision={hasCollisions(selectedItem, activeFloor.items, layout.width, layout.height)}
                  onDuplicate={(id) => {
                    const newId = actions.duplicateItem(id);
                    setSelectedItemId(newId);
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
                  actions.applyLayout({
                    ...template,
                    floors: template.floors.map((floor) => ({ ...floor, items: [...floor.items] })),
                  });
                  setSelectedItemId(null);
                }}
              />

              <LibraryPanel
                currentLayout={layout}
                onLoad={(loaded) => {
                  actions.applyLayout(loaded);
                  setSelectedItemId(null);
                  history.clear();
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
