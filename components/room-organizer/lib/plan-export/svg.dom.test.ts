// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { makeFloor, makeItem, makeLayout } from '../__testfixtures__/fixtures';
import { buildingToSvg, layoutToSvg } from './svg';

/** What a strict XML parser reports, as browsers, Inkscape and Illustrator read the file. */
function xmlErrors(svg: string): string[] {
  const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
  return [...doc.querySelectorAll('parsererror')].map((node) => node.textContent ?? '');
}

/** Every class XML 1.0 forbids, even as a character reference: C0 controls, lone surrogates, U+FFFE/F. */
const POISON = 'A\u0000\u0001\u0008\u000b\u000c\u000e\u001f\ud83d-\ude00￾￿B';
/** What the text reads once those are gone. */
const CLEAN = 'A-B';

function poisonedLayout() {
  const floor = makeFloor({
    id: `f${POISON}`,
    name: `Floor${POISON}`,
    floorColor: `#fff${POISON}`,
    items: [
      makeItem({ id: 'a', name: `Sofa${POISON}`, type: `sofa${POISON}`, color: `#abc${POISON}`, width: 2, depth: 1, position: { x: 0, z: 0 } }),
      makeItem({ id: 'b', type: 'door', name: `Door${POISON}`, width: 0.9, depth: 0.1, position: { x: 0, z: -4 } }),
    ],
    zones: [{ id: 'z', name: `Zone${POISON}`, color: `#def${POISON}`, x: -3, z: -3, w: 2, d: 2 }],
  });
  return { layout: makeLayout({ name: `House${POISON}`, floors: [floor] }), floor };
}

describe('SVG export parses as XML (#549)', () => {
  it('the parser does reject an illegal character, so these tests can fail', () => {
    expect(xmlErrors('<svg xmlns="http://www.w3.org/2000/svg"><title>A\u0001</title></svg>')).not.toEqual([]);
  });

  it('survives forbidden characters in every text field of one floor', () => {
    const { layout, floor } = poisonedLayout();
    expect(xmlErrors(layoutToSvg(layout, floor, { schedule: true }))).toEqual([]);
  });

  it('survives them on the whole-building sheet too', () => {
    const { layout } = poisonedLayout();
    expect(xmlErrors(buildingToSvg(layout, { schedule: true }))).toEqual([]);
  });

  it('keeps the readable text around them', () => {
    const { layout, floor } = poisonedLayout();
    const doc = new DOMParser().parseFromString(layoutToSvg(layout, floor), 'image/svg+xml');
    expect(doc.querySelector('title')?.textContent).toBe(`House${CLEAN} — Floor${CLEAN}`);
  });

  it('does not leave half an emoji where the schedule cuts a long name', () => {
    // Character 31 of this name is the first half of the emoji.
    const floor = makeFloor({ items: [makeItem({ name: `${'x'.repeat(30)}🛋 and the rest`, position: { x: 0, z: 0 } })] });
    expect(layoutToSvg(makeLayout({ floors: [floor] }), floor, { schedule: true })).not.toMatch(/\p{Cs}/u);
  });
});
