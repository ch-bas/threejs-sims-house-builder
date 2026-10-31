import { describe, expect, it, vi } from 'vitest';
import { MAX_SHARE_HASH_LENGTH } from './share';
import { deliverShareLink } from './share-delivery';

const URL_OK = 'https://example.test/#layout=abc';
const encoded = (url = URL_OK, strippedFloorPlan = false) => Promise.resolve({ url, strippedFloorPlan });
const tooLong = `https://example.test/#${'x'.repeat(MAX_SHARE_HASH_LENGTH * 2)}`;
const refused = () => Promise.reject(new DOMException('No gesture', 'NotAllowedError'));

describe('deliverShareLink (#685)', () => {
  it('starts the clipboard write inside the tap, before the encoding resolves', () => {
    const writeLater = vi.fn((text: Promise<string>) => text.then(() => {}));
    let resolve!: (value: { url: string; strippedFloorPlan: boolean }) => void;
    void deliverShareLink(new Promise((done) => (resolve = done)), { writeLater });
    expect(writeLater).toHaveBeenCalledTimes(1);
    resolve({ url: URL_OK, strippedFloorPlan: false });
  });

  it('hands the link to the deferred write and reports it copied', async () => {
    let written = '';
    const outcome = await deliverShareLink(encoded(URL_OK, true), {
      writeLater: async (text) => {
        written = await text;
      },
    });
    expect(written).toBe(URL_OK);
    expect(outcome).toEqual({ kind: 'copied', strippedFloorPlan: true });
  });

  it('falls back to a plain write where the deferred one fails', async () => {
    const writeText = vi.fn(() => Promise.resolve());
    const outcome = await deliverShareLink(encoded(), { writeLater: refused, writeText });
    expect(writeText).toHaveBeenCalledWith(URL_OK);
    expect(outcome.kind).toBe('copied');
  });

  it('leaves the copy field as the last resort', async () => {
    expect(await deliverShareLink(encoded(), { writeLater: refused, writeText: refused })).toEqual({ kind: 'manual', url: URL_OK });
    expect(await deliverShareLink(encoded(), {})).toEqual({ kind: 'manual', url: URL_OK });
  });

  it('refuses a link that is too long, on either path, and copies nothing', async () => {
    const writeText = vi.fn(() => Promise.resolve());
    const share = vi.fn(() => Promise.resolve());
    const writeLater = (text: Promise<string>) => text.then(() => {});
    expect(await deliverShareLink(encoded(tooLong), { writeLater, writeText })).toEqual({ kind: 'too-large' });
    expect(await deliverShareLink(encoded(tooLong), { share, writeText })).toEqual({ kind: 'too-large' });
    expect(writeText).not.toHaveBeenCalled();
    expect(share).not.toHaveBeenCalled();
  });

  it('prefers the share sheet, and does not copy as well', async () => {
    const share = vi.fn(() => Promise.resolve());
    const writeLater = vi.fn(() => Promise.resolve());
    const outcome = await deliverShareLink(encoded(), { share, writeLater });
    expect(share).toHaveBeenCalledWith(URL_OK);
    expect(writeLater).not.toHaveBeenCalled();
    expect(outcome.kind).toBe('shared');
  });

  it('says nothing when the sheet is closed', async () => {
    const writeText = vi.fn(() => Promise.resolve());
    const outcome = await deliverShareLink(encoded(), {
      share: () => Promise.reject(new DOMException('Closed', 'AbortError')),
      writeText,
    });
    expect(outcome).toEqual({ kind: 'cancelled' });
    expect(writeText).not.toHaveBeenCalled();
  });

  it('copies when the sheet is refused, else offers it again on a fresh tap', async () => {
    const writeText = vi.fn(() => Promise.resolve());
    expect((await deliverShareLink(encoded(), { share: refused, writeText })).kind).toBe('copied');

    const share = vi.fn<() => Promise<void>>(refused);
    const outcome = await deliverShareLink(encoded(), { share, writeText: refused });
    expect(outcome.kind).toBe('manual');
    if (outcome.kind !== 'manual') return;
    expect(outcome.url).toBe(URL_OK);
    share.mockImplementation(() => Promise.resolve());
    await outcome.share?.();
    expect(share).toHaveBeenCalledTimes(2);
  });
});
