// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { AR_LINK_IMAGE, USDZ_MIME, buildUsdzBlob, quickLookSupported, usdzFileName } from './ar-view';
import { ROOM_TEMPLATES } from './constants';

function docWithRelList(supports: (token: string) => boolean): Pick<Document, 'createElement'> {
  return { createElement: () => ({ relList: { supports } }) } as unknown as Pick<Document, 'createElement'>;
}

describe('AR Quick Look detection (#937)', () => {
  it('is on only where an <a> supports rel="ar"', () => {
    expect(quickLookSupported(docWithRelList((token) => token === 'ar'))).toBe(true);
    expect(quickLookSupported(docWithRelList(() => false))).toBe(false);
  });

  it('is off without a document, a relList or a supports(), and when supports() throws', () => {
    expect(quickLookSupported(undefined)).toBe(false);
    expect(quickLookSupported({ createElement: () => ({}) } as unknown as Pick<Document, 'createElement'>)).toBe(false);
    expect(quickLookSupported({ createElement: () => ({ relList: {} }) } as unknown as Pick<Document, 'createElement'>)).toBe(false);
    expect(
      quickLookSupported(
        docWithRelList(() => {
          throw new TypeError('no supported tokens');
        })
      )
    ).toBe(false);
  });

  it('is off in a desktop browser engine (jsdom)', () => {
    expect(quickLookSupported(document)).toBe(false);
  });
});

describe('the USDZ file (#937)', () => {
  it('is a USDZ archive of the house, its stage first', async () => {
    const blob = await buildUsdzBlob(ROOM_TEMPLATES.bedroom);
    expect(blob.type).toBe(USDZ_MIME);
    const bytes = new Uint8Array(await blob.arrayBuffer());
    // A zip whose first entry is the stage.
    expect([...bytes.subarray(0, 4)]).toEqual([0x50, 0x4b, 0x03, 0x04]);
    expect(new TextDecoder().decode(bytes.subarray(30, 40))).toBe('model.usda');
  });

  it('names the file after the house', () => {
    expect(usdzFileName({ name: 'Maison d’été' })).toMatch(/^maison-d-ete\.usdz$/);
    expect(usdzFileName({ name: '' })).toBe('layout.usdz');
  });

  it('puts an image the CSP allows (data:) in the AR link', () => {
    expect(AR_LINK_IMAGE.startsWith('data:image/svg+xml,')).toBe(true);
    expect(decodeURIComponent(AR_LINK_IMAGE.slice('data:image/svg+xml,'.length))).toMatch(/^<svg /);
  });
});
