'use client';

import { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useRoomEditor } from '../contexts';
import { useSelection } from '../contexts';
import { NOT_WHILE_EXPLORING, useExploring } from '../hooks/use-exploring';
import { layoutStore } from '../hooks/use-layout-store';
import { openBlueprintPrintWindow } from '../lib/blueprint';
import { HARD_BUDGET_SELL_BACK_NOTE, isHardBudgetOn } from '../lib/budget';
import { askConfirm } from '../lib/confirm-dialog';
import { DEFAULT_BUDGET } from '../lib/constants';
import { notifyWithUndo, removedMessage, removedNames } from '../lib/editor-notices';
import { downloadInventoryCsv, downloadLayoutAsJson, downloadScheduleCsv } from '../lib/file-io';
import { floorKeepOut } from '../lib/floor-keep-out';
import { type AutoOrganizeStrategy } from '../lib/geometry';
import { isWallMounted } from '../lib/opening-snap';
import { buildingExportFileName, downloadTextFile, planExportFileName } from '../lib/plan-export/download';
import { buildingToDxf, layoutToDxf } from '../lib/plan-export/dxf';
import { buildingToSvg, layoutToSvg } from '../lib/plan-export/svg';
import { storeyHeight } from '../lib/storeys';
import { ENTRANCE_WALL_ID } from '../lib/street';
import { runSurprise } from '../lib/surprise';
import { arrangeByZone } from '../lib/zones';
import { PrintPlanControl } from './print-options';
import type { FurnitureItem } from '../lib/types';

export interface ActionsPanelProps {
  /** Resolves true when the file replaced the current house. */
  onImport(file: File): Promise<boolean>;
  onExportGlb(): void;
  onShareLink(): void;
}

export function ActionsPanel(props: ActionsPanelProps): JSX.Element {
  const { layout, activeFloor, activeFloorIndex, actions, isReady, playCue, history } = useRoomEditor();
  const { selectOnly, setSelectedItemId, setExtraSelectedIds } = useSelection();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importStatus, setImportStatus] = useState<string | null>(null);

  const hasItems = activeFloor.items.length > 0;
  const buildingHasItems = hasItems || layout.floors.some((floor) => floor.items.length > 0);
  // The porch back wall is structure the reducer keeps on a clear (#357).
  const hasInteriorWalls = (activeFloor.interiorWalls ?? []).some((wall) => wall.id !== ENTRANCE_WALL_ID);
  const allLocked = hasItems && activeFloor.items.every((item) => item.locked === true);
  const multiStorey = layout.floors.length > 1;
  // EXPLORE never edits the house (#643): the edits here are off, the
  // exports stay.
  const exploring = useExploring();
  const editHint = exploring ? NOT_WHILE_EXPLORING : undefined;

  // Doors/windows/cameras must stay on their walls and outdoor items must stay
  // outside the building — organizing them into the room grid tears openings
  // off their cutouts and drags garden items indoors as permanent collisions.
  const organize = (strategy: AutoOrganizeStrategy) => {
    const anchored: FurnitureItem[] = [];
    const movable: FurnitureItem[] = [];
    for (const item of activeFloor.items) {
      if (isWallMounted(item.type) || item.category === 'outdoor') anchored.push(item);
      else movable.push(item);
    }
    // The porch, the stairwell holes and the partitions are off limits, as
    // they are to every other placement (#577).
    const context = {
      keepOut: floorKeepOut(layout, activeFloorIndex),
      interiorWalls: activeFloor.interiorWalls,
      storeyHeight: storeyHeight(activeFloor),
    };
    // A floor with zones is arranged room by room (#629).
    const arranged = arrangeByZone(movable, layout.width, layout.height, strategy, { context, zones: activeFloor.zones });
    actions.replaceItems([...anchored, ...arranged]);
  };

  const handleFile = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    void props.onImport(file).then((imported) => {
      if (imported) setImportStatus(`Imported “${file.name}”. Undo brings back the house it replaced.`);
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">⚙️ Layout actions</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <Section title="Arrange">
          <div className="grid grid-cols-3 gap-1">
            <Button onClick={() => organize('shelf')} disabled={!hasItems || exploring} title={editHint} size="sm" className="text-xs">
              🎯 Pack
            </Button>
            <Button
              onClick={() => organize('by-category')}
              variant="outline"
              disabled={!hasItems || exploring}
              title={editHint}
              size="sm"
              className="text-xs"
            >
              🏷 By cat
            </Button>
            <Button
              onClick={() => organize('by-size')}
              variant="outline"
              disabled={!hasItems || exploring}
              title={editHint}
              size="sm"
              className="text-xs"
            >
              📏 By size
            </Button>
          </div>
          <Button
            onClick={() => {
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
            variant="outline"
            className="w-full text-xs"
            size="sm"
            disabled={exploring}
            title={editHint}
          >
            🎁 Surprise me
          </Button>
        </Section>

        <Section title="Floor">
          <div className="grid grid-cols-2 gap-2">
            <Button
              onClick={() => actions.setLockAll(!allLocked)}
              variant="outline"
              size="sm"
              className="text-xs"
              disabled={!hasItems || exploring}
              title={editHint}
            >
              {allLocked ? '🔓 Unlock all' : '🔒 Lock all'}
            </Button>
            <Button
              onClick={() => {
                // Same rule as Surprise: never wipe placed furniture without
                // asking (#105, #223).
                void askConfirm({
                  title: 'Remove every item from this floor?',
                  body: `Undo brings them back.${isHardBudgetOn(layout) ? HARD_BUDGET_SELL_BACK_NOTE : ''}`,
                  confirmLabel: 'Clear floor',
                  danger: true,
                }).then((ok) => {
                  if (!ok) return;
                  // Read after the answer: another tab's version may have
                  // been adopted while the question was open.
                  const before = layoutStore.getState();
                  const floor = before.layout.floors[before.activeFloorIndex];
                  // Its own undo step, so the toast's Undo takes back just this (#651).
                  history.commitNow();
                  actions.clearItems();
                  const cleared = layoutStore.getState();
                  const gone = removedNames(floor?.items ?? [], cleared.layout.floors[cleared.activeFloorIndex]?.items ?? []);
                  if (gone.length > 0) {
                    notifyWithUndo(removedMessage(gone, floor?.name), { current: () => layoutStore.getState().layout, undo: history.undo });
                  }
                  playCue('remove');
                  selectOnly(null);
                });
              }}
              variant="outline"
              size="sm"
              className="text-xs text-red-600 hover:text-red-700 hover:bg-red-50"
              disabled={!hasItems || exploring}
              title={editHint}
            >
              🗑 Clear floor
            </Button>
          </div>
          <Button
            onClick={() => {
              void askConfirm({
                title: 'Remove every interior wall on this floor?',
                body: 'Undo brings them back.',
                confirmLabel: 'Clear walls',
                danger: true,
              }).then((ok) => {
                if (ok) actions.clearInteriorWalls();
              });
            }}
            variant="outline"
            size="sm"
            className="w-full text-xs"
            disabled={!hasInteriorWalls || exploring}
            title={editHint}
          >
            🧹 Clear interior walls
          </Button>
        </Section>

        <Section title="Export / share">
          <div className="grid grid-cols-2 gap-2">
            <Button onClick={() => downloadLayoutAsJson(layout)} variant="outline" size="sm" className="text-xs">
              💾 JSON
            </Button>
            <Button
              onClick={() => fileInputRef.current?.click()}
              variant="outline"
              size="sm"
              className="text-xs"
              disabled={exploring}
              title={editHint}
            >
              📂 Import
            </Button>
            {/* The inventory lists every floor's items, so it is gated on
                the building having any, not just this floor (#430). */}
            <Button
              onClick={() => downloadInventoryCsv(layout)}
              variant="outline"
              size="sm"
              className="text-xs"
              disabled={!buildingHasItems}
              title="One row per item: size, price, position, rotation, zone"
            >
              📊 CSV
            </Button>
            <Button
              onClick={() => downloadScheduleCsv(layout)}
              variant="outline"
              size="sm"
              className="text-xs"
              disabled={!buildingHasItems}
              title="Items grouped per floor with quantity and total"
            >
              🧾 Schedule
            </Button>
            <Button
              onClick={props.onExportGlb}
              variant="outline"
              size="sm"
              className="text-xs"
              disabled={!isReady}
              title="The whole building: every floor, the roof, all walls"
            >
              🧊 GLB
            </Button>
            {/* The plan exports of the active floor (#230). Not gated on
                hasItems: the walls, openings and zones alone are a valid
                plan — the blueprint included (#437). The SVG lists the
                floor's items under the plan (#424). */}
            <Button
              onClick={() => openBlueprintPrintWindow(layout, activeFloor)}
              variant="outline"
              size="sm"
              className="text-xs"
            >
              🖨 Print
            </Button>
            <Button
              onClick={() =>
                downloadTextFile(
                  planExportFileName(layout, activeFloor, 'svg'),
                  'image/svg+xml',
                  layoutToSvg(layout, activeFloor, { schedule: true })
                )
              }
              variant="outline"
              size="sm"
              className="text-xs"
              title={multiStorey ? 'This floor, with its item schedule' : 'The plan, with its item schedule'}
            >
              🖼 SVG
            </Button>
            <Button
              onClick={() =>
                downloadTextFile(
                  planExportFileName(layout, activeFloor, 'dxf'),
                  'application/dxf',
                  layoutToDxf(layout, activeFloor)
                )
              }
              variant="outline"
              size="sm"
              className="text-xs"
              title={multiStorey ? 'This floor, in metres' : 'The plan, in metres'}
            >
              📐 DXF
            </Button>
            {/* The whole building at one scale (#405): floors stacked down
                one SVG, side by side in one DXF on the same layers. */}
            {multiStorey && (
              <>
                <Button
                  onClick={() =>
                    downloadTextFile(
                      buildingExportFileName(layout, 'svg'),
                      'image/svg+xml',
                      buildingToSvg(layout, { schedule: true })
                    )
                  }
                  variant="outline"
                  size="sm"
                  className="text-xs"
                  title="Every floor on one sheet, stacked, each with its item schedule"
                >
                  🖼 SVG · all floors
                </Button>
                <Button
                  onClick={() =>
                    downloadTextFile(
                      buildingExportFileName(layout, 'dxf'),
                      'application/dxf',
                      buildingToDxf(layout)
                    )
                  }
                  variant="outline"
                  size="sm"
                  className="text-xs"
                  title="Every floor side by side, in metres"
                >
                  📐 DXF · all floors
                </Button>
              </>
            )}
            {/* Print to scale with paper / scale / floor options (#435, #405). */}
            <PrintPlanControl />
            <Button onClick={props.onShareLink} variant="outline" size="sm" className="col-span-2 text-xs">
              🔗 Link
            </Button>
          </div>
          {importStatus && (
            <p role="status" className="text-xs text-muted-foreground">
              {importStatus}
            </p>
          )}
        </Section>

        <input ref={fileInputRef} type="file" accept=".json" onChange={handleFile} className="hidden" />
      </CardContent>
    </Card>
  );
}

interface SectionProps {
  title: string;
  children: React.ReactNode;
}

function Section({ title, children }: SectionProps): JSX.Element {
  return (
    <div className="space-y-2">
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">{title}</p>
      {children}
    </div>
  );
}
