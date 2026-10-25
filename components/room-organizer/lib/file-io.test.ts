import { describe, expect, it, vi } from 'vitest';
import { makeFloor, makeItem, makeLayout, makeUnplacedItem } from './__testfixtures__/fixtures';
import { inventoryCsv, readLayoutFromFile, scheduleCsv } from './file-io';
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

const BOM = '﻿';
const rows = (csv: string): string[] => csv.slice(BOM.length).trimEnd().split('\r\n');

describe('inventoryCsv (#430)', () => {
  const layout = makeLayout({
    floors: [
      makeFloor({
        name: 'Rez-de-chaussée',
        zones: [{ id: 'z', name: 'Séjour', color: '#f00', x: -4, z: -4, w: 4, d: 8 }],
        items: [
          makeItem({ id: 'd1', type: 'door', name: 'Door', price: 320, position: { x: -2, z: -4 } }),
          makeItem({
            id: 'd2', type: 'door', name: 'Door', price: 320, position: { x: 2.5, z: -4 },
            rotation: -Math.PI / 2, mirrored: true, locked: true,
          }),
          makeItem({ id: 's', type: 'sofa', name: 'Canapé ☕', category: 'seating', price: 650, position: { x: -1.234, z: 0.5 } }),
          makeUnplacedItem({ id: 'u', name: '=HYPERLINK("x")' }),
        ],
      }),
    ],
  });

  it('starts with a UTF-8 byte-order mark', () => {
    expect(inventoryCsv(layout).startsWith(BOM)).toBe(true);
  });

  it('keeps the original columns first and adds placement, state and zone', () => {
    expect(rows(inventoryCsv(layout))[0]).toBe(
      'Floor,Category,Type,Name,Width (m),Depth (m),Height (m),Colour,Price,X (m),Z (m),Rotation (deg),Mirrored,Locked,Zone'
    );
  });

  it('tells identical doors apart and writes coordinates as plain numbers', () => {
    const [, door1, door2, sofa] = rows(inventoryCsv(layout));
    expect(door1).toBe('Rez-de-chaussée,,door,Door,1.00,1.00,1.00,#ffffff,320,-2,-4,0,no,no,Séjour');
    expect(door2).toBe('Rez-de-chaussée,,door,Door,1.00,1.00,1.00,#ffffff,320,2.5,-4,270,yes,yes,');
    expect(sofa).toBe('Rez-de-chaussée,seating,sofa,Canapé ☕,1.00,1.00,1.00,#ffffff,650,-1.23,0.5,0,no,no,Séjour');
  });

  it('leaves an unplaced item without a position and still guards formulas', () => {
    expect(rows(inventoryCsv(layout))[4]).toBe(
      `Rez-de-chaussée,,chair,"'=HYPERLINK(""x"")",1.00,1.00,1.00,#ffffff,0,,,0,no,no,`
    );
  });
});

describe('scheduleCsv (#430)', () => {
  it('groups identical items per floor with quantity and totals', () => {
    const door = { type: 'door', name: 'Door', price: 320 };
    const layout = makeLayout({
      floors: [
        makeFloor({
          items: [makeItem({ id: 'a', ...door }), makeItem({ id: 'b', ...door }), makeItem({ id: 'c', ...door, color: '#000000' })],
        }),
        makeFloor({ id: 'f1', name: 'Upstairs', items: [makeItem({ id: 'd', ...door })] }),
      ],
    });
    const csv = scheduleCsv(layout);
    expect(csv.startsWith(BOM)).toBe(true);
    expect(rows(csv)).toEqual([
      'Floor,Category,Type,Name,Width (m),Depth (m),Height (m),Colour,Unit price,Qty,Total',
      'Ground Floor,,door,Door,1.00,1.00,1.00,#ffffff,320,2,640',
      'Ground Floor,,door,Door,1.00,1.00,1.00,#000000,320,1,320',
      'Upstairs,,door,Door,1.00,1.00,1.00,#ffffff,320,1,320',
      'All floors,,,,,,,,,4,1280',
    ]);
  });

  it('rounds money to the cent', () => {
    const vase = { type: 'vase', name: 'Vase', price: 12.95 };
    const items = ['a', 'b', 'c', 'd', 'e', 'f'].map((id) => makeItem({ id, ...vase }));
    const layout = makeLayout({
      floors: [makeFloor({ items: [...items, makeItem({ id: 'g', type: 'cup', name: 'Cup', price: 0.1 }), makeItem({ id: 'h', type: 'mug', name: 'Mug', price: 0.2 })] })],
    });
    const lines = rows(scheduleCsv(layout));
    expect(lines[1]).toBe('Ground Floor,,vase,Vase,1.00,1.00,1.00,#ffffff,12.95,6,77.7');
    expect(lines[4]).toBe('All floors,,,,,,,,,8,78');
  });
});

describe('the CSV formula guard (#455)', () => {
  const nameCell = (name: string): string => {
    const layout = makeLayout({ floors: [makeFloor({ items: [makeItem({ name })] })] });
    const row = rows(inventoryCsv(layout))[1]!;
    const prefix = 'Ground Floor,,chair,';
    const suffix = ',1.00,1.00,1.00,#ffffff,0,0,0,0,no,no,';
    expect(row.startsWith(prefix) && row.endsWith(suffix), row).toBe(true);
    return row.slice(prefix.length, row.length - suffix.length);
  };

  it.each([
    ['=cmd()', "'=cmd()"],
    ['+1+1', "'+1+1"],
    ['-2+3', "'-2+3"],
    ['@SUM(A1:A9)', "'@SUM(A1:A9)"],
    ['\t=cmd()', "'\t=cmd()"],
  ])('neutralises a name starting a formula: %j', (name, cell) => {
    expect(nameCell(name)).toBe(cell);
  });

  it('quotes a guarded name that also needs quoting', () => {
    expect(nameCell('=1,2')).toBe(`"'=1,2"`);
    expect(nameCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
  });

  it('writes a quoted "=cmd" so it reads back starting with a quote, which no spreadsheet evaluates', () => {
    expect(nameCell('"=cmd"')).toBe('"""=cmd"""');
  });

  it('leaves ordinary names alone', () => {
    expect(nameCell('Sofa 2-seat')).toBe('Sofa 2-seat');
    expect(nameCell('Lamp @ desk')).toBe('Lamp @ desk');
  });

  it('guards every text column, not just the name', () => {
    const layout = makeLayout({
      floors: [
        makeFloor({
          name: '=floor()',
          zones: [{ id: 'z', name: '@zone', color: '#f00', x: -4, z: -4, w: 8, d: 8 }],
          items: [makeItem({ type: '+type', color: '-color' })],
        }),
      ],
    });
    expect(rows(inventoryCsv(layout))[1]).toBe("'=floor(),,'+type,Chair,1.00,1.00,1.00,'-color,0,0,0,0,no,no,'@zone");
    expect(rows(scheduleCsv(layout))[1]).toBe("'=floor(),,'+type,Chair,1.00,1.00,1.00,'-color,0,1,0");
  });

  it('writes a negative coordinate as a number, not a guarded string', () => {
    const layout = makeLayout({ floors: [makeFloor({ items: [makeItem({ position: { x: -1.5, z: -2 } })] })] });
    expect(rows(inventoryCsv(layout))[1]).toContain(',-1.5,-2,');
  });
});
