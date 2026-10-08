import { describe, expect, it } from 'vitest';
import { sceneWallDisplay } from '../lib/walkthrough-view';
import { otherFloorGhostOpacity } from './use-scene-effects';

describe('otherFloorGhostOpacity', () => {
  it('ghosts the other storeys in cutaway and walls-down with "show all floors" on', () => {
    expect(otherFloorGhostOpacity(true, 'cutaway', false)).toBe(0.25);
    expect(otherFloorGhostOpacity(true, 'down', false)).toBe(0.25);
    expect(otherFloorGhostOpacity(true, 'cutaway', true)).toBeUndefined();
    expect(otherFloorGhostOpacity(false, 'cutaway', false)).toBeUndefined();
  });

  it('draws every storey solid while walking, whatever the orbit mode (#359)', () => {
    for (const mode of ['cutaway', 'down', 'up'] as const) {
      expect(otherFloorGhostOpacity(true, sceneWallDisplay(mode, true), false)).toBeUndefined();
    }
  });
});
