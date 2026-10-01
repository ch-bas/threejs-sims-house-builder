import { describe, expect, it, vi } from 'vitest';
import {
  createChannel,
  noticeDuration,
  notify,
  requestZoneName,
  subscribeNotices,
  subscribeZoneNameRequests,
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
