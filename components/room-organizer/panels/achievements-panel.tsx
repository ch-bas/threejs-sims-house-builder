'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ACHIEVEMENTS } from '../lib/achievements';

export interface AchievementsPanelProps {
  unlocked: ReadonlySet<string>;
}

export function AchievementsPanel({ unlocked }: AchievementsPanelProps): JSX.Element {
  const total = ACHIEVEMENTS.length;
  const unlockedCount = ACHIEVEMENTS.reduce((sum, a) => sum + (unlocked.has(a.id) ? 1 : 0), 0);
  const progress = total > 0 ? (unlockedCount / total) * 100 : 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center justify-between">
          <span>🏆 Achievements</span>
          <span className="text-xs text-muted-foreground">
            {unlockedCount}/{total}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div
          role="progressbar"
          aria-label="Achievements unlocked"
          aria-valuemin={0}
          aria-valuemax={total}
          aria-valuenow={unlockedCount}
          aria-valuetext={`${unlockedCount} of ${total}`}
          className="h-1.5 w-full bg-muted rounded-full overflow-hidden"
        >
          <div className="h-full bg-emerald-500 transition-all" style={{ width: `${progress}%` }} />
        </div>
        <ul className="space-y-1.5 max-h-56 overflow-y-auto">
          {ACHIEVEMENTS.map((achievement) => {
            const isUnlocked = unlocked.has(achievement.id);
            return (
              <li
                key={achievement.id}
                className={`flex items-start gap-2 text-xs p-2 rounded border ${
                  isUnlocked ? 'border-border bg-card' : 'border-dashed border-border'
                }`}
              >
                <span role="img" aria-label={isUnlocked ? 'Unlocked' : 'Locked'} className={`text-base ${isUnlocked ? '' : 'grayscale opacity-60'}`}>
                  {isUnlocked ? achievement.icon : '🔒'}
                </span>
                <div className="flex-1">
                  <p className="font-medium">{achievement.name}</p>
                  <p className="text-muted-foreground">{achievement.description}</p>
                </div>
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}
