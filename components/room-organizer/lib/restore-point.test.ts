import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeFloor, makeItem, makeLayout } from './__testfixtures__/fixtures';
import { snapshotBeforeReplace } from './restore-point';
import { recordSnapshot } from './version-history';

vi.mock('./version-history', () => ({
  recordSnapshot: vi.fn(),
}));

const mockedRecord = vi.mocked(recordSnapshot);

const furnished = () =>
  makeLayout({ name: 'Furnished', floors: [makeFloor({ items: [makeItem()] })] });

describe('snapshotBeforeReplace (#298)', () => {
  beforeEach(() => {
    mockedRecord.mockReset();
    mockedRecord.mockReturnValue(true);
  });

  it('forces a restore point of a furnished layout', () => {
    const layout = furnished();
    snapshotBeforeReplace(layout);
    expect(mockedRecord).toHaveBeenCalledTimes(1);
    expect(mockedRecord).toHaveBeenCalledWith(layout, { force: true });
  });

  it('snapshots when only an upper floor holds items', () => {
    const layout = makeLayout({
      floors: [makeFloor(), makeFloor({ id: 'first', name: 'First Floor', items: [makeItem()] })],
    });
    snapshotBeforeReplace(layout);
    expect(mockedRecord).toHaveBeenCalledWith(layout, { force: true });
  });

  it('snapshots an item-less layout that carries a floor-plan image', () => {
    const layout = makeLayout({ floorPlanImage: 'data:image/png;base64,AAAA' });
    snapshotBeforeReplace(layout);
    expect(mockedRecord).toHaveBeenCalledWith(layout, { force: true });
  });

  it('skips an empty house', () => {
    snapshotBeforeReplace(makeLayout());
    expect(mockedRecord).not.toHaveBeenCalled();
  });

  it('skips a missing layout', () => {
    snapshotBeforeReplace(null);
    snapshotBeforeReplace(undefined);
    expect(mockedRecord).not.toHaveBeenCalled();
  });

  it('swallows a throwing recordSnapshot', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mockedRecord.mockImplementation(() => {
      throw new Error('quota');
    });
    expect(() => snapshotBeforeReplace(furnished())).not.toThrow();
    expect(mockedRecord).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });
});
