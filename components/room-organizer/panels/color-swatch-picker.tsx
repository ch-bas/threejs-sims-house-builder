'use client';

import { useId } from 'react';
import { Label } from '@/components/ui/label';

/** Preset colours offered by the item colour pickers. */
export const COLOR_SWATCHES: readonly string[] = [
  '#8B4513',
  '#4A5568',
  '#E8E8E8',
  '#2C3E50',
  '#C62828',
  '#1976D2',
  '#388E3C',
  '#FFB300',
  '#6A1B9A',
  '#5D4037',
  '#0D47A1',
  '#FAFAFA',
];

export interface ColorSwatchPickerProps {
  value: string;
  /** Preset swatches to offer (pre-sliced by the caller). */
  swatches: readonly string[];
  /** Recently used colours from the editor context (pre-sliced by the caller). */
  recent: readonly string[];
  onChange(color: string): void;
  onCommit(color: string): void;
  /**
   * 'glass' — compact inline row styled for the plotcraft HUD popover.
   * 'card'  — shadcn-styled block for the sidebar resize panel.
   */
  variant: 'glass' | 'card';
}

/**
 * Colour input + preset swatches + recent colours. One widget, two skins:
 * both variants share the same structure and behaviour (commit on blur,
 * selected-swatch highlight, recent-colour reuse) but keep the styling of
 * the design system they sit in.
 */
export function ColorSwatchPicker(props: ColorSwatchPickerProps): JSX.Element {
  return props.variant === 'glass' ? <GlassSkin {...props} /> : <CardSkin {...props} />;
}

function isSelected(value: string, swatch: string): boolean {
  return value.toLowerCase() === swatch.toLowerCase();
}

function GlassSkin({ value, swatches, recent, onChange, onCommit }: ColorSwatchPickerProps): JSX.Element {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span
          style={{
            width: 48,
            fontFamily: 'var(--pc-font-display)',
            fontWeight: 600,
            fontSize: 10,
            letterSpacing: 'var(--pc-tr-caps)',
            textTransform: 'uppercase',
            color: 'var(--pc-paper-soft)',
          }}
        >
          Colour
        </span>
        <input
          type="color"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onBlur={(event) => onCommit(event.target.value)}
          style={{
            width: 30,
            height: 26,
            borderRadius: 6,
            border: '1px solid var(--pc-glass-stroke)',
            background: 'transparent',
            cursor: 'pointer',
            padding: 0,
          }}
        />
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, flex: 1 }}>
          {swatches.map((swatch) => {
            const selected = isSelected(value, swatch);
            return (
              <button
                key={swatch}
                type="button"
                aria-label={`Use color ${swatch}`}
                onClick={() => onChange(swatch)}
                style={{
                  height: 16,
                  width: 16,
                  borderRadius: 999,
                  border: '1px solid var(--pc-glass-stroke)',
                  backgroundColor: swatch,
                  cursor: 'pointer',
                  boxShadow: selected ? 'var(--pc-halo-cyan-soft)' : 'none',
                  outline: selected ? '1px solid var(--pc-cyan-glow)' : 'none',
                  padding: 0,
                }}
              />
            );
          })}
        </div>
      </div>
      {recent.length > 0 && (
        <div
          style={{ display: 'flex', flexWrap: 'wrap', gap: 4, paddingLeft: 56 }}
        >
          {recent.map((swatch) => {
            const selected = isSelected(value, swatch);
            return (
              <button
                key={swatch}
                type="button"
                aria-label={`Reuse colour ${swatch}`}
                onClick={() => onChange(swatch)}
                style={{
                  height: 14,
                  width: 14,
                  borderRadius: 4,
                  border: '1px solid var(--pc-glass-stroke)',
                  backgroundColor: swatch,
                  cursor: 'pointer',
                  boxShadow: selected ? 'var(--pc-halo-cyan-soft)' : 'none',
                  outline: selected ? '1px solid var(--pc-cyan-glow)' : 'none',
                  padding: 0,
                }}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

function CardSkin({ value, swatches, recent, onChange, onCommit }: ColorSwatchPickerProps): JSX.Element {
  const inputId = useId();
  return (
    <div className="space-y-2">
      <Label htmlFor={inputId} className="text-xs">
        Color
      </Label>
      <div className="flex items-center gap-2">
        <input
          id={inputId}
          type="color"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onBlur={(event) => onCommit(event.target.value)}
          className="h-8 w-10 rounded border cursor-pointer"
        />
        <div className="flex flex-wrap gap-1">
          {swatches.map((swatch) => (
            <button
              key={swatch}
              type="button"
              aria-label={`Use color ${swatch}`}
              onClick={() => onChange(swatch)}
              className={`h-5 w-5 rounded-full border ${
                isSelected(value, swatch) ? 'ring-2 ring-primary' : ''
              }`}
              style={{ backgroundColor: swatch }}
            />
          ))}
        </div>
      </div>
      {recent.length > 0 && (
        <div>
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Recent</p>
          <div className="flex flex-wrap gap-1 mt-1">
            {recent.map((swatch) => (
              <button
                key={swatch}
                type="button"
                aria-label={`Reuse colour ${swatch}`}
                onClick={() => onChange(swatch)}
                className={`h-5 w-5 rounded border ${
                  isSelected(value, swatch) ? 'ring-2 ring-primary' : ''
                }`}
                style={{ backgroundColor: swatch }}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
