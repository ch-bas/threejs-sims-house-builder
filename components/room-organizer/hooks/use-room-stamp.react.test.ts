// @vitest-environment jsdom
import { renderHook } from '@testing-library/react';
import { act } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { useRoomStamp } from './use-room-stamp';
import type { StampContext } from '../lib/room-stamp';

const context: StampContext = {
  existingWalls: [],
  roomWidth: 10,
  roomDepth: 8,
  porch: null,
  cutout: { corner: 'ne', width: 4, depth: 3 },
};

describe('useRoomStamp on an L (#727)', () => {
  it('the ghost shows what the drop builds: out of the corner', () => {
    const onPlace = vi.fn();
    const { result } = renderHook(() =>
      useRoomStamp({ context, pointer: { x: 3, z: -1.5 }, onPointer: vi.fn(), onPlace, onRefused: vi.fn() })
    );
    act(() => result.current.arm({ shape: 'rectangle', width: 4, depth: 3 }));
    expect(result.current.ghost?.placement).toEqual({ centerX: 3, centerZ: 0.5, width: 4, depth: 3 });
    act(() => result.current.release(3, -1.5));
    expect(onPlace.mock.calls[0]?.[0].placement).toEqual({ centerX: 3, centerZ: 0.5, width: 4, depth: 3 });
  });
});
