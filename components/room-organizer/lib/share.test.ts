import { beforeAll, describe, expect, it } from 'vitest';
import { makeFloor, makeItem, makeLayout } from './__testfixtures__/fixtures';
import { decodeShareUrl, encodeShareUrl, isShareUrlReasonablySized } from './share';

// share.ts encodes via window.btoa / window.atob. In the Node test environment
// there is no window, so provide a minimal shim backed by Node's global
// btoa/atob before importing exercises the codec.
beforeAll(() => {
  if (typeof (globalThis as { window?: unknown }).window === 'undefined') {
    (globalThis as { window?: unknown }).window = {
      btoa: (s: string) => Buffer.from(s, 'binary').toString('base64'),
      atob: (s: string) => Buffer.from(s, 'base64').toString('binary'),
    };
  }
});

const ORIGIN = 'https://example.com/app';
const PREFIX = '#layout=';

function hashOf(url: string): string {
  return url.slice(url.indexOf(PREFIX));
}

describe('encodeShareUrl / decodeShareUrl roundtrip', () => {
  it('roundtrips a basic layout', () => {
    const layout = makeLayout({ name: 'Roundtrip House' });
    const { url } = encodeShareUrl(layout, ORIGIN);
    expect(url.startsWith(`${ORIGIN}${PREFIX}`)).toBe(true);
    const decoded = decodeShareUrl(hashOf(url));
    expect(decoded).toEqual(layout);
  });

  it('roundtrips unicode and emoji names', () => {
    const layout = makeLayout({ name: 'Château 🏰 des Rêves — 日本語' });
    const { url } = encodeShareUrl(layout, ORIGIN);
    const decoded = decodeShareUrl(hashOf(url));
    expect(decoded!.name).toBe('Château 🏰 des Rêves — 日本語');
  });

  it('roundtrips a layout with items across multiple floors', () => {
    const layout = makeLayout({
      floors: [
        makeFloor({ id: 'g', items: [makeItem({ id: 'a', type: 'sofa' })] }),
        makeFloor({ id: 'u', name: 'First Floor', items: [makeItem({ id: 'b', type: 'bed' })] }),
      ],
    });
    const decoded = decodeShareUrl(hashOf(encodeShareUrl(layout, ORIGIN).url));
    expect(decoded).toEqual(layout);
  });

  it('produces URL-safe base64 (no + / = characters in the payload)', () => {
    const layout = makeLayout({ name: '???>>><<<~~~ padding padding padding' });
    const { url } = encodeShareUrl(layout, ORIGIN);
    const payload = url.slice(url.indexOf(PREFIX) + PREFIX.length);
    expect(payload).not.toMatch(/[+/=]/);
  });
});

describe('encodeShareUrl — floor-plan stripping', () => {
  it('strips a floor-plan image and reports strippedFloorPlan=true', () => {
    const layout = makeLayout({ floorPlanImage: 'data:image/png;base64,AAAA' });
    const { url, strippedFloorPlan } = encodeShareUrl(layout, ORIGIN);
    expect(strippedFloorPlan).toBe(true);
    const decoded = decodeShareUrl(hashOf(url));
    expect(decoded!.floorPlanImage).toBeUndefined();
  });

  it('does not mutate the source layout when stripping', () => {
    const layout = makeLayout({ floorPlanImage: 'data:image/png;base64,AAAA' });
    encodeShareUrl(layout, ORIGIN);
    expect(layout.floorPlanImage).toBe('data:image/png;base64,AAAA');
  });

  it('reports strippedFloorPlan=false when there is no image', () => {
    expect(encodeShareUrl(makeLayout(), ORIGIN).strippedFloorPlan).toBe(false);
  });
});

describe('decodeShareUrl — corrupt input returns null without throwing', () => {
  it('returns null when the hash prefix is missing', () => {
    expect(decodeShareUrl('#other=abc')).toBeNull();
  });

  it('returns null for an empty payload', () => {
    expect(decodeShareUrl(PREFIX)).toBeNull();
  });

  it('returns null for garbage base64 that is not valid JSON', () => {
    expect(decodeShareUrl(`${PREFIX}!!!not-base64!!!`)).toBeNull();
  });

  it('returns null when the payload decodes to a non-layout object', () => {
    const encoded = Buffer.from(JSON.stringify({ foo: 'bar' }), 'binary').toString('base64');
    expect(decodeShareUrl(`${PREFIX}${encoded}`)).toBeNull();
  });
});

describe('isShareUrlReasonablySized', () => {
  it('accepts a short URL and rejects an oversized one', () => {
    expect(isShareUrlReasonablySized('https://x.com/#layout=abc')).toBe(true);
    expect(isShareUrlReasonablySized('x'.repeat(12_001))).toBe(false);
  });
});
