'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ACHIEVEMENTS, type Achievement } from '../lib/achievements';

export interface AchievementsPanelProps {
  unlocked: ReadonlySet<string>;
}

/** The achievements proper, and the challenge briefs' badges (#909) in a section of their own with their own count. */
const MAIN = ACHIEVEMENTS.filter((achievement) => achievement.challengeId === undefined);
const CHALLENGE_BADGES = ACHIEVEMENTS.filter((achievement) => achievement.challengeId !== undefined);

export function AchievementsPanel({ unlocked }: AchievementsPanelProps): JSX.Element {
  const count = (list: readonly Achievement[]) => list.reduce((sum, a) => sum + (unlocked.has(a.id) ? 1 : 0), 0);
  const unlockedCount = count(MAIN);
  const challengesDone = count(CHALLENGE_BADGES);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center justify-between">
          <span>🏆 Achievements</span>
          <span className="text-xs text-muted-foreground">
            {unlockedCount}/{MAIN.length}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <Progress label="Achievements unlocked" done={unlockedCount} total={MAIN.length} />
        <AchievementList list={MAIN} unlocked={unlocked} className="max-h-56 overflow-y-auto" />
        {CHALLENGE_BADGES.length > 0 && (
          <section aria-labelledby="pc-challenge-badges" className="space-y-2 pt-1">
            <h3 className="text-sm font-semibold flex items-center justify-between">
              <span id="pc-challenge-badges">Challenges</span>
              <span className="text-xs font-normal text-muted-foreground">
                {challengesDone}/{CHALLENGE_BADGES.length}
              </span>
            </h3>
            <Progress label="Challenges completed" done={challengesDone} total={CHALLENGE_BADGES.length} />
            <AchievementList list={CHALLENGE_BADGES} unlocked={unlocked} />
          </section>
        )}
      </CardContent>
    </Card>
  );
}

function Progress({ label, done, total }: { label: string; done: number; total: number }): JSX.Element {
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={total}
      aria-valuenow={done}
      aria-valuetext={`${done} of ${total}`}
      className="h-1.5 w-full bg-muted rounded-full overflow-hidden"
    >
      <div className="h-full bg-emerald-500 transition-all" style={{ width: `${total > 0 ? (done / total) * 100 : 0}%` }} />
    </div>
  );
}

function AchievementList({ list, unlocked, className = '' }: { list: readonly Achievement[]; unlocked: ReadonlySet<string>; className?: string }): JSX.Element {
  return (
    <ul className={`space-y-1.5 ${className}`}>
      {list.map((achievement) => {
        const isUnlocked = unlocked.has(achievement.id);
        return (
          <li
            key={achievement.id}
            className={`flex items-start gap-2 text-xs p-2 rounded border ${isUnlocked ? 'border-border bg-card' : 'border-dashed border-border'}`}
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
  );
}
