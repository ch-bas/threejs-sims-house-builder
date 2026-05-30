'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ROOF_LABELS } from '../three/roof';
import type { RoofStyle } from '../lib/types';
import { useRoomEditor } from '../contexts';

const ROOF_STYLES: ReadonlyArray<RoofStyle> = ['none', 'flat', 'gable', 'hipped'];
const DEFAULT_COLOR = '#8d6e63';

export function RoofPanel(): JSX.Element {
  const { layout, actions } = useRoomEditor();
  const style = layout.roof?.style ?? 'none';
  const color = layout.roof?.color ?? DEFAULT_COLOR;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">🏠 Roof</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div>
          <Label className="text-xs">Style</Label>
          <Select value={style} onValueChange={(value) => actions.setRoofStyle(value as RoofStyle)}>
            <SelectTrigger className="text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ROOF_STYLES.map((option) => (
                <SelectItem key={option} value={option}>
                  {ROOF_LABELS[option]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {style !== 'none' && (
          <div>
            <Label className="text-xs">Colour</Label>
            <Input
              type="color"
              value={color}
              onChange={(event) => actions.setRoofColor(event.target.value)}
              className="h-8 w-full"
            />
          </div>
        )}
        <p className="text-[10px] text-muted-foreground">
          The roof sits on top of the highest floor. Gable sheds along the longer side.
        </p>
      </CardContent>
    </Card>
  );
}
