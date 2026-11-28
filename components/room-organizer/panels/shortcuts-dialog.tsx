'use client';

import { useRef, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { useLengthUnit } from '../contexts';
import { useAppleKeys } from '../hooks/use-apple-keys';
import { useDialogFocus } from '../hooks/use-dialog-focus';
import { EDIT_KEYS, KEY_CONTEXT_TITLES, KEYMAP, formatBinding } from '../lib/keymap';
import { Icon } from '../plotcraft/icon';
import { SHORTCUT_CONTEXTS, shortcutLabel } from './shortcuts-panel';

/**
 * The `?` overlay (#932): every shortcut in the key table, by context, ⌘ on
 * a Mac. A modal: focus moves in and stays, Escape, back, `?` again or the
 * close button shut it, and no other key reaches the editor behind it.
 * Loaded on demand by shortcuts-overlay.
 */
export function ShortcutsDialog({ onClose }: { onClose(): void }): JSX.Element {
  const dialogRef = useRef<HTMLDivElement>(null);
  const backdropPressRef = useRef(false);
  const unit = useLengthUnit();
  const mac = useAppleKeys();

  // Focus on the dialog itself, so its title is read first; back to the
  // control that opened it, or to the home control after a key closed it.
  useDialogFocus(true, dialogRef, { onEscape: onClose, trap: true, takeFocus: true, returnHome: 'keyboard' });

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    // Escape and Tab belong to useDialogFocus (a document listener).
    if (event.key === 'Escape' || event.key === 'Tab') return;
    // Nothing reaches the editor's shortcuts behind the overlay.
    event.stopPropagation();
    // AltGr (reported as Ctrl+Alt on Windows) makes `?` on some layouts:
    // accepted as the opener accepts it.
    const altGraph = event.getModifierState('AltGraph');
    if (event.key === EDIT_KEYS.shortcuts && (altGraph || !(event.ctrlKey || event.metaKey || event.altKey))) {
      event.preventDefault();
      // The press that opened it may still be held.
      if (!event.repeat) onClose();
    }
  };

  return (
    <div
      onPointerDown={(event) => {
        backdropPressRef.current = event.target === event.currentTarget;
      }}
      onClick={(event) => {
        // Only a whole click on the backdrop, not the end of a press begun inside.
        const fromBackdrop = backdropPressRef.current && event.target === event.currentTarget;
        backdropPressRef.current = false;
        if (fromBackdrop) onClose();
      }}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(20, 30, 40, 0.45)',
        display: 'grid',
        placeItems: 'center',
        // Above the drawer (40) and the welcome modal (60), under a confirm (70).
        zIndex: 65,
        padding: 16,
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="pc-shortcuts-title"
        tabIndex={-1}
        className="pc-glass pc-glass--dark"
        onKeyDown={onKeyDown}
        style={{
          width: 'min(760px, 100%)',
          maxHeight: 'calc(100dvh - 32px)',
          overflowY: 'auto',
          padding: '16px 20px 18px',
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
          outline: 'none',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <h2 id="pc-shortcuts-title" style={{ margin: 0, fontFamily: 'var(--pc-font-display)', fontWeight: 700, fontSize: 16, color: 'var(--pc-paper)' }}>
            Keyboard shortcuts
          </h2>
          <button type="button" className="pc-tile" aria-label="Close" title="Close (Esc)" onClick={onClose} style={CLOSE}>
            <Icon name="close" size={16} />
          </button>
        </div>
        {/* Columns as wide as they fit: the long Editing list flows on into the next. */}
        <div style={{ columnWidth: 220, columnGap: 24 }}>
          {SHORTCUT_CONTEXTS.map((context) => (
            <section key={context} aria-labelledby={`pc-shortcuts-${context}`} style={{ marginBottom: 12 }}>
              <h3 id={`pc-shortcuts-${context}`} className="pc-hud-header" style={{ margin: '0 0 6px', fontSize: 10, color: 'var(--pc-cyan-glow)', breakAfter: 'avoid' }}>
                {KEY_CONTEXT_TITLES[context]}
              </h3>
              <dl style={{ margin: 0 }}>
                {KEYMAP.filter((binding) => binding.context === context).map((binding) => (
                  <div key={binding.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 10, padding: '2px 0', breakInside: 'avoid' }}>
                    <dt className="pc-body" style={{ fontSize: 12, lineHeight: 1.35, color: 'var(--pc-paper-soft)' }}>
                      {shortcutLabel(binding, unit)}
                    </dt>
                    <dd style={{ margin: 0, flexShrink: 0 }}>
                      <kbd style={KEY}>{formatBinding(binding, mac)}</kbd>
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}

const CLOSE: React.CSSProperties = {
  width: 36,
  height: 36,
  display: 'grid',
  placeItems: 'center',
  borderRadius: 12,
  cursor: 'pointer',
  flexShrink: 0,
};

const KEY: React.CSSProperties = {
  display: 'inline-block',
  padding: '1px 6px',
  borderRadius: 6,
  border: '1px solid rgba(255, 255, 255, 0.35)',
  background: 'rgba(255, 255, 255, 0.08)',
  color: 'var(--pc-paper)',
  // The UI's own face: a monospace one draws ⌘ and ⇧ too small to read.
  fontFamily: 'inherit',
  fontSize: 12,
  fontWeight: 600,
  whiteSpace: 'nowrap',
};
