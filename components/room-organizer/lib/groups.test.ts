import { describe, expect, it } from 'vitest';
import { makeItem } from './__testfixtures__/fixtures';
import { expandSelection, groupIdsIn, groupMemberIds, isWholeGroup, remapGroupIds } from './groups';

const items = [
  makeItem({ id: 'a', groupId: 'g1' }),
  makeItem({ id: 'b', groupId: 'g1' }),
  makeItem({ id: 'c', groupId: 'g1' }),
  makeItem({ id: 'd', groupId: 'g2' }),
  makeItem({ id: 'e', groupId: 'g2' }),
  makeItem({ id: 'f' }),
];

describe('expandSelection (#154)', () => {
  it('a grouped id selects its whole group, itself included', () => {
    expect([...expandSelection(items, 'b')].sort()).toEqual(['a', 'b', 'c']);
    expect([...expandSelection(items, 'e')].sort()).toEqual(['d', 'e']);
  });

  it('an ungrouped id selects itself only', () => {
    expect([...expandSelection(items, 'f')]).toEqual(['f']);
  });

  it('an unknown id still maps to itself so the selection is never empty', () => {
    expect([...expandSelection(items, 'ghost')]).toEqual(['ghost']);
  });

  it('a group reduced to one survivor behaves like an ungrouped item', () => {
    const survivor = [makeItem({ id: 'a', groupId: 'g1' }), makeItem({ id: 'f' })];
    expect([...expandSelection(survivor, 'a')]).toEqual(['a']);
  });
});

describe('groupMemberIds / groupIdsIn / isWholeGroup (#154)', () => {
  it('lists members of a group and the groups present in a selection', () => {
    expect([...groupMemberIds(items, 'g2')].sort()).toEqual(['d', 'e']);
    expect([...groupIdsIn(items, new Set(['a', 'f']))]).toEqual(['g1']);
    expect([...groupIdsIn(items, new Set(['a', 'e']))].sort()).toEqual(['g1', 'g2']);
    expect(groupIdsIn(items, new Set(['f'])).size).toBe(0);
  });

  it('isWholeGroup is true only for exactly one complete group', () => {
    expect(isWholeGroup(items, new Set(['a', 'b', 'c']))).toBe(true);
    expect(isWholeGroup(items, new Set(['a', 'b']))).toBe(false); // partial
    expect(isWholeGroup(items, new Set(['a', 'b', 'c', 'f']))).toBe(false); // plus a loose item
    expect(isWholeGroup(items, new Set(['a', 'b', 'c', 'd', 'e']))).toBe(false); // two groups
    expect(isWholeGroup(items, new Set(['f']))).toBe(false);
    expect(isWholeGroup(items, new Set())).toBe(false);
  });
});

describe('remapGroupIds (#154)', () => {
  it('gives each source group a fresh id under the tag and keeps loose items loose', () => {
    const copies = remapGroupIds(items, 'paste-1');
    expect(copies.map((item) => item.groupId)).toEqual([
      'paste-1-g0',
      'paste-1-g0',
      'paste-1-g0',
      'paste-1-g1',
      'paste-1-g1',
      undefined,
    ]);
    // Ungrouped entries keep identity; grouped ones are new objects.
    expect(copies[5]).toBe(items[5]);
    expect(copies[0]).not.toBe(items[0]);
  });
});
