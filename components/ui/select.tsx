import * as React from 'react';
import { cn } from '@/lib/utils';

// A styled native <select> (#415). It replaced a Radix Select that shipped
// ~38 KB gz (popper, floating-ui, scroll lock, lucide) for a handful of short
// option lists; the native control brings keyboard, type-ahead, screen-reader
// and touch-picker behaviour for free.

export interface SelectProps
  extends Omit<React.SelectHTMLAttributes<HTMLSelectElement>, 'value' | 'defaultValue' | 'onChange' | 'multiple'> {
  value: string;
  onValueChange(value: string): void;
  /** Shown while `value` matches no option; the placeholder itself can't be picked. */
  placeholder?: string;
}

const Select = React.forwardRef<HTMLSelectElement, SelectProps>(
  ({ className, value, onValueChange, placeholder, children, ...props }, ref) => (
    <div className="relative">
      <select
        ref={ref}
        value={value}
        onChange={(event) => onValueChange(event.target.value)}
        className={cn(
          'flex h-10 w-full appearance-none items-center rounded-md border border-input bg-background py-2 pl-3 pr-8 text-sm text-foreground ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50',
          className
        )}
        {...props}
      >
        {placeholder !== undefined && (
          <option value="" disabled hidden>
            {placeholder}
          </option>
        )}
        {children}
      </select>
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-foreground opacity-50"
      >
        <path d="m6 9 6 6 6-6" />
      </svg>
    </div>
  )
);
Select.displayName = 'Select';

export { Select };
