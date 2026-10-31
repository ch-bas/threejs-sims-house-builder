'use client';

import { memo, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { HeldEditorContexts, useEditorView, useRoomEditor, useSelection, useViewSettings } from '../contexts';
import { markLayoutLoaded } from '../hooks/use-achievements';
import { useDialogFocus, useFocusBeside } from '../hooks/use-dialog-focus';
import { useEvent } from '../hooks/use-event';
import { NOT_WHILE_EXPLORING, useExploring } from '../hooks/use-exploring';
import { useFloorKeepOut } from '../hooks/use-floor-keep-out';
import { layoutStore } from '../hooks/use-layout-store';
import { useMediaQuery } from '../hooks/use-media-query';
import { alignSelection, distributeSelection } from '../lib/alignment';
import { HARD_BUDGET_SELL_BACK_NOTE, isHardBudgetOn, loadTemplateUnderBudget, purchasePrice, purchaseRefusal, SELL_BACK_RATE } from '../lib/budget';
import { collisionMessage } from '../lib/collision-reason';
import { CURRENCY_SYMBOL } from '../lib/constants';
import { notify, notifyRefused } from '../lib/editor-notices';
import { readImageAsDataUrl } from '../lib/file-io';
import { placeSetInFreeSpace, setForStorey } from '../lib/furniture-sets';
import { sameLayoutContent } from '../lib/persistence';
import { confirmReplace, snapshotBeforeReplace } from '../lib/restore-point';
import { safeGetItem, safeSetItem } from '../lib/safe-storage';
import { storeyHeight } from '../lib/storeys';
import { entrancePlanOutline } from '../lib/street';
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
import { DRAWER_FULL_SCREEN_QUERY, SIDE_PANELS_ID, SIDE_TABPANEL_ID, SidebarTabs, sideTabId, type SidebarTab } from './sidebar-tabs';
import { SitePanel } from './site-panel';
import { StatisticsPanel } from './statistics-panel';
import { StoragePanel } from './storage-panel';
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
  /** Closes the item popover, as Escape does on the scene; null while there is none. */
  dismissItemPopover: (() => void) | null;
  unlockedAchievements: ReadonlySet<string>;
  // Scene-ref callbacks that can't move into context
  onApplyPreset(preset: CameraPreset): void;
  onFitToRoom(): void;
  onScreenshot(): void;
  onImport(file: File): Promise<boolean>;
  onExportGlb(): void;
  onShareLink(): void;
  /** Wall-aware placement (snaps doors/windows/cameras to walls) shared with the bottom catalog. */
  placeCatalogItem(catalogItem: CatalogItem, position?: { x: number; z: number }): string;
  /**
   * The orchestrator's removeItem — it also clears the id from the
   * multi-select set, which a local reimplementation here used to miss.
   */
  removeItem(id: string): void;
  /** The orchestrator's duplicate: selection-aware, and it plays the cue (#460). */
  duplicateItem(id: string): void;
}

// Memoised, and its panels read the editor through HeldEditorContexts, so a
// closed drawer skips layout edits altogether (#3). Pass stable callbacks.
export const SidebarDrawer = memo(function SidebarDrawer({
  collapsed,
  onCollapse,
  dismissItemPopover,
  ...bodyProps
}: SidebarDrawerProps): JSX.Element {
  const view = useViewSettings('drawWallMode', 'drawZoneMode', 'measurementMode');
  const gameMode = useEditorView((state) => state.gameMode);
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
  // The item popover and the toasts open from in here but render outside: they
  // join the Tab cycle, and Escape closes the popover before the drawer (#632).
  // A full-screen drawer covers the popover, so it stays out of that.
  const coversPopover = useMediaQuery(DRAWER_FULL_SCREEN_QUERY);
  const popoverBeside = !drawing && !coversPopover ? dismissItemPopover : null;
  const focusBeside = useFocusBeside(!collapsed);
  useDialogFocus(!collapsed, drawerRef, {
    trap: !drawing,
    companions: true,
    returnHome: true,
    onEscape: popoverBeside ?? onCollapse,
  });
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
        id={SIDE_PANELS_ID}
        role="dialog"
        // Not modal to a screen reader either while an overlay is a part of it.
        aria-modal={drawing || popoverBeside || focusBeside ? undefined : 'true'}
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
          id={SIDE_TABPANEL_ID}
          role="tabpanel"
          aria-labelledby={sideTabId(sidebarTab)}
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
          <HeldEditorContexts hold={collapsed}>
            <DrawerBody sidebarTab={sidebarTab} onCollapse={onCollapse} {...bodyProps} />
          </HeldEditorContexts>
        </div>
      </aside>
    </div>
  );
});

type DrawerBodyProps = Omit<SidebarDrawerProps, 'collapsed' | 'dismissItemPopover'> & { sidebarTab: SidebarTab };

const DrawerBody = memo(function DrawerBody({
  sidebarTab,
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
  duplicateItem,
}: DrawerBodyProps): JSX.Element {
  const { layout, activeFloor, activeFloorIndex, actions, history, isReady, playCue } = useRoomEditor();
  const view = useViewSettings('view2D', 'walkthroughMode');
  // EXPLORE never edits the house (#643): the editing panels sit in a
  // disabled fieldset there, and a note says why.
  const exploring = useExploring();
  const keepOut = useFloorKeepOut(layout, activeFloorIndex);
  const { selectedItem, selectOnly, allSelectedIds } = useSelection();
  // Bumped when the storage card deletes or restores saved layouts, so the
  // Saved Layouts panel re-reads its list (#615, #620).
  const [libraryRevision, setLibraryRevision] = useState(0);
  // Stable, so the open drawer's catalog tiles skip layout edits too (#3).
  const addFromCatalog = useEvent((catalogItem: CatalogItem) => {
    const id = placeCatalogItem(catalogItem);
    if (!id) return;
    selectOnly(id);
  });

  const handleFloorPlanUpload = async (file: File) => {
    try {
      const dataUrl = await readImageAsDataUrl(file);
      actions.setFloorPlan(dataUrl);
    } catch (uploadError) {
      notify(uploadError instanceof Error ? uploadError.message : 'Failed to upload image.', 'error');
    }
  };

  return (
    <>
      {exploring && (
        <p role="note" className="text-xs" style={{ margin: 0, opacity: 0.85 }}>
          {NOT_WHILE_EXPLORING}.
        </p>
      )}
      <EditLock locked={exploring}>
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
          <MemoFurnitureCatalogPanel onAdd={addFromCatalog} />

          <SetsPanel
            onAddSet={(set) => {
              // Scale/refuse the set to the current room so pieces don't
              // land through the walls in small rooms (#73), on the free
              // spot nearest the centre rather than on top of what's
              // there (#456). An empty result means it can't fit here.
              const items = placeSetInFreeSpace(set, {
                roomWidth: layout.width,
                roomDepth: layout.height,
                existing: activeFloor.items,
                keepOut,
                interiorWalls: activeFloor.interiorWalls ?? [],
                frontGap: entrancePlanOutline(layout, activeFloorIndex),
                storeyHeight: storeyHeight(activeFloor),
                floorIndex: activeFloorIndex,
              });
              // Garden pieces stay on the ground floor (#591); an all-garden set says so.
              if (setForStorey(set, activeFloorIndex).items.length === 0) {
                notifyRefused(`The ${set.label} is all garden items, and garden items go on the ground floor.`, playCue);
                return;
              }
              if (items.length === 0) {
                notifyRefused(`No free spot for the ${set.label} — make some room first.`, playCue);
                return;
              }
              // Hard budget (#463e): say why instead of a silent refusal.
              const refusal = purchaseRefusal(layout, purchasePrice(items));
              if (refusal !== null) {
                notifyRefused(refusal, playCue);
                return;
              }
              actions.addItems(items);
              playCue('place');
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
      </EditLock>

      {sidebarTab === 'style' && (
        <>
          <EditLock locked={exploring}>
          <ThemesPanel
            onApply={(themeKey) => {
              // Re-clicking the active theme changes nothing: no undo step (#598).
              const themed = applyTheme(layout, themeKey);
              if (sameLayoutContent(themed, layout)) return;
              // Loads are discrete steps: an edit still in the debounce
              // window keeps an undo entry of its own (#555).
              history.commitNow();
              actions.applyLayout(themed);
            }}
          />

          </EditLock>

          <TimeOfDayPanel />

          {selectedItem && (
            <EditLock locked={exploring}>
            <ItemResizePanel
              collision={collisionMessage(selectedItem, activeFloor.items, layout.width, layout.height, { keepOut, interiorWalls: activeFloor.interiorWalls, storeyHeight: storeyHeight(activeFloor) })}
              onDuplicate={duplicateItem}
            />
            </EditLock>
          )}
        </>
      )}

      {sidebarTab === 'manage' && (
        <>
          <CameraPresetsPanel
            disabled={!isReady || view.view2D || view.walkthroughMode}
            screenshotDisabled={!isReady || view.walkthroughMode}
            onApply={onApplyPreset}
            onFit={onFitToRoom}
            onScreenshot={onScreenshot}
          />

          <ActionsPanel
            onImport={onImport}
            onExportGlb={onExportGlb}
            onShareLink={onShareLink}
          />

          <EditLock locked={exploring}>
          <TemplatesPanel
            onLoadTemplate={async (template) => {
              // The hard budget and its write-off stay the player's; under it
              // a template is a purchase, refused before asking (#691).
              const label = `${template.name} template`;
              const asked = loadTemplateUnderBudget(layout, template, label);
              if (asked.refusal !== null) {
                notifyRefused(asked.refusal, playCue);
                return false;
              }
              const note = isHardBudgetOn(layout) ? HARD_BUDGET_SELL_BACK_NOTE : '';
              if (!(await confirmReplace(layout, `the ${label}`, { note }))) return false;
              // Read again after the answer: another tab's version may have
              // been adopted while it asked, and its budget is what counts.
              const current = layoutStore.getState().layout;
              const load = loadTemplateUnderBudget(current, template, label);
              if (load.refusal !== null) {
                notifyRefused(load.refusal, playCue);
                return false;
              }
              snapshotBeforeReplace(current);
              history.commitNow();
              actions.applyLayout({
                ...load.layout,
                floors: load.layout.floors.map((floor) => ({ ...floor, items: [...floor.items] })),
              });
              markLayoutLoaded();
              if (load.writtenOff > 0) {
                notify(`The furniture it replaced sold back at ${Math.round(SELL_BACK_RATE * 100)}%: ${CURRENCY_SYMBOL}${load.writtenOff.toLocaleString()} written off.`, 'info');
              }
              selectOnly(null);
              return true;
            }}
          />

          <LibraryPanel
            key={libraryRevision}
            currentLayout={layout}
            onLoad={(loaded) => {
              // No history.clear(): like a template load, this must stay
              // one Ctrl+Z away from the design it replaced (#222). The house
              // on screen now: the load asked first, and asking takes time.
              snapshotBeforeReplace(layoutStore.getState().layout);
              history.commitNow();
              actions.applyLayout(loaded);
              markLayoutLoaded();
              selectOnly(null);
            }}
          />

          </EditLock>

          <StoragePanel
            currentLayout={layout}
            onStorageChanged={() => setLibraryRevision((revision) => revision + 1)}
          />

          <StatisticsPanel />
          <AchievementsPanel unlocked={unlockedAchievements} />
          <ShortcutsPanel />
        </>
      )}
    </>
  );
});

const MemoFurnitureCatalogPanel = memo(FurnitureCatalogPanel);

/**
 * Turns every control inside off while `locked` (#643): a disabled fieldset
 * disables its buttons, fields and selects. `display: contents`, so the
 * panels lay out exactly as without it.
 */
function EditLock({ locked, children }: { locked: boolean; children: ReactNode }): JSX.Element {
  return (
    <fieldset disabled={locked} style={{ display: 'contents' }}>
      {children}
    </fieldset>
  );
}
