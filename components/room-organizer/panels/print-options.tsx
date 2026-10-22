'use client';

import { useId, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { useRoomEditor } from '../contexts';
import {
  DEFAULT_PRINT_OPTIONS,
  openPlanPrintWindow,
  PAPER_SIZES,
  printScaleLabel,
  resolvePrintScale,
  SCALE_DENOMINATORS,
  type PaperSize,
  type PrintOptions,
  type PrintOrientation,
} from '../lib/plan-export/print';

/**
 * The print-to-scale button and its options (#435, #405, #424): paper,
 * orientation, scale, whether items outside the walls are drawn, an item
 * schedule, and every floor at once.
 * The button folds the options open under it; their Print button opens the
 * popup, inside that click's user gesture. Renders two cells of the Export
 * grid, each spanning both columns.
 */
export function PrintPlanControl(): JSX.Element {
  const { layout, activeFloor } = useRoomEditor();
  const [open, setOpen] = useState(false);
  const [options, setOptions] = useState<PrintOptions>(DEFAULT_PRINT_OPTIONS);
  const id = useId();
  const formId = `${id}-form`;
  const multiStorey = layout.floors.length > 1;
  // A single-storey house has nothing else to print; don't carry a stale
  // "every floor" from before a floor was removed.
  const effective: PrintOptions = multiStorey ? options : { ...options, allFloors: false };
  // Cheap (a bounds pass over the items): recomputed each render while open.
  const scale = open ? resolvePrintScale(layout, activeFloor, effective) : null;

  const patch = (next: Partial<PrintOptions>): void => setOptions((current) => ({ ...current, ...next }));

  return (
    <>
      <Button
        onClick={() => setOpen((value) => !value)}
        variant="outline"
        size="sm"
        className="col-span-2 text-xs"
        aria-expanded={open}
        aria-controls={formId}
      >
        📄 Print / PDF (to scale)
      </Button>
      {open && (
        <div id={formId} role="group" aria-label="Print options" className="col-span-2 space-y-2 rounded-md border p-2">
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label htmlFor={`${id}-paper`} className="text-xs">
                Paper
              </Label>
              <Select
                id={`${id}-paper`}
                className="h-8 text-xs"
                value={effective.paper}
                onValueChange={(value) => patch({ paper: value as PaperSize })}
              >
                {PAPER_SIZES.map((paper) => (
                  <option key={paper} value={paper}>
                    {paper}
                  </option>
                ))}
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor={`${id}-orientation`} className="text-xs">
                Orientation
              </Label>
              <Select
                id={`${id}-orientation`}
                className="h-8 text-xs"
                value={effective.orientation}
                onValueChange={(value) => patch({ orientation: value as PrintOrientation | 'auto' })}
              >
                <option value="auto">Auto</option>
                <option value="portrait">Portrait</option>
                <option value="landscape">Landscape</option>
              </Select>
            </div>
          </div>
          <div className="space-y-1">
            <Label htmlFor={`${id}-scale`} className="text-xs">
              Scale
            </Label>
            <Select
              id={`${id}-scale`}
              className="h-8 text-xs"
              value={String(effective.denominator)}
              onValueChange={(value) => patch({ denominator: value === 'auto' ? 'auto' : Number(value) })}
            >
              <option value="auto">Auto (largest that fits)</option>
              {SCALE_DENOMINATORS.map((denominator) => (
                <option key={denominator} value={String(denominator)}>
                  1:{denominator}
                </option>
              ))}
            </Select>
          </div>
          <div className="flex items-center gap-2">
            <input
              id={`${id}-outdoor`}
              type="checkbox"
              checked={effective.includeOutdoor}
              onChange={(event) => patch({ includeOutdoor: event.target.checked })}
              className="h-4 w-4 rounded border-gray-300"
            />
            <Label htmlFor={`${id}-outdoor`} className="cursor-pointer text-xs">
              Include items outside the walls
            </Label>
          </div>
          <div className="flex items-center gap-2">
            <input
              id={`${id}-schedule`}
              type="checkbox"
              checked={effective.schedule}
              onChange={(event) => patch({ schedule: event.target.checked })}
              className="h-4 w-4 rounded border-gray-300"
            />
            <Label htmlFor={`${id}-schedule`} className="cursor-pointer text-xs">
              Item schedule under each plan
            </Label>
          </div>
          {multiStorey && (
            <div className="flex items-center gap-2">
              <input
                id={`${id}-floors`}
                type="checkbox"
                checked={effective.allFloors}
                onChange={(event) => patch({ allFloors: event.target.checked })}
                className="h-4 w-4 rounded border-gray-300"
              />
              <Label htmlFor={`${id}-floors`} className="cursor-pointer text-xs">
                Every floor, one per page
              </Label>
            </div>
          )}
          {/* amber-400 on the drawer's dark card is 9.6:1 (WCAG AA needs 4.5:1). */}
          {scale && (
            <p className={`text-xs ${scale.fits ? 'text-muted-foreground' : 'text-amber-400'}`} aria-live="polite">
              {printScaleLabel(scale)}
            </p>
          )}
          <Button
            onClick={() => openPlanPrintWindow(layout, activeFloor, effective)}
            size="sm"
            className="w-full text-xs"
          >
            Print
          </Button>
        </div>
      )}
    </>
  );
}
