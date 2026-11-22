// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EditorViewProvider } from '../contexts/editor-view-context';
import { createEditorViewStore } from '../hooks/editor-view-store';
import { BACK_LAYER } from '../hooks/use-back-dismiss';
import { makeViewSettings } from '../lib/__testfixtures__/fixtures';
import { type WalkerCardSnapshot, createWalkerCards } from '../lib/walker-card';
import { walkerName } from '../lib/walker-card-text';
import { WALKER_CARD_BACK_LAYER, WalkerCard } from './walker-card';

afterEach(cleanup);

const snapshot: WalkerCardSnapshot = {
  id: 4,
  seed: 3,
  doing: { asleep: false, seated: false, seeking: 'hunger', using: null },
  needs: { hunger: 0.123, energy: 0.6, fun: 1, hygiene: 0.5 },
  wants: 'hunger',
};
const NAME = walkerName(3);

function setup(walking = false) {
  const cards = createWalkerCards();
  const store = createEditorViewStore(makeViewSettings({ walkthroughMode: walking }));
  render(
    <EditorViewProvider store={store}>
      <WalkerCard cards={cards} />
    </EditorViewProvider>
  );
  return cards;
}

function open(cards: ReturnType<typeof createWalkerCards>): void {
  act(() => {
    cards.select(4, { x: 300, y: 300 });
    cards.publish(snapshot);
  });
}

const card = () => screen.queryByRole('region', { name: `${NAME}, a walker` });

describe('the walker card (#906)', () => {
  it('shows nothing until the walk fills it, then the name, the line, a bar per need and what is missing', () => {
    const cards = setup();
    act(() => cards.select(4, { x: 300, y: 300 }));
    expect(card()).toBeNull();
    act(() => cards.publish(snapshot));
    expect(card()).not.toBeNull();
    expect(screen.getByText('Off to eat')).toBeTruthy();
    const meters = screen.getAllByRole('meter');
    expect(meters.map((meter) => [meter.getAttribute('aria-label'), meter.getAttribute('aria-valuenow')])).toEqual([
      ['Food', '12'],
      ['Energy', '60'],
      ['Fun', '100'],
      ['Hygiene', '50'],
    ]);
    expect(screen.getByText('Hungry, and can’t find food')).toBeTruthy();
  });

  it('closes with its button', () => {
    const cards = setup();
    open(cards);
    fireEvent.click(screen.getByRole('button', { name: `Close ${NAME}’s card` }));
    expect(cards.selected()).toBeNull();
    expect(card()).toBeNull();
  });

  it('Escape closes the card and nothing else: one step per press, held repeats swallowed', () => {
    const cards = setup();
    open(cards);
    // The editor's own Escape (deselect, end a placement) listens on the window, bubbling.
    const editor = vi.fn();
    window.addEventListener('keydown', editor);
    fireEvent.keyDown(document.body, { key: 'Escape', repeat: true });
    expect(cards.selected()).toBe(4);
    expect(editor).not.toHaveBeenCalled();
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(cards.selected()).toBeNull();
    expect(editor).not.toHaveBeenCalled();
    // Closed: the next Escape is the editor's again.
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(editor).toHaveBeenCalledTimes(1);
    window.removeEventListener('keydown', editor);
  });

  it('leaves Escape to a modal over it (the drawer, a confirm), as back does', () => {
    const cards = setup();
    open(cards);
    const modal = document.createElement('div');
    modal.setAttribute('aria-modal', 'true');
    modal.getClientRects = () => [new DOMRect(0, 0, 10, 10)] as unknown as DOMRectList;
    document.body.appendChild(modal);
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(cards.selected()).toBe(4);
    modal.remove();
    expect(WALKER_CARD_BACK_LAYER).toBeGreaterThan(BACK_LAYER.itemSheet);
    expect(WALKER_CARD_BACK_LAYER).toBeLessThan(BACK_LAYER.drawer);
  });

  it('stays out of a walk', () => {
    const cards = setup(true);
    open(cards);
    expect(card()).toBeNull();
  });
});
