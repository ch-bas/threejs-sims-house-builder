// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EditorViewProvider } from '../contexts/editor-view-context';
import { RoomEditorProvider, type RoomEditorContextValue } from '../contexts/room-editor-context';
import { SelectionProvider, type SelectionContextValue } from '../contexts/selection-context';
import { createEditorViewStore } from '../hooks/editor-view-store';
import { makeLayout, makeViewSettings } from '../lib/__testfixtures__/fixtures';
import { ACHIEVEMENTS } from '../lib/achievements';
import { challengeAchievementId, challengeById, challengeLayout } from '../lib/challenges';
import { AchievementToast } from './achievement-toast';
import { ChallengeChip } from './challenge-chip';
import { TemplatesPanel } from './templates-panel';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

beforeEach(() => {
  window.matchMedia = ((query: string) => ({
    media: query,
    matches: false,
    addEventListener: () => {},
    removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia;
});

afterEach(cleanup);

const STARTER = challengeAchievementId('starter-home');

describe('challenge completion rewards (#909)', () => {
  it('the toast says a brief was completed, not an achievement', () => {
    const starter = ACHIEVEMENTS.find((a) => a.id === STARTER)!;
    render(<AchievementToast pending={[starter]} onDismiss={vi.fn()} />);
    expect(screen.getByText('Challenge Complete')).toBeTruthy();
    expect(screen.queryByText('Achievement Unlocked')).toBeNull();
    expect(screen.getByText('Starter home')).toBeTruthy();
    cleanup();
    const plain = ACHIEVEMENTS.find((a) => a.id === 'first-steps')!;
    render(<AchievementToast pending={[plain]} onDismiss={vi.fn()} />);
    expect(screen.getByText('Achievement Unlocked')).toBeTruthy();
  });

  it('the templates panel marks the briefs completed once', () => {
    const layout = makeLayout();
    const editor = { layout, activeFloor: layout.floors[0], activeFloorIndex: 0, actions: {}, history: {}, isReady: true, playCue: vi.fn() } as unknown as RoomEditorContextValue;
    const selection = { selectOnly: vi.fn() } as unknown as SelectionContextValue;
    const store = createEditorViewStore(makeViewSettings());
    store.getState().actions.setGameMode('build');
    render(
      <EditorViewProvider store={store}>
        <RoomEditorProvider value={editor}>
          <SelectionProvider value={selection}>
            <TemplatesPanel onLoadTemplate={vi.fn(() => Promise.resolve(true))} unlocked={new Set([STARTER])} />
          </SelectionProvider>
        </RoomEditorProvider>
      </EditorViewProvider>
    );
    const brief = (name: string) => screen.getByRole('button', { name: new RegExp(`^${name}`) });
    expect(brief('Starter home').textContent).toContain('Done');
    // The badge stands apart from the word.
    expect(brief('Starter home').querySelector('[aria-hidden="true"]')?.className).toContain('mr-1');
    expect(brief('Starter home').textContent).toContain('🔑 Done');
    expect(brief('Show home').textContent).not.toContain('Done');
  });

  it('the checklist says when the house is outside the brief\'s terms', () => {
    const lot = challengeLayout(challengeById('starter-home')!, 0);
    const chip = (layout: typeof lot) => {
      const editor = { layout, activeFloorIndex: 0, collidingIds: new Set<string>() } as unknown as RoomEditorContextValue;
      return render(
        <EditorViewProvider store={createEditorViewStore(makeViewSettings())}>
          <RoomEditorProvider value={editor}>
            <ChallengeChip />
          </RoomEditorProvider>
        </EditorViewProvider>
      );
    };
    chip(lot);
    expect(screen.queryByText(/Outside the brief/)).toBeNull();
    cleanup();
    chip({ ...lot, budget: { writeOff: 0, amount: 20_000 } });
    expect(screen.getByText(/Outside the brief's terms: funds raised over/)).toBeTruthy();
  });
});
