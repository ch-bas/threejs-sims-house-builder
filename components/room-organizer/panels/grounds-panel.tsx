'use client';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select } from '@/components/ui/select';
import { useEditorViewActions, useLengthUnit, useRoomEditor } from '../contexts';
import { setGroundDrawKind, useGroundDrawKind } from '../hooks/ground-draw';
import { formatArea, formatSize } from '../lib/format';
import { GROUND_KINDS, GROUND_LABELS, GROUND_MISFIT_NOTES, MAX_GROUNDS, groundArea, groundMisfit } from '../lib/grounds';
import type { GroundKind } from '../lib/types';

export interface GroundsPanelProps {
  /** The tool draws on the plan the drawer covers: it folds away (#323). */
  onDrawStart?(): void;
}

/**
 * Garden surfaces (#924): pick paving, gravel, a deck or a lawn and drag it
 * out on the 2D plan around the house; the list changes a surface's kind or
 * removes it. The tool works on the ground floor's plan, so picking one shows
 * it, parking the other drawing tools.
 */
export function GroundsPanel({ onDrawStart }: GroundsPanelProps = {}): JSX.Element {
  const { layout, actions, activeFloorIndex } = useRoomEditor();
  const { setView } = useEditorViewActions();
  const unit = useLengthUnit();
  const drawing = useGroundDrawKind();
  const grounds = layout.grounds ?? [];
  const full = grounds.length >= MAX_GROUNDS;

  const pick = (kind: GroundKind) => {
    if (drawing === kind) {
      setGroundDrawKind(null);
      return;
    }
    if (activeFloorIndex !== 0) actions.setActiveFloorIndex(0);
    setView((v) => ({ ...v, view2D: true, drawZoneMode: false, drawWallMode: false, measurementMode: false }));
    setGroundDrawKind(kind);
    onDrawStart?.();
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">🌿 Garden surfaces</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <div className="grid grid-cols-2 gap-2" role="group" aria-label="Lay a garden surface">
          {GROUND_KINDS.map((kind) => (
            <Button
              key={kind}
              variant={drawing === kind ? 'default' : 'outline'}
              size="sm"
              className="text-xs"
              aria-pressed={drawing === kind}
              disabled={drawing !== kind && full}
              onClick={() => pick(kind)}
            >
              {GROUND_LABELS[kind]}
            </Button>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">
          {drawing
            ? 'Drag a rectangle on the 2D plan, outside the house.'
            : full
              ? `A lot holds at most ${MAX_GROUNDS} garden surfaces.`
              : 'Lay a patio, a gravel drive, a deck or a lawn on the lot around the house.'}
        </p>

        {grounds.length > 0 && (
          <ul className="space-y-1 border-t pt-2" aria-label="Garden surfaces on the lot">
            {grounds.map((ground, index) => {
              // Numbered within its kind: Paving 1, Paving 2, Deck 1.
              const nth = grounds.slice(0, index + 1).filter((entry) => entry.kind === ground.kind).length;
              const label = `${GROUND_LABELS[ground.kind]} ${nth}`;
              const misfit = groundMisfit(ground, layout);
              return (
                <li key={ground.id} className="flex items-center gap-2 text-xs">
                  <Select
                    value={ground.kind}
                    onValueChange={(value) => actions.updateGround(ground.id, { kind: value as GroundKind })}
                    className="h-8 w-32 shrink-0 text-xs"
                    aria-label={`${label}: kind`}
                  >
                    {GROUND_KINDS.map((kind) => (
                      <option key={kind} value={kind}>
                        {GROUND_LABELS[kind]}
                      </option>
                    ))}
                  </Select>
                  <span className="min-w-0 flex-1 text-muted-foreground">
                    {formatSize(ground.w, ground.d, 1, unit)} · {formatArea(groundArea(ground), unit)}
                    {misfit ? ` · not shown: ${GROUND_MISFIT_NOTES[misfit]}` : ''}
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-xs"
                    aria-label={`Remove ${label}`}
                    onClick={() => actions.removeGround(ground.id)}
                  >
                    ✕
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
