'use client';

import { useEffect, useState } from 'react';
import { useRoomEditor } from '../contexts';
import { subscribeZoneNameRequests } from '../lib/editor-notices';
import { Icon } from '../plotcraft/icon';
import { ChipNameField } from './chip-controls';

/**
 * Names a zone just drawn on the 2D plan (#374). The plan adds the zone under
 * its default name and asks here, so drawing never stops on a blocking
 * prompt: Enter renames it, Escape keeps the default. The chip goes away by
 * itself when the zone does (undo, floor switch).
 */
export function ZoneNameChip(): JSX.Element | null {
  const { activeFloor, actions } = useRoomEditor();
  const [zoneId, setZoneId] = useState<string | null>(null);

  useEffect(() => subscribeZoneNameRequests(setZoneId), []);

  const zone = zoneId ? activeFloor.zones?.find((entry) => entry.id === zoneId) : undefined;
  if (!zoneId || !zone) return null;

  return (
    <div
      className="pc-top-chip"
      style={{
        position: 'absolute',
        top: 104,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 31,
        maxWidth: 'calc(100vw - 32px)',
      }}
    >
      <div
        className="pc-glass pc-glass--dark"
        style={{
          padding: '6px 8px 6px 12px',
          display: 'inline-flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          gap: 8,
          borderRadius: 999,
          fontFamily: 'var(--pc-font-display)',
          fontWeight: 600,
          fontSize: 11,
          color: 'var(--pc-cyan-glow)',
        }}
      >
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
