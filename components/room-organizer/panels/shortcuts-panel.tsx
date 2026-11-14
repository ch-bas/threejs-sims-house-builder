'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useLengthUnit } from '../contexts';
import { formatMetres } from '../lib/format';

interface Shortcut {
  label: string;
  keys: string;
}

const SHORTCUTS: readonly Shortcut[] = [
  { label: 'Undo / Redo', keys: 'Ctrl+Z / Ctrl+⇧+Z or Ctrl+Y' },
  { label: 'Delete item or wall', keys: 'Del / ⌫' },
  { label: 'Duplicate', keys: 'Ctrl+D' },
  { label: 'Copy / Paste', keys: 'Ctrl+C / Ctrl+V' },
  { label: 'Rotate', keys: 'R (⇧R = 15°)' },
  // Nudge goes here, with the Shift step in the unit shown (#725).
  { label: 'Lock / unlock', keys: 'U' },
  { label: 'Deselect', keys: 'Esc' },
  { label: 'Focus on item', keys: 'F' },
  { label: 'Multi-select', keys: 'Ctrl/⌘+click' },
  { label: 'Toggle 2D', keys: '2' },
  { label: 'Dimension labels', keys: 'M' },
  { label: 'Snap to grid', keys: 'G' },
  { label: 'Signals/Coverage', keys: 'W' },
  { label: 'Time of day', keys: '[ / ]' },
  { label: 'Switch floor', keys: 'PgUp / PgDn' },
  { label: 'Show / hide panels', keys: 'P' },
];

export function ShortcutsPanel(): JSX.Element {
  const unit = useLengthUnit();
  const nudge: Shortcut = { label: 'Nudge', keys: `Arrows (⇧ = ${formatMetres(1, undefined, unit)})` };
  const rotate = SHORTCUTS.findIndex((shortcut) => shortcut.label === 'Rotate');
  const shortcuts = [...SHORTCUTS.slice(0, rotate + 1), nudge, ...SHORTCUTS.slice(rotate + 1)];
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">⌨️ Shortcuts</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="text-xs space-y-1">
          {shortcuts.map((shortcut) => (
            <div key={shortcut.label} className="flex justify-between">
              <span className="text-muted-foreground">{shortcut.label}:</span>
              <code className="bg-muted px-1 rounded">{shortcut.keys}</code>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
