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
    // The stacked host shows what is left, not what was already seen.
    expect(shown('Achievement a')).toBe(false);
    expect(shown('Achievement b')).toBe(true);
    setCompact(true);
    // Everything was on screen already: the queue clears.
    expect(shown('Achievement a')).toBe(false);
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
