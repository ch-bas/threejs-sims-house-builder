'use client';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { CameraPreset } from '../lib/types';

const PRESETS: ReadonlyArray<{ key: CameraPreset; label: string }> = [
  { key: 'iso', label: '📐 Isometric' },
  { key: 'top', label: '⬇️ Top-down' },
  { key: 'front', label: '⬅️ Front' },
  { key: 'corner', label: '↗️ Corner' },
];

export interface CameraPresetsPanelProps {
  disabled: boolean;
  onApply(preset: CameraPreset): void;
  onFit(): void;
  onScreenshot(): void;
}

export function CameraPresetsPanel({ disabled, onApply, onFit, onScreenshot }: CameraPresetsPanelProps): JSX.Element {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">📷 Camera</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <div className="grid grid-cols-2 gap-2">
          {PRESETS.map((preset) => (
            <Button
              key={preset.key}
              variant="outline"
              size="sm"
              disabled={disabled}
              onClick={() => onApply(preset.key)}
              className="text-xs"
            >
              {preset.label}
            </Button>
          ))}
        </div>
        <Button variant="outline" size="sm" disabled={disabled} onClick={onFit} className="w-full text-xs">
          🔍 Fit to room
        </Button>
        <Button variant="outline" size="sm" disabled={disabled} onClick={onScreenshot} className="w-full text-xs">
          📸 Screenshot PNG
        </Button>
      </CardContent>
    </Card>
  );
}
