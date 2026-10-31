import { describe, expect, it, vi } from 'vitest';
import {
  createChannel,
  lockedMessage,
  lockedNote,
  noticeDuration,
  notify,
  notifyRefused,
  notifyWithUndo,
  removedMessage,
  removedNames,
  requestZoneName,
  subscribeNotices,
  subscribeZoneNameRequests,
  UNDO_STALE_MESSAGE,
  type Notice,
} from './editor-notices';

describe('createChannel', () => {
  it('delivers to every subscriber until it unsubscribes', () => {
    const channel = createChannel<number>();
    const a = vi.fn();
    const b = vi.fn();
    const stopA = channel.subscribe(a);
    channel.subscribe(b);
    channel.emit(1);
    stopA();
    channel.emit(2);
    expect(a.mock.calls).toEqual([[1]]);
    expect(b.mock.calls).toEqual([[1], [2]]);
  });

  it('tolerates a listener unsubscribing while it is being notified', () => {
    const channel = createChannel<string>();
    const later = vi.fn();
    const stop = channel.subscribe(() => stop());
    channel.subscribe(later);
    channel.emit('x');
    expect(later).toHaveBeenCalledWith('x');
  });
});

describe('notify', () => {
  it('publishes notices with increasing ids and only the options given', () => {
    const seen: Notice[] = [];
    const stop = subscribeNotices((notice) => seen.push(notice));
    notify('Saved', 'success');
    notify('Copy this link', 'info', { copyText: 'https://example.test/#x' });
    stop();
    notify('unheard');
    expect(seen).toHaveLength(2);
    expect(seen[0]).toEqual({ id: seen[0]!.id, message: 'Saved', tone: 'success' });
    expect('copyText' in seen[0]!).toBe(false);
    expect(seen[1]!.copyText).toBe('https://example.test/#x');
    expect(seen[1]!.id).toBeGreaterThan(seen[0]!.id);
  });

  it('defaults to the info tone', () => {
    let tone: string | undefined;
    const stop = subscribeNotices((notice) => {
      tone = notice.tone;
    });
    notify('hello');
    stop();
    expect(tone).toBe('info');
  });
});

describe('noticeDuration', () => {
  it('keeps errors up longer and copy-by-hand notices until dismissed', () => {
    const base = { id: 1, message: 'm' };
    expect(noticeDuration({ ...base, tone: 'info' })).toBe(4000);
    expect(noticeDuration({ ...base, tone: 'error' })).toBeGreaterThan(4000);
    expect(noticeDuration({ ...base, tone: 'info', copyText: 'u' })).toBeNull();
  });
});

describe('zone name requests', () => {
  it('reach the subscriber with the zone id', () => {
    const listener = vi.fn();
    const stop = subscribeZoneNameRequests(listener);
    requestZoneName('zone-1');
    stop();
    requestZoneName('zone-2');
    expect(listener.mock.calls).toEqual([['zone-1']]);
  });
});

describe('notice actions (#651)', () => {
  it('carry the action only when one is given, and linger like errors', () => {
    const seen: Notice[] = [];
    const stop = subscribeNotices((notice) => seen.push(notice));
    const run = vi.fn();
    notify('Removed Sofa', 'info', { action: { label: 'Undo', run } });
    notify('plain');
    stop();
    expect(seen[0]!.action?.label).toBe('Undo');
    expect('action' in seen[1]!).toBe(false);
    expect(noticeDuration(seen[0]!)).toBe(7000);
    expect(noticeDuration(seen[1]!)).toBe(4000);
  });

  it('undoes only while the state the edit left is still current', () => {
    const seen: Notice[] = [];
    const stop = subscribeNotices((notice) => seen.push(notice));
    let state: object = { v: 1 };
    const undo = vi.fn();
    const notice = notifyWithUndo('Removed Sofa', { current: () => state, undo });
    notice.action!.run();
    expect(undo).toHaveBeenCalledTimes(1);

    const stale = notifyWithUndo('Removed Bed', { current: () => state, undo });
    state = { v: 2 };
    stale.action!.run();
    stop();
    expect(undo).toHaveBeenCalledTimes(1);
    expect(seen.at(-1)!.message).toBe(UNDO_STALE_MESSAGE);
  });

  it('names one item, or counts several', () => {
    expect(removedMessage(['Sofa'])).toBe('Removed Sofa');
    expect(removedMessage(['Sofa', 'Bed', 'Lamp'])).toBe('Removed 3 items');
    expect(removedMessage(['Sofa', 'Bed'], 'Ground floor')).toBe('Removed 2 items from Ground floor');
  });

  it('finds what a removal took away', () => {
    const before = [
      { id: 'a', name: 'Sofa' },
      { id: 'b', name: 'Bed' },
      { id: 'door', name: 'Front door' },
    ];
    expect(removedNames(before, [{ id: 'door' }])).toEqual(['Sofa', 'Bed']);
    expect(removedNames(before, before)).toEqual([]);
  });
});

describe('notifyRefused (#588, #642)', () => {
  it('plays the refused cue once and raises an error notice', () => {
    const seen: Notice[] = [];
    const stop = subscribeNotices((notice) => seen.push(notice));
    const playCue = vi.fn();
    notifyRefused('Over budget: $200 left', playCue);
    stop();
    expect(playCue.mock.calls).toEqual([['refused']]);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ message: 'Over budget: $200 left', tone: 'error' });
  });
});

describe('locked item wording (#635)', () => {
  it('points at U with a keyboard, at the Unlock tile on touch', () => {
    expect(lockedMessage('Sofa', false)).toBe('Sofa is locked. Press U or Unlock to move or turn it.');
    expect(lockedMessage('Sofa', true)).toBe('Sofa is locked. Tap Unlock to move or turn it.');
    expect(lockedNote(true)).toBe('Locked in place. Tap Unlock to move or turn it.');
  });

  it('counts a selection', () => {
    expect(lockedMessage(3, false)).toBe('These 3 items are locked. Press U or Unlock to move or turn them.');
  });
});
