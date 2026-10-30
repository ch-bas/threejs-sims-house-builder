// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { notify } from '../lib/editor-notices';
import { AchievementToast } from './achievement-toast';
import { StatusToastHost } from './status-toast';
import type { Achievement } from '../lib/achievements';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// A matchMedia whose answer the test controls: "compact" matches every
// small-screen query the overlays ask about.
let compact = true;
const mediaListeners = new Set<() => void>();
function setCompact(next: boolean): void {
  compact = next;
  act(() => {
    for (const listener of [...mediaListeners]) listener();
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  compact = true;
  window.matchMedia = ((query: string) => ({
    media: query,
    get matches() {
      return compact;
    },
    addEventListener: (_: string, listener: () => void) => mediaListeners.add(listener),
    removeEventListener: (_: string, listener: () => void) => mediaListeners.delete(listener),
  })) as unknown as typeof window.matchMedia;
});

afterEach(() => {
  cleanup();
  mediaListeners.clear();
  vi.useRealTimers();
});

const achievement = (id: string): Achievement => ({
  id,
  name: `Achievement ${id}`,
  description: `Did ${id}`,
  icon: 'sparkle',
  isMet: () => true,
});

function Harness({ initial }: { initial: readonly Achievement[] }) {
  const [pending, setPending] = useState(initial);
  return (
    <>
      <StatusToastHost />
      <AchievementToast pending={pending} onDismiss={() => setPending([])} />
    </>
  );
}

const advance = (ms: number): void => {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
};
const shown = (text: string) => screen.queryAllByText(text, { exact: false }).length > 0;

describe('compact status notices', () => {
  it('never drops the notice on screen when the queue overflows', () => {
    render(<StatusToastHost />);
    act(() => {
      for (let i = 1; i <= 8; i++) notify(`Notice ${i}`);
    });
    expect(shown('Notice 1')).toBe(true);
    expect(shown('Notice 2')).toBe(false);
    // Notice 1 runs out; the newest waiting ones survived the overflow.
    advance(4000);
    expect(shown('Notice 1')).toBe(false);
    expect(shown('Notice 4')).toBe(true);
  });
});

describe('status notices with an action (#651)', () => {
  it('run the action once from its button and close', () => {
    render(<StatusToastHost />);
    const run = vi.fn();
    act(() => {
      notify('Removed Sofa', 'info', { action: { label: 'Undo', run } });
    });
    const undo = screen.getByRole('button', { name: /^Undo/ });
    act(() => {
      undo.click();
    });
    expect(run).toHaveBeenCalledTimes(1);
    expect(shown('Removed Sofa')).toBe(false);
  });

  it('wait while the pointer or the focus is on them', () => {
    compact = false;
    render(<StatusToastHost />);
    act(() => {
      notify('Removed Bed', 'info', { action: { label: 'Undo', run: vi.fn() } });
    });
    const toast = screen.getByRole('status');
    act(() => {
      toast.dispatchEvent(new MouseEvent('pointerover', { bubbles: true }));
    });
    advance(20_000);
    expect(shown('Removed Bed')).toBe(true);
    act(() => {
      toast.dispatchEvent(new MouseEvent('pointerout', { bubbles: true, relatedTarget: document.body }));
      screen.getByRole('button', { name: /^Undo/ }).focus();
    });
    advance(20_000);
    expect(shown('Removed Bed')).toBe(true);
    act(() => {
      screen.getByRole('button', { name: /^Undo/ }).blur();
    });
    advance(7000);
    expect(shown('Removed Bed')).toBe(false);
  });

  it('without an action show no extra button', () => {
    render(<StatusToastHost />);
    act(() => {
      notify('Exported');
    });
    expect(screen.getAllByRole('button').map((button) => button.getAttribute('aria-label'))).toEqual(['Dismiss']);
  });
});

describe('compact achievements', () => {
  it('resume after a status notice instead of replaying in full', () => {
    render(<Harness initial={[achievement('a'), achievement('b')]} />);
    expect(shown('Achievement a')).toBe(true);
    advance(2000);
    act(() => {
      notify('Exported');
    });
    expect(shown('Achievement a')).toBe(false);
    advance(4000); // the notice's own lifetime
    expect(shown('Exported')).toBe(false);
    expect(shown('Achievement a')).toBe(true);
    // 3500ms in all: 1500ms were left.
    advance(1499);
    expect(shown('Achievement a')).toBe(true);
    advance(1);
    expect(shown('Achievement a')).toBe(false);
    expect(shown('Achievement b')).toBe(true);
  });

  it('do not replay after a rotation across the breakpoint', () => {
    render(<Harness initial={[achievement('a'), achievement('b')]} />);
    advance(3500);
    expect(shown('Achievement b')).toBe(true);
    setCompact(false);
    // The desktop placement carries on with what is left, not what was seen.
    expect(shown('Achievement a')).toBe(false);
    expect(shown('Achievement b')).toBe(true);
    setCompact(true);
    expect(shown('Achievement a')).toBe(false);
    expect(shown('Achievement b')).toBe(true);
    // Its countdown carried over too: it ends on time, and the queue clears.
    advance(3500);
    expect(shown('Achievement b')).toBe(false);
  });

  it('show around a notice that stays until dismissed', () => {
    render(<Harness initial={[achievement('a')]} />);
    act(() => {
      notify('Copy this share link:', 'info', { copyText: 'https://example.test/#layout=x' });
    });
    expect(shown('Copy this share link')).toBe(true);
    expect(shown('Achievement a')).toBe(true);
    advance(3500);
    expect(shown('Achievement a')).toBe(false);
    expect(shown('Copy this share link')).toBe(true);
  });
});

describe('compact achievements and the dock tray', () => {
  it('wait, paused, while the ⋯ tray is open', async () => {
    const panel = document.createElement('div');
    panel.className = 'pc-mode-panel';
    panel.setAttribute('data-more-open', '');
    document.body.appendChild(panel);
    try {
      render(<Harness initial={[achievement('a')]} />);
      expect(shown('Achievement a')).toBe(false);
      advance(10_000);
      await act(async () => {
        panel.removeAttribute('data-more-open');
        await Promise.resolve(); // MutationObserver callbacks are microtasks
      });
      expect(shown('Achievement a')).toBe(true);
      advance(3500);
      expect(shown('Achievement a')).toBe(false);
    } finally {
      panel.remove();
    }
  });
});

describe('desktop achievements (#461)', () => {
  beforeEach(() => {
    compact = false;
  });

  it('play one at a time above the mode panel, each with its own timer', () => {
    render(<Harness initial={[achievement('a'), achievement('b')]} />);
    expect(shown('Achievement a')).toBe(true);
    expect(shown('Achievement b')).toBe(false);
    expect(shown('1 more')).toBe(true);
    const host = screen.getByRole('status').parentElement;
    expect(host?.style.bottom).toContain('--pc-mode-top');
    advance(4499);
    expect(shown('Achievement a')).toBe(true);
    advance(1);
    expect(shown('Achievement a')).toBe(false);
    expect(shown('Achievement b')).toBe(true);
    advance(4500);
    expect(shown('Achievement b')).toBe(false);
  });

  it('a new unlock queues behind the one on screen without restarting its countdown', () => {
    function Growing() {
      const [pending, setPending] = useState<readonly Achievement[]>([achievement('a')]);
      return (
        <>
          <button type="button" onClick={() => setPending((list) => [...list, achievement('c')])}>
            unlock
          </button>
          <AchievementToast pending={pending} onDismiss={() => setPending([])} />
        </>
      );
    }
    render(<Growing />);
    advance(3000);
    act(() => {
      screen.getByText('unlock').click();
    });
    advance(1500);
    expect(shown('Achievement a')).toBe(false);
    expect(shown('Achievement c')).toBe(true);
  });

  it('hold their countdown while hovered', () => {
    render(<Harness initial={[achievement('a')]} />);
    const host = screen.getByRole('status').parentElement!;
    act(() => {
      host.dispatchEvent(new MouseEvent('pointerover', { bubbles: true }));
    });
    advance(10_000);
    expect(shown('Achievement a')).toBe(true);
    act(() => {
      host.dispatchEvent(new MouseEvent('pointerout', { bubbles: true, relatedTarget: document.body }));
    });
    advance(4500);
    expect(shown('Achievement a')).toBe(false);
  });
});
