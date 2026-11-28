import { afterEach, describe, expect, it } from 'vitest';
import {
  closeWhatsNew,
  offerWhatsNew,
  openWhatsNew,
  resetWhatsNewForTests,
  whatsNewMounts,
  whatsNewSeenBefore,
  whatsNewState,
  type WhatsNewScene,
} from '../hooks/use-whats-new';
import { whatsNewIsNews } from './app-version';
import { readWhatsNew } from './whats-new';

// What's new (#931): the stamped lines and when they are news.

describe('readWhatsNew', () => {
  it('reads the stamped content, five lines at most', () => {
    const raw = JSON.stringify({ version: '1.38.0', items: ['a', 'b', 'c', 'd', 'e', 'f'] });
    expect(readWhatsNew(raw)).toEqual({ version: '1.38.0', items: ['a', 'b', 'c', 'd', 'e'] });
  });

  it('reads anything else as no content', () => {
    expect(readWhatsNew(undefined)).toBeNull();
    expect(readWhatsNew('')).toBeNull();
    expect(readWhatsNew('null')).toBeNull();
    expect(readWhatsNew('{not json')).toBeNull();
    expect(readWhatsNew(JSON.stringify({ version: 1, items: ['a'] }))).toBeNull();
    expect(readWhatsNew(JSON.stringify({ version: '1.0.0', items: [3, ' '] }))).toBeNull();
    expect(readWhatsNew(JSON.stringify({ version: '1.0.0', items: ['ok', 3] }))).toEqual({ version: '1.0.0', items: ['ok'] });
  });
});

describe('whatsNewIsNews', () => {
  it('is news after an update to the release it describes', () => {
    expect(whatsNewIsNews('1.38.0', false, '1.37.0')).toBe(true);
    // No stamp: a browser from before the stamp existed (it held a house).
    expect(whatsNewIsNews('1.38.0', false, null)).toBe(true);
  });

  it('is not news when that release was already seen, as after a fix-only release', () => {
    expect(whatsNewIsNews('1.38.0', false, '1.38.0')).toBe(false);
    expect(whatsNewIsNews('1.38.0', false, '1.39.0')).toBe(false);
  });

  it('always shows from Help, and never without content', () => {
    expect(whatsNewIsNews('1.38.0', true, '1.38.0')).toBe(true);
    expect(whatsNewIsNews(null, true, null)).toBe(false);
  });
});

describe('the What’s new session', () => {
  afterEach(resetWhatsNewForTests);

  it('is offered once per page load and remembers the version seen before', () => {
    expect(whatsNewState()).toBe('closed');
    offerWhatsNew('1.37.0');
    expect(whatsNewState()).toBe('update');
    expect(whatsNewSeenBefore()).toBe('1.37.0');
    closeWhatsNew();
    // Closed for the page: a second offer (an effect re-run) does nothing.
    offerWhatsNew('1.36.0');
    expect(whatsNewState()).toBe('closed');
    expect(whatsNewSeenBefore()).toBe('1.37.0');
    openWhatsNew();
    expect(whatsNewState()).toBe('asked');
  });
});

describe('whatsNewMounts', () => {
  const scene: WhatsNewScene = { state: 'update', tourPhase: 'none', ready: true, exploring: false, photo: false };

  it('mounts in an ordinary session once the editor is up', () => {
    expect(whatsNewMounts(scene)).toBe(true);
    expect(whatsNewMounts({ ...scene, state: 'closed' })).toBe(false);
    expect(whatsNewMounts({ ...scene, ready: false })).toBe(false);
  });

  it('waits out EXPLORE and photo mode', () => {
    expect(whatsNewMounts({ ...scene, exploring: true })).toBe(false);
    expect(whatsNewMounts({ ...scene, photo: true })).toBe(false);
  });

  it('never in a tour; over a kept house only when Help asked', () => {
    expect(whatsNewMounts({ ...scene, tourPhase: 'touring' })).toBe(false);
    expect(whatsNewMounts({ ...scene, tourPhase: 'touring', state: 'asked' })).toBe(false);
    expect(whatsNewMounts({ ...scene, tourPhase: 'kept' })).toBe(false);
    expect(whatsNewMounts({ ...scene, tourPhase: 'kept', state: 'asked' })).toBe(true);
  });
});
