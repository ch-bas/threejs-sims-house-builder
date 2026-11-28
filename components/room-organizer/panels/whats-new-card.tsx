'use client';

import { useEffect, useRef, useState } from 'react';
import { useMediaQuery } from '../hooks/use-media-query';
import { closeWhatsNew, useWhatsNewState, whatsNewSeenBefore, whatsNewShown } from '../hooks/use-whats-new';
import { whatsNewIsNews } from '../lib/app-version';
import { COMPACT_DOCK_QUERY } from '../lib/hud-layout';
import { HudCard, focusModePanel } from './hud-card';
import type { WhatsNew } from '../lib/whats-new';

let loading: Promise<WhatsNew | null> | null = null;

/**
 * The lines, stamped in at build time from CHANGELOG.md, are in a chunk of
 * their own (`lib/whats-new`, which imports nothing, so the editor's bundle
 * keeps its shape): loaded from this build's files when the card first
 * opens, never fetched from anywhere else.
 */
function loadWhatsNew(): Promise<WhatsNew | null> {
  loading ??= import('../lib/whats-new').then(
    (module) => module.WHATS_NEW,
    () => {
      loading = null;
      return null;
    }
  );
  return loading;
}

/**
 * What's new (#931): up to five lines about the release, once after an
 * update (or from Help), in the Getting started card's place and frame. The
 * editor mounts it only outside a tour, EXPLORE and photo mode
 * (`whatsNewMounts`), so it waits them out.
 */
export function WhatsNewCard(): JSX.Element | null {
  const state = useWhatsNewState();
  const cardRef = useRef<HTMLElement>(null);
  // undefined while the lines load.
  const [content, setContent] = useState<WhatsNew | null | undefined>(undefined);

  useEffect(() => {
    let live = true;
    void loadWhatsNew().then((loaded) => {
      if (live) setContent(loaded);
    });
    return () => {
      live = false;
    };
  }, []);

  const news = whatsNewIsNews(content?.version ?? null, state === 'asked', whatsNewSeenBefore());

  // Nothing to tell (a fix-only release, a build without lines): close quietly.
  useEffect(() => {
    if (content !== undefined && !news) closeWhatsNew();
  }, [content, news]);

  const visible = content !== undefined && content !== null && news && state !== 'closed';
  // Seen once it is on screen: the next load won't offer it again.
  useEffect(() => {
    if (visible) whatsNewShown();
  }, [visible]);

  // A phone: a sheet over the dock, capped and scrolling inside (#931).
  const compact = useMediaQuery(COMPACT_DOCK_QUERY);

  if (!content || !visible) return null;

  const dismiss = (): void => {
    const card = cardRef.current;
    const active = document.activeElement;
    const hadFocus = card !== null && active instanceof Node && card.contains(active);
    closeWhatsNew();
    if (hadFocus) focusModePanel();
  };

  return (
    <HudCard
      ref={cardRef}
      {...(compact ? { className: 'pc-whats-new--compact' } : {})}
      titleId="pc-whats-new-title" title="What’s new" aside={`Version ${content.version}`} label="Dismiss what’s new" onClick={dismiss}>
      <ul className="pc-first-steps__tips" style={{ margin: 0, paddingLeft: 16, listStyle: 'disc' }}>
        {content.items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
      {state === 'update' && (
        <p className="pc-blurb" style={{ fontSize: 11, margin: '8px 0 0' }}>
          View options → Help brings this back.
        </p>
      )}
    </HudCard>
  );
}
