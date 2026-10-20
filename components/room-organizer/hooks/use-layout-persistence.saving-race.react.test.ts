// @vitest-environment jsdom
import { cleanup, renderHook, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { flushSync } from 'react-dom';
import { afterEach, expect, it } from 'vitest';
import { makeLayout } from '../lib/__testfixtures__/fixtures';
import { STORAGE_KEY } from '../lib/constants';
import { useLayoutPersistence } from './use-layout-persistence';

// Real timers and no act(): the race needs React's own lane scheduling.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false;

const DEBOUNCE = 100;
const realSetTimeout = window.setTimeout.bind(window);
const sleep = (ms: number) => new Promise((resolve) => realSetTimeout(resolve, ms));

afterEach(() => {
  window.setTimeout = realSetTimeout as typeof window.setTimeout;
  cleanup();
});

// #480 follow-up: the save's setSaving(false) is queued at the default lane.
// An edit in the same task renders first at the sync lane; if the guard read
// `saving` from that render (still true) it skipped setSaving(true), the
// queued false then landed, and the HUD said "Saved" over an unsaved edit.
it('saving stays on for an edit made in the same task as the previous save', async () => {
  window.localStorage.clear();
  let afterSave: (() => void) | null = null;
  // Run `afterSave` right after the autosave debounce fires, in the same task.
  window.setTimeout = ((callback: () => void, ms?: number) =>
    realSetTimeout(() => {
      callback();
      if (ms === DEBOUNCE && afterSave) {
        const run = afterSave;
        afterSave = null;
        run();
      }
    }, ms)) as typeof window.setTimeout;

  const { result } = renderHook(() => {
    const [layout, setLayout] = useState(() => makeLayout({ name: 'A' }));
    return { setLayout, ...useLayoutPersistence({ layout, onHydrate: () => {}, debounceMs: DEBOUNCE }) };
  });
  await sleep(DEBOUNCE + 50);
  flushSync(() => result.current.setLayout(makeLayout({ name: 'AB' })));
  await waitFor(() => expect(result.current.saving).toBe(true));

  afterSave = () => flushSync(() => result.current.setLayout(makeLayout({ name: 'ABC' })));
  // The first save lands; sample before the second one's debounce runs out.
  await sleep(DEBOUNCE + 30);
  const stored = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? '{}') as { name?: string };
  expect({ storedName: stored.name, saving: result.current.saving }).toEqual({ storedName: 'AB', saving: true });
});
