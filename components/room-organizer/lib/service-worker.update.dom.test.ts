// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import {
  applyUpdate,
  askIsMine,
  IS_MINE_MS,
  resetUpdateOffer,
  subscribeUpdateReady,
  UPDATE_CHECK_MS,
  UPDATE_SETTLE_MS,
  updateKind,
  watchForUpdate,
  type SaveFlush,
} from './service-worker';

// The update prompt's side of the worker (#933, second step).

/** A turn of the event loop: message ports deliver there. */
const turn = () => new Promise<void>((resolve) => setImmediate(resolve));

interface FakeWorker {
  postMessage: Mock<(message: unknown, transfer?: Transferable[]) => void>;
  state: string;
  listeners: (() => void)[];
  addEventListener(type: 'statechange', listener: () => void): void;
}

/** A worker that says whether the page is of its build (`mine`), or never answers (null). */
function worker(mine: boolean | null = false, state = 'installing'): FakeWorker {
  const w: FakeWorker = {
    postMessage: vi.fn((message: unknown, transfer?: Transferable[]): void => {
      const port = transfer?.[0];
      if (mine !== null && port instanceof MessagePort && (message as { type?: string }).type === 'is-mine') port.postMessage(mine);
    }),
    state,
    listeners: [],
    addEventListener: (_type, listener) => {
      w.listeners.push(listener);
    },
  };
  return w;
}

function fakeRegistration(waiting: FakeWorker | null = null) {
  const found: (() => void)[] = [];
  return {
    waiting,
    installing: null as FakeWorker | null,
    update: vi.fn(() => Promise.resolve()),
    addEventListener: (_type: 'updatefound', listener: () => void) => {
      found.push(listener);
    },
    /** A newer worker installs and waits. */
    install(next: FakeWorker) {
      this.installing = next;
      for (const listener of found) listener();
      this.installing = null;
      this.waiting = next;
      next.state = 'installed';
      for (const listener of next.listeners) listener();
    },
  };
}

function fakeContainer() {
  const changes: (() => void)[] = [];
  const container: {
    controller: FakeWorker | null;
    register(): Promise<unknown>;
    getRegistrations(): Promise<never[]>;
    addEventListener(type: 'controllerchange', listener: () => void): void;
    change(next?: FakeWorker | null): void;
  } = {
    controller: null,
    register: () => Promise.resolve({}),
    getRegistrations: () => Promise.resolve([]),
    addEventListener: (_type: 'controllerchange', listener: () => void) => {
      changes.push(listener);
    },
    /** `next` took over. */
    change: (next: FakeWorker | null = container.controller): void => {
      container.controller = next;
      for (const listener of [...changes]) listener();
    },
  };
  return container;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
  resetUpdateOffer();
  const script = document.createElement('script');
  script.src = 'https://example.org/site/_next/static/chunks/webpack-old.js';
  document.head.append(script);
});

afterEach(() => {
  document.head.replaceChildren();
  vi.useRealTimers();
});

async function settle(): Promise<void> {
  vi.advanceTimersByTime(UPDATE_SETTLE_MS);
  await turn();
  await turn();
}

describe('askIsMine', () => {
  it('asks with this page\'s runtime, and can\'t tell without one or without an answer', async () => {
    const mine = worker(true);
    await expect(askIsMine(mine, '_next/static/chunks/webpack-old.js')).resolves.toBe(true);
    expect(mine.postMessage).toHaveBeenCalledWith({ type: 'is-mine', marker: '_next/static/chunks/webpack-old.js' }, [expect.anything()]);
    await expect(askIsMine(worker(false), 'm')).resolves.toBe(false);
    await expect(askIsMine(worker(true), null)).resolves.toBeNull();
    const silent = askIsMine(worker(null), 'm');
    vi.advanceTimersByTime(IS_MINE_MS);
    await expect(silent).resolves.toBeNull();
  });
});

describe('watchForUpdate', () => {
  it('offers a newer worker still waiting a moment later to a page of the older build', async () => {
    const reg = fakeRegistration();
    const told = vi.fn();
    const off = subscribeUpdateReady(told);
    watchForUpdate(reg, fakeContainer());
    reg.install(worker(false));
    expect(updateKind()).toBeNull();
    await settle();
    expect(updateKind()).toBe('newer');
    expect(told).toHaveBeenCalledTimes(1);
    off();
  });

  it('offers nothing to a page already of the waiting worker\'s build', async () => {
    const reg = fakeRegistration();
    watchForUpdate(reg, fakeContainer());
    reg.install(worker(true));
    await settle();
    expect(updateKind()).toBeNull();
  });

  it('offers nothing when the newer worker took over at once (the only tab, a page of its build)', async () => {
    const reg = fakeRegistration();
    watchForUpdate(reg, fakeContainer());
    reg.install(worker(false));
    reg.waiting = null;
    await settle();
    expect(updateKind()).toBeNull();
  });

  it('offers a worker already waiting when the page registers', async () => {
    const reg = fakeRegistration(worker(false, 'installed'));
    watchForUpdate(reg, fakeContainer());
    await settle();
    expect(updateKind()).toBe('newer');
  });

  it('tells an older tab it is behind once another tab\'s update takes it over, and not a tab of the new build', async () => {
    const container = fakeContainer();
    watchForUpdate(fakeRegistration(), container);
    container.change(worker(false));
    await turn();
    await turn();
    expect(updateKind()).toBe('stale');

    resetUpdateOffer();
    container.change(worker(true));
    await turn();
    await turn();
    expect(updateKind()).toBeNull();
  });

  it('tells a page that opened under a newer worker it is behind, once no newer worker turns up', async () => {
    const container = fakeContainer();
    container.controller = worker(false);
    const reg = fakeRegistration();
    watchForUpdate(reg, container);
    await turn();
    await turn();
    expect(reg.update).toHaveBeenCalled();
    expect(updateKind()).toBe('stale');
  });

  it('never calls a page of a new deploy stale while its own worker installs, nor a page of the worker in charge', async () => {
    const container = fakeContainer();
    container.controller = worker(false);
    const reg = fakeRegistration();
    reg.update.mockImplementation(() => {
      reg.installing = worker(true);
      return Promise.resolve();
    });
    watchForUpdate(reg, container);
    await turn();
    await turn();
    expect(updateKind()).toBeNull();

    resetUpdateOffer();
    const current = fakeContainer();
    current.controller = worker(true);
    const same = fakeRegistration();
    watchForUpdate(same, current);
    await turn();
    await turn();
    expect(same.update).not.toHaveBeenCalled();
    expect(updateKind()).toBeNull();
  });

  it('looks for a newer build when the tab comes back, at most hourly', () => {
    let now = 0;
    const reg = fakeRegistration();
    watchForUpdate(reg, fakeContainer(), () => now);
    const visible = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    document.dispatchEvent(new Event('visibilitychange'));
    expect(reg.update).not.toHaveBeenCalled();
    now = UPDATE_CHECK_MS;
    document.dispatchEvent(new Event('visibilitychange'));
    document.dispatchEvent(new Event('visibilitychange'));
    expect(reg.update).toHaveBeenCalledTimes(1);
    visible.mockRestore();
  });
});

describe('applyUpdate', () => {
  async function offered() {
    const reg = fakeRegistration(worker(false, 'installed'));
    const container = fakeContainer();
    watchForUpdate(reg, container);
    await settle();
    return { reg, container, waiting: reg.waiting as FakeWorker };
  }
  const saved = (): SaveFlush => 'saved';

  it('saves first, asks the waiting worker to take over, and reloads once it is in charge, once', async () => {
    const { container, waiting } = await offered();
    const order: string[] = [];
    const flushSave = vi.fn((): SaveFlush => {
      order.push('save');
      return 'saved';
    });
    waiting.postMessage.mockImplementation((message: unknown) => typeof message === 'string' && order.push(message));
    const reload = vi.fn(() => order.push('reload'));
    const outcome = applyUpdate({ flushSave, reload, container });
    expect(reload).not.toHaveBeenCalled();
    container.change(waiting);
    container.change(waiting);
    await expect(outcome).resolves.toBe('reloading');
    expect(order).toEqual(['save', 'skip-waiting', 'reload']);
    // A second click while the page reloads does nothing more.
    await expect(applyUpdate({ flushSave, reload, container })).resolves.toBe('reloading');
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('never reloads over a change it could not save, and says when a newer version\'s save refused it', async () => {
    const { container, waiting } = await offered();
    const reload = vi.fn();
    await expect(applyUpdate({ flushSave: () => 'failed', reload, container })).resolves.toBe('not-saved');
    await expect(applyUpdate({ flushSave: () => 'newer', reload, container })).resolves.toBe('newer-saved');
    expect(waiting.postMessage).not.toHaveBeenCalledWith('skip-waiting');
    expect(reload).not.toHaveBeenCalled();
    expect(updateKind()).toBe('newer');
  });

  it('reloads at once when another tab already put the newer worker in charge', async () => {
    const { container, waiting } = await offered();
    container.change(worker(false));
    await turn();
    await turn();
    expect(updateKind()).toBe('stale');
    const reload = vi.fn();
    await expect(applyUpdate({ flushSave: saved, reload, container })).resolves.toBe('reloading');
    expect(waiting.postMessage).not.toHaveBeenCalledWith('skip-waiting');
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('says so when the worker never takes over, and does not reload', async () => {
    const { container } = await offered();
    const reload = vi.fn();
    const outcome = applyUpdate({ flushSave: saved, reload, container, timeoutMs: 1000 });
    vi.advanceTimersByTime(1000);
    await expect(outcome).resolves.toBe('stuck');
    expect(reload).not.toHaveBeenCalled();
  });

  it('does nothing without an offer', async () => {
    const flushSave = vi.fn(saved);
    await expect(applyUpdate({ flushSave, reload: vi.fn(), container: fakeContainer() })).resolves.toBe('gone');
    expect(flushSave).not.toHaveBeenCalled();
  });
});
