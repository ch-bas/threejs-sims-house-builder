// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { subscribeNotices, type Notice } from '../lib/editor-notices';
import { resetUpdateOffer, UPDATE_SETTLE_MS, watchForUpdate, type SaveFlush } from '../lib/service-worker';
import {
  MAX_OFFERS,
  REOFFER_MS,
  UPDATE_MESSAGES,
  UPDATE_NEWER_SAVED,
  UPDATE_NOT_NOW,
  UPDATE_NOT_SAVED,
  useUpdatePrompt,
  type UseUpdatePromptOptions,
} from './use-update-prompt';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// The update prompt (#933): offered only in a calm moment; Reload saves first.

let notices: Notice[] = [];
let unsubscribe: () => void = () => undefined;
// A newer build's worker: this page is not of its build.
const waiting = {
  state: 'installed',
  postMessage: vi.fn((message: unknown, transfer?: Transferable[]) => {
    const port = transfer?.[0];
    if (port instanceof MessagePort && (message as { type?: string }).type === 'is-mine') port.postMessage(false);
  }),
};
const turn = () => new Promise<void>((resolve) => setImmediate(resolve));

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
  resetUpdateOffer();
  notices = [];
  unsubscribe = subscribeNotices((notice) => notices.push(notice));
  waiting.postMessage.mockClear();
  Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: { addEventListener: vi.fn() } });
  const script = document.createElement('script');
  script.src = 'https://example.org/site/_next/static/chunks/webpack-old.js';
  document.head.append(script);
});

afterEach(() => {
  cleanup();
  unsubscribe();
  document.head.replaceChildren();
  document.body.replaceChildren();
  vi.useRealTimers();
});

async function newerBuildWaits(): Promise<void> {
  watchForUpdate({ waiting }, { register: () => Promise.resolve({}), getRegistrations: () => Promise.resolve([]) });
  act(() => {
    vi.advanceTimersByTime(UPDATE_SETTLE_MS);
  });
  await act(async () => {
    await turn();
    await turn();
  });
}

const tick = (ms = 2_000) =>
  act(() => {
    vi.advanceTimersByTime(ms);
  });

const offers = (): Notice[] => notices.filter((notice) => notice.message === UPDATE_MESSAGES.newer);

function prompt(overrides: Partial<UseUpdatePromptOptions> = {}) {
  return renderHook((props: Partial<UseUpdatePromptOptions>) =>
    useUpdatePrompt({ calm: true, isHoldActive: () => false, flushSave: (): SaveFlush => 'saved', playCue: vi.fn(), ...overrides, ...props })
  );
}

it('offers the update, and not before a newer build waits', async () => {
  prompt();
  expect(offers()).toHaveLength(0);
  await newerBuildWaits();
  tick(10_000);
  expect(offers()).toHaveLength(1);
  expect(offers()[0]?.action?.label).toBe('Reload');
});

it('offers again in a tab in view after a while, a few times at most', async () => {
  prompt();
  await newerBuildWaits();
  expect(offers()).toHaveLength(1);
  tick(REOFFER_MS - 2_000);
  expect(offers()).toHaveLength(1);
  for (let i = 0; i < 5; i += 1) tick(REOFFER_MS);
  expect(offers()).toHaveLength(MAX_OFFERS);
});

it('waits for a calm moment: EXPLORE, photo, the walk, a ghost, a wall draft, drawing', async () => {
  const { rerender } = prompt({ calm: false });
  await newerBuildWaits();
  expect(offers()).toHaveLength(0);
  rerender({ calm: true });
  expect(offers()).toHaveLength(1);
});

it('waits for a drag to end, and for a text field to lose focus', async () => {
  let holding = true;
  prompt({ isHoldActive: () => holding });
  const field = document.createElement('input');
  document.body.append(field);
  field.focus();
  await newerBuildWaits();
  expect(offers()).toHaveLength(0);
  holding = false;
  tick();
  expect(offers()).toHaveLength(0);
  field.blur();
  tick();
  expect(offers()).toHaveLength(1);
});

it('waits for a modal dialog (the start chooser) to close, but not for the side drawer', async () => {
  const chooser = document.createElement('div');
  chooser.setAttribute('role', 'dialog');
  chooser.setAttribute('aria-modal', 'true');
  const drawer = document.createElement('aside');
  drawer.setAttribute('role', 'dialog');
  drawer.setAttribute('aria-modal', 'true');
  document.body.append(chooser, drawer);
  prompt();
  await newerBuildWaits();
  expect(offers()).toHaveLength(0);
  chooser.remove();
  tick();
  expect(offers()).toHaveLength(1);
});

it('refuses on Reload while a drag is under way, when the change could not be saved, and names a newer save', async () => {
  let holding = false;
  let flushed: SaveFlush = 'failed';
  const playCue = vi.fn();
  prompt({ isHoldActive: () => holding, flushSave: () => flushed, playCue });
  await newerBuildWaits();
  const action = offers()[0]?.action;
  if (!action?.keepOpen) throw new Error('expected a keep-open Reload');
  holding = true;
  await expect(action.run()).resolves.toBe(false);
  expect(notices.at(-1)?.message).toBe(UPDATE_NOT_NOW);
  holding = false;
  await expect(action.run()).resolves.toBe(false);
  expect(notices.at(-1)?.message).toBe(UPDATE_NOT_SAVED);
  flushed = 'newer';
  await expect(action.run()).resolves.toBe(false);
  expect(notices.at(-1)?.message).toBe(UPDATE_NEWER_SAVED);
  expect(playCue).toHaveBeenCalledTimes(3);
  expect(waiting.postMessage).not.toHaveBeenCalledWith('skip-waiting');
});
