'use client';

import { useId, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { FloorPlanFitMode } from '../lib/types';
import { useRoomEditor } from '../contexts';

const FIT_MODE_HINTS: Record<FloorPlanFitMode, string> = {
  stretch: '↔️ Stretches image to fill entire room',
  cover: '📐 Covers room, may crop image',
  contain: '🖼️ Shows full image, may have gaps',
};

export interface RoomSettingsPanelProps {
  onFloorPlanUpload(file: File): void;
}

export function RoomSettingsPanel({ onFloorPlanUpload }: RoomSettingsPanelProps): JSX.Element {
  const { layout, activeFloor, actions, view, setView } = useRoomEditor();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const nameId = useId();
  const widthId = useId();
  const heightId = useId();
  const colorId = useId();
  const opacityId = useId();
  const effectId = useId();
  const fitModeId = useId();
  const fileInputId = useId();

  const handleFile = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) onFloorPlanUpload(file);
    event.target.value = '';
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Room Settings</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <Label htmlFor={nameId}>Layout Name</Label>
          <Input
            id={nameId}
            value={layout.name}
            onChange={(e) => actions.setName(e.target.value)}
            placeholder="My Room"
          />
        </div>
        <div>
          <Label htmlFor={widthId}>Width (meters)</Label>
          <Input
            id={widthId}
            type="number"
            min="2"
            max="20"
            step="0.5"
            value={layout.width}
            onChange={(e) => actions.setWidth(parseFloat(e.target.value) || 5)}
          />
        </div>
        <div>
          <Label htmlFor={heightId}>Depth (meters)</Label>
          <Input
            id={heightId}
            type="number"
            min="2"
            max="20"
            step="0.5"
            value={layout.height}
            onChange={(e) => actions.setHeight(parseFloat(e.target.value) || 4)}
          />
        </div>
        <div>
          <Label htmlFor={colorId}>Floor Color</Label>
          <Input
            id={colorId}
            type="color"
            value={activeFloor.floorColor}
            onChange={(e) => actions.setFloorColor(e.target.value)}
          />
        </div>

        <div className="pt-2 border-t">
          <Label className="text-sm font-medium">Floor Plan Image</Label>
          <div className="mt-2 space-y-2">
            {layout.floorPlanImage ? (
              <>
                <div className="text-xs text-muted-foreground bg-green-50 p-2 rounded">✓ Floor plan uploaded</div>
                <div>
                  <Label htmlFor={opacityId} className="text-xs">
                    Opacity: {((layout.floorPlanOpacity ?? 0.5) * 100).toFixed(0)}%
                  </Label>
                  <Input
                    id={opacityId}
                    type="range"
                    min="0"
                    max="1"
                    step="0.05"
                    value={layout.floorPlanOpacity ?? 0.5}
                    onChange={(e) => actions.setFloorPlanOpacity(parseFloat(e.target.value))}
                    className="w-full"
                  />
                </div>
                <div className="flex items-center space-x-2 pt-2">
                  <input
                    id={effectId}
                    type="checkbox"
                    checked={view.floorPlan3DEffect}
                    onChange={(e) => setView((v) => ({ ...v, floorPlan3DEffect: e.target.checked }))}
                    className="w-4 h-4 rounded border-gray-300"
                  />
                  <Label htmlFor={effectId} className="text-xs cursor-pointer">
                    Enable 3D Displacement Effect
                  </Label>
                </div>
                <p className="text-xs text-muted-foreground">
                  Creates height variations based on the floor plan image brightness
                </p>

                <div>
                  <Label htmlFor={fitModeId} className="text-xs">
                    Fit Mode
                  </Label>
                  <Select
                    value={layout.floorPlanFitMode ?? 'stretch'}
                    onValueChange={(value) => actions.setFloorPlanFitMode(value as FloorPlanFitMode)}
                  >
                    <SelectTrigger id={fitModeId} className="w-full text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="stretch">Stretch (Fill Room)</SelectItem>
                      <SelectItem value="cover">Cover (No Gaps)</SelectItem>
                      <SelectItem value="contain">Contain (Show All)</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground mt-1">
                    {FIT_MODE_HINTS[layout.floorPlanFitMode ?? 'stretch']}
                  </p>
                </div>

                <Button onClick={() => actions.setFloorPlan(null)} variant="outline" size="sm" className="w-full text-xs">
                  Remove Floor Plan
                </Button>
              </>
            ) : (
              <>
                <input
                  ref={fileInputRef}
                  id={fileInputId}
                  type="file"
                  accept="image/*"
                  onChange={handleFile}
                  className="hidden"
                />
                <Button
                  onClick={() => fileInputRef.current?.click()}
                  variant="outline"
                  size="sm"
                  className="w-full text-xs"
                >
                  📤 Upload Floor Plan
                </Button>
                <p className="text-xs text-muted-foreground">Upload an image to overlay on your room layout</p>
              </>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
