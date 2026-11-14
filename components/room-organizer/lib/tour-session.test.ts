// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MAX_SHARE_HASH_LENGTH } from './share';
import { isTourSession, resetTourPhaseForTests, setTourPhase, subscribeTourPhase, tourPhase, tourPhaseForHash } from './tour-session';

describe('tourPhaseForHash', () => {
  it('opens a share link as a tour', () => {
    expect(tourPhaseForHash('#layout=v2.abc')).toBe('touring');
  });

  it('opens anything else as an ordinary session', () => {
    expect(tourPhaseForHash('')).toBe('none');
    expect(tourPhaseForHash('#layout=')).toBe('none');
    expect(tourPhaseForHash('#other=1')).toBe('none');
  });

  it('refuses a link over the decode budget', () => {
    expect(tourPhaseForHash(`#layout=${'a'.repeat(MAX_SHARE_HASH_LENGTH)}`)).toBe('none');
  });
});

describe('the page phase', () => {
  afterEach(() => {
    resetTourPhaseForTests();
    window.history.replaceState(null, '', window.location.pathname);
  });

  it('reads the hash once, on first use', () => {
    window.history.replaceState(null, '', '#layout=v2.abc');
    expect(isTourSession()).toBe(true);
    // Clearing the hash later (Keep a copy) doesn't end the tour by itself.
    window.history.replaceState(null, '', window.location.pathname);
    expect(tourPhase()).toBe('touring');
  });

  it('tells subscribers about a change, and only a change', () => {
    window.history.replaceState(null, '', '#layout=v2.abc');
    const listener = vi.fn();
    const unsubscribe = subscribeTourPhase(listener);
    setTourPhase('touring');
    expect(listener).not.toHaveBeenCalled();
    setTourPhase('kept');
    expect(listener).toHaveBeenCalledTimes(1);
    expect(isTourSession()).toBe(false);
    unsubscribe();
    setTourPhase('none');
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
