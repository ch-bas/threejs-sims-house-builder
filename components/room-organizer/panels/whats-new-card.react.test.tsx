// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { EditorViewProvider } from '../contexts/editor-view-context';
import { RoomEditorProvider, type RoomEditorContextValue } from '../contexts/room-editor-context';
import { createEditorViewStore } from '../hooks/editor-view-store';
import { offerFirstSteps, resetFirstStepsForTests } from '../hooks/use-first-steps';
import { offerWhatsNew, openWhatsNew, resetWhatsNewForTests, whatsNewState } from '../hooks/use-whats-new';
import { makeLayout, makeViewSettings } from '../lib/__testfixtures__/fixtures';
import { SEEN_VERSION_STORAGE_KEY, resetVersionSessionForTests } from '../lib/app-version';
import { COMPACT_DOCK_QUERY } from '../lib/hud-layout';
import { FirstStepsCard } from './first-steps-card';
import { WhatsNewCard } from './whats-new-card';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// What's new (#931): the card that shares Getting started's place and frame.

vi.mock('../contexts', async (original) => ({
  ...(await original<typeof import('../contexts')>()),
  useSelection: () => ({ selectOnly: vi.fn() }),
}));

// The build stamps the lines in; lib/whats-new reads them once, when the card first loads it.
beforeAll(async () => {
  vi.stubEnv('NEXT_PUBLIC_WHATS_NEW', JSON.stringify({ version: '1.38.0', items: ['Measure on the plan', 'Garden surfaces'] }));
  await import('../lib/whats-new');
  vi.unstubAllEnvs();
});

let phone = false;

beforeEach(() => {
  window.localStorage.clear();
  resetFirstStepsForTests();
  resetWhatsNewForTests();
  resetVersionSessionForTests();
  phone = false;
  window.matchMedia = ((query: string) => ({
    media: query,
    matches: phone && query === COMPACT_DOCK_QUERY,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  })) as unknown as typeof window.matchMedia;
});
afterEach(() => cleanup());

function setup() {
  const editor = { layout: makeLayout({ id: 'house-test' }), isReady: true, error: null } as unknown as RoomEditorContextValue;
  const store = createEditorViewStore(makeViewSettings());
  render(
    <EditorViewProvider store={store}>
      <RoomEditorProvider value={editor}>
        <div className="pc-mode-panel">
          <button type="button" aria-pressed="true">
            Design
          </button>
        </div>
        <FirstStepsCard placeCatalogItem={vi.fn(() => '')} onShareLink={() => Promise.resolve()} onSelectedWallChange={vi.fn()} />
        <WhatsNewCard />
      </RoomEditorProvider>
    </EditorViewProvider>
  );
}

describe('WhatsNewCard', () => {
  it('shows the release’s lines after an update, in Getting started’s place', async () => {
    act(() => {
      offerFirstSteps();
      offerWhatsNew('1.37.0');
    });
    setup();
    const card = await screen.findByRole('region', { name: 'What’s new' });
    expect(card.hasAttribute('data-scene-occluder')).toBe(true);
    expect(screen.getByText('Measure on the plan')).toBeTruthy();
    expect(screen.getByText('Version 1.38.0')).toBeTruthy();
    expect(screen.queryByRole('region', { name: 'Getting started' })).toBeNull();
    const close = screen.getByRole('button', { name: 'Dismiss what’s new' });
    close.focus();
    fireEvent.click(close);
    expect(whatsNewState()).toBe('closed');
    expect(screen.queryByRole('region', { name: 'What’s new' })).toBeNull();
    // Getting started comes back, and the keyboard goes to the mode panel.
    expect(screen.getByRole('region', { name: 'Getting started' })).toBeTruthy();
    expect(document.activeElement?.textContent).toBe('Design');
  });

  it('closes quietly when that release was already seen', async () => {
    act(() => offerWhatsNew('1.38.0'));
    setup();
    await vi.waitFor(() => expect(whatsNewState()).toBe('closed'));
    expect(screen.queryByRole('region', { name: 'What’s new' })).toBeNull();
  });

  it('shows from Help whatever was seen', async () => {
    act(() => {
      offerWhatsNew('1.38.0');
      openWhatsNew();
    });
    setup();
    expect(await screen.findByRole('region', { name: 'What’s new' })).toBeTruthy();
    // Asked for: no "Help brings this back" line.
    expect(screen.queryByText(/brings this back/)).toBeNull();
  });

  it('stamps the version only once the card is on screen (#931)', async () => {
    act(() => offerWhatsNew(null));
    // Offered but not mounted (EXPLORE all session, a failed load): nothing stamped.
    expect(window.localStorage.getItem(SEEN_VERSION_STORAGE_KEY)).toBeNull();
    setup();
    await screen.findByRole('region', { name: 'What’s new' });
    expect(window.localStorage.getItem(SEEN_VERSION_STORAGE_KEY)).toBe('0.0.0');
  });

  it('is a capped sheet on a phone', async () => {
    phone = true;
    act(() => openWhatsNew());
    setup();
    const card = await screen.findByRole('region', { name: 'What’s new' });
    expect(card.classList.contains('pc-whats-new--compact')).toBe(true);
  });
});
