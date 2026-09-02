'use client';

import { useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useRoomEditor } from '../contexts';
import { useSelection } from '../contexts';
import { openBlueprintPrintWindow } from '../lib/blueprint';
import { downloadLayoutAsJson, downloadInventoryCsv } from '../lib/file-io';
import { autoOrganize, type AutoOrganizeStrategy } from '../lib/geometry';
import { isWallMounted } from '../lib/opening-snap';
import { surpriseLayout } from '../lib/surprise';
import type { FurnitureItem } from '../lib/types';

export interface ActionsPanelProps {
  onImport(file: File): void;
  onExportGlb(): void;
  onShareLink(): void;
}

export function ActionsPanel(props: ActionsPanelProps): JSX.Element {
  const { layout, activeFloor, actions, isReady } = useRoomEditor();
  const { selectOnly, setSelectedItemId, setExtraSelectedIds } = useSelection();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const hasItems = activeFloor.items.length > 0;
  const allLocked = hasItems && activeFloor.items.every((item) => item.locked === true);

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
    actions.replaceItems([...anchored, ...autoOrganize(movable, layout.width, layout.height, strategy)]);
  };

  const handleFile = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) props.onImport(file);
    event.target.value = '';
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">⚙️ Layout actions</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <Section title="Arrange">
          <div className="grid grid-cols-3 gap-1">
            <Button onClick={() => organize('shelf')} disabled={!hasItems} size="sm" className="text-xs">
              🎯 Pack
            </Button>
            <Button
              onClick={() => organize('by-category')}
              variant="outline"
              disabled={!hasItems}
              size="sm"
              className="text-xs"
            >
              🏷 By cat
            </Button>
            <Button
              onClick={() => organize('by-size')}
              variant="outline"
              disabled={!hasItems}
              size="sm"
              className="text-xs"
            >
              📏 By size
            </Button>
          </div>
          <Button
            onClick={() => {
              // Surprise replaces the whole floor — never wipe placed furniture
              // without asking (#105). An empty floor proceeds silently.
              if (
                hasItems &&
                !window.confirm('Replace everything on this floor with a surprise layout?')
              ) {
                return;
              }
              const items = surpriseLayout({ roomWidth: layout.width, roomDepth: layout.height });
              actions.replaceItems(items);
              setSelectedItemId(null);
              setExtraSelectedIds(new Set());
            }}
            variant="outline"
            className="w-full text-xs"
            size="sm"
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
              disabled={!hasItems}
            >
              {allLocked ? '🔓 Unlock all' : '🔒 Lock all'}
            </Button>
            <Button
              onClick={() => {
                actions.clearItems();
                selectOnly(null);
              }}
              variant="outline"
              size="sm"
              className="text-xs text-red-600 hover:text-red-700 hover:bg-red-50"
              disabled={!hasItems}
            >
              🗑 Clear floor
            </Button>
          </div>
          <Button
            onClick={actions.clearInteriorWalls}
            variant="outline"
            size="sm"
            className="w-full text-xs"
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
            >
              📂 Import
            </Button>
            <Button
              onClick={() => downloadInventoryCsv(layout)}
              variant="outline"
              size="sm"
              className="text-xs"
              disabled={!hasItems}
            >
              📊 CSV
            </Button>
            <Button
              onClick={props.onExportGlb}
              variant="outline"
              size="sm"
              className="text-xs"
              disabled={!isReady}
            >
              🧊 GLB
            </Button>
            <Button onClick={props.onShareLink} variant="outline" size="sm" className="text-xs">
              🔗 Link
            </Button>
            <Button
              onClick={() => openBlueprintPrintWindow(layout, activeFloor)}
              variant="outline"
              size="sm"
              className="text-xs"
              disabled={!hasItems}
            >
              🖨 Print
            </Button>
          </div>
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
