'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useLengthUnit } from '../contexts';
import { useAppleKeys } from '../hooks/use-apple-keys';
import { formatMetres, type LengthUnit } from '../lib/format';
import { KEY_CONTEXT_TITLES, KEYMAP, formatBinding, type KeyBinding, type KeyContext } from '../lib/keymap';

/** The sheet's sections, in order; the `?` overlay shows the same. */
export const SHORTCUT_CONTEXTS: readonly KeyContext[] = ['edit', 'plan', 'walk'];

/** A row's label: the nudge's steps follow the unit shown (#725). */
export function shortcutLabel(binding: KeyBinding, unit: LengthUnit): string {
  return binding.id === 'nudge' ? `Nudge ${formatMetres(0.1, undefined, unit)} (Shift: ${formatMetres(1, undefined, unit)})` : binding.label;
}

/**
 * The shortcut sheet, drawn from the key table (lib/keymap, #932): what the
 * handlers bind is what it lists, with ⌘ on a Mac and Ctrl elsewhere.
 */
export function ShortcutsPanel(): JSX.Element {
  const unit = useLengthUnit();
  const mac = useAppleKeys();
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">⌨️ Shortcuts</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {SHORTCUT_CONTEXTS.map((context) => (
          <section key={context} aria-label={KEY_CONTEXT_TITLES[context]}>
            <h3 className="text-xs font-semibold mb-1">{KEY_CONTEXT_TITLES[context]}</h3>
            <div className="text-xs space-y-1">
              {KEYMAP.filter((binding) => binding.context === context).map((binding) => (
                <div key={binding.id} className="flex justify-between gap-2">
                  <span className="text-muted-foreground">{shortcutLabel(binding, unit)}:</span>
                  <code className="bg-muted px-1 rounded text-right">{formatBinding(binding, mac)}</code>
                </div>
              ))}
            </div>
          </section>
        ))}
      </CardContent>
    </Card>
  );
}
