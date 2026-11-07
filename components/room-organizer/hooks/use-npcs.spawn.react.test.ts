// @vitest-environment jsdom
import { renderHook } from '@testing-library/react';
import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { useNpcs } from './use-npcs';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('walkers spawned while the frame budget is paused (#671 review)', () => {
  it('are posed, shadowed and painted at once, without waiting for a budget step', () => {
    const scene = new THREE.Scene();
    const invalidate = vi.fn();
    const requestShadowUpdate = vi.fn();
    // A budget that never ticks: a hidden tab.
    const steps: Array<(delta: number) => boolean> = [];
    const addDecorativeStep = vi.fn((step: (delta: number) => boolean) => {
      steps.push(step);
      return () => {};
    });
    renderHook(() =>
      useNpcs({
        enabled: true,
        threeModuleRef: { current: THREE as unknown as typeof import('../three/three-runtime') },
        sceneRef: { current: scene },
        roomWidth: 6,
        roomDepth: 6,
        items: [],
        keepOut: [],
        floorY: 0,
        invalidate,
        requestShadowUpdate,
        addDecorativeStep,
      })
    );
    expect(scene.children.filter((child) => child.userData.type === 'npc')).toHaveLength(3);
    expect(requestShadowUpdate).toHaveBeenCalled();
    expect(invalidate).toHaveBeenCalled();
    // The walk itself still runs on the budget.
    expect(steps).toHaveLength(1);
  });
});
