'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ROOM_TEMPLATES, type RoomTemplateKey } from '../lib/constants';

const TEMPLATE_OPTIONS: ReadonlyArray<{ key: RoomTemplateKey; label: string }> = [
  { key: 'bedroom', label: '🛏️ Bedroom' },
  { key: 'livingRoom', label: '🛋️ Living Room' },
  { key: 'office', label: '💼 Home Office' },
  { key: 'kitchen', label: '🍳 Kitchen' },
  { key: 'bathroom', label: '🛁 Bathroom' },
  { key: 'studio', label: '🏠 Studio Apartment' },
];

export interface TemplatesPanelProps {
  onLoadTemplate(template: (typeof ROOM_TEMPLATES)[RoomTemplateKey]): void;
}

export function TemplatesPanel({ onLoadTemplate }: TemplatesPanelProps): JSX.Element {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Templates</CardTitle>
      </CardHeader>
      <CardContent>
        <Select onValueChange={(key) => onLoadTemplate(ROOM_TEMPLATES[key as RoomTemplateKey])}>
          <SelectTrigger>
            <SelectValue placeholder="Load a template..." />
          </SelectTrigger>
          <SelectContent>
            {TEMPLATE_OPTIONS.map((option) => (
              <SelectItem key={option.key} value={option.key}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </CardContent>
    </Card>
  );
}
