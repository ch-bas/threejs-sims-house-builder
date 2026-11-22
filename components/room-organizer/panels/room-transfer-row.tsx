'use client';

import { useMemo, useRef, useState } from 'react';
import { useLengthUnit, useRoomEditor } from '../contexts';
import { useExploring } from '../hooks/use-exploring';
import { useMediaQuery } from '../hooks/use-media-query';
import { useRoomTransfer } from '../hooks/use-room-transfer';
import { formatMetres } from '../lib/format';
import { COMPACT_DOCK_QUERY } from '../lib/hud-layout';
import { EDIT_KEYS } from '../lib/keymap';
import { roomArrangement, type RoomTransfer, type RoomTransferResult } from '../lib/room-transfer';
import { zoneLabelSpot } from '../lib/zones';
import { ChipButton } from './chip-controls';
import type { RoomZone, Vec2 } from '../lib/types';

/** A room steps this far per arrow; Shift steps the wall grid. */
const STEP = 0.5;
const FINE_STEP = 0.1;

/** A point inside the zone's room: the middle of its label's clear stretch. */
function zonePoint(zone: RoomZone): Vec2 {
  const spot = zoneLabelSpot(zone);
  return { x: spot.x + spot.w / 2, z: spot.z + spot.d / 2 };
}

const ARROWS: ReadonlyArray<{ glyph: string; label: string; dx: number; dz: number }> = [
  { glyph: '←', label: 'west', dx: -1, dz: 0 },
  { glyph: '→', label: 'east', dx: 1, dz: 0 },
  { glyph: '↑', label: 'north', dx: 0, dz: -1 },
  { glyph: '↓', label: 'south', dx: 0, dz: 1 },
];

/**
 * The zone chip's room row (#925). With a zone selected on the plan, "Select
 * room" takes its detected room: the furniture in it, its zones and the
 * partitions only it stands on. Then the arrows move the room with its walls,
 * Mirror flips it in place, and Copy keeps it for Paste, here or on another
 * storey. Each is one reducer action (`transferRoom`), one undo step; a
 * refusal says why.
 */
export function RoomTransferRow({
  selectedZoneId,
  onZoneSelect,
}: {
  selectedZoneId: string | null;
  onZoneSelect(id: string | null): void;
}): JSX.Element | null {
  const { layout, activeFloor, activeFloorIndex } = useRoomEditor();
  const { copiedRoom: clipboard, transferRoom, pasteRoom, copyRoom, refuse } = useRoomTransfer();
  const exploring = useExploring();
  const unit = useLengthUnit();
  const [roomZoneId, setRoomZoneId] = useState<string | null>(null);
  const fine = useRef(false);
  // On a phone the row keeps to one line under the tool's: glyphs, no count.
  const compact = useMediaQuery(COMPACT_DOCK_QUERY);

  const zone = selectedZoneId ? activeFloor.zones?.find((entry) => entry.id === selectedZoneId) : undefined;
  const selected = zone !== undefined && roomZoneId === zone.id;
  const room = useMemo(
    () => (selected && zone ? roomArrangement(layout, activeFloorIndex, zonePoint(zone)) : null),
    [selected, zone, layout, activeFloorIndex]
  );

  if (exploring) return null;

  /** A copy or paste selects the room it brought. */
  const follow = (plan: RoomTransferResult | null): void => {
    const arrived = plan?.zoneIds[0];
    if (!arrived) return;
    onZoneSelect(arrived);
    setRoomZoneId(arrived);
  };
  const run = (transfer: RoomTransfer): void => {
    const plan = transferRoom(transfer);
    if (transfer.kind === 'copy' || transfer.kind === 'paste') follow(plan);
  };
  const paste = (): void => follow(pasteRoom());

  const pasteButton = clipboard ? (
    <ChipButton title="Paste the copied room here, where it was or beside it" onClick={paste}>
      Paste room
    </ChipButton>
  ) : null;

  if (!zone) return pasteButton ? <span style={ROW} onKeyDownCapture={holdBack}>{pasteButton}</span> : null;

  if (!selected || !room) {
    return (
      <span style={ROW} onKeyDownCapture={holdBack}>
        <ChipButton
          title="Select the room this zone names, with its furniture and walls"
          onClick={() => {
            const picked = roomArrangement(layout, activeFloorIndex, zonePoint(zone));
            if ('refusal' in picked) {
              refuse(picked.refusal);
              return;
            }
            if (!picked.zones.some((entry) => entry.id === zone.id)) {
              refuse(`${zone.name} reaches past its room: select a zone that fits one room.`);
              return;
            }
            setRoomZoneId(zone.id);
          }}
        >
          Select room
        </ChipButton>
        {pasteButton}
      </span>
    );
  }

  if ('refusal' in room) {
    return (
      <span style={ROW} onKeyDownCapture={holdBack}>
        {room.refusal}
        <ChipButton title="Let go of the room" onClick={() => setRoomZoneId(null)}>
          Done
        </ChipButton>
      </span>
    );
  }

  const at = zonePoint(zone);
  const count = room.items.length;
  const walls = room.walls.length;
  return (
    <span style={ROW} role="group" aria-label={`Room ${zone.name}`} onKeyDownCapture={holdBack}>
      {!compact && (
        <span>
          {count} {count === 1 ? 'item' : 'items'} · {walls} {walls === 1 ? 'wall' : 'walls'}
        </span>
      )}
      <span style={ARROW_GROUP} onClickCapture={(event) => (fine.current = event.shiftKey)}>
        {ARROWS.map((arrow) => (
          <ChipButton
            key={arrow.label}
            title={`Move the room ${formatMetres(STEP, undefined, unit)} ${arrow.label} (Shift: ${formatMetres(FINE_STEP, undefined, unit)})`}
            ariaLabel={`Move the room ${arrow.label}`}
            onClick={() => {
              const step = fine.current ? FINE_STEP : STEP;
              run({ kind: 'move', at, dx: arrow.dx * step, dz: arrow.dz * step });
            }}
          >
            {arrow.glyph}
          </ChipButton>
        ))}
      </span>
      <ChipButton
        title="Mirror the room west to east, in place"
        {...(compact ? { ariaLabel: 'Mirror the room west to east' } : {})}
        onClick={() => run({ kind: 'mirror', at, axis: 'x' })}
      >
        {compact ? '⇆' : 'Mirror ⇆'}
      </ChipButton>
      <ChipButton
        title="Mirror the room north to south, in place"
        {...(compact ? { ariaLabel: 'Mirror the room north to south' } : {})}
        onClick={() => run({ kind: 'mirror', at, axis: 'z' })}
      >
        {compact ? '⇅' : 'Mirror ⇅'}
      </ChipButton>
      <ChipButton
        title="Copy the room with its walls, to paste here or on another storey"
        onClick={() => copyRoom(room, zone.name)}
      >
        Copy
      </ChipButton>
      {pasteButton}
      <ChipButton title="Let go of the room" onClick={() => setRoomZoneId(null)}>
        Done
      </ChipButton>
    </span>
  );
}

/** A held Enter clicks a button again on every repeat: one press, one step. */
export function holdBack(event: Pick<React.KeyboardEvent, 'repeat' | 'key' | 'preventDefault'>): void {
  if (event.repeat && (event.key === EDIT_KEYS.confirm || event.key === EDIT_KEYS.space)) event.preventDefault();
}

const ROW: React.CSSProperties = {
  flexBasis: '100%',
  display: 'inline-flex',
  flexWrap: 'wrap',
  justifyContent: 'center',
  alignItems: 'center',
  gap: 6,
  color: 'var(--pc-paper)',
};

const ARROW_GROUP: React.CSSProperties = { display: 'inline-flex', gap: 4 };
