'use client';

import { useEffect, useState } from 'react';
import { useEditorViewActions, useRoomEditor, useViewSettings } from '../contexts';
import { useMediaQuery } from '../hooks/use-media-query';
import { subscribeZoneNameRequests } from '../lib/editor-notices';
import { COARSE_POINTER_QUERY } from '../lib/hud-layout';
import { Icon } from '../plotcraft/icon';
import { ChipButton, ChipNameField } from './chip-controls';

/**
 * The zone tool's top-centre chip. While the draw mode is on it says so and
 * how to leave it (#439): the drawer that switched it on folds away, so the
 * plan was the only thing on screen and it showed nothing. Once a zone is
 * drawn it names it (#374): the plan adds the zone under its default name
 * and asks here, so drawing never stops on a blocking prompt: Enter renames
 * it, Escape keeps the default. The name field goes away by itself when the
 * zone does (undo, floor switch).
 */
export function ZoneNameChip(): JSX.Element | null {
  const { activeFloor, actions } = useRoomEditor();
  const view = useViewSettings('drawZoneMode', 'view2D');
  const { setView } = useEditorViewActions();
  // A finger taps and there is no Escape key on a phone.
  const touch = useMediaQuery(COARSE_POINTER_QUERY);
  const [zoneId, setZoneId] = useState<string | null>(null);

  useEffect(() => subscribeZoneNameRequests(setZoneId), []);

  const zone = zoneId ? activeFloor.zones?.find((entry) => entry.id === zoneId) : undefined;
  if (!zoneId || !zone) {
    if (!view.drawZoneMode || !view.view2D) return null;
    return (
      <div className="pc-top-chip" style={CHIP_SLOT} role="status">
        <div className="pc-glass pc-glass--dark" style={{ ...CHIP_BODY, color: 'var(--pc-sky)' }}>
          <Icon name="tag" size={14} />
          {touch ? 'Drag to add, tap to adjust' : 'Drag to add a zone · click one to adjust · Esc to stop'}
          <ChipButton title="Stop drawing zones" onClick={() => setView((v) => ({ ...v, drawZoneMode: false }))}>
            Done
          </ChipButton>
        </div>
      </div>
    );
  }

  return (
    <div className="pc-top-chip" style={CHIP_SLOT}>
      <div className="pc-glass pc-glass--dark" style={{ ...CHIP_BODY, color: 'var(--pc-cyan-glow)' }}>
        <Icon name="tag" size={14} />
        Name this zone
        <ChipNameField
          key={zone.id}
          label="Zone name"
          initialValue={zone.name}
          submitLabel="Save"
          onSubmit={(name) => {
            if (name !== zone.name) actions.updateZone(zone.id, { name });
            setZoneId(null);
          }}
          onCancel={() => setZoneId(null)}
        />
      </div>
    </div>
  );
}

const CHIP_SLOT: React.CSSProperties = {
  position: 'absolute',
  top: 104,
  left: '50%',
  transform: 'translateX(-50%)',
  zIndex: 31,
  maxWidth: 'calc(100vw - 32px)',
};

const CHIP_BODY: React.CSSProperties = {
  padding: '6px 8px 6px 12px',
  display: 'inline-flex',
  flexWrap: 'wrap',
  alignItems: 'center',
  gap: 8,
  borderRadius: 999,
  fontFamily: 'var(--pc-font-display)',
  fontWeight: 600,
  fontSize: 11,
};
