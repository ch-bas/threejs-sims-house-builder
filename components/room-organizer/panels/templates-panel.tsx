'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select } from '@/components/ui/select';
import { NOT_WHILE_EXPLORING, useExploring } from '../hooks/use-exploring';
import { ROOM_TEMPLATES, type RoomTemplateKey } from '../lib/constants';
import { subscribeHouseReplaced } from '../lib/restore-point';

// A Record, not a list, so a template added to ROOM_TEMPLATES without a label
// here fails the typecheck instead of silently missing from the select (#343).
const TEMPLATE_LABELS: Readonly<Record<RoomTemplateKey, string>> = {
  bedroom: '🛏️ Bedroom',
  livingRoom: '🛋️ Living Room',
  office: '💼 Home Office',
  kitchen: '🍳 Kitchen',
  bathroom: '🛁 Bathroom',
  studio: '🏠 Studio Apartment',
  twoStory: '🏡 Two-Story Home',
};

const TEMPLATE_OPTIONS = (Object.keys(TEMPLATE_LABELS) as RoomTemplateKey[]).map((key) => ({
  key,
  label: TEMPLATE_LABELS[key],
}));

export interface TemplatesPanelProps {
  /** Resolves false when the user declined replacing the current house. */
  /** Resolves true once the template replaced the house (after the in-app confirm, #649). */
  onLoadTemplate(template: (typeof ROOM_TEMPLATES)[RoomTemplateKey]): Promise<boolean>;
}

export function TemplatesPanel({ onLoadTemplate }: TemplatesPanelProps): JSX.Element {
  const [status, setStatus] = useState<string | null>(null);
  // A template replaces the house: not while exploring (#643).
  const exploring = useExploring();
  // "Undo brings back …" stops being true once another house replaces this one.
  useEffect(() => subscribeHouseReplaced(() => setStatus(null)), []);
  const load = (key: RoomTemplateKey) => {
    void onLoadTemplate(ROOM_TEMPLATES[key]).then((loaded) => {
      if (loaded) setStatus(`Loaded the ${TEMPLATE_LABELS[key].replace(/^\S+\s/, '')} template. Undo brings back the house it replaced.`);
    });
  };
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Templates</CardTitle>
      </CardHeader>
      <CardContent>
        {/* Controlled with an always-empty value so choosing the SAME template
            twice still fires onValueChange (a select only reports a change
            away from its current value) — re-applying a template after edits
            was a silent no-op (#122). */}
        <Select
          value=""
          onValueChange={(key) => load(key as RoomTemplateKey)}
          placeholder="Load a template..."
          aria-label="Load a template"
          disabled={exploring}
          {...(exploring ? { title: NOT_WHILE_EXPLORING } : {})}
        >
          {TEMPLATE_OPTIONS.map((option) => (
            <option key={option.key} value={option.key}>
              {option.label}
            </option>
          ))}
        </Select>
        {status && (
          <p role="status" className="mt-2 text-xs text-muted-foreground">
            {status}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
