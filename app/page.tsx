'use client';

import dynamic from 'next/dynamic';

const RoomOrganizer = dynamic(
  () => import('@/components/room-organizer').then((module) => module.RoomOrganizer),
  {
    ssr: false,
    loading: () => (
      <div
        className="pc-world"
        style={{
          position: 'fixed',
          inset: 0,
          display: 'grid',
          placeItems: 'center',
        }}
      >
        <div
          className="pc-glass pc-glass--dark"
          style={{ padding: '18px 28px', textAlign: 'center' }}
        >
          <p
            style={{
              margin: 0,
              fontFamily: 'var(--pc-font-display)',
              fontWeight: 700,
              color: 'var(--pc-paper)',
              letterSpacing: 'var(--pc-tr-caps)',
              textTransform: 'uppercase',
              fontSize: 14,
            }}
          >
            Loading the lot…
          </p>
        </div>
      </div>
    ),
  }
);

export default function Page(): JSX.Element {
  return <RoomOrganizer />;
}
