import { describe, expect, it } from 'vitest';
import { hitInteriorWall } from './plan-edit';
import type { InteriorWall } from '../lib/types';

const across: InteriorWall = { id: 'across', x1: -2, z1: 0, x2: 2, z2: 0 };
const down: InteriorWall = { id: 'down', x1: 1, z1: -3, x2: 1, z2: 3 };

describe('hitInteriorWall (#564)', () => {
  it('finds a wall within its thickness and misses past it', () => {
    expect(hitInteriorWall([across], 0, 0.07)?.id).toBe('across');
    expect(hitInteriorWall([across], 0, 0.2)).toBeNull();
  });

  it('widens the target by the slop', () => {
    expect(hitInteriorWall([across], 0, 0.2, 0.15)?.id).toBe('across');
  });

  it('does not reach past the end of the wall', () => {
    expect(hitInteriorWall([across], 2.3, 0, 0.1)).toBeNull();
  });

  it('takes the nearest of two walls', () => {
    expect(hitInteriorWall([across, down], 0.9, 0.05, 0.2)?.id).toBe('across');
    expect(hitInteriorWall([across, down], 0.95, 0.15, 0.2)?.id).toBe('down');
  });

  it('survives a zero-length wall', () => {
    expect(hitInteriorWall([{ id: 'dot', x1: 1, z1: 1, x2: 1, z2: 1 }], 1, 1)?.id).toBe('dot');
  });
});
