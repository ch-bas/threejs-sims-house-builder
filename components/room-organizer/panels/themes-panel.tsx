'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { THEME_LIST, type ThemeMeta } from '../lib/themes';
import type { ThemeKey } from '../lib/types';

export interface ThemesPanelProps {
  onApply(theme: ThemeKey): void;
}

export function ThemesPanel({ onApply }: ThemesPanelProps): JSX.Element {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">🎭 Themes</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 gap-2">
          {THEME_LIST.map((theme) => (
            <ThemeButton key={theme.key} theme={theme} onApply={onApply} />
          ))}
        </div>
        <p className="text-[10px] text-muted-foreground mt-2">
          Applies new walls, floor, and category-based colors. Use Undo to revert.
        </p>
      </CardContent>
    </Card>
  );
}

interface ThemeButtonProps {
  theme: ThemeMeta;
  onApply(theme: ThemeKey): void;
}

function ThemeButton({ theme, onApply }: ThemeButtonProps): JSX.Element {
  return (
    <button
      type="button"
      onClick={() => onApply(theme.key)}
      className="text-left p-2 rounded border hover:bg-accent transition-colors text-xs"
    >
      <div className="flex items-center gap-2 font-medium">
        <span>{theme.icon}</span>
        {theme.label}
      </div>
      <div className="text-muted-foreground mt-1">{theme.description}</div>
    </button>
  );
}
