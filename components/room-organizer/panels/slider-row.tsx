'use client';

import { useId } from 'react';

export interface SliderRowProps {
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  format(value: number): string;
  onChange(value: number): void;
  /** Width of the label column in px (default 48). */
  labelWidth?: number;
  /**
   * Spaced-caps label (default). Set false for the plain bold label style
   * used by the compact dimension rows.
   */
  uppercaseLabel?: boolean;
}

/**
 * Label + range input + value readout row, styled for the plotcraft HUD
 * (display font, cyan accent, tabular-nums readout).
 */
export function SliderRow(props: SliderRowProps): JSX.Element {
  const {
    label,
    min,
    max,
    step,
    value,
    format,
    onChange,
    labelWidth = 48,
    uppercaseLabel = true,
  } = props;
  const id = useId();
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <label
        htmlFor={id}
        style={{
          width: labelWidth,
          fontFamily: 'var(--pc-font-display)',
          fontWeight: uppercaseLabel ? 600 : 700,
          fontSize: 10,
          ...(uppercaseLabel
            ? {
                letterSpacing: 'var(--pc-tr-caps)',
                textTransform: 'uppercase' as const,
              }
            : {}),
          color: 'var(--pc-paper-soft)',
        }}
      >
        {label}
      </label>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(parseFloat(event.target.value))}
        style={{ flex: 1, accentColor: 'var(--pc-cyan-glow)' }}
      />
      <span
        style={{
          width: 48,
          textAlign: 'right',
          fontFamily: 'var(--pc-font-display)',
          fontWeight: 600,
          fontSize: 10,
          fontVariantNumeric: 'tabular-nums',
          color: 'var(--pc-paper)',
        }}
      >
        {format(value)}
      </span>
    </div>
  );
}
