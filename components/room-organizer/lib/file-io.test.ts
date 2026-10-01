import { describe, expect, it, vi } from 'vitest';
import { makeLayout } from './__testfixtures__/fixtures';
import { readLayoutFromFile } from './file-io';
import { MAX_LAYOUT_JSON_BYTES } from './schema';

describe('readLayoutFromFile', () => {
  it('reads a layout file', async () => {
    const layout = makeLayout({ name: 'Imported' });
    const file = new File([JSON.stringify(layout, null, 2)], 'house.json', { type: 'application/json' });
    await expect(readLayoutFromFile(file)).resolves.toEqual(layout);
  });

  it('refuses a file over the size budget without reading it (#332)', async () => {
    const text = vi.fn(() => Promise.resolve('{}'));
    const huge = { size: MAX_LAYOUT_JSON_BYTES + 1, text } as unknown as File;
    await expect(readLayoutFromFile(huge)).rejects.toThrow(/far larger than any house layout/);
    expect(text).not.toHaveBeenCalled();
  });

  it('still refuses a file that is not a layout', async () => {
    const file = new File(['{"name":"x"}'], 'x.json');
    await expect(readLayoutFromFile(file)).rejects.toThrow(/does not match/);
  });
});
