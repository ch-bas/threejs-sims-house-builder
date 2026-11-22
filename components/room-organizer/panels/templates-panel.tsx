'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select } from '@/components/ui/select';
import { NOT_WHILE_EXPLORING, useExploring } from '../hooks/use-exploring';
import { useStartChallenge } from '../hooks/use-start-challenge';
import { CHALLENGES, challengeAchievementId, goalLabel, ZONE_HINT } from '../lib/challenges';
import { ROOM_TEMPLATES, type RoomTemplateKey } from '../lib/constants';
import { formatMoney } from '../lib/format';
import { subscribeHouseReplaced } from '../lib/restore-point';

// A Record, not a list, so a template added to ROOM_TEMPLATES without a label
// here fails the typecheck instead of silently missing from the select (#343).
export const TEMPLATE_LABELS: Readonly<Record<RoomTemplateKey, string>> = {
  bedroom: '🛏️ Bedroom',
  livingRoom: '🛋️ Living Room',
  office: '💼 Home Office',
  kitchen: '🍳 Kitchen',
  bathroom: '🛁 Bathroom',
  studio: '🏠 Studio Apartment',
  twoStory: '🏡 Two-Story Home',
};

/** Every template, in the select's order (the start chooser shows them too, #721). */
export const TEMPLATE_KEYS = Object.keys(TEMPLATE_LABELS) as RoomTemplateKey[];

/** A template's name without its emoji. */
export function templateName(key: RoomTemplateKey): string {
  return TEMPLATE_LABELS[key].replace(/^\S+\s/, '');
}

const TEMPLATE_OPTIONS = TEMPLATE_KEYS.map((key) => ({
  key,
  label: TEMPLATE_LABELS[key],
}));

export interface TemplatesPanelProps {
  /** Resolves false when the user declined replacing the current house. */
  /** Resolves true once the template replaced the house (after the in-app confirm, #649). */
  onLoadTemplate(template: (typeof ROOM_TEMPLATES)[RoomTemplateKey]): Promise<boolean>;
  /** The achievements unlocked: a brief completed once is marked done (#909). */
  unlocked?: ReadonlySet<string>;
}

export function TemplatesPanel({ onLoadTemplate, unlocked }: TemplatesPanelProps): JSX.Element {
  const [status, setStatus] = useState<string | null>(null);
  // A template replaces the house: not while exploring (#643).
  const exploring = useExploring();
  // "Undo brings back …" stops being true once another house replaces this one.
  useEffect(() => subscribeHouseReplaced(() => setStatus(null)), []);
  const startChallenge = useStartChallenge();
  const start = (index: number) => {
    const challenge = CHALLENGES[index];
    if (!challenge) return;
    void startChallenge(challenge).then((started) => {
      if (started) setStatus(`Started the ${challenge.name} challenge. Undo brings back the house it replaced.`);
    });
  };
  const load = (key: RoomTemplateKey) => {
    void onLoadTemplate(ROOM_TEMPLATES[key]).then((loaded) => {
      if (loaded) setStatus(`Loaded the ${templateName(key)} template. Undo brings back the house it replaced.`);
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
        {/* Challenge briefs (#909): an empty lot, funds and goals to meet. */}
        <h3 className="mt-3 text-sm font-semibold">Challenges</h3>
        <p className="text-xs text-muted-foreground">An empty lot, funds and goals to meet. {ZONE_HINT}</p>
        <ul className="mt-1 space-y-1.5" aria-label="Challenges">
          {CHALLENGES.map((challenge, index) => (
            <li key={challenge.id}>
              <Button
                variant="outline"
                className="h-auto w-full flex-col items-start gap-0.5 whitespace-normal py-1.5 text-left"
                disabled={exploring}
                title={exploring ? NOT_WHILE_EXPLORING : challenge.goals.map(goalLabel).join(' · ')}
                onClick={() => start(index)}
              >
                <span className="text-xs font-semibold">
                  {challenge.name} · {formatMoney(challenge.funds)}
                  {unlocked?.has(challengeAchievementId(challenge.id)) && (
                    <>
                      {' · '}
                      <span aria-hidden="true" className="mr-1">
                        {challenge.badge}
                      </span>{' '}
                      Done
                    </>
                  )}
                </span>
                <span className="text-xs font-normal text-muted-foreground">{challenge.brief}</span>
              </Button>
            </li>
          ))}
        </ul>
        {status && (
          <p role="status" className="mt-2 text-xs text-muted-foreground">
            {status}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
