// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeFloor, makeItem, makeLayout } from '../__testfixtures__/fixtures';
import { subscribeNotices, type Notice } from '../editor-notices';
import { printInPopup } from './print-popup';

// The print and blueprint buttons open the popup inside the click and load
// the code that fills it afterwards (#589).

interface FakePopup {
  html: string;
  closed: boolean;
  opener: unknown;
  window: Window;
}

function fakePopup(): FakePopup {
  const popup: FakePopup = { html: '', closed: false, opener: window, window: null as unknown as Window };
  popup.window = {
    document: {
      readyState: 'loading',
      write: (markup: string) => {
        popup.html += markup;
      },
      close: () => undefined,
    },
    addEventListener: () => undefined,
    setTimeout: () => 0,
    print: () => undefined,
    close: () => {
      popup.closed = true;
    },
    set opener(value: unknown) {
      popup.opener = value;
    },
    get opener() {
      return popup.opener;
    },
  } as unknown as Window;
  return popup;
}

/** Let the load and fill promises run. */
async function settle(): Promise<void> {
  for (let i = 0; i < 10; i++) await Promise.resolve();
  await vi.dynamicImportSettled();
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

describe('printInPopup (#589)', () => {
  let popup: FakePopup;
  let notices: Notice[];
  let stop: () => void;

  beforeEach(() => {
    popup = fakePopup();
    vi.spyOn(window, 'open').mockReturnValue(popup.window);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    notices = [];
    stop = subscribeNotices((notice) => notices.push(notice));
    vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/png;base64,STUB');
  });

  afterEach(() => {
    stop();
    vi.restoreAllMocks();
  });

  it('opens the popup inside the click, before the code has loaded', () => {
    printInPopup('the plan', () => new Promise(() => undefined));
    expect(window.open).toHaveBeenCalledOnce();
    expect(popup.opener).toBeNull();
  });

  it('says pop-ups are blocked and loads nothing when the popup is refused', () => {
    vi.mocked(window.open).mockReturnValue(null);
    const load = vi.fn(() => Promise.resolve(() => undefined));
    printInPopup('the plan', load);
    expect(load).not.toHaveBeenCalled();
    expect(notices.map((notice) => notice.message)).toEqual([expect.stringMatching(/Pop-ups are blocked/) as unknown]);
  });

  it('closes the popup and blames the connection when the code fails to load', async () => {
    printInPopup('the plan', () => Promise.reject(new Error('Loading chunk 24 failed.')));
    await settle();
    expect(popup.closed).toBe(true);
    expect(notices.map((notice) => [notice.tone, notice.message])).toEqual([
      ['error', expect.stringMatching(/Couldn’t load what printing the plan needs\. Check your connection/) as unknown],
    ]);
  });

  it('closes the popup and says the print failed when writing it throws', async () => {
    printInPopup('the plan', () =>
      Promise.resolve(() => {
        throw new Error('boom');
      })
    );
    await settle();
    expect(popup.closed).toBe(true);
    const messages = notices.map((notice) => notice.message);
    expect(messages).toEqual([expect.stringMatching(/Couldn’t print the plan\./) as unknown]);
    expect(messages[0]).not.toMatch(/connection/);
  });

  it('prints the plan through the lazily loaded print document', async () => {
    const floor = makeFloor({ items: [makeItem()] });
    const layout = makeLayout({ floors: [floor] });
    printInPopup('the plan', async () => {
      const { writePlanPrint } = await import('./print');
      return (printWindow) => writePlanPrint(printWindow, layout, floor, { paper: 'A3' });
    });
    await settle();
    expect(popup.closed).toBe(false);
    expect(popup.html).toContain('@page { size: A3 portrait;');
    expect(popup.html).toContain('<svg');
    expect(notices).toEqual([]);
  });

  it('prints the blueprint through the lazily loaded blueprint module', async () => {
    const floor = makeFloor({ items: [makeItem()] });
    const layout = makeLayout({ name: 'Cosy', floors: [floor] });
    printInPopup('the blueprint', async () => {
      const { writeBlueprint } = await import('../blueprint');
      return (printWindow) => writeBlueprint(printWindow, layout, floor);
    });
    await settle();
    await vi.waitFor(() => expect(popup.html).toContain('data:image/png;base64,STUB'));
    expect(popup.html).toContain('Cosy');
    expect(popup.closed).toBe(false);
    expect(notices).toEqual([]);
  });
});
