import { describe, expect, it } from 'vitest';
import { PhysicsWorld, FIXED_DT } from './PhysicsWorld.js';
import type { Transform } from '@chambler/shared';

function makeTransform(y = 0): Transform {
  return {
    position: { x: 0, y, z: 0 },
    rotation: { w: 1, x: 0, y: 0, z: 0 },
    scale: { x: 1, y: 1, z: 1 },
  };
}

describe('PhysicsWorld', () => {
  it('creates a world and a dynamic body', async () => {
    const pw = await PhysicsWorld.create();
    const body = pw.createBody('b1', {
      type: 'dynamic',
      shape: { kind: 'box', halfExtents: { x: 0.25, y: 0.25, z: 0.25 } },
      transform: makeTransform(2),
    });
    expect(pw.bodyCount()).toBe(1);
    expect(body.rigidBody).toBeTruthy();
    pw.dispose();
  });

  it('steps physics and body falls under gravity', async () => {
    const pw = await PhysicsWorld.create();
    pw.createBody('b1', {
      type: 'dynamic',
      shape: { kind: 'box', halfExtents: { x: 0.25, y: 0.25, z: 0.25 } },
      transform: makeTransform(2),
      canSleep: false,
    });
    const body = pw.getBody('b1')!;
    const y0 = body.rigidBody.translation().y;
    for (let i = 0; i < 30; i++) pw.step();
    const y1 = body.rigidBody.translation().y;
    expect(y1).toBeLessThan(y0);
    pw.dispose();
  });

  it('accumulator reports correct step count for 1/60 s', async () => {
    const pw = await PhysicsWorld.create();
    pw.createBody('b1', {
      type: 'dynamic',
      shape: { kind: 'sphere', radius: 0.25 },
      transform: makeTransform(1),
    });
    const res = pw.step(FIXED_DT);
    expect(pw.lastSteps).toBe(1);
    expect(res).toBeCloseTo(0, 5);
    pw.dispose();
  });

  it('removeBody removes from world', async () => {
    const pw = await PhysicsWorld.create();
    pw.createBody('b1', {
      type: 'dynamic',
      shape: { kind: 'box', halfExtents: { x: 0.1, y: 0.1, z: 0.1 } },
      transform: makeTransform(1),
    });
    expect(pw.hasBody('b1')).toBe(true);
    pw.removeBody('b1');
    expect(pw.hasBody('b1')).toBe(false);
    expect(pw.bodyCount()).toBe(0);
    pw.dispose();
  });
});